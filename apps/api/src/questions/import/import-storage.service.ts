import { BadRequestException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve } from 'node:path';
import { loadImportConfig, type ImportConfig } from './import-config';

export type ImportFileType = 'pdf' | 'xlsx' | 'csv';

export interface UploadedImportFile {
  path: string;
  filename: string;
  originalname: string;
  size: number;
}

export interface StoredImportFile {
  originalFileName: string;
  storageKey: string;
  fileSha256: string;
  fileType: ImportFileType;
  byteSize: number;
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

@Injectable()
export class ImportStorageService {
  private readonly config: ImportConfig;

  constructor(config: ImportConfig = loadImportConfig()) {
    this.config = config;
  }

  async putIncoming(file: UploadedImportFile): Promise<StoredImportFile> {
    const incomingPath = resolve(file.path);
    const expectedFileName = basename(incomingPath);

    try {
      if (!isContained(this.config.incomingDirectory, incomingPath) || expectedFileName !== file.filename || !/^[a-f0-9-]{36}\.[a-z0-9]{1,12}$/u.test(expectedFileName)) {
        throw new BadRequestException('Upload did not land in the private incoming directory');
      }
      const fileType = fileTypeFromName(file.originalname);
      const maximum = fileType === 'pdf' ? this.config.maxPdfBytes : this.config.maxTableBytes;
      if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > maximum) {
        throw new PayloadTooLargeException(`Upload exceeds the ${fileType} size limit`);
      }
      const fileSha256 = await this.hashAndValidate(incomingPath, fileType);
      const finalName = `${randomUUID()}.${fileType}`;
      const finalPath = resolve(this.config.temporaryDirectory, finalName);
      if (!isContained(this.config.temporaryDirectory, finalPath)) throw new Error('Unsafe temporary storage destination');
      await rename(incomingPath, finalPath);
      return {
        originalFileName: basename(file.originalname),
        storageKey: `temporary/${finalName}`,
        fileSha256,
        fileType,
        byteSize: file.size,
      };
    } catch (error) {
      await this.removeIncomingIfSafe(incomingPath, expectedFileName);
      throw error;
    }
  }

  private async hashAndValidate(path: string, fileType: ImportFileType): Promise<string> {
    const hash = createHash('sha256');
    let prefix = Buffer.alloc(0);
    let foundNul = false;
    for await (const chunk of createReadStream(path)) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(bytes);
      if (prefix.length < 8) prefix = Buffer.concat([prefix, bytes]).subarray(0, 8);
      if (fileType === 'csv' && bytes.includes(0x00)) foundNul = true;
    }
    if (fileType === 'pdf' && prefix.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new BadRequestException('PDF signature is invalid');
    }
    if (fileType === 'xlsx' && !(prefix[0] === 0x50 && prefix[1] === 0x4b && prefix[2] === 0x03 && prefix[3] === 0x04)) {
      throw new BadRequestException('XLSX ZIP signature is invalid');
    }
    if (fileType === 'csv' && foundNul) throw new BadRequestException('CSV must not contain NUL bytes');
    return hash.digest('hex');
  }

  private async removeIncomingIfSafe(path: string, expectedFileName: string): Promise<void> {
    const resolved = resolve(path);
    if (basename(resolved) !== expectedFileName || !isContained(this.config.incomingDirectory, resolved) || !/^[a-f0-9-]{36}\.[a-z0-9]{1,12}$/u.test(expectedFileName)) return;
    await rm(resolved, { force: true });
  }
}
