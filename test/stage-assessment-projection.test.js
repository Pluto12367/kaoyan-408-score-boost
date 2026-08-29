import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadModule(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    const key = Object.keys(dependencies).find((c) => specifier.includes(c));
    if (key) return dependencies[key];
    if (specifier.includes('@nestjs/common')) return { Injectable: () => (target) => target, Optional: () => (target, _key, _index) => undefined };
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

const asOf = new Date('2026-08-24T08:00:00.000Z');

async function createProjection(options = {}) {
  const snapshot = await loadModule('apps/api/src/study/stage-assessment.snapshot.ts');
  const proj = await loadModule('apps/api/src/study/stage-assessment-projection.service.ts', {
    'stage-assessment.snapshot': snapshot,
    'assessment-projection.service': {},
    'student-state-projection.service': {},
    'wrong-question-projection.service': {},
  });
  const calls = { assessment: [], state: [], wrong: [] };
  const service = new proj.StageAssessmentProjectionService(
    { getFacts: async (...a) => { calls.assessment.push(a); return options.assessment ?? { attemptCount: 0, bestScore: null, latestScore: null, lastAssessmentAt: null, latestAccuracyRate: null }; } },
    { getSnapshot: async (...a) => { calls.state.push(a); return options.state ?? stateSnapshot(); } },
    { getSnapshot: async (...a) => { calls.wrong.push(a); return options.wrong ?? { currentWrongItems: [], resolvedItems: [], dueItems: [] }; } },
  );
  return { service, calls };
}

function stateSnapshot() {
  return {
    userId: 'u-1', asOf: asOf.toISOString(),
    goal: { stage: '强化', targetScore: 120 },
    mastery: { source: 'user_knowledge_mastery', averageMastery: 62, weakCount: 2, reviewCount: 1, masteredCount: 3, lastUpdatedAt: null },
    weakPoints: [{ knowledgeNodeId: 'kp-1', subject: '操作系统', chapter: '内存', title: '页表', masteryRate: 45, accuracyRate: 40, attempts: 5, wrongCount: 3 }],
    wrongQuestionSummary: { total: 3, unresolved: 2, reviewed: 1, resolved: 1, latestWrongAt: '2026-08-23T00:00:00.000Z' },
    reviewDue: { dueCount: 1, overdueCount: 0, nextReviewAt: null, items: [] },
    studyTasks: { today: [], counts: { pending: 0, inProgress: 0, postponed: 0, completed: 0 } },
    assessmentSummary: { attemptCount: 2, bestScore: 86, latestAccuracyRate: 0.8, improvementText: '' },
  };
}

test('projection injects assessment facts forwarded with fixed asOf', async () => {
  const assessment = { attemptCount: 3, bestScore: 90, latestScore: 84, lastAssessmentAt: asOf.toISOString(), latestAccuracyRate: 0.85 };
  const { service, calls } = await createProjection({ assessment });
  const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = 'postgres://test';
  try {
    const snapshot = await service.getSnapshot('u-1', asOf);
    assert.equal(calls.assessment[0][1], asOf);
    assert.equal(snapshot.assessmentFacts.bestScore, 90);
    assert.equal(snapshot.assessmentFacts.latestAccuracyRate, 0.85);
  } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

test('projection injects mastery and weak point facts from StudentState', async () => {
  const { service, calls } = await createProjection();
  const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = 'postgres://test';
  try {
    const snapshot = await service.getSnapshot('u-1', asOf);
    assert.equal(calls.state[0][1], asOf);
    assert.equal(snapshot.masteryFacts.averageMastery, 62);
    assert.equal(snapshot.masteryFacts.weakPoints.length, 1);
    assert.equal(snapshot.masteryFacts.weakPoints[0].knowledgeNodeId, 'kp-1');
    assert.equal(snapshot.studentFacts.stage, '强化');
  } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

test('projection injects wrong question facts from WrongQuestionProjectionService', async () => {
  const wrong = { currentWrongItems: [{ questionId: 'q-1' }, { questionId: 'q-2' }], resolvedItems: [{ questionId: 'q-3' }], dueItems: [{ questionId: 'q-1' }] };
  const { service, calls } = await createProjection({ wrong });
  const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = 'postgres://test';
  try {
    const snapshot = await service.getSnapshot('u-1', asOf);
    assert.equal(calls.wrong[0][1], asOf);
    assert.equal(snapshot.wrongQuestionFacts.total, 2);
    assert.equal(snapshot.wrongQuestionFacts.resolved, 1);
    assert.equal(snapshot.wrongQuestionFacts.dueCount, 1);
  } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

test('projection injects question pool facts via catalog query', async () => {
  const pool = { knowledgePoints: [{ id: 'kp-1', subject: 'OS', chapter: '内存', title: '页表', importance: 5 }], questions: [{ id: 'q-1', stem: 'Q', difficulty: 'medium', type: '单选', source: '真题', year: 2020, knowledgePointIds: ['kp-1'], expectedTimeSec: 90 }] };
  const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = 'postgres://test';
  try {
    const snapshot = await (await createProjection()).service.getSnapshot('u-1', asOf);
    // No catalog query provided -> question pool defaults safe empty
    assert.deepEqual(snapshot.questionPoolFacts.questions, []);
    assert.deepEqual(snapshot.questionPoolFacts.knowledgePoints, []);
  } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

test('empty database returns safe empty snapshot', async () => {
  const { service } = await createProjection();
  const previous = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
  try {
    const snapshot = await service.getSnapshot('u-empty', asOf);
    assert.equal(snapshot.source, 'stage_assessment_facts');
    assert.equal(snapshot.assessmentFacts.attemptCount, 0);
    assert.deepEqual(snapshot.masteryFacts.weakPoints, []);
    assert.deepEqual(snapshot.questionPoolFacts.questions, []);
  } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

test('projection boundary excludes StudyService, Controller, Adapter, Prisma', async () => {
  const source = await readFile(new URL('../apps/api/src/study/stage-assessment-projection.service.ts', import.meta.url), 'utf8');
  for (const forbidden of ['StudyService', 'Controller', 'Adapter', 'PrismaService', 'prisma.', 'QueryService']) assert.equal(source.includes(forbidden), false, `${forbidden} must not be present`);
  assert.match(source, /AssessmentProjectionService/);
  assert.match(source, /StudentStateProjectionService/);
  assert.match(source, /WrongQuestionProjectionService/);
});