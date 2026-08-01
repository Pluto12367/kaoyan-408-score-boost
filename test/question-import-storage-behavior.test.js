import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const { loadImportConfig } = require('../apps/api/dist/questions/import/import-config.js');
const { ImportStorageService } = require('../apps/api/dist/questions/import/import-storage.service.js');
const { QuestionTemplateService } = require('../apps/api/dist/questions/import/question-template.service.js');
const roots = [];

async function storageFixture() {
  const root = await mkdtemp(join(tmpdir(), 'question-import-'));
  roots.push(root);
  const config = loadImportConfig({
    QUESTION_IMPORT_DATA_DIR: root,
    QUESTION_IMPORT_WEB_ROOT: join(root, '..', 'web-root'),
  });
  return { config, storage: new ImportStorageService(config) };
}

test.afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

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

test('accepts the standard XLSX template without whole-file ZIP parsing', async () => {
  const { config, storage } = await storageFixture();
  const file = await incoming(config, '.xlsx', await new QuestionTemplateService().buildXlsx());

  const stored = await storage.putIncoming(file);
  assert.equal(stored.fileType, 'xlsx');
  assert.match(stored.storageKey, /^temporary\/[a-f0-9-]{36}$/u);
});

test('rejects XLSX central-directory bomb metadata and truncation', async () => {
  const { config, storage } = await storageFixture();
  const template = await new QuestionTemplateService().buildXlsx();
  const central = template.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(central > 0);
  const bomb = Buffer.from(template);
  bomb.writeUInt32LE(30 * 1024 * 1024, central + 24);
  const bombFile = await incoming(config, '.xlsx', bomb);
  await assert.rejects(storage.putIncoming(bombFile));

  const truncatedFile = await incoming(config, '.xlsx', template.subarray(0, -12));
  await assert.rejects(storage.putIncoming(truncatedFile));
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

test('rejects a linked data root before creating private child directories in its target', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'question-import-link-'));
  roots.push(root);
  const target = join(root, 'outside');
  const linked = join(root, 'linked-root');
  await mkdir(target);
  try {
    await symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    context.skip(`links unavailable in this environment: ${String(error)}`);
    return;
  }
  assert.throws(() => loadImportConfig({ QUESTION_IMPORT_DATA_DIR: linked, QUESTION_IMPORT_WEB_ROOT: join(root, 'web') }));
  await assert.rejects(access(join(target, 'incoming')));
});
