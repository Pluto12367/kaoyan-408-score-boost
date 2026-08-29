import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const asOf = new Date('2026-08-24T08:00:00.000Z');
const generatedAt = asOf.toISOString();

async function loadModule(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    const key = Object.keys(dependencies).find((c) => specifier.includes(c));
    if (key) return dependencies[key];
    if (specifier.includes('study-date')) return { studyDateKey: () => '2026-08-24' };
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

function snapshot(overrides = {}) {
  return {
    source: 'stage_assessment_facts', userId: 'u-1', asOf: generatedAt,
    studentFacts: { stage: '强化', targetScore: 120 },
    assessmentFacts: { attemptCount: 2, bestScore: 86, latestScore: 82, latestAccuracyRate: 0.8, lastAssessmentAt: '2026-08-20T00:00:00.000Z' },
    masteryFacts: { source: 'user_knowledge_mastery', averageMastery: 50, weakCount: 1, reviewCount: 0, masteredCount: 0, weakPoints: [{ knowledgeNodeId: 'kp-weak', subject: 'OS', chapter: '内存', title: '页表', masteryRate: 40, accuracyRate: 30 }] },
    practiceFacts: { totalCount: 3, todayCount: 1, accuracy: 0.5, lastPracticeAt: generatedAt },
    wrongQuestionFacts: { total: 2, unresolved: 1, resolved: 1, dueCount: 1, latestWrongAt: generatedAt },
    questionPoolFacts: {
      knowledgePoints: [
        { id: 'kp-weak', subject: 'OS', chapter: '内存', title: '页表', importance: 5 },
        { id: 'kp-other', subject: 'OS', chapter: '调度', title: '进程调度', importance: 4 },
      ],
      questions: [
        { id: 'q-weak-1', stem: 'Q1', difficulty: 'medium', type: '单选', source: '真题', year: 2020, knowledgePointIds: ['kp-weak'], expectedTimeSec: 90 },
        { id: 'q-weak-2', stem: 'Q2', difficulty: 'hard', type: '多选', source: '模拟', year: null, knowledgePointIds: ['kp-weak'], expectedTimeSec: 120 },
        { id: 'q-other-1', stem: 'Q3', difficulty: 'easy', type: '单选', source: '真题', year: 2021, knowledgePointIds: ['kp-other'], expectedTimeSec: 60 },
      ],
    },
    ...overrides,
  };
}

// Legacy reference: the shape StudyService.getStageAssessment() produces from the
// same facts (focus-first selection + fallback + questionLimit, plus legacy copy).
function legacyFromFacts(source, questionLimit = 6) {
  const focusIds = new Set(source.masteryFacts.weakPoints.map((p) => p.knowledgeNodeId));
  const focus = source.questionPoolFacts.questions.filter((q) => q.knowledgePointIds.some((id) => focusIds.has(id)));
  const fallback = source.questionPoolFacts.questions.filter((q) => !focus.includes(q));
  const selected = [...focus, ...fallback].slice(0, Math.min(questionLimit, source.questionPoolFacts.questions.length));
  const selectedKpIds = [...new Set(selected.flatMap((q) => q.knowledgePointIds))];
  const pointsById = new Map(source.questionPoolFacts.knowledgePoints.map((p) => [p.id, p]));
  const focusKnowledgePoints = selectedKpIds.map((id) => pointsById.get(id)).filter(Boolean);
  return {
    id: `stage-2026-08-24`,
    title: `${source.studentFacts.stage ?? '强化'}阶段测评`,
    userId: source.userId,
    description: '根据当前薄弱点生成的小测，用于判断本阶段是否需要继续专项突破。',
    estimatedMinutes: Math.max(10, Math.round(selected.reduce((sum, q) => sum + q.expectedTimeSec, 0) / 60)),
    focusKnowledgePoints,
    questions: selected,
    // legacy catalog fields that new fact model intentionally does not carry:
    legacyCatalogFields: ['options', 'answer', 'analysis', 'frequency', 'prerequisites'],
  };
}

async function runNewPath(source, questionLimit = 6) {
  const snapshotModule = await loadModule('apps/api/src/study/stage-assessment.snapshot.ts');
  const selectorModule = await loadModule('apps/api/src/study/stage-assessment.selector.ts', { 'stage-assessment.snapshot': snapshotModule });
  const adapterModule = await loadModule('apps/api/src/study/stage-assessment.adapter.ts', {
    'stage-assessment.snapshot': snapshotModule,
    'stage-assessment.selector': selectorModule,
  });
  const selection = new selectorModule.StageAssessmentSelector().select(source, { questionLimit });
  return adapterModule.toLegacyStageAssessment(source, selection, generatedAt);
}

test('parity: empty user data yields same stage/title and empty questions', async () => {
  const empty = snapshot({
    studentFacts: { stage: null, targetScore: null },
    assessmentFacts: { attemptCount: 0, bestScore: null, latestScore: null, latestAccuracyRate: null, lastAssessmentAt: null },
    masteryFacts: { source: 'empty', averageMastery: 0, weakCount: 0, reviewCount: 0, masteredCount: 0, weakPoints: [] },
    practiceFacts: { totalCount: 0, todayCount: 0, accuracy: 0, lastPracticeAt: null },
    wrongQuestionFacts: { total: 0, unresolved: 0, resolved: 0, dueCount: 0, latestWrongAt: null },
    questionPoolFacts: { knowledgePoints: [], questions: [] },
  });
  const legacy = legacyFromFacts(empty);
  const dto = await runNewPath(empty);
  assert.equal(dto.stage, legacy.title.replace('阶段测评', ''));
  assert.equal(dto.title, legacy.title);
  assert.deepEqual(dto.questions, []);
  assert.deepEqual(dto.focusKnowledgePoints, []);
  assert.equal(dto.summary.attemptCount, 0);
  assert.equal(dto.summary.bestScore, null);
});

test('parity: assessment history maps to summary fields', async () => {
  const source = snapshot();
  const legacy = legacyFromFacts(source);
  const dto = await runNewPath(source);
  assert.equal(dto.summary.attemptCount, 2);
  assert.equal(dto.summary.bestScore, 86);
  assert.equal(dto.summary.latestScore, 82);
  assert.equal(dto.summary.latestAccuracyRate, 0.8);
  assert.equal(dto.userId, legacy.userId);
});

test('parity: weak points drive focus knowledge points and selected questions', async () => {
  const source = snapshot();
  const legacy = legacyFromFacts(source);
  const dto = await runNewPath(source);
  assert.deepEqual(dto.focusKnowledgePoints.map((p) => p.id), legacy.focusKnowledgePoints.map((p) => p.id));
  assert.deepEqual(dto.questions.map((q) => q.id), legacy.questions.map((q) => q.id));
  assert.equal(dto.questions.length, 3);
  assert.equal(dto.questions[0].id, 'q-weak-1');
});

test('parity: question pool maps ids and knowledge point ids', async () => {
  const source = snapshot();
  const dto = await runNewPath(source);
  assert.equal(dto.questions.length, 3);
  assert.deepEqual(dto.questions.map((q) => q.id), ['q-weak-1', 'q-weak-2', 'q-other-1']);
  assert.deepEqual(dto.questions[0].knowledgePointIds, ['kp-weak']);
  assert.deepEqual(dto.focusKnowledgePoints[0].id, 'kp-weak');
});

test('parity: questionLimit keeps new and legacy counts identical', async () => {
  const source = snapshot();
  const legacy = legacyFromFacts(source, 2);
  const dto = await runNewPath(source, 2);
  assert.equal(dto.questions.length, legacy.questions.length);
  assert.equal(dto.questions.length, 2);
  assert.deepEqual(dto.questions.map((q) => q.id), legacy.questions.map((q) => q.id));
});

test('parity: fallback behavior adds non-focus questions when pool exceeds focus set', async () => {
  const source = snapshot();
  const dto = await runNewPath(source, 6);
  assert.equal(dto.questions.length, 3);
  assert.equal(dto.questions.some((q) => q.id === 'q-other-1'), true);
  const legacy = legacyFromFacts(source, 6);
  assert.deepEqual(dto.questions.map((q) => q.id), legacy.questions.map((q) => q.id));
});

test('parity: fixed asOf produces stable generatedAt and id', async () => {
  const source = snapshot();
  const first = await runNewPath(source);
  const second = await runNewPath(source);
  assert.equal(first.generatedAt, generatedAt);
  assert.equal(first.id, 'stage-2026-08-24');
  assert.deepEqual(first, second);
});

test('parity: documented real differences do not modify production logic', async () => {
  const source = snapshot();
  const legacy = legacyFromFacts(source);
  const dto = await runNewPath(source);
  // Legacy includes full catalog fields (options/answer/analysis on questions,
  // frequency/prerequisites on knowledge points); new fact model intentionally
  // carries only facts. This is a documented boundary, not a production fix.
  for (const field of legacy.legacyCatalogFields) {
    assert.equal(JSON.stringify(dto.questions).includes(`"${field}"`), false, `${field} should not appear in new fact-based questions`);
  }
  assert.equal(dto.description, legacy.description);
  assert.equal(dto.title, legacy.title);
});