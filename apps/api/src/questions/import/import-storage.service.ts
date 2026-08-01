import { BadRequestException, Inject, Injectable, Optional, PayloadTooLargeException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, posix, relative, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { createInflateRaw } from 'node:zlib';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import { PDFDocument } from 'pdf-lib';
import { loadImportConfig, QUESTION_IMPORT_CONFIG, type ImportConfig } from './import-config';

export type ImportFileType = 'pdf' | 'xlsx' | 'csv';

export interface UploadedImportFile { path: string; filename: string; originalname: string; size: number; }
export interface StoredImportFile { originalFileName: string; storageKey: string; fileSha256: string; fileType: ImportFileType; byteSize: number; }

const SERVER_FILE_NAME = /^[a-f0-9-]{36}$/u;
const MAX_ZIP_ENTRIES = 1_000;
const MAX_XLSX_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_XLSX_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_CENTRAL_BYTES = 1024 * 1024;
const MAX_XLSX_STRUCTURE_BYTES = 1024 * 1024;
const OPC_CONTENT_TYPES_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/content-types';
const OPC_RELATIONSHIPS_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const SPREADSHEETML_NAMESPACE = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const OFFICE_RELATIONSHIPS_NAMESPACE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WORKBOOK_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const WORKSHEET_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const WORKSHEET_RELATIONSHIP_TYPE = `${OFFICE_RELATIONSHIPS_NAMESPACE}/worksheet`;

interface ZipEntry {
  name: string;
  directory: boolean;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

interface WorkbookRelationship {
  type: string;
  target: string;
  targetMode?: string;
}

function isContained(parent: string, candidate: string): boolean {
  const remainder = relative(parent, candidate);
  return remainder !== '' && !remainder.startsWith('..') && !isAbsolute(remainder);
}

function fileTypeFromName(fileName: string): ImportFileType {
  const extension = extname(fileName).toLowerCase();
  const base = fileName.slice(0, -extension.length);
  if (!base || base.includes('.') || !['.pdf', '.xlsx', '.csv'].includes(extension)) {
    throw new BadRequestException('Only single-extension PDF, XLSX, and CSV files are supported');
  }
  return extension.slice(1) as ImportFileType;
}

function readUInt32(buffer: Buffer, offset: number): number {
  if (offset + 4 > buffer.length) throw new BadRequestException('XLSX central directory is truncated');
  return buffer.readUInt32LE(offset);
}

function readUInt16(buffer: Buffer, offset: number): number {
  if (offset + 2 > buffer.length) throw new BadRequestException('XLSX central directory is truncated');
  return buffer.readUInt16LE(offset);
}

@Injectable()
export class ImportStorageService {
  private readonly config: ImportConfig;

  constructor(@Optional() @Inject(QUESTION_IMPORT_CONFIG) config?: ImportConfig) { this.config = config ?? loadImportConfig(); }

  async putIncoming(file: UploadedImportFile): Promise<StoredImportFile> {
    const incomingPath = resolve(file.path);
    const ownedBasename = basename(incomingPath);
    try {
      await this.assertIncomingFile(incomingPath, file.filename, ownedBasename);
      const fileType = fileTypeFromName(file.originalname);
      const actual = await stat(incomingPath);
      const maximum = fileType === 'pdf' ? this.config.maxPdfBytes : this.config.maxTableBytes;
      if (!actual.isFile() || actual.size <= 0 || actual.size !== file.size || actual.size > maximum) {
        throw new PayloadTooLargeException(`Upload exceeds the ${fileType} size limit`);
      }
      const fileSha256 = await this.hashAndValidate(incomingPath, fileType);
      const finalName = randomUUID();
      const finalPath = resolve(this.config.temporaryDirectory, finalName);
      await this.assertTrustedParent(this.config.temporaryDirectory, finalPath);
      await rename(incomingPath, finalPath);
      return { originalFileName: basename(file.originalname), storageKey: `temporary/${finalName}`, fileSha256, fileType, byteSize: actual.size };
    } catch (error) {
      await this.removeIncomingIfSafe(incomingPath, ownedBasename);
      throw error;
    }
  }

  async removeTemporary(storageKey: string): Promise<void> {
    const match = /^temporary\/([a-f0-9-]{36})$/u.exec(storageKey);
    if (!match) return;
    const filePath = resolve(this.config.temporaryDirectory, match[1]);
    await this.assertTrustedParent(this.config.temporaryDirectory, filePath);
    await rm(filePath, { force: true });
  }

  async readTemporary(storageKey: string): Promise<Buffer> {
    const match = /^temporary\/([a-f0-9-]{36})$/u.exec(storageKey);
    if (!match) throw new BadRequestException('Question import storage key is invalid');
    const filePath = resolve(this.config.temporaryDirectory, match[1]);
    await this.assertTrustedParent(this.config.temporaryDirectory, filePath);
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new BadRequestException('Question import file is unavailable');
    if (metadata.size > this.config.maxTableBytes) throw new PayloadTooLargeException('Question import table exceeds its size limit');
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of createReadStream(filePath)) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.length;
      if (total > this.config.maxTableBytes) throw new PayloadTooLargeException('Question import table exceeds its size limit');
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, total);
  }

  /** Resolves a server-owned PDF to an absolute private path for a document provider. */
  async resolveTemporaryPdfPath(storageKey: string): Promise<string> {
    const filePath = await this.resolveTemporaryPath(storageKey);
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > this.config.maxPdfBytes) throw new BadRequestException('Question import PDF is unavailable');
    const prefix = Buffer.alloc(5);
    const handle = await open(filePath, 'r');
    try { await handle.read(prefix, 0, prefix.length, 0); } finally { await handle.close(); }
    if (prefix.toString('ascii') !== '%PDF-') throw new BadRequestException('PDF signature is invalid');
    return filePath;
  }

  /** Creates a distinct, private document-provider artifact for one planned page range. */
  async createProviderSplitArtifact(sourceStorageKey: string, pageStart: number, pageEnd: number): Promise<{ storageKey: string; pageStart: number; pageEnd: number }> {
    if (!Number.isInteger(pageStart) || !Number.isInteger(pageEnd) || pageStart < 1 || pageEnd < pageStart) throw new BadRequestException('Document split page range is invalid');
    const sourcePath = await this.resolveTemporaryPdfPath(sourceStorageKey);
    const splitDirectory = await this.providerSplitDirectory();
    const splitId = randomUUID();
    const splitPath = resolve(splitDirectory, `${splitId}.pdf`);
    const metadataPath = resolve(splitDirectory, `${splitId}.json`);
    let splitBytes: Uint8Array;
    try {
      const source = await PDFDocument.load(await readFile(sourcePath));
      if (pageEnd > source.getPageCount()) throw new BadRequestException('Document split page range exceeds the source PDF');
      const split = await PDFDocument.create();
      const pages = await split.copyPages(source, Array.from({ length: pageEnd - pageStart + 1 }, (_, index) => pageStart - 1 + index));
      for (const page of pages) split.addPage(page);
      splitBytes = await split.save();
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Document split PDF could not be created');
    }
    await writeFile(splitPath, splitBytes, { flag: 'wx', mode: 0o600 });
    try {
      await writeFile(metadataPath, JSON.stringify({ pageStart, pageEnd }), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      await rm(splitPath, { force: true });
      throw error;
    }
    return { storageKey: `provider-split/${splitId}`, pageStart, pageEnd };
  }

  /** Resolves only a server-created split artifact and verifies its planned page range. */
  async resolveProviderSplitPdfPath(storageKey: string, pageStart: number, pageEnd: number): Promise<string> {
    const { filePath, metadata } = await this.providerSplitPaths(storageKey);
    if (metadata.pageStart !== pageStart || metadata.pageEnd !== pageEnd) throw new BadRequestException('Document split page range does not match its provider job');
    const file = await lstat(filePath);
    if (!file.isFile() || file.isSymbolicLink() || file.size <= 0 || file.size > this.config.maxPdfBytes) throw new BadRequestException('Document split PDF is unavailable');
    const prefix = Buffer.alloc(5);
    const handle = await open(filePath, 'r');
    try { await handle.read(prefix, 0, prefix.length, 0); } finally { await handle.close(); }
    if (prefix.toString('ascii') !== '%PDF-') throw new BadRequestException('PDF signature is invalid');
    return filePath;
  }

  async readProviderSplitMetadata(storageKey: string): Promise<{ pageStart: number; pageEnd: number }> {
    return (await this.providerSplitPaths(storageKey)).metadata;
  }

  async resolvePagePreviewJpegPath(storageKey: string): Promise<string> {
    const match = /^page-preview\/([a-f0-9-]{36})$/u.exec(storageKey);
    if (!match) throw new BadRequestException('Question import preview storage key is invalid');
    const path = resolve(this.config.temporaryDirectory, 'page-previews', `${match[1]}.jpg`);
    await this.assertTrustedParent(this.config.temporaryDirectory, path);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0) throw new BadRequestException('Question import preview is unavailable');
    return path;
  }

  /** Records metadata for a qpdf-created private split whose UUID has already been generated by the server. */
  async registerProviderSplitArtifact(id: string, pageStart: number, pageEnd: number): Promise<void> {
    if (!SERVER_FILE_NAME.test(id) || !Number.isInteger(pageStart) || !Number.isInteger(pageEnd) || pageStart < 1 || pageEnd < pageStart) {
      throw new BadRequestException('Document split artifact is invalid');
    }
    const directory = await this.providerSplitDirectory();
    const path = resolve(directory, `${id}.pdf`);
    await this.assertTrustedParent(directory, path);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0) throw new BadRequestException('Document split PDF is unavailable');
    await writeFile(resolve(directory, `${id}.json`), JSON.stringify({ pageStart, pageEnd }), { flag: 'wx', mode: 0o600 });
  }

  /** Persists unexposed provider JSON and optional ZIP bytes under private storage. */
  async putProviderArtifacts<T extends object & { _zipBytes?: Uint8Array | null }>(result: T): Promise<string> {
    const artifactDirectory = resolve(this.config.temporaryDirectory, 'provider');
    await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
    await this.assertTrustedParent(this.config.temporaryDirectory, artifactDirectory);
    const artifactId = randomUUID();
    let zipKey: string | undefined;
    if (result._zipBytes && result._zipBytes.length > 0) {
      const zipPath = resolve(artifactDirectory, `${artifactId}.zip`);
      await writeFile(zipPath, result._zipBytes, { flag: 'wx', mode: 0o600 });
      zipKey = `provider/${artifactId}.zip`;
    }
    const metadata = { ...result } as Record<string, unknown>;
    delete metadata._zipBytes;
    const jsonPath = resolve(artifactDirectory, `${artifactId}.json`);
    await writeFile(jsonPath, JSON.stringify({ result: metadata, ...(zipKey ? { zipKey } : {}) }), { flag: 'wx', mode: 0o600 });
    return `provider/${artifactId}.json`;
  }

  async cleanupIncoming(file: UploadedImportFile | undefined): Promise<void> {
    if (!file) return;
    await this.removeIncomingIfSafe(resolve(file.path), file.filename);
  }

  private async resolveTemporaryPath(storageKey: string): Promise<string> {
    const match = /^temporary\/([a-f0-9-]{36})$/u.exec(storageKey);
    if (!match) throw new BadRequestException('Question import storage key is invalid');
    const filePath = resolve(this.config.temporaryDirectory, match[1]);
    await this.assertTrustedParent(this.config.temporaryDirectory, filePath);
    return filePath;
  }

  private async providerSplitDirectory(): Promise<string> {
    const directory = resolve(this.config.temporaryDirectory, 'provider-splits');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await this.assertTrustedParent(this.config.temporaryDirectory, directory);
    return directory;
  }

  private async providerSplitPaths(storageKey: string): Promise<{ filePath: string; metadata: { pageStart: number; pageEnd: number } }> {
    const match = /^provider-split\/([a-f0-9-]{36})$/u.exec(storageKey);
    if (!match) throw new BadRequestException('Document split storage key is invalid');
    const directory = await this.providerSplitDirectory();
    const filePath = resolve(directory, `${match[1]}.pdf`);
    const metadataPath = resolve(directory, `${match[1]}.json`);
    await this.assertTrustedParent(directory, filePath);
    await this.assertTrustedParent(directory, metadataPath);
    let metadata: unknown;
    try { metadata = JSON.parse(await readFile(metadataPath, 'utf8')); } catch { throw new BadRequestException('Document split metadata is unavailable'); }
    if (!metadata || typeof metadata !== 'object' || !Number.isInteger((metadata as { pageStart?: unknown }).pageStart) || !Number.isInteger((metadata as { pageEnd?: unknown }).pageEnd)) throw new BadRequestException('Document split metadata is invalid');
    const { pageStart, pageEnd } = metadata as { pageStart: number; pageEnd: number };
    if (pageStart < 1 || pageEnd < pageStart) throw new BadRequestException('Document split metadata is invalid');
    return { filePath, metadata: { pageStart, pageEnd } };
  }

  private async hashAndValidate(path: string, fileType: ImportFileType): Promise<string> {
    const hash = createHash('sha256');
    let prefix = Buffer.alloc(0);
    let csvText = '';
    let csvHasComma = false;
    let csvHasNewline = false;
    let csvHasText = false;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      for await (const chunk of createReadStream(path)) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(bytes);
        if (prefix.length < 8) prefix = Buffer.concat([prefix, bytes]).subarray(0, 8);
        if (fileType === 'csv') {
          if (bytes.includes(0x00)) throw new BadRequestException('CSV must not contain NUL bytes');
          const text = decoder.decode(bytes, { stream: true });
          csvText += text.slice(0, Math.max(0, 8_192 - csvText.length));
          csvHasComma ||= text.includes(',');
          csvHasNewline ||= text.includes('\n') || text.includes('\r');
          csvHasText ||= /[^\t\r\n\x00-\x1f\x7f]/u.test(text);
          if (/[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)) throw new BadRequestException('CSV contains binary control bytes');
        }
      }
      if (fileType === 'csv') {
        const tail = decoder.decode();
        csvText += tail.slice(0, Math.max(0, 8_192 - csvText.length));
        csvHasComma ||= tail.includes(',');
        csvHasNewline ||= tail.includes('\n') || tail.includes('\r');
        csvHasText ||= /[^\t\r\n\x00-\x1f\x7f]/u.test(tail);
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('CSV must be valid UTF-8 text');
    }
    if (fileType === 'pdf' && prefix.subarray(0, 5).toString('ascii') !== '%PDF-') throw new BadRequestException('PDF signature is invalid');
    if (fileType === 'xlsx') await this.assertXlsx(path);
    if (fileType === 'csv' && (!csvHasComma || !csvHasNewline || !csvHasText || csvText.length === 0)) {
      throw new BadRequestException('CSV must contain a UTF-8 header row and record structure');
    }
    return hash.digest('hex');
  }

  private async assertXlsx(path: string): Promise<void> {
    try {
      const handle = await open(path, 'r');
      try {
        const size = (await handle.stat()).size;
        const tailSize = Math.min(size, 65_557);
        const tail = await this.readExactly(handle, tailSize, size - tailSize);
        const eocd = this.findEocd(tail);
        const entryCount = tail.readUInt16LE(eocd + 10);
        const directorySize = readUInt32(tail, eocd + 12);
        const directoryOffset = readUInt32(tail, eocd + 16);
        if (entryCount === 0 || entryCount > MAX_ZIP_ENTRIES || directorySize === 0 || directorySize > MAX_ZIP_CENTRAL_BYTES || directoryOffset + directorySize > size) {
          throw new BadRequestException('XLSX ZIP exceeds safe directory limits');
        }
        const entries = this.readCentralDirectory(await this.readExactly(handle, directorySize, directoryOffset), entryCount);
        await this.assertWorkbookStructure(path, handle, size, entries);
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('XLSX ZIP structure is invalid');
    }
  }

  private findEocd(buffer: Buffer): number {
    let eocd = -1;
    for (let index = buffer.length - 22; index >= 0; index -= 1) if (readUInt32(buffer, index) === 0x06054b50) { eocd = index; break; }
    if (eocd < 0) throw new BadRequestException('XLSX ZIP central directory is missing');
    if (eocd + 22 > buffer.length) throw new BadRequestException('XLSX ZIP EOCD is truncated');
    return eocd;
  }

  private readCentralDirectory(buffer: Buffer, entryCount: number): Map<string, ZipEntry> {
    let offset = 0;
    const entries = new Map<string, ZipEntry>();
    let expandedBytes = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > buffer.length) throw new BadRequestException('XLSX central directory entry is truncated');
      if (readUInt32(buffer, offset) !== 0x02014b50) throw new BadRequestException('XLSX central directory entry is invalid');
      const flags = readUInt16(buffer, offset + 8);
      const method = readUInt16(buffer, offset + 10);
      const compressed = readUInt32(buffer, offset + 20);
      const expanded = readUInt32(buffer, offset + 24);
      const nameLength = readUInt16(buffer, offset + 28);
      const extraLength = readUInt16(buffer, offset + 30);
      const commentLength = readUInt16(buffer, offset + 32);
      const localHeaderOffset = readUInt32(buffer, offset + 42);
      const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
      if (entryEnd > buffer.length) throw new BadRequestException('XLSX central directory entry is truncated');
      if ((flags & 0x0001) !== 0 || ![0, 8].includes(method) || expanded === 0xffffffff || compressed === 0xffffffff || localHeaderOffset === 0xffffffff || expanded > MAX_XLSX_ENTRY_BYTES || expanded > compressed * 100 + 1) throw new BadRequestException('XLSX entry exceeds safe expansion limits');
      expandedBytes += expanded;
      if (expandedBytes > MAX_XLSX_EXPANDED_BYTES) throw new BadRequestException('XLSX exceeds safe expanded size limits');
      let name: string;
      try { name = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(offset + 46, offset + 46 + nameLength)); } catch { throw new BadRequestException('XLSX path encoding is invalid'); }
      if (!name || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')) throw new BadRequestException('XLSX contains an unsafe path');
      if (entries.has(name)) throw new BadRequestException('XLSX contains duplicate entry names');
      entries.set(name, { name, directory: name.endsWith('/'), method, compressedSize: compressed, uncompressedSize: expanded, localHeaderOffset });
      offset = entryEnd;
    }
    return entries;
  }

  private async assertWorkbookStructure(path: string, handle: Awaited<ReturnType<typeof open>>, size: number, entries: Map<string, ZipEntry>) {
    const contentTypesXml = await this.readXmlEntry(path, handle, size, this.requiredEntry(entries, '[Content_Types].xml'));
    const workbookXml = await this.readXmlEntry(path, handle, size, this.requiredEntry(entries, 'xl/workbook.xml'));
    const relationshipsXml = await this.readXmlEntry(path, handle, size, this.requiredEntry(entries, 'xl/_rels/workbook.xml.rels'));
    const contentTypes = this.parseContentTypes(contentTypesXml);
    const sheetIds = this.parseWorkbook(workbookXml);
    const relationships = this.parseWorkbookRelationships(relationshipsXml);

    if (contentTypes.get('/xl/workbook.xml') !== WORKBOOK_CONTENT_TYPE) {
      throw new BadRequestException('XLSX workbook content type is invalid');
    }

    const parsedWorksheets = new Set<string>();
    for (const sheetId of sheetIds) {
      const relationship = relationships.get(sheetId);
      if (!relationship || relationship.type !== WORKSHEET_RELATIONSHIP_TYPE || (relationship.targetMode && relationship.targetMode !== 'Internal')) {
        throw new BadRequestException('XLSX workbook has no valid worksheet relationship');
      }
      const worksheetPath = this.resolveWorksheetTarget(relationship.target);
      if (!worksheetPath || contentTypes.get(`/${worksheetPath}`) !== WORKSHEET_CONTENT_TYPE) {
        throw new BadRequestException('XLSX worksheet target or content type is invalid');
      }
      if (parsedWorksheets.has(worksheetPath)) continue;
      const worksheetXml = await this.readXmlEntry(path, handle, size, this.requiredEntry(entries, worksheetPath));
      this.parseWorksheet(worksheetXml);
      parsedWorksheets.add(worksheetPath);
    }
  }

  private requiredEntry(entries: Map<string, ZipEntry>, name: string): ZipEntry {
    const entry = entries.get(name);
    if (!entry || entry.directory) throw new BadRequestException('XLSX workbook structure is invalid');
    return entry;
  }

  private async readXmlEntry(path: string, handle: Awaited<ReturnType<typeof open>>, size: number, entry: ZipEntry): Promise<string> {
    if (entry.compressedSize > MAX_XLSX_STRUCTURE_BYTES || entry.uncompressedSize > MAX_XLSX_STRUCTURE_BYTES) throw new BadRequestException('XLSX structure entry exceeds safe size limits');
    const header = await this.readExactly(handle, 30, entry.localHeaderOffset);
    if (readUInt32(header, 0) !== 0x04034b50 || readUInt16(header, 8) !== entry.method) throw new BadRequestException('XLSX local entry header is invalid');
    const nameLength = readUInt16(header, 26);
    const extraLength = readUInt16(header, 28);
    const name = new TextDecoder('utf-8', { fatal: true }).decode(await this.readExactly(handle, nameLength, entry.localHeaderOffset + 30));
    const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
    if (name !== entry.name || dataStart + entry.compressedSize > size) throw new BadRequestException('XLSX local entry is truncated');
    const content = await this.readBoundedEntry(path, dataStart, entry);
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(content).replace(/^\uFEFF/u, '').trim();
      if (!text.startsWith('<') || !text.endsWith('>') || /[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(text)) throw new Error('not XML-like');
      return text;
    } catch {
      throw new BadRequestException('XLSX workbook XML is not valid UTF-8');
    }
  }

  private async readBoundedEntry(path: string, dataStart: number, entry: ZipEntry): Promise<Buffer> {
    let compressedBytes = 0;
    let expandedBytes = 0;
    const counter = new Transform({ transform: (chunk, _encoding, callback) => {
      compressedBytes += chunk.length;
      callback(compressedBytes > MAX_XLSX_STRUCTURE_BYTES ? new BadRequestException('XLSX structure entry exceeds safe size limits') : undefined, chunk);
    } });
    const source = entry.compressedSize === 0 ? Readable.from([]) : createReadStream(path, { start: dataStart, end: dataStart + entry.compressedSize - 1 });
    const output = entry.method === 8 ? source.pipe(counter).pipe(createInflateRaw()) : source.pipe(counter);
    const chunks: Buffer[] = [];
    for await (const chunk of output) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      expandedBytes += bytes.length;
      if (expandedBytes > MAX_XLSX_STRUCTURE_BYTES) throw new BadRequestException('XLSX structure entry exceeds safe size limits');
      chunks.push(bytes);
    }
    if (compressedBytes !== entry.compressedSize || expandedBytes !== entry.uncompressedSize) throw new BadRequestException('XLSX structure entry is truncated');
    return Buffer.concat(chunks, expandedBytes);
  }

  private parseContentTypes(xml: string): Map<string, string> {
    const overrides = new Map<string, string>();
    this.parseXml(xml, 'content types', (tag, depth) => {
      if (depth === 1) this.assertXmlElement(tag, 'Types', OPC_CONTENT_TYPES_NAMESPACE, 'content types');
      if (depth !== 2 || tag.local !== 'Override' || tag.uri !== OPC_CONTENT_TYPES_NAMESPACE) return;
      const partName = this.xmlAttribute(tag, 'PartName');
      const contentType = this.xmlAttribute(tag, 'ContentType');
      if (!partName || !contentType || overrides.has(partName)) throw new BadRequestException('XLSX content type override is invalid');
      overrides.set(partName, contentType);
    });
    return overrides;
  }

  private parseWorkbook(xml: string): string[] {
    const sheetIds: string[] = [];
    this.parseXml(xml, 'workbook', (tag, depth, parent) => {
      if (depth === 1) this.assertXmlElement(tag, 'workbook', SPREADSHEETML_NAMESPACE, 'workbook');
      if (depth !== 3 || tag.local !== 'sheet' || tag.uri !== SPREADSHEETML_NAMESPACE || parent?.local !== 'sheets' || parent.uri !== SPREADSHEETML_NAMESPACE) return;
      const relationshipId = this.xmlAttribute(tag, 'id', OFFICE_RELATIONSHIPS_NAMESPACE);
      if (!relationshipId || sheetIds.includes(relationshipId)) throw new BadRequestException('XLSX workbook sheet relationship is invalid');
      sheetIds.push(relationshipId);
    });
    if (sheetIds.length === 0) throw new BadRequestException('XLSX workbook has no worksheet');
    return sheetIds;
  }

  private parseWorkbookRelationships(xml: string): Map<string, WorkbookRelationship> {
    const relationships = new Map<string, WorkbookRelationship>();
    this.parseXml(xml, 'workbook relationships', (tag, depth) => {
      if (depth === 1) this.assertXmlElement(tag, 'Relationships', OPC_RELATIONSHIPS_NAMESPACE, 'workbook relationships');
      if (depth !== 2 || tag.local !== 'Relationship' || tag.uri !== OPC_RELATIONSHIPS_NAMESPACE) return;
      const id = this.xmlAttribute(tag, 'Id');
      const type = this.xmlAttribute(tag, 'Type');
      const target = this.xmlAttribute(tag, 'Target');
      const targetMode = this.xmlAttribute(tag, 'TargetMode');
      if (!id || !type || !target || relationships.has(id)) throw new BadRequestException('XLSX workbook relationship is invalid');
      relationships.set(id, { type, target, ...(targetMode ? { targetMode } : {}) });
    });
    return relationships;
  }

  private parseWorksheet(xml: string): void {
    this.parseXml(xml, 'worksheet', (tag, depth) => {
      if (depth === 1) this.assertXmlElement(tag, 'worksheet', SPREADSHEETML_NAMESPACE, 'worksheet');
    });
  }

  private parseXml(xml: string, label: string, onOpenTag: (tag: SaxesTagNS, depth: number, parent?: SaxesTagNS) => void): void {
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(xml)) throw new BadRequestException(`XLSX ${label} XML must not contain DTD or entity declarations`);
    const parser = new SaxesParser<{ xmlns: true }>({ xmlns: true });
    const openTags: SaxesTagNS[] = [];
    parser.on('doctype', () => { throw new BadRequestException(`XLSX ${label} XML must not contain a DTD`); });
    parser.on('opentag', (tag) => {
      const parent = openTags.at(-1);
      openTags.push(tag);
      onOpenTag(tag, openTags.length, parent);
    });
    parser.on('closetag', () => { openTags.pop(); });
    try {
      parser.write(xml).close();
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`XLSX ${label} XML is malformed`);
    }
  }

  private assertXmlElement(tag: SaxesTagNS, local: string, uri: string, label: string): void {
    if (tag.local !== local || tag.uri !== uri) throw new BadRequestException(`XLSX ${label} namespace is invalid`);
  }

  private xmlAttribute(tag: SaxesTagNS, local: string, uri = ''): string | undefined {
    return Object.values(tag.attributes).find((attribute) => attribute.local === local && attribute.uri === uri)?.value;
  }

  private resolveWorksheetTarget(target: string): string | undefined {
    if (target.startsWith('/') || target.includes('\\') || /[\x00-\x1f\x7f%:?#]/u.test(target)) return undefined;
    const segments = target.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return undefined;
    const resolved = posix.join('xl', ...segments);
    return resolved.startsWith('xl/worksheets/') && resolved.length > 'xl/worksheets/'.length ? resolved : undefined;
  }

  private async readExactly(handle: Awaited<ReturnType<typeof open>>, length: number, position: number): Promise<Buffer> {
    const output = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await handle.read(output, offset, length - offset, position + offset);
      if (bytesRead === 0) throw new BadRequestException('XLSX ZIP is truncated');
      offset += bytesRead;
    }
    return output;
  }

  private async assertIncomingFile(path: string, filename: string, ownedBasename: string) {
    if (ownedBasename !== filename || !SERVER_FILE_NAME.test(ownedBasename)) throw new BadRequestException('Upload did not receive a server-generated filename');
    await this.assertTrustedParent(this.config.incomingDirectory, path);
    if ((await lstat(path)).isSymbolicLink()) throw new BadRequestException('Upload path must not be a link');
  }

  private async assertTrustedParent(expectedParent: string, path: string) {
    const parent = await realpath(expectedParent);
    const actualParent = await realpath(dirname(path));
    if (parent !== actualParent || !isContained(parent, resolve(path))) throw new BadRequestException('Upload path escaped private storage');
  }

  private async removeIncomingIfSafe(path: string, ownedBasename: string): Promise<void> {
    if (!SERVER_FILE_NAME.test(ownedBasename) || basename(path) !== ownedBasename) return;
    try {
      await this.assertTrustedParent(this.config.incomingDirectory, path);
      await rm(path, { force: true });
    } catch { /* never widen deletion after a containment failure */ }
  }
}
