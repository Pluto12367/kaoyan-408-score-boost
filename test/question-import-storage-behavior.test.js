import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const { loadImportConfig } = require('../apps/api/dist/questions/import/import-config.js');
const { ImportStorageService } = require('../apps/api/dist/questions/import/import-storage.service.js');

async function storageFixture() {
  const root = await mkdtemp(join(tmpdir(), 'question-import-'));
  const config = loadImportConfig({
    QUESTION_IMPORT_DATA_DIR: root,
    QUESTION_IMPORT_WEB_ROOT: join(root, '..', 'web-root'),
  });
  return { config, storage: new ImportStorageService(config) };
}

async function incoming(config, extension, content) {
  const filename = randomUUID();
  const path = join(config.incomingDirectory, filename);
  await writeFile(path, content);
  return { path, filename, originalname: `questions${extension}`, size: content.length };
}

test('rejects a generic ZIP posing as XLSX and removes the exact private incoming file', async () => {
  const { config, storage } = await storageFixture();
  const zip = new JSZip();
  zip.file('not-a-workbook.txt', 'not xlsx');
  const file = await incoming(config, '.xlsx', await zip.generateAsync({ type: 'nodebuffer' }));

  await assert.rejects(storage.putIncoming(file));
  await assert.rejects(readFile(file.path));
});

test('rejects malformed UTF-8 CSV and removes it', async () => {
  const { config, storage } = await storageFixture();
  const file = await incoming(config, '.csv', Buffer.from([0xc3, 0x28, 0x2c, 0x0a]));

  await assert.rejects(storage.putIncoming(file));
  await assert.rejects(readFile(file.path));
});

test('cleans a server-generated incoming filename even when its client extension is invalid', async () => {
  const { config, storage } = await storageFixture();
  const file = await incoming(config, '.dangerouslylongextension', Buffer.from('%PDF-1.7\n'));

  await assert.rejects(storage.putIncoming(file));
  await assert.rejects(readFile(file.path));
});
