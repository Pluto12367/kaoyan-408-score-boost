// V13 PHASE 10 — frontend consumption slice contract test.
//
// Pins the two things that matter for a read-only consumption slice:
//   1. the PURE view helpers behave honestly (no invented numbers, unavailable
//      and empty states stay distinguishable from real data), tested against
//      the real source via transpile (same approach as
//      student-home-context-adapter.test.js);
//   2. the slice is structurally read-only: GET-only endpoints, no mock
//      fallback, silent in the static demo, and the card is actually mounted.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadViewModule() {
  const path = 'apps/web/src/features/student/home/learningInsightsView.ts';
  const input = readFileSync(path, 'utf8');
  const output = ts.transpileModule(input, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('module', 'exports', output)(module, module.exports);
  return module.exports;
}

const view = loadViewModule();

// ---------------------------------------------------------------- formatting

test('P10 view: ladder steps format honestly, unavailable steps keep their reason', () => {
  assert.equal(view.formatLadderStep({
    order: 1, stage: 'basic', label: '基础训练', status: 'READY', questionCount: 3,
    difficulty: 'BASIC', minutes: 9, dueInDays: null, limitedByContent: false, reason: null,
  }), '3 题 · 基础 · 约 9 分钟');

  assert.equal(view.formatLadderStep({
    order: 3, stage: 'variant', label: '变式训练', status: 'UNAVAILABLE', questionCount: 0,
    difficulty: null, minutes: null, dueInDays: null, limitedByContent: false, reason: '变式能力未配置',
  }), '变式能力未配置', 'unavailable steps show their reason, not a fake count');

  assert.equal(view.formatLadderStep({
    order: 4, stage: 'review', label: '复习', status: 'READY', questionCount: 0,
    difficulty: null, minutes: 3, dueInDays: 1, limitedByContent: false, reason: null,
  }), '1 天后');

  assert.equal(view.formatLadderStep({
    order: 2, stage: 'same_type', label: '同型训练', status: 'READY', questionCount: 1,
    difficulty: 'MEDIUM', minutes: 3, dueInDays: null, limitedByContent: true, reason: null,
  }), '1 题 · 中等 · 约 3 分钟 · 题量受题库限制');
});

test('P10 view: forgetting warnings surface only actionable risks, capped', () => {
  const rows = [
    { nodeId: 'n1', nodeName: 'A', risk: 'healthy', retention: 0.9, daysUntilDue: 5, finding: 'ok' },
    { nodeId: 'n2', nodeName: 'B', risk: 'overdue', retention: 0.2, daysUntilDue: -2, finding: '过期' },
    { nodeId: 'n3', nodeName: 'C', risk: 'due_soon', retention: 0.8, daysUntilDue: 1, finding: 'soon' },
    { nodeId: 'n4', nodeName: 'D', risk: 'at_risk', retention: 0.3, daysUntilDue: 2, finding: 'risk' },
  ];
  const selected = view.selectForgettingWarnings(rows, 3);
  assert.deepEqual(selected.map((row) => row.nodeId), ['n2', 'n4'], 'healthy and due_soon are not warnings');
  assert.equal(view.riskLabel('overdue'), '复习已过期');
  assert.equal(view.riskLabel('healthy'), '保持中');
});

test('P10 view: recovery summary is null when there is nothing honest to say', () => {
  assert.equal(view.summarizeRecovery(null, false), null);
  assert.equal(view.summarizeRecovery({ storeAvailable: false, dataStatus: 'EMPTY', summary: {}, rows: [] }, false),
    '失分恢复：存储不可用，暂不结算。');
  assert.equal(view.summarizeRecovery({
    storeAvailable: true, dataStatus: 'EMPTY',
    summary: { questions: 0 }, rows: [],
  }, false), null, 'empty projection renders nothing');

  const line = view.summarizeRecovery({
    storeAvailable: true, dataStatus: 'OK',
    summary: {
      questions: 4, recoveredQuestions: 1, notRecoveredQuestions: 1, awaitingQuestions: 1,
      observedLostScore: 6, observedLossWithReattemptSuccess: 2, observedLossOutstanding: 4,
    },
    rows: [],
  }, false);
  assert.match(line, /已确认追回 1 题/);
  assert.match(line, /未追回 4 分/);
});

test('P10 view: outstanding recovery rows exclude recovered questions', () => {
  const rows = [
    { questionId: 'q1', nodeId: 'n', status: 'recovered', observedLostScore: 2, observedLossOutstanding: 0, reattemptCount: 1 },
    { questionId: 'q2', nodeId: 'n', status: 'not_recovered', observedLostScore: 2, observedLossOutstanding: 2, reattemptCount: 2 },
    { questionId: 'q3', nodeId: 'n', status: 'awaiting_reattempt', observedLostScore: 2, observedLossOutstanding: 2, reattemptCount: 0 },
  ];
  const selected = view.selectOutstandingRecoveries(rows, 3);
  assert.deepEqual(selected.map((row) => row.questionId), ['q2', 'q3']);
});

test('P10 view: hasRenderableInsight distinguishes empty projections from data', () => {
  assert.equal(view.hasRenderableInsight({ prescription: null, forgetting: null, recovery: null }), false);
  assert.equal(view.hasRenderableInsight({
    prescription: { storeAvailable: true, dataStatus: 'EMPTY', target: null, reason: '', difficultyAnchor: null, reviewEmphasis: false, ladder: [] },
    forgetting: { storeAvailable: true, dataStatus: 'EMPTY', rows: [] },
    recovery: null,
  }), false, 'empty projections stay silent');
  assert.equal(view.hasRenderableInsight({
    prescription: {
      storeAvailable: true, dataStatus: 'OK',
      target: { nodeId: 'n', questionSubtypeLabel: 'OS PV 题', reasonLabel: '计算错误' },
      reason: 'r', difficultyAnchor: 'BASIC', reviewEmphasis: false,
      ladder: [{ order: 1, stage: 'basic', label: '基础训练', status: 'READY', questionCount: 3, difficulty: 'BASIC', minutes: 9, dueInDays: null, limitedByContent: false, reason: null }],
    },
    forgetting: null, recovery: null,
  }), true);
  assert.equal(view.hasRenderableInsight({
    prescription: { storeAvailable: false, reasonUnavailable: 'store_unavailable', dataStatus: 'EMPTY', target: null, reason: '', difficultyAnchor: null, reviewEmphasis: false, ladder: [] },
    forgetting: {
      storeAvailable: true, dataStatus: 'OK',
      rows: [{ nodeId: 'n', nodeName: 'A', risk: 'at_risk', retention: 0.3, daysUntilDue: 2, finding: 'risk' }],
    },
    recovery: null,
  }), true, 'unavailable prescription does not hide a real forgetting warning');
});

// ------------------------------------------------------- structural contracts

test('P10 slice is read-only: four GET endpoints, no write verbs, no mock fallback', () => {
  const endpoints = readFileSync('apps/web/src/api/endpoints/learningInsights.ts', 'utf8');
  for (const path of ['/coach/error-diagnosis', '/coach/training-prescription', '/coach/forgetting-risk', '/coach/score-recovery']) {
    assert.ok(endpoints.includes(path), `endpoint file must consume ${path}`);
  }
  assert.equal(/method:\s*'POST'|method:\s*'PATCH'|method:\s*'PUT'|method:\s*'DELETE'/.test(endpoints), false,
    'the slice must not write');
  assert.equal(/mockData|isMockAllowed\s*\(\s*\)\s*===?\s*true/.test(endpoints), false, 'no mock fallback in the endpoint layer');

  const card = readFileSync('apps/web/src/features/student/home/components/LearningInsightsCard.tsx', 'utf8');
  assert.ok(card.includes('isStaticDemoMode()'), 'card must stay silent in the static demo');
  assert.ok(card.includes('处方与提醒暂时加载失败'), 'failed loads must be stated explicitly');
  assert.equal(/localStorage|mockData/.test(card), false, 'no local caching or mock data in the card');

  const home = readFileSync('apps/web/src/features/student/home/StudentHome.tsx', 'utf8');
  assert.ok(home.includes('<LearningInsightsCard'), 'the card must be mounted on the student home');
});
