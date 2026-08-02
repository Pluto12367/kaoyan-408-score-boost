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
    QUESTION_IMPORT_DISK_STOP_PERCENT: '100',
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

async function workbookLikeZip(entries) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const spreadsheetContentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
const spreadsheetWorkbook = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Questions" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
const spreadsheetRelationships = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
const spreadsheetWorksheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`;

function spreadsheetEntries(overrides = {}) {
  return {
    '[Content_Types].xml': spreadsheetContentTypes,
    'xl/workbook.xml': spreadsheetWorkbook,
    'xl/_rels/workbook.xml.rels': spreadsheetRelationships,
    'xl/worksheets/sheet1.xml': spreadsheetWorksheet,
    ...overrides,
  };
}

async function rejectsWorkbookCases(config, storage, cases) {
  for (const entries of cases) {
    const file = await incoming(config, '.xlsx', await workbookLikeZip(entries));
    await assert.rejects(storage.putIncoming(file));
    await assert.rejects(readFile(file.path));
  }
}

test('rejects a generic ZIP posing as XLSX and removes the exact private incoming file', async () => {
  const { config, storage } = await storageFixture();
  const zip = new JSZip();
  zip.file('not-a-workbook.txt', 'not xlsx');
  const file = await incoming(config, '.xlsx', await zip.generateAsync({ type: 'nodebuffer' }));

  await assert.rejects(storage.putIncoming(file));
  await assert.rejects(readFile(file.path));
});

test('rejects name-only and structurally invalid OOXML workbook ZIPs', async () => {
  const { config, storage } = await storageFixture();
  const cases = [
    { '[Content_Types].xml': '', 'xl/workbook.xml': '', 'payload.txt': 'not a workbook' },
    { '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': spreadsheetWorkbook },
    { '[Content_Types].xml': spreadsheetContentTypes, 'xl/workbook.xml': '<workbook/>' },
    { '[Content_Types].xml': spreadsheetContentTypes, 'xl/workbook.xml': spreadsheetWorkbook },
  ];
  for (const entries of cases) {
    const file = await incoming(config, '.xlsx', await workbookLikeZip(entries));
    await assert.rejects(storage.putIncoming(file));
    await assert.rejects(readFile(file.path));
  }
});

test('rejects malformed and namespace-unbound workbook XML', async () => {
  const { config, storage } = await storageFixture();
  await rejectsWorkbookCases(config, storage, [
    spreadsheetEntries({
      'xl/workbook.xml': `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Questions" sheetId="1" r:id="rId1"/></workbook>`,
    }),
    spreadsheetEntries({
      'xl/workbook.xml': `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Questions" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    }),
    spreadsheetEntries({
      'xl/workbook.xml': `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="urn:not-office-relationships"><sheets><sheet name="Questions" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    }),
  ]);
});

test('rejects missing or incorrectly namespaced worksheet content types', async () => {
  const { config, storage } = await storageFixture();
  const missingWorksheetType = spreadsheetContentTypes.replace(/\s*<Override PartName="\/xl\/worksheets\/sheet1\.xml"[^>]*\/>/u, '');
  const wrongNamespace = spreadsheetContentTypes.replace(
    '<Override PartName="/xl/worksheets/sheet1.xml"',
    '<Override xmlns="urn:not-opc-content-types" PartName="/xl/worksheets/sheet1.xml"',
  );
  await rejectsWorkbookCases(config, storage, [
    spreadsheetEntries({ '[Content_Types].xml': missingWorksheetType }),
    spreadsheetEntries({ '[Content_Types].xml': wrongNamespace }),
  ]);
});

test('rejects DTD and entity declarations in XLSX structural XML', async () => {
  const { config, storage } = await storageFixture();
  const withDtd = spreadsheetContentTypes.replace(
    '<Types ',
    '<!DOCTYPE Types [<!ENTITY forbidden "value">]>\n<Types ',
  );
  await rejectsWorkbookCases(config, storage, [
    spreadsheetEntries({ '[Content_Types].xml': withDtd }),
  ]);
});

test('rejects malformed, incorrectly namespaced, or forged worksheet relationships', async () => {
  const { config, storage } = await storageFixture();
  const wrongElementNamespace = spreadsheetRelationships.replace(
    '<Relationship Id=',
    '<Relationship xmlns="urn:not-package-relationships" Id=',
  );
  const forgedType = spreadsheetRelationships.replace(
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
    'https://attacker.invalid/worksheet',
  );
  const malformed = spreadsheetRelationships.replace('</Relationships>', '');
  const outsideWorksheetDirectory = spreadsheetEntries({
    '[Content_Types].xml': spreadsheetContentTypes.replaceAll('/xl/worksheets/sheet1.xml', '/xl/styles.xml'),
    'xl/_rels/workbook.xml.rels': spreadsheetRelationships.replace('worksheets/sheet1.xml', 'styles.xml'),
    'xl/worksheets/sheet1.xml': undefined,
    'xl/styles.xml': spreadsheetWorksheet,
  });
  delete outsideWorksheetDirectory['xl/worksheets/sheet1.xml'];
  await rejectsWorkbookCases(config, storage, [
    spreadsheetEntries({ 'xl/_rels/workbook.xml.rels': wrongElementNamespace }),
    spreadsheetEntries({ 'xl/_rels/workbook.xml.rels': forgedType }),
    spreadsheetEntries({ 'xl/_rels/workbook.xml.rels': malformed }),
    outsideWorksheetDirectory,
  ]);
});

test('rejects plain-text and incorrectly namespaced worksheet parts', async () => {
  const { config, storage } = await storageFixture();
  await rejectsWorkbookCases(config, storage, [
    spreadsheetEntries({ 'xl/worksheets/sheet1.xml': 'not xml' }),
    spreadsheetEntries({
      'xl/worksheets/sheet1.xml': '<worksheet xmlns="urn:not-spreadsheetml"><sheetData/></worksheet>',
    }),
  ]);
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

test('readExactly fills its buffer across short reads', async () => {
  const { storage } = await storageFixture();
  const source = Buffer.from('short reads must be retried');
  let calls = 0;
  const handle = {
    async read(target, offset, length, position) {
      calls += 1;
      const bytesRead = Math.min(3, length, source.length - position);
      source.copy(target, offset, position, position + bytesRead);
      return { bytesRead };
    },
  };
  const output = await storage.readExactly(handle, source.length, 0);
  assert.deepEqual(output, source);
  assert.ok(calls > 1);
});
