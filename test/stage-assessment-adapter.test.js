import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadAdapter() {
  const source = await readFile(new URL('../apps/api/src/study/stage-assessment.adapter.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: 'stage-assessment.adapter.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    if (specifier.includes('study-date')) return { studyDateKey: () => '2026-08-24' };
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

const asOf = '2026-08-24T08:00:00.000Z';

function snapshot(overrides = {}) {
  return {
    source: 'stage_assessment_facts', userId: 'u-1', asOf,
    studentFacts: { stage: '强化', targetScore: 120 },
    assessmentFacts: { attemptCount: 2, bestScore: 86, latestScore: 82, latestAccuracyRate: 0.8, lastAssessmentAt: '2026-08-20T00:00:00.000Z' },
    masteryFacts: { source: 'user_knowledge_mastery', averageMastery: 50, weakCount: 1, reviewCount: 0, masteredCount: 0, weakPoints: [{ knowledgeNodeId: 'kp-weak', subject: 'OS', chapter: '内存', title: '页表', masteryRate: 40, accuracyRate: 30 }] },
    practiceFacts: { totalCount: 0, todayCount: 0, accuracy: 0, lastPracticeAt: null },
    wrongQuestionFacts: { total: 0, unresolved: 0, resolved: 0, dueCount: 0, latestWrongAt: null },
    questionPoolFacts: { knowledgePoints: [{ id: 'kp-weak', subject: 'OS', chapter: '内存', title: '页表', importance: 5 }], questions: [{ id: 'q-1', stem: 'Q1', difficulty: 'medium', type: '单选', source: '真题', year: 2020, knowledgePointIds: ['kp-weak'], expectedTimeSec: 90 }] },
    ...overrides,
  };
}

function selection(overrides = {}) {
  return {
    userId: 'u-1', asOf,
    focusKnowledgePointIds: ['kp-weak'],
    selectedQuestionIds: ['q-1'],
    selectedQuestions: [{ id: 'q-1', stem: 'Q1', difficulty: 'medium', type: '单选', source: '真题', year: 2020, knowledgePointIds: ['kp-weak'], expectedTimeSec: 90 }],
    focusKnowledgePoints: [{ id: 'kp-weak', subject: 'OS', chapter: '内存', title: '页表', importance: 5 }],
    fallbackUsed: false,
    questionLimit: 6,
    totalPoolSize: 1,
    ...overrides,
  };
}

test('empty data produces legacy-safe DTO with fallbacks', async () => {
  const { toLegacyStageAssessment } = await loadAdapter();
  const emptySnap = snapshot({ studentFacts: { stage: null, targetScore: null }, assessmentFacts: { attemptCount: 0, bestScore: null, latestScore: null, latestAccuracyRate: null, lastAssessmentAt: null }, questionPoolFacts: { knowledgePoints: [], questions: [] } });
  const emptySelection = selection({ selectedQuestionIds: [], selectedQuestions: [], focusKnowledgePointIds: [], focusKnowledgePoints: [], fallbackUsed: false, totalPoolSize: 0 });
  const dto = toLegacyStageAssessment(emptySnap, emptySelection, asOf);
  assert.equal(dto.stage, '强化');
  assert.equal(dto.title, '强化阶段测评');
  assert.ok(dto.description);
  assert.deepEqual(dto.questions, []);
  assert.deepEqual(dto.focusKnowledgePoints, []);
  assert.equal(dto.summary.attemptCount, 0);
  assert.equal(dto.summary.bestScore, null);
  assert.equal(dto.generatedAt, asOf);
});

test('selection drives question and knowledge point mapping', async () => {
  const { toLegacyStageAssessment } = await loadAdapter();
  const dto = toLegacyStageAssessment(snapshot(), selection(), asOf);
  assert.equal(dto.questions.length, 1);
  assert.equal(dto.questions[0].id, 'q-1');
  assert.equal(dto.questions[0].stem, 'Q1');
  assert.equal(dto.questions[0].expectedTimeSec, 90);
  assert.deepEqual(dto.focusKnowledgePoints, [{ id: 'kp-weak', subject: 'OS', chapter: '内存', title: '页表', importance: 5 }]);
  assert.equal(dto.estimatedMinutes, 10);
});

test('summary fields map from assessment facts without recomputation', async () => {
  const { toLegacyStageAssessment } = await loadAdapter();
  const dto = toLegacyStageAssessment(snapshot(), selection(), asOf);
  assert.equal(dto.summary.attemptCount, 2);
  assert.equal(dto.summary.bestScore, 86);
  assert.equal(dto.summary.latestScore, 82);
  assert.equal(dto.summary.latestAccuracyRate, 0.8);
  assert.equal(dto.userId, 'u-1');
});

test('copy fields are generated only in adapter', async () => {
  const { toLegacyStageAssessment } = await loadAdapter();
  const dto = toLegacyStageAssessment(snapshot(), selection(), asOf);
  assert.equal(typeof dto.reason, 'string');
  assert.equal(typeof dto.actionText, 'string');
  assert.match(dto.id, /^stage-\d{4}-\d{2}-\d{2}$/);
});

test('adapter does not mutate snapshot or selection', async () => {
  const { toLegacyStageAssessment } = await loadAdapter();
  const snap = snapshot();
  const sel = selection();
  const beforeSnap = JSON.stringify(snap);
  const beforeSel = JSON.stringify(sel);
  toLegacyStageAssessment(snap, sel, asOf);
  assert.equal(JSON.stringify(snap), beforeSnap);
  assert.equal(JSON.stringify(sel), beforeSel);
});

test('adapter has no data-access, recommendation, or study-state recomputation dependencies', async () => {
  const source = await readFile(new URL('../apps/api/src/study/stage-assessment.adapter.ts', import.meta.url), 'utf8');
  for (const forbidden of ['Prisma', 'Repository', 'StudyService', 'Controller', 'Selector', 'recommendation', 'masteryFacts', 'weakPoints']) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be present`);
  }
});
