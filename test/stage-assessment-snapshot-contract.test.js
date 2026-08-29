import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadSnapshot() {
  const source = await readFile(new URL('../apps/api/src/study/stage-assessment.snapshot.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: 'stage-assessment.snapshot.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => { throw new Error(`Unexpected dependency: ${specifier}`); }, module, module.exports);
  return module.exports;
}

const asOf = '2026-08-24T08:00:00.000Z';

function fullFacts() {
  return {
    userId: 'u-1',
    asOf,
    assessmentFacts: { attemptCount: 2, bestScore: 86, latestScore: 82, latestAccuracyRate: 0.8, lastAssessmentAt: asOf },
    masteryFacts: { source: 'user_knowledge_mastery', averageMastery: 62, weakCount: 2, reviewCount: 1, masteredCount: 3, weakPoints: [{ knowledgeNodeId: 'kp-1', subject: '算子系统', chapter: '内存', title: '页表', masteryRate: 45, accuracyRate: 40 }] },
    practiceFacts: { totalCount: 8, todayCount: 2, accuracy: 0.625, lastPracticeAt: asOf },
    wrongQuestionFacts: { total: 3, unresolved: 2, resolved: 1, dueCount: 1 },
    questionPoolFacts: {
      knowledgePoints: [{ id: 'kp-1', subject: '操作系统', chapter: '内存', title: '页表', importance: 5 }],
      questions: [{ id: 'q-1', stem: '题干', difficulty: 'medium', type: '单选题', source: '真题', year: 2020, knowledgePointIds: ['kp-1'], expectedTimeSec: 90 }],
    },
  };
}

test('snapshot converts to StageAssessmentSnapshot with explicit fact domains', async () => {
  const { buildStageAssessmentSnapshot } = await loadSnapshot();
  const snapshot = buildStageAssessmentSnapshot(fullFacts());
  assert.equal(snapshot.source, 'stage_assessment_facts');
  assert.equal(snapshot.userId, 'u-1');
  assert.equal(snapshot.asOf, asOf);
  for (const field of ['assessmentFacts', 'masteryFacts', 'practiceFacts', 'wrongQuestionFacts', 'questionPoolFacts']) {
    assert.ok(snapshot[field], `${field} must be present`);
  }
  assert.equal(snapshot.assessmentFacts.bestScore, 86);
  assert.equal(snapshot.masteryFacts.averageMastery, 62);
  assert.equal(snapshot.practiceFacts.accuracy, 0.625);
  assert.equal(snapshot.wrongQuestionFacts.total, 3);
  assert.equal(snapshot.questionPoolFacts.questions[0].id, 'q-1');
});

test('empty snapshot is safe with explicit empty fact groups', async () => {
  const { buildStageAssessmentSnapshot } = await loadSnapshot();
  const snapshot = buildStageAssessmentSnapshot({ userId: 'u-empty', asOf });
  assert.equal(snapshot.source, 'stage_assessment_facts');
  assert.equal(snapshot.assessmentFacts.attemptCount, 0);
  assert.deepEqual(snapshot.masteryFacts.weakPoints, []);
  assert.equal(snapshot.practiceFacts.totalCount, 0);
  assert.equal(snapshot.wrongQuestionFacts.total, 0);
  assert.deepEqual(snapshot.questionPoolFacts.questions, []);
  assert.deepEqual(snapshot.questionPoolFacts.knowledgePoints, []);
});

test('snapshot excludes presentation strategy, recommendations, selection, and UI fields', async () => {
  const { buildStageAssessmentSnapshot } = await loadSnapshot();
  const snapshot = buildStageAssessmentSnapshot(fullFacts());
  // Top-level snapshot rejects presentation/selection/UI keys. Note: "title" is a
  // legitimate fact field inside weakPoints/knowledgePoints, so it must not appear
  // at the snapshot root — the legacy DTO's assessment title/description are the UI copy.
  const root = snapshot;
  for (const forbidden of ['recommendation', 'nextAction', 'reason', 'difficultySuggestion', 'selectedQuestions', 'estimatedMinutes', 'focusKnowledgePoints', 'priorityCard', 'checkpointMessage', 'actionText']) {
    assert.equal(JSON.stringify(root).includes(`"${forbidden}"`), false, `${forbidden} must not be in snapshot`);
  }
  assert.equal(root.title, undefined, 'snapshot root must not have DTO title');
  assert.equal(root.description, undefined, 'snapshot root must not have DTO description');
});

test('fixed asOf is preserved', async () => {
  const { buildStageAssessmentSnapshot } = await loadSnapshot();
  const snapshot = buildStageAssessmentSnapshot({ userId: 'u-1', asOf: new Date('2026-08-24T08:00:00.000Z') });
  assert.equal(snapshot.asOf, asOf);
});

test('snapshot contract documents projection sources without forbidden dependencies', async () => {
  const source = await readFile(new URL('../apps/api/src/study/stage-assessment.snapshot.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /StudyService|Controller|Adapter|Repository|PrismaService|QueryService/);
});