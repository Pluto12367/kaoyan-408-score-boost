import { BadRequestException, Inject, Injectable, Optional, PayloadTooLargeException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { loadImportConfig, QUESTION_IMPORT_CONFIG, type ImportConfig } from './import-config';

export type ImportFileType = 'pdf' | 'xlsx' | 'csv';

export interface UploadedImportFile { path: string; filename: string; originalname: string; size: number; }
export interface StoredImportFile { originalFileName: string; storageKey: string; fileSha256: string; fileType: ImportFileType; byteSize: number; }

const SERVER_FILE_NAME = /^[a-f0-9-]{36}$/u;
const MAX_ZIP_ENTRIES = 1_000;
const MAX_XLSX_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_XLSX_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_CENTRAL_BYTES = 1024 * 1024;

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

  async cleanupIncoming(file: UploadedImportFile | undefined): Promise<void> {
    if (!file) return;
    await this.removeIncomingIfSafe(resolve(file.path), file.filename);
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
        if (entries.get('[Content_Types].xml') !== false || entries.get('xl/workbook.xml') !== false) throw new BadRequestException('XLSX workbook structure is invalid');
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

  private readCentralDirectory(buffer: Buffer, entryCount: number): Map<string, boolean> {
    let offset = 0;
    const entries = new Map<string, boolean>();
    let expandedBytes = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > buffer.length) throw new BadRequestException('XLSX central directory entry is truncated');
      if (readUInt32(buffer, offset) !== 0x02014b50) throw new BadRequestException('XLSX central directory entry is invalid');
      const compressed = readUInt32(buffer, offset + 20);
      const expanded = readUInt32(buffer, offset + 24);
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
      if (entryEnd > buffer.length) throw new BadRequestException('XLSX central directory entry is truncated');
      if (expanded === 0xffffffff || compressed === 0xffffffff || expanded > MAX_XLSX_ENTRY_BYTES || expanded > compressed * 100 + 1) throw new BadRequestException('XLSX entry exceeds safe expansion limits');
      expandedBytes += expanded;
      if (expandedBytes > MAX_XLSX_EXPANDED_BYTES) throw new BadRequestException('XLSX exceeds safe expanded size limits');
      let name: string;
      try { name = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(offset + 46, offset + 46 + nameLength)); } catch { throw new BadRequestException('XLSX path encoding is invalid'); }
      if (!name || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')) throw new BadRequestException('XLSX contains an unsafe path');
      entries.set(name, name.endsWith('/'));
      offset = entryEnd;
    }
    return entries;
  }

  private async readExactly(handle: Awaited<ReturnType<typeof open>>, length: number, position: number): Promise<Buffer> {
    const output = Buffer.alloc(length);
    const { bytesRead } = await handle.read(output, 0, length, position);
    if (bytesRead !== length) throw new BadRequestException('XLSX ZIP is truncated');
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
