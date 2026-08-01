import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ImportStorageService } from './import-storage.service';
import { runPdfProcess } from './pdf-document.service';

export interface QuestionImportAsset { storageKey: string; sha256: string; mediaType: 'image/jpeg'; byteSize: number; pageNumber: number; }

@Injectable()
export class PdfPageRenderer {
  constructor(private readonly storage: ImportStorageService) {}

  async render(storageKey: string, page: number): Promise<QuestionImportAsset> {
    if (!Number.isInteger(page) || page < 1) throw new BadRequestException('PDF page number is invalid');
    const source = await this.storage.resolveTemporaryPdfPath(storageKey);
    const directory = resolve(dirname(source), 'page-previews');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const prefix = resolve(directory, id);
    const path = `${prefix}.jpg`;
    await runPdfProcess('pdftoppm', ['-f', String(page), '-l', String(page), '-singlefile', '-jpeg', '-jpegopt', 'quality=85', source, prefix]);
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size <= 0) throw new BadRequestException('PDF preview could not be created');
    return { storageKey: `page-preview/${id}`, sha256: createHash('sha256').update(await readFile(path)).digest('hex'), mediaType: 'image/jpeg', byteSize: metadata.size, pageNumber: page };
  }
}
