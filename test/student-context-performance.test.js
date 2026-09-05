import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// SC-5 TASK 4: production-like StudentContext performance baselines.
// Payload budgets (hard gates): Small < 50KB, Medium < 100KB, Heavy < 200KB.
// Selector execution time is asserted with a generous smoke budget; the size
// budgets are the regression gate.

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const selector = require('../apps/api/src/study/student-context.selector.ts');

const asOf = '2026-09-05T08:00:00.000Z';
const iso = (daysAgo, hour = 10) => new Date(new Date(asOf).getTime() - daysAgo * 86400000 + hour * 3600000).toISOString();
const win = (days) => ({ startAt: iso(days), endAt: asOf, baselineStartAt: iso(days * 2), baselineEndAt: iso(days) });
const windows = { last7d: win(7), last30d: win(30), activity: win(7) };
const SUBJECTS = ['数据结构', '操作系统', '计算机组成原理', '计算机网络'];

function fixtures({ nodes, records, sessions, actions }) {
  const masteryNodes = Array.from({ length: nodes }, (_, i) => ({
    knowledgeNodeId: `node-${String(i).padStart(4, '0')}`,
    subject: SUBJECTS[i % 4], chapter: `章节-${i % 20}`, title: `节点标题-${i}`,
    mastery: (i % 100) / 100, accuracy: i % 2 ? 0.7 : 0.4,
    attempts: 5 + (i % 10), correctCount: 3 + (i % 7), wrongCount: 1 + (i % 3),
    status: i % 3 === 0 ? 'weak' : i % 3 === 1 ? 'review' : 'mastered',
    updatedAt: iso(i % 60),
  }));
  const practiceRecords = Array.from({ length: records }, (_, i) => ({
    id: `p-${i}`, knowledgePointId: `point-${i % Math.max(1, Math.floor(records / 4))}`,
    subject: SUBJECTS[i % 4], chapter: `章节-${i % 20}`, title: `知识点-${i % 150}`,
    submittedAt: iso(i % 365, i % 24), correct: i % 3 !== 0,
    timeSpentSec: 60 + (i % 90), mistakeReason: i % 3 === 0 ? '概念不清' : null,
  }));
  const sessionRows = Array.from({ length: sessions }, (_, i) => ({
    learningSessionId: `s-${i}`, actionId: `action-${i % Math.max(1, actions)}`, type: 'practice_set',
    startedAt: iso(i % 90), lastActiveAt: iso(i % 90), completed: i % 2 === 0,
  }));
  const activityDays = Array.from({ length: 7 }, (_, i) => ({
    date: iso(i).slice(0, 10), practiceCount: 3, completedTaskCount: 2, isActive: true,
  }));
  const tasks = Array.from({ length: 6 }, (_, i) => ({
    studyTaskId: `task-${i}`, actionId: `action-${i}`, title: `任务-${i}`, status: 'pending',
    scheduledDate: asOf.slice(0, 10), completed: false, completedAt: null,
    knowledgePointId: `point-${i}`, knowledgeNodeId: `node-${i}`, minutes: 30, questionCount: 10,
  }));
  const evidence = actions === 0 ? [] : Array.from({ length: actions * 4 }, (_, i) => ({
    source: 'recommendation_action',
    timestamp: new Date(new Date(asOf).getTime() - i * 3600000).toISOString(),
    actionId: `action-${i % Math.max(1, actions)}`,
    studyTaskId: `task-${i % 6}`,
    referenceId: `ref-${i}`,
  }));
  return {
    user: { name: '小明', role: 'STUDENT', targetSchool: 'BUPT', weakestSubject: '操作系统', diagnosis: null, examYear: 2027, targetScore: 120, currentScore: 80, remainingDays: 100, studyStage: '强化' },
    masteryNodes, practiceRecords, reviewItems: [], tasks, sessions: sessionRows, activityDays,
    recommendationEvidence: evidence,
  };
}

function buildProfile(facts) {
  const start = performance.now();
  const context = selector.buildStudentContext({ userId: 'u-1', asOf, todayDate: asOf.slice(0, 10), windows, sourceFacts: facts });
  const durationMs = performance.now() - start;
  const json = JSON.stringify(context);
  return { context, durationMs, sizeKB: json.length / 1024 };
}

const PROFILES = {
  small: { nodes: 20, records: 50, sessions: 3, actions: 5, budgetKB: 50 },
  medium: { nodes: 200, records: 1000, sessions: 100, actions: 50, budgetKB: 100 },
  heavy: { nodes: 600, records: 3000, sessions: 300, actions: 150, budgetKB: 200 },
};

for (const [name, profile] of Object.entries(PROFILES)) {
  test(`performance: ${name} user stays within the ${profile.budgetKB}KB payload budget`, () => {
    const { context, durationMs, sizeKB } = buildProfile(fixtures(profile));
    assert.ok(sizeKB < profile.budgetKB, `${name} payload ${sizeKB.toFixed(1)}KB exceeds ${profile.budgetKB}KB budget`);
    assert.ok(durationMs < 1000, `${name} selector took ${durationMs.toFixed(1)}ms (smoke budget 1000ms)`);
  });
}

test('performance: bounded sections hold their caps under heavy load', () => {
  const { context } = buildProfile(fixtures(PROFILES.heavy));
  assert.ok(context.recommendationEvidence.length <= 60, `evidence rows ${context.recommendationEvidence.length} > 60`);
  assert.ok(context.mastery.weakPoints.length <= 20, `weakPoints rows ${context.mastery.weakPoints.length} > 20`);
  assert.ok(context.momentum.recentSessions.length <= 10, `recentSessions rows ${context.momentum.recentSessions.length} > 10`);
});

test('performance: small context keeps full semantics (no caps engaged)', () => {
  const facts = fixtures(PROFILES.small);
  const { context } = buildProfile(facts);
  assert.equal(context.recommendationEvidence.length, PROFILES.small.actions * 4);
  // weakPoints = distinct points with at least one wrong answer (well under cap 20).
  const wrongPoints = new Set(facts.practiceRecords.filter((r) => !r.correct).map((r) => r.knowledgePointId));
  assert.equal(context.mastery.weakPoints.length, wrongPoints.size);
  assert.ok(context.mastery.weakPoints.length < 20);
});
