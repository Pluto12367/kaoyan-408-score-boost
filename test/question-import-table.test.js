import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');
const { TableImportParser } = require('../apps/api/dist/questions/import/table-import.parser.js');
const { QuestionTemplateService } = require('../apps/api/dist/questions/import/question-template.service.js');

const headers = ['科目', '章节', '知识点', '题型', '难度', '题干', '选项 A', '选项 B', '选项 C', '选项 D', '正确答案', '答案解析', '来源', '年份', '建议答题时间（秒）'];
const row = ['操作系统', '进程管理', '进程同步与互斥', '选择题', '中等', '哪个内容包含逗号, 仍是题干？', '进程同步', '磁盘调度', '地址转换', '文件分配', 'A', '解析', '合法原创资料', '2026', '90'];

async function workbookBuffer(rows = [row]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('题库导入');
  sheet.addRow(headers);
  rows.forEach((values) => sheet.addRow(values));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('parses xlsx and UTF-8 BOM CSV quoted commas into the same source row fields', async () => {
  const parser = new TableImportParser();
  const xlsx = await parser.parse(await workbookBuffer(), 'questions.xlsx');
  const csv = await parser.parse(Buffer.from(`\uFEFF${headers.join(',')}\r\n操作系统,进程管理,进程同步与互斥,选择题,中等,"哪个内容包含逗号, 仍是题干？",进程同步,磁盘调度,地址转换,文件分配,A,解析,合法原创资料,2026,90`, 'utf8'), 'questions.csv');

  assert.equal(xlsx.issues.length, 0);
  assert.equal(csv.issues.length, 0);
  assert.deepEqual(xlsx.rows, csv.rows);
  assert.equal(xlsx.rows[0].rowNumber, 2);
  assert.equal(xlsx.rows[0].values.题干, '哪个内容包含逗号, 仍是题干？');
});

test('rejects legacy xls input and tables over 1000 data rows', async () => {
  const parser = new TableImportParser();
  const legacy = await parser.parse(Buffer.from('not an excel workbook'), 'questions.xls');
  const tooManyRows = await parser.parse(await workbookBuffer(Array.from({ length: 1001 }, () => row)), 'questions.xlsx');

  assert.deepEqual(legacy.rows, []);
  assert.ok(legacy.issues.some((issue) => issue.code === 'UNSUPPORTED_FILE_TYPE'));
  assert.deepEqual(tooManyRows.rows, []);
  assert.ok(tooManyRows.issues.some((issue) => issue.code === 'ROW_LIMIT_EXCEEDED'));
});

test('reports a formula without a cached result instead of evaluating it', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('题库导入');
  sheet.addRow(headers);
  const worksheetRow = sheet.addRow(row);
  worksheetRow.getCell(6).value = { formula: '1+1' };
  const parser = new TableImportParser();
  const result = await parser.parse(Buffer.from(await workbook.xlsx.writeBuffer()), 'formula.xlsx');

  assert.deepEqual(result.rows, []);
  assert.ok(result.issues.some((issue) => issue.code === 'FORMULA_VALUE_UNAVAILABLE'));
});

test('builds a workbook template with import and instruction sheets plus validation lists', async () => {
  const buffer = await new QuestionTemplateService().buildXlsx();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.getWorksheet('题库导入');
  assert.ok(sheet);
  assert.ok(workbook.getWorksheet('填写说明'));
  assert.deepEqual(sheet.getRow(1).values.slice(1), headers);
  assert.equal(sheet.getCell('A2').dataValidation.type, 'list');
  assert.equal(sheet.getCell('D2').dataValidation.type, 'list');
  assert.equal(sheet.getCell('E2').dataValidation.type, 'list');
  assert.equal(sheet.getCell('K2').dataValidation.type, 'list');
});
