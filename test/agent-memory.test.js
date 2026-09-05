/**
 * Agent Memory Layer Tests (Phase AI-7).
 *
 * Learning Memory: read-only, rebuildable, derived EXCLUSIVELY from the
 * canonical StudentContext — never a source of truth, never persisted.
 *
 * Layers:
 * - shortTerm: current learning tasks (today pending/in-progress + live session)
 * - midTerm: recent weak knowledge (weak/improving nodes, high-risk wrong questions)
 * - longTerm: historical learning patterns (streak, trends, subject mix, exam goal)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

import { buildLearningMemoryFromContext, buildMemoryBrief } from '../apps/api/dist/agent/learning-memory.js';

// ---- fixture (StudentContext v1 subset relevant to memory) ----

function studentContextFixture(overrides = {}) {
  return {
    version: 'student-context-v1',
    userId: 'u-1',
    asOf: '2026-09-05T08:00:00.000Z',
    profile: { userId: 'u-1', name: '小明', weakestSubject: '操作系统', diagnosis: null, role: 'STUDENT', targetSchool: null },
    exam: { examYear: 2027, targetScore: 130, currentScore: 85, remainingDays: 90, studyStage: '强化' },
    mastery: {
      source: 'user_knowledge_mastery',
      weakNodes: [
        { knowledgeNodeId: 'OS-C06-S06-P02', subject: 'OS', chapter: '进程管理', title: '死锁必要条件', mastery: 0.3, accuracy: 0.4, attempts: 6, wrongCount: 4, status: 'weak', updatedAt: '2026-09-04T00:00:00.000Z' },
        { knowledgeNodeId: 'OS-C02-S04-P20', subject: 'OS', chapter: '进程同步', title: '信号量', mastery: 0.42, accuracy: 0.5, attempts: 10, wrongCount: 5, status: 'weak', updatedAt: '2026-09-03T00:00:00.000Z' },
      ],
      weakPoints: [],
      improvingPoints: [
        { knowledgeNodeId: 'CN-TCP-01', subject: 'CN', chapter: '传输层', title: 'TCP拥塞控制', mastery: 0.6, accuracy: 0.65, attempts: 8, wrongCount: 2, status: 'improving', updatedAt: '2026-09-02T00:00:00.000Z' },
      ],
      masteredPoints: [
        { knowledgeNodeId: 'DS-LIST-01', subject: 'DS', chapter: '线性表', title: '顺序表', mastery: 0.9, accuracy: 0.9, attempts: 12, wrongCount: 1, status: 'mastered', updatedAt: '2026-08-20T00:00:00.000Z' },
      ],
      lastUpdatedAt: '2026-09-04T00:00:00.000Z',
    },
    practice: {
      source: 'practice_record',
      recentAccuracy: { window: 'last7d', baseline: 0.6, sampleSize: 20, status: 'sufficient', value: 0.75 },
      recentVolume: { window: 'last7d', baseline: 15, sampleSize: 20, status: 'sufficient', value: 22 },
      subjectDistribution: { status: 'sufficient', items: [
        { subject: 'OS', count: 12, share: 0.55 },
        { subject: 'DS', count: 6, share: 0.27 },
        { subject: 'CN', count: 3, share: 0.14 },
        { subject: 'CO', count: 1, share: 0.04 },
      ] },
      totalCount: 120,
      latestSubmittedAt: '2026-09-05T07:00:00.000Z',
    },
    review: {
      source: 'review_schedule',
      dueCount: 3, overdueCount: 1, reviewedCount: 5, resolvedCount: 2,
      highRiskQuestions: [
        { questionId: 'w-1', knowledgePointId: 'point-pv', wrongCount: 4, overdue: true, nextReviewAt: '2026-09-04T00:00:00.000Z', stability: 'learning' },
        { questionId: 'w-2', knowledgePointId: 'point-dl', wrongCount: 2, overdue: false, nextReviewAt: '2026-09-06T00:00:00.000Z', stability: 'review' },
        { questionId: 'w-3', knowledgePointId: 'point-x', wrongCount: 2, overdue: false, nextReviewAt: '2026-09-07T00:00:00.000Z', stability: 'review' },
        { questionId: 'w-4', knowledgePointId: 'point-y', wrongCount: 1, overdue: false, nextReviewAt: '2026-09-08T00:00:00.000Z', stability: 'learning' },
      ],
      nextReviewAt: '2026-09-05T12:00:00.000Z',
    },
    plan: {
      source: 'study_plan',
      planId: 'plan-1',
      todayTasks: [
        { studyTaskId: 't-1', actionId: null, title: '学习死锁必要条件', status: 'pending', scheduledDate: '2026-09-05', completed: false, completedAt: null, knowledgePointId: null, knowledgeNodeId: 'OS-C06-S06-P02', minutes: 40, questionCount: 8 },
        { studyTaskId: 't-2', actionId: null, title: '错题重做：信号量', status: 'in_progress', scheduledDate: '2026-09-05', completed: false, completedAt: null, knowledgePointId: null, knowledgeNodeId: 'OS-C02-S04-P20', minutes: 30, questionCount: 8 },
        { studyTaskId: 't-3', actionId: null, title: '已完成任务', status: 'completed', scheduledDate: '2026-09-05', completed: true, completedAt: '2026-09-05T06:00:00.000Z', knowledgePointId: null, knowledgeNodeId: null, minutes: 20, questionCount: 5 },
      ],
      completion: { completedCount: 1, totalCount: 3, rate: { window: 'last7d', baseline: null, sampleSize: 3, status: 'sufficient', value: 0.33 } },
    },
    momentum: {
      studyStreak: 6,
      recentSessions: [
        { learningSessionId: 's-1', actionId: null, type: 'practice_set', startedAt: '2026-09-05T07:30:00.000Z', lastActiveAt: '2026-09-05T07:50:00.000Z', completed: false },
        { learningSessionId: 's-2', actionId: null, type: 'practice_set', startedAt: '2026-09-04T07:30:00.000Z', lastActiveAt: '2026-09-04T08:10:00.000Z', completed: true },
      ],
      activityTrend: { window: 'last7d', baseline: 5, sampleSize: 6, status: 'sufficient', value: 6 },
    },
    recommendationEvidence: [],
    ...overrides,
  };
}

// ---- pure builder ----

test('memory shortTerm carries today open tasks and the live session', () => {
  const memory = buildLearningMemoryFromContext(studentContextFixture());
  assert.equal(memory.shortTerm.openTasks.length, 2);
  assert.equal(memory.shortTerm.openTasks[0].title, '学习死锁必要条件');
  assert.equal(memory.shortTerm.openTasks[0].knowledgeNodeId, 'OS-C06-S06-P02');
  assert.equal(memory.shortTerm.openTasks[0].status, 'pending');
  assert.equal(memory.shortTerm.openTasks[1].status, 'in_progress');
  assert.equal(memory.shortTerm.completedToday, 1);
  assert.ok(memory.shortTerm.liveSession);
  assert.equal(memory.shortTerm.liveSession.learningSessionId, 's-1');
});

test('memory midTerm carries bounded weak/improving nodes and top high-risk questions', () => {
  const memory = buildLearningMemoryFromContext(studentContextFixture());
  assert.equal(memory.midTerm.weakNodes.length, 2);
  assert.equal(memory.midTerm.weakNodes[0].knowledgeNodeId, 'OS-C06-S06-P02');
  assert.equal(memory.midTerm.improvingNodes.length, 1);
  // high risk bounded to 3, ordered by wrongCount desc
  assert.equal(memory.midTerm.highRiskQuestions.length, 3);
  assert.equal(memory.midTerm.highRiskQuestions[0].questionId, 'w-1');
  assert.equal(memory.midTerm.dueCount, 3);
  assert.equal(memory.midTerm.overdueCount, 1);
});

test('memory longTerm carries patterns and exam goal', () => {
  const memory = buildLearningMemoryFromContext(studentContextFixture());
  assert.equal(memory.longTerm.studyStreak, 6);
  assert.equal(memory.longTerm.recentAccuracy.value, 0.75);
  assert.equal(memory.longTerm.recentAccuracy.status, 'sufficient');
  assert.equal(memory.longTerm.topSubjects[0].subject, 'OS');
  assert.ok(memory.longTerm.topSubjects.length <= 3);
  assert.equal(memory.longTerm.examGoal.targetScore, 130);
  assert.equal(memory.longTerm.examGoal.weakestSubject, '操作系统');
  assert.equal(memory.longTerm.examGoal.stage, '强化');
});

test('memory is safe on empty StudentContext (no throws, empty layers)', () => {
  const empty = studentContextFixture({
    mastery: { source: 'empty', weakNodes: [], weakPoints: [], improvingPoints: [], masteredPoints: [], lastUpdatedAt: null },
    plan: { source: 'empty', planId: null, todayTasks: [], completion: { completedCount: 0, totalCount: 0, rate: { window: 'last7d', baseline: null, sampleSize: 0, status: 'insufficient_data', value: null } } },
    review: { source: 'empty', dueCount: 0, overdueCount: 0, reviewedCount: 0, resolvedCount: 0, highRiskQuestions: [], nextReviewAt: null },
    momentum: { studyStreak: 0, recentSessions: [], activityTrend: { window: 'last7d', baseline: null, sampleSize: 0, status: 'insufficient_data', value: null } },
  });
  const memory = buildLearningMemoryFromContext(empty);
  assert.equal(memory.shortTerm.openTasks.length, 0);
  assert.equal(memory.shortTerm.liveSession, null);
  assert.equal(memory.midTerm.weakNodes.length, 0);
  assert.equal(memory.midTerm.highRiskQuestions.length, 0);
  assert.equal(memory.longTerm.studyStreak, 0);
});

test('memory derivation is deterministic (rebuildable)', () => {
  const context = studentContextFixture();
  const a = buildLearningMemoryFromContext(context);
  const b = buildLearningMemoryFromContext(context);
  assert.deepEqual(a, b);
});

test('memory brief is compact and bounded for prompt injection', () => {
  const brief = buildMemoryBrief(buildLearningMemoryFromContext(studentContextFixture()));
  assert.ok(brief.length > 0);
  assert.ok(brief.length <= 900, `brief should stay bounded, got ${brief.length}`);
  assert.ok(brief.includes('死锁必要条件'));
  assert.ok(!brief.includes('undefined'));
});

// ---- Nest service shell ----

async function loadService() {
  const path = 'apps/api/src/agent/learning-memory.service.ts';
  const input = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(input, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: false },
  }).outputText;
  const module = { exports: {} };
  const stubs = {
    '@nestjs/common': { Injectable: () => (target) => target, Optional: () => () => {}, Logger: class { warn() {} log() {} } },
  };
  Function('require', 'module', 'exports', output)((specifier) => {
    const stubKey = Object.keys(stubs).find((key) => specifier.includes(key));
    if (stubKey) return stubs[stubKey];
    if (specifier.includes('learning-memory')) return { buildLearningMemoryFromContext, buildMemoryBrief };
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports.LearningMemoryService;
}

test('LearningMemoryService derives memory through StudentContextQueryService only', async () => {
  const Service = await loadService();
  const calls = [];
  const service = new Service({
    getContext: async (userId) => { calls.push(userId); return studentContextFixture(); },
  });
  const memory = await service.getLearningMemory('u-1');
  assert.deepEqual(calls, ['u-1']);
  assert.equal(memory.shortTerm.completedToday, 1);
  assert.equal(memory.userId, 'u-1');
  assert.ok(memory.derivedAt);
});

// ---- boundaries: read-only, rebuildable, not a source of truth ----

test('memory layer holds no storage and no write primitives', async () => {
  for (const file of ['apps/api/src/agent/learning-memory.ts', 'apps/api/src/agent/learning-memory.service.ts']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bprisma\b/, `${file} must not reference a database client`);
    assert.doesNotMatch(source, /\.(create|update|delete|upsert|save)\s*\(/, `${file} must not write`);
    assert.doesNotMatch(source, /localStorage|sessionStorage|new Map\(\)\.set/, `${file} must not persist`);
  }
});

test('agent consumes memory: system prompt carries the memory brief', async () => {
  const source = await readFile(new URL('../apps/api/src/agent/study-agent.service.ts', import.meta.url), 'utf8');
  assert.match(source, /LearningMemoryService/);
  assert.match(source, /getLearningMemory/);
  assert.match(source, /学习记忆（只读背景，来自学生上下文）/);
  assert.match(source, /memory load failed \(non-blocking\)/);
});