import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadModule(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    const key = Object.keys(dependencies).find((candidate) => specifier.includes(candidate));
    if (key) return dependencies[key];
    if (specifier.includes('@nestjs/common')) return { Injectable: () => (target) => target, Optional: () => (target, _key, _index) => undefined };
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

const asOf = new Date('2026-08-24T08:00:00.000Z');
const snapshot = {
  source: 'stage_assessment_facts',
  userId: 'u-1',
  asOf: asOf.toISOString(),
  studentFacts: { stage: '强化', targetScore: 120 },
  assessmentFacts: { attemptCount: 2, bestScore: 86, latestScore: 82, latestAccuracyRate: 0.8, lastAssessmentAt: '2026-08-20T00:00:00.000Z' },
  masteryFacts: { source: 'user_knowledge_mastery', averageMastery: 50, weakCount: 1, reviewCount: 0, masteredCount: 0, weakPoints: [] },
  practiceFacts: { totalCount: 0, todayCount: 0, accuracy: 0, lastPracticeAt: null },
  wrongQuestionFacts: { total: 0, unresolved: 0, resolved: 0, dueCount: 0, latestWrongAt: null },
  questionPoolFacts: { knowledgePoints: [], questions: [] },
};

test('query service calls projection, selector, and adapter in order', async () => {
  const calls = { projection: [], selector: [], adapter: [] };
  const query = await loadModule('apps/api/src/study/stage-assessment-query.service.ts', {
    'stage-assessment.snapshot': {
      buildStageAssessmentSnapshot: () => snapshot,
    },
    'stage-assessment.projection.service': {},
    'stage-assessment.selector': {
      StageAssessmentSelector: class {
        select(value) { calls.selector.push(value); return { userId: value.userId, asOf: value.asOf, selectedQuestions: [], focusKnowledgePoints: [], focusKnowledgePointIds: [], fallbackUsed: false, questionLimit: 6, totalPoolSize: 0 }; }
      },
    },
    'stage-assessment.adapter': {
      toLegacyStageAssessment: (value, selection, generatedAt) => {
        calls.adapter.push([value, selection, generatedAt]);
        return { id: 'stage-2026-08-24', userId: 'u-1' };
      },
    },
  });

  const service = new query.StageAssessmentQueryService({
    getSnapshot: async (...args) => {
      calls.projection.push(args);
      return snapshot;
    },
  });

  const result = await service.getStageAssessmentCompat('u-1', asOf);
  assert.equal(calls.projection.length, 1);
  assert.equal(calls.projection[0][0], 'u-1');
  assert.equal(calls.projection[0][1], asOf);
  assert.equal(calls.selector.length, 1);
  assert.equal(calls.adapter.length, 1);
  assert.deepEqual(result, { id: 'stage-2026-08-24', userId: 'u-1' });
});

test('query service passes default asOf and returns legacy DTO', async () => {
  const query = await loadModule('apps/api/src/study/stage-assessment-query.service.ts', {
    'stage-assessment.snapshot': { buildStageAssessmentSnapshot: () => snapshot },
    'stage-assessment.projection.service': {},
    'stage-assessment.selector': {
      StageAssessmentSelector: class {
        select(value) { return { userId: value.userId, asOf: value.asOf, selectedQuestions: [], focusKnowledgePoints: [], focusKnowledgePointIds: [], fallbackUsed: false, questionLimit: 6, totalPoolSize: 0 }; }
      },
    },
    'stage-assessment.adapter': {
      toLegacyStageAssessment: (value, selection, generatedAt) => ({
        id: 'stage-2026-08-24',
        generatedAt,
        title: `${value.studentFacts.stage}阶段测评`,
        description: 'ok',
        userId: value.userId,
        stage: value.studentFacts.stage,
        estimatedMinutes: 10,
        focusKnowledgePoints: selection.focusKnowledgePoints,
        questions: selection.selectedQuestions,
        summary: value.assessmentFacts,
        reason: 'ok',
        actionText: 'ok',
      }),
    },
  });
  const service = new query.StageAssessmentQueryService({ getSnapshot: async () => snapshot });
  const dto = await service.getStageAssessmentCompat('u-1');
  assert.equal(dto.userId, 'u-1');
  assert.equal(dto.stage, '强化');
  assert.equal(dto.generatedAt.length > 0, true);
});

test('query service keeps the legacy delegate optional and free of other dependencies', async () => {
  const source = await readFile(new URL('../apps/api/src/study/stage-assessment-query.service.ts', import.meta.url), 'utf8');
  // 过渡期契约：compat 查询允许以 @Optional 方式委托遗留 StudyService（题目池
  // catalog query 未就绪，见服务内注释）；其余脏依赖依旧禁止。
  assert.match(source, /@Optional\(\) private readonly legacy\?: StudyService/);
  for (const forbidden of ['Controller', 'Prisma', 'Repository', 'recommendation']) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be present`);
  }
});

test('query service does not mutate snapshot or selection', async () => {
  const query = await loadModule('apps/api/src/study/stage-assessment-query.service.ts', {
    'stage-assessment.snapshot': { buildStageAssessmentSnapshot: () => snapshot },
    'stage-assessment.projection.service': {},
    'stage-assessment.selector': {
      StageAssessmentSelector: class {
        select(value) { return { userId: value.userId, asOf: value.asOf, selectedQuestions: [], focusKnowledgePoints: [], focusKnowledgePointIds: [], fallbackUsed: false, questionLimit: 6, totalPoolSize: 0 }; }
      },
    },
    'stage-assessment.adapter': {
      toLegacyStageAssessment: (value, selection) => ({
        id: 'stage-2026-08-24',
        userId: value.userId,
        stage: value.studentFacts.stage,
        title: '强化阶段测评',
        description: 'ok',
        estimatedMinutes: 10,
        focusKnowledgePoints: selection.focusKnowledgePoints,
        questions: selection.selectedQuestions,
        summary: value.assessmentFacts,
        reason: 'ok',
        actionText: 'ok',
        generatedAt: value.asOf,
      }),
    },
  });
  const service = new query.StageAssessmentQueryService({ getSnapshot: async () => snapshot });
  const before = JSON.stringify(snapshot);
  await service.getStageAssessmentCompat('u-1', asOf);
  assert.equal(JSON.stringify(snapshot), before);
});