// V14 ③（Owner 批准 D-T-1/2，2026-09-27）— 「今天做什么」合并纯模块契约。
// 设计 docs/v14-flagship-detailed-design.md §3。
//
// 钉死：
//   1. 排序：prescription(READY) > review_due > wrong_due；UNAVAILABLE/NO_CONTENT 处方不产出动作。
//   2. 每源最多 2 条，总量 ≤ limit（默认 3）。
//   3. reason 只拼接证据字段原文（count/lostScore/stage），不生成新判断。
//   4. 全空 → nothingReason 给出显式引导，不静默空白。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function loadModule() {
  const moduleSource = await source('packages/shared/src/score-center/today-actions.ts');
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

const prescriptionStep = (overrides = {}) => ({
  order: 3,
  stage: 'variant',
  label: '变式训练',
  status: 'READY',
  questionCount: 4,
  difficulty: 'MEDIUM',
  minutes: 12,
  dueInDays: null,
  limitedByContent: false,
  reason: '处方第 3 步',
  ...overrides,
});

const finding = {
  subject: '数据结构',
  nodeId: 'DS-C02-S04-P05',
  questionSubtype: 'unknown',
  questionSubtypeLabel: '未知题型',
  reasonCode: 'concept_confusion',
  reasonLabel: '概念混淆',
  count: 2,
  recentCount: 2,
  trend: 'up',
  repeated: true,
  observedLostScore: 8,
  proxyLostScore: 0,
  confidence: 'high',
};

test('排序与上限：处方 READY 在前、每源 ≤2、总量 ≤ limit', async () => {
  const { buildTodayActions } = await loadModule();
  const result = buildTodayActions({
    limit: 3,
    prescription: {
      dataStatus: 'OK',
      target: finding,
      reason: '概念混淆复发',
      difficultyAnchor: 'BASIC',
      reviewEmphasis: false,
      ladder: [prescriptionStep(), prescriptionStep({ order: 4, stage: 'review', label: '隔日复习' })],
    },
    dueReviews: { count: 3, questions: [{ questionId: 'r1' }, { questionId: 'r2' }, { questionId: 'r3' }] },
    wrongSummary: { pendingCount: 5, newestAt: '2026-09-26' },
    finding,
  });
  assert.equal(result.actions.length, 3);
  assert.equal(result.actions[0].kind, 'prescription_step');
  assert.equal(result.actions[0].launch.type, 'practice_set');
  assert.equal(result.actions[1].kind, 'prescription_step', 'ladder 有 2 个 READY 步 → 处方占 2 席（每源 ≤2）');
  assert.equal(result.actions[2].kind, 'review_due', '第 3 席轮到复习到期');
});

test('UNAVAILABLE/NO_CONTENT 处方不产出动作；reason 引用证据原文', async () => {
  const { buildTodayActions } = await loadModule();
  const result = buildTodayActions({
    limit: 3,
    prescription: {
      dataStatus: 'NO_CONTENT', target: finding, reason: '该考点暂无可练题目',
      difficultyAnchor: null, reviewEmphasis: false,
      ladder: [prescriptionStep({ status: 'NO_CONTENT' })],
    },
    dueReviews: { count: 0, questions: [] },
    wrongSummary: { pendingCount: 2, newestAt: '2026-09-27' },
    finding,
  });
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].kind, 'wrong_due');
  // reason 只含证据字段原文数字。
  assert.match(result.actions[0].reason, /2/);
  assert.doesNotMatch(result.actions[0].reason, /我们建议|系统认为/);
});

test('全空 → nothingReason 显式引导，不静默', async () => {
  const { buildTodayActions } = await loadModule();
  const result = buildTodayActions({
    limit: 3,
    prescription: null,
    dueReviews: { count: 0, questions: [] },
    wrongSummary: { pendingCount: 0, newestAt: null },
    finding: null,
  });
  assert.equal(result.actions.length, 0);
  assert.match(result.nothingReason ?? '', /诊断|复习|完成/);
});

test('处方动作 launch 携带显式题单参数（nodeId+subtype+count）', async () => {
  const { buildTodayActions } = await loadModule();
  const result = buildTodayActions({
    limit: 3,
    prescription: {
      dataStatus: 'OK', target: finding, reason: 'x', difficultyAnchor: 'BASIC',
      reviewEmphasis: false, ladder: [prescriptionStep()],
    },
    dueReviews: { count: 0, questions: [] },
    wrongSummary: { pendingCount: 0, newestAt: null },
    finding,
  });
  const action = result.actions[0];
  assert.equal(action.launch.type, 'practice_set');
  assert.equal(action.launch.nodeId, 'DS-C02-S04-P05');
  assert.equal(action.launch.questionCount, 4);
});
