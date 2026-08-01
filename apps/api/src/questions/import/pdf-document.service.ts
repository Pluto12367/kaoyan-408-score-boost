import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ImportStorageService } from './import-storage.service';

export interface PdfPageRange { pageStart: number; pageEnd: number; }
export interface StoredFile { storageKey: string; sha256: string; mediaType: string; byteSize: number; pageStart: number; pageEnd: number; }

const MAX_PROVIDER_PAGES = 200;
const PROCESS_TIMEOUT_MS = 10 * 60_000;
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;

export function splitPageRanges(pageCount: number, maximum = MAX_PROVIDER_PAGES): PdfPageRange[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new BadRequestException('PDF must contain at least one page');
  if (!Number.isInteger(maximum) || maximum < 1) throw new BadRequestException('PDF page chunk size is invalid');
  const ranges: PdfPageRange[] = [];
  for (let pageStart = 1; pageStart <= pageCount; pageStart += maximum) ranges.push({ pageStart, pageEnd: Math.min(pageCount, pageStart + maximum - 1) });
  return ranges;
}

@Injectable()
export class PdfDocumentService {
  constructor(private readonly storage: ImportStorageService) {}

  async pageCount(storageKey: string): Promise<number> {
    const source = await this.storage.resolveTemporaryPdfPath(storageKey);
    const output = await runPdfProcess('qpdf', ['--show-npages', source]);
    const count = Number.parseInt(output.trim(), 10);
    if (!Number.isInteger(count) || count < 1 || String(count) !== output.trim()) throw new BadRequestException('qpdf returned an invalid page count');
    return count;
  }

  async split(storageKey: string, ranges: PdfPageRange[]): Promise<StoredFile[]> {
    const source = await this.storage.resolveTemporaryPdfPath(storageKey);
    const destinationDirectory = resolve(dirname(source), 'provider-splits');
    await mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
    const files: StoredFile[] = [];
    for (const range of ranges) {
      if (!Number.isInteger(range.pageStart) || !Number.isInteger(range.pageEnd) || range.pageStart < 1 || range.pageEnd < range.pageStart) throw new BadRequestException('Document split page range is invalid');
      const id = randomUUID();
      const pending = resolve(destinationDirectory, `${id}.pending.pdf`);
      const output = resolve(destinationDirectory, `${id}.pdf`);
      await runPdfProcess('qpdf', [source, '--pages', '.', `${range.pageStart}-${range.pageEnd}`, '--', pending]);
      await rename(pending, output);
      const metadata = await stat(output);
      if (!metadata.isFile() || metadata.size <= 0) throw new BadRequestException('qpdf created an empty split PDF');
      await this.storage.registerProviderSplitArtifact(id, range.pageStart, range.pageEnd);
      files.push({ storageKey: `provider-split/${id}`, sha256: await sha256File(output), mediaType: 'application/pdf', byteSize: metadata.size, ...range });
    }
    return files;
  }
}

async function sha256File(path: string): Promise<string> {
  const data = await import('node:fs/promises').then(({ readFile }) => readFile(path));
  return createHash('sha256').update(data).digest('hex');
}

export function runPdfProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let output = '';
    let overflow = false;
    const append = (chunk: Buffer) => {
      if (output.length >= MAX_PROCESS_OUTPUT_BYTES) { overflow = true; return; }
      output += chunk.toString('utf8').slice(0, MAX_PROCESS_OUTPUT_BYTES - output.length);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => child.kill('SIGKILL'), PROCESS_TIMEOUT_MS);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (overflow) return reject(new BadRequestException('PDF command output exceeded the safety limit'));
      if (code !== 0) return reject(new BadRequestException(`PDF command failed (${code ?? 'signal'})`));
      resolveOutput(output);
    });
  });
}
