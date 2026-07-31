import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeCandidateDraft } = require('../packages/shared/dist/questionImport.js');
const { computeContentFingerprint } = require('../packages/shared/dist/questionImport.server.js');

const validRow = {
  科目: ' 操作系统 ',
  章节: '进程管理',
  知识点: '进程同步与互斥',
  题型: '选择题',
  难度: '中等',
  题干: '  PV 操作的主要用途是？ ',
  '选项 A': 'Ａ．进程同步',
  '选项 B': ' B、磁盘调度 ',
  '选项 C': 'Ｃ、地址转换',
  '选项 D': 'Ｄ、文件分配',
  正确答案: ' ａ ',
  答案解析: ' P、V 操作用于同步与互斥。 ',
  来源: ' 合法原创资料 ',
  年份: '2026',
  '建议答题时间（秒）': '90',
};

test('normalizes a valid Chinese choice row and produces a canonical SHA-256 fingerprint', () => {
  const result = normalizeCandidateDraft(validRow, { rowNumber: 2 });

  assert.ok(result.value);
  assert.deepEqual(result.value.options, ['进程同步', '磁盘调度', '地址转换', '文件分配']);
  assert.equal(result.value.source, '合法原创资料');
  assert.equal(result.value.answer, 'A');
  assert.equal(result.value.stem, 'PV 操作的主要用途是?');
  assert.equal(result.issues.length, 0);
  assert.equal(computeContentFingerprint(result.value).length, 64);
});

test('reports missing source, invalid answer and unknown difficulty without returning a candidate', () => {
  const result = normalizeCandidateDraft({ ...validRow, 来源: ' ', 正确答案: 'E', 难度: '专家' }, { rowNumber: 4 });

  assert.equal(result.value, undefined);
  assert.deepEqual(
    result.issues.map((issue) => issue.code).sort(),
    ['INVALID_ANSWER', 'MISSING_SOURCE', 'UNKNOWN_DIFFICULTY'],
  );
  assert.ok(result.issues.every((issue) => issue.severity === 'error'));
});

test('does not treat an uncached spreadsheet formula as question text', () => {
  const result = normalizeCandidateDraft({ ...validRow, 题干: { formula: '1+1' } }, { rowNumber: 6 });

  assert.equal(result.value, undefined);
  assert.ok(result.issues.some((issue) => issue.code === 'FORMULA_VALUE_UNAVAILABLE'));
});

test('retains formula and asset placeholders in a valid draft', () => {
  const result = normalizeCandidateDraft({
    ...validRow,
    题干: '计算 $\\frac{1}{2}$ [asset:diagram-1] 的值。',
    formulas: [{ latex: '\\frac{1}{2}' }],
    assetIds: ['asset-1'],
  }, { rowNumber: 8 });

  assert.ok(result.value);
  assert.equal(result.value.stem, '计算 $\\frac{1}{2}$ [asset:diagram-1] 的值。');
  assert.deepEqual(result.value.formulas, [{ latex: '\\frac{1}{2}' }]);
  assert.deepEqual(result.value.assetIds, ['asset-1']);
});
