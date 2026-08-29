import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadSelector() {
  const source = await readFile(new URL('../apps/api/src/study/stage-assessment.selector.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: 'stage-assessment.selector.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => { throw new Error(`Unexpected dependency: ${specifier}`); }, module, module.exports);
  return module.exports;
}

const asOf = '2026-08-24T08:00:00.000Z';

function snapshot(overrides = {}) {
  return {
    source: 'stage_assessment_facts', userId: 'u-1', asOf,
    studentFacts: { stage: '强化', targetScore: 120 },
    assessmentFacts: { attemptCount: 0, bestScore: null, latestScore: null, latestAccuracyRate: null, lastAssessmentAt: null },
    masteryFacts: { source: 'user_knowledge_mastery', averageMastery: 50, weakCount: 1, reviewCount: 0, masteredCount: 0, weakPoints: [{ knowledgeNodeId: 'kp-weak', subject: 'OS', chapter: '内存', title: '页表', masteryRate: 40, accuracyRate: 30 }] },
    practiceFacts: { totalCount: 0, todayCount: 0, accuracy: 0, lastPracticeAt: null },
    wrongQuestionFacts: { total: 0, unresolved: 0, resolved: 0, dueCount: 0, latestWrongAt: null },
    questionPoolFacts: { knowledgePoints: [{ id: 'kp-weak', subject: 'OS', chapter: '内存', title: '页表', importance: 5 }, { id: 'kp-other', subject: 'OS', chapter: '调度', title: '进程调度', importance: 4 }], questions: [
      { id: 'q-focus-1', stem: 'Q1', difficulty: 'medium', type: '单选', source: '真题', year: 2020, knowledgePointIds: ['kp-weak'], expectedTimeSec: 90 },
      { id: 'q-other-1', stem: 'Q2', difficulty: 'easy', type: '单选', source: '真题', year: 2021, knowledgePointIds: ['kp-other'], expectedTimeSec: 60 },
      { id: 'q-focus-2', stem: 'Q3', difficulty: 'hard', type: '多选', source: '模拟', year: null, knowledgePointIds: ['kp-weak'], expectedTimeSec: 120 },
    ] },
    ...overrides,
  };
}

test('empty snapshot produces empty selection without throwing', async () => {
  const { StageAssessmentSelector } = await loadSelector();
  const empty = snapshot({ masteryFacts: { source: 'empty', averageMastery: 0, weakCount: 0, reviewCount: 0, masteredCount: 0, weakPoints: [] }, questionPoolFacts: { knowledgePoints: [], questions: [] } });
  const result = new StageAssessmentSelector().select(empty);
  assert.deepEqual(result.selectedQuestionIds, []);
  assert.deepEqual(result.focusKnowledgePointIds, []);
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.totalPoolSize, 0);
  assert.equal(result.questionLimit, 6);
});

test('weak points drive focus questions first', async () => {
  const { StageAssessmentSelector } = await loadSelector();
  const result = new StageAssessmentSelector().select(snapshot());
  assert.deepEqual(result.focusKnowledgePointIds, ['kp-weak']);
  assert.deepEqual(result.selectedQuestionIds, ['q-focus-1', 'q-focus-2', 'q-other-1']);
});

test('weakest knowledge point ranks first within focus questions', async () => {
  const { StageAssessmentSelector } = await loadSelector();
  const source = snapshot({
    masteryFacts: { source: 'user_knowledge_mastery', averageMastery: 40, weakCount: 2, reviewCount: 0, masteredCount: 0, weakPoints: [{ knowledgeNodeId: 'kp-a', subject: 'OS', chapter: 'A', title: 'A', masteryRate: 30, accuracyRate: 20 }, { knowledgeNodeId: 'kp-b', subject: 'OS', chapter: 'B', title: 'B', masteryRate: 45, accuracyRate: 40 }] },
    questionPoolFacts: { knowledgePoints: [{ id: 'kp-a', subject: 'OS', chapter: 'A', title: 'A', importance: 4 }, { id: 'kp-b', subject: 'OS', chapter: 'B', title: 'B', importance: 3 }], questions: [
      { id: 'q-b', stem: 'B', difficulty: 'easy', type: '单选', source: null, year: null, knowledgePointIds: ['kp-b'], expectedTimeSec: 60 },
      { id: 'q-a', stem: 'A', difficulty: 'hard', type: '单选', source: null, year: null, knowledgePointIds: ['kp-a'], expectedTimeSec: 90 },
    ] },
  });
  const result = new StageAssessmentSelector().select(source);
  assert.deepEqual(result.selectedQuestionIds, ['q-a', 'q-b']);
});

test('question limit controls the number of selected questions', async () => {
  const { StageAssessmentSelector } = await loadSelector();
  const result = new StageAssessmentSelector().select(snapshot(), { questionLimit: 2 });
  assert.equal(result.questionLimit, 2);
  assert.equal(result.selectedQuestions.length, 2);
  assert.equal(result.selectedQuestions[0].id, 'q-focus-1');
});

test('selector does not mutate the snapshot', async () => {
  const { StageAssessmentSelector } = await loadSelector();
  const source = snapshot();
  const before = JSON.stringify(source);
  new StageAssessmentSelector().select(source, { questionLimit: 2 });
  assert.equal(JSON.stringify(source), before);
});

test('selector has no database, repository, DTO, or recommendation dependencies', async () => {
  const source = await readFile(new URL('../apps/api/src/study/stage-assessment.selector.ts', import.meta.url), 'utf8');
  for (const forbidden of ['Prisma', 'Repository', 'StudyService', 'Controller', 'Adapter', 'recommendation', 'nextAction', 'title', 'description']) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be present`);
  }
  assert.match(source, /StageAssessmentSnapshot/);
});