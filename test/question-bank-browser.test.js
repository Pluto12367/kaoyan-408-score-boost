// V14 — 题库浏览/自由刷题 pure-helper contract（任务书
// docs/v14-question-bank-browser-design.md §6；Owner 批准 D-B-1..4 按建议冻结）。
//
// 钉死的行为：
//   1. attemptStatus 归并 = PracticeRecord 的 OBSERVED 投影，wrong 优先；
//      无记录 = unanswered（绝不伪造对错，RULE-06）。
//   2. 筛选/排序纯函数：科目（经知识点→科目映射）、题型、年份、状态；
//      排序 = 年份降序（无年份最后）→ 题号升序（无题号最后）→ id 稳定序。
//   3. 一键组卷上限 50（Owner D-B-3），超限 capped=true 且截断不静默。
//   4. 分页为纯切片（客户端已有全量投影，无需服务端分页）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function loadBrowserModule() {
  const moduleSource = await source('apps/web/src/features/practice/questionBankBrowser.ts');
  const stripped = moduleSource.replace(/from '([^']*)'/g, (match, specifier) => {
    if (specifier.endsWith('.js') || specifier.startsWith('.')) return match;
    return "from './__stub__'";
  });
  const compiled = ts.transpileModule(stripped, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const runnable = compiled.replace(/import \{[^}]*\} from '\.\/__stub__';/g, '');
  return import(`data:text/javascript;base64,${Buffer.from(runnable).toString('base64')}`);
}

const q = (overrides) => ({
  id: overrides.id,
  stem: overrides.stem ?? '题干',
  options: ['A', 'B'],
  knowledgePointIds: overrides.knowledgePointIds ?? ['p1'],
  difficulty: overrides.difficulty ?? '中等',
  type: overrides.type ?? '选择题',
  source: overrides.source ?? '408真题',
  year: overrides.year,
  examNo: overrides.examNo,
  maxScore: overrides.maxScore,
  expectedTimeSec: 100,
  answer: '',
  analysis: '',
});

test('attemptStatus: 无记录 = unanswered，绝不伪造对错', async () => {
  const { deriveAttemptStatuses } = await loadBrowserModule();
  assert.deepEqual(deriveAttemptStatuses([]), new Map());
});

test('attemptStatus: 做过且错以 wrong 优先，全对才是 correct', async () => {
  const { deriveAttemptStatuses } = await loadBrowserModule();
  const statuses = deriveAttemptStatuses([
    { questionId: 'q1', correct: true },
    { questionId: 'q1', correct: false },
    { questionId: 'q2', correct: true },
    { questionId: 'q2', correct: true },
  ]);
  assert.equal(statuses.get('q1'), 'wrong');
  assert.equal(statuses.get('q2'), 'correct');
});

test('filter+sort: 年份降序（无年份最后）→ 题号升序（无题号最后）→ id 稳定', async () => {
  const { filterBrowseQuestions } = await loadBrowserModule();
  const rows = filterBrowseQuestions({
    questions: [
      q({ id: 'a', year: 2010, examNo: 5 }),
      q({ id: 'b', year: 2011, examNo: 2 }),
      q({ id: 'c', year: 2010, examNo: 1 }),
      q({ id: 'd', year: undefined, examNo: 9 }),
      q({ id: 'e', year: 2011, examNo: 40 }),
    ],
    subjectByPointId: new Map(),
    records: [],
    filters: { subject: null, type: 'all', year: null, status: 'all' },
  });
  assert.deepEqual(rows.map((row) => row.id), ['b', 'e', 'c', 'a', 'd']);
});

test('filter: 科目经知识点映射、题型、年份、状态可组合', async () => {
  const { filterBrowseQuestions } = await loadBrowserModule();
  const questions = [
    q({ id: 'ds-mcq', type: '选择题', year: 2010, knowledgePointIds: ['p-ds'] }),
    q({ id: 'ds-essay', type: '综合题', year: 2009, knowledgePointIds: ['p-ds'] }),
    q({ id: 'net-mcq', type: '选择题', year: 2010, knowledgePointIds: ['p-net'] }),
  ];
  const subjectByPointId = new Map([['p-ds', '数据结构'], ['p-net', '计算机网络']]);
  const records = [{ questionId: 'ds-mcq', correct: false }];

  const base = { subjectByPointId, records };
  assert.deepEqual(
    filterBrowseQuestions({ ...base, questions, filters: { subject: '数据结构', type: 'all', year: null, status: 'all' } }).map((r) => r.id),
    ['ds-mcq', 'ds-essay'],
  );
  assert.deepEqual(
    filterBrowseQuestions({ ...base, questions, filters: { subject: '数据结构', type: '综合题', year: 2009, status: 'all' } }).map((r) => r.id),
    ['ds-essay'],
  );
  assert.deepEqual(
    filterBrowseQuestions({ ...base, questions, filters: { subject: null, type: 'all', year: null, status: 'wrong' } }).map((r) => r.id),
    ['ds-mcq'],
  );
  assert.deepEqual(
    filterBrowseQuestions({ ...base, questions, filters: { subject: null, type: 'all', year: null, status: 'unanswered' } }).map((r) => r.id),
    ['net-mcq', 'ds-essay'],
  );
});

test('row 投影：stemPreview 截断、不携带 options/answer/analysis/knowledgePointIds', async () => {
  const { filterBrowseQuestions } = await loadBrowserModule();
  const rows = filterBrowseQuestions({
    questions: [q({ id: 'x', stem: 'A'.repeat(80) + '超长题干尾部', year: 2012, examNo: 3, maxScore: 10 })],
    subjectByPointId: new Map(),
    records: [],
    filters: { subject: null, type: 'all', year: null, status: 'all' },
  });
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.ok(row.stemPreview.length <= 61);
  assert.ok(row.stemPreview.endsWith('…'));
  assert.equal(row.examNo, 3);
  assert.equal(row.maxScore, 10);
  assert.equal(row.status, 'unanswered');
  assert.deepEqual(
    Object.keys(row).sort(),
    ['difficulty', 'examNo', 'id', 'maxScore', 'source', 'status', 'stemPreview', 'type', 'year'],
    'row keys are white-listed — no options/answer/analysis leakage',
  );
});

test('自由组卷：上限 50、超限显式 capped、顺序保持', async () => {
  const { buildFreePracticeSet, FREE_PRACTICE_MAX_QUESTIONS } = await loadBrowserModule();
  assert.equal(FREE_PRACTICE_MAX_QUESTIONS, 50);
  const rows = Array.from({ length: 60 }, (_, index) => ({ id: `q-${index + 1}` }));
  const capped = buildFreePracticeSet(rows);
  assert.equal(capped.total, 60);
  assert.equal(capped.capped, true);
  assert.equal(capped.questionIds.length, 50);
  assert.deepEqual(capped.questionIds.slice(0, 2), ['q-1', 'q-2']);
  const small = buildFreePracticeSet(rows.slice(0, 7));
  assert.deepEqual(small, { questionIds: rows.slice(0, 7).map((r) => r.id), capped: false, total: 7 });
});

test('分页：纯切片、page 越界收敛到最后一页、空结果至少 1 页', async () => {
  const { paginateBrowseRows } = await loadBrowserModule();
  const rows = Array.from({ length: 45 }, (_, index) => ({ id: `q-${index}` }));
  const page1 = paginateBrowseRows(rows, 1, 20);
  assert.equal(page1.total, 45);
  assert.equal(page1.pageCount, 3);
  assert.equal(page1.rows.length, 20);
  const page3 = paginateBrowseRows(rows, 3, 20);
  assert.equal(page3.rows.length, 5);
  const overflow = paginateBrowseRows(rows, 99, 20);
  assert.equal(overflow.page, 3);
  assert.equal(overflow.rows.length, 5);
  const empty = paginateBrowseRows([], 1, 20);
  assert.deepEqual(empty, { rows: [], total: 0, pageCount: 1, page: 1 });
});
