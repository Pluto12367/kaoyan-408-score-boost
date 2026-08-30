// Sprint 3.3.4 parity：practice-set / review-resources 的 DTO 映射对照。
// legacy 参照 = study.service.ts@HEAD(3528d75) 两方法的逐语句转录（internals 以 fixture 注入）；
// 新链 = RecommendationService（引擎 fixture）→ adapter → 同一内容选择逻辑。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const shared = require('../packages/shared/dist/index.js');
const adapters = {
  bridge: require('../apps/api/src/study/practice-set-recommendation.adapter.ts'),
  review: require('../apps/api/src/study/review-resources-recommendation.adapter.ts'),
  service: require('../apps/api/src/study/recommendation.service.ts'),
};
const { RecommendationService } = adapters.service;

// ---- fixture（新旧口径校准：引擎弱项桥接后 = legacy 报告弱项）----
const TODAY = '2026-08-30';
const FIXTURE_REPORT = {
  weakPoints: [
    { knowledgePointId: 'kp-ds-tree', title: '树的遍历应用', accuracyRate: 50 },
  ],
  accuracyRate: 80,
  speedRisks: [],
};
const FIXTURE_ENGINE_NODES = [
  { id: 'node-ds-tree', subject: 'DS', name: '树的遍历应用', importance: 5, difficulty: 3, isActive: true, nodeType: 'atomicPoint' },
  { id: 'node-ds-strong', subject: 'DS', name: '图的遍历应用', importance: 4, difficulty: 3, isActive: true, nodeType: 'atomicPoint' },
];
const FIXTURE_MASTERIES = [
  { knowledgeNodeId: 'node-ds-tree', mastery: 0.3, accuracy: 0.5, recentAccuracy: 0.4, attempts: 4, correctCount: 2, wrongCount: 2, retention: null, stabilityDays: null, lastReviewedAt: null, pinned: false },
  { knowledgeNodeId: 'node-ds-strong', mastery: 0.85, accuracy: 0.95, recentAccuracy: 0.9, attempts: 10, correctCount: 9, wrongCount: 0, retention: 0.95, stabilityDays: 14, lastReviewedAt: new Date('2026-08-29T00:00:00.000Z'), pinned: false },
];
const FIXTURE_SNAPSHOTS = [
  { knowledgeNodeId: 'node-ds-tree', recent3Frequency: 4, recent5Frequency: 4, allTimeEvidence: 4, primaryScore5y: 6, trendDirection: 'STABLE', trendDelta: 0, evidenceConfidence: 'HIGH' },
  { knowledgeNodeId: 'node-ds-strong', recent3Frequency: 3, recent5Frequency: 3, allTimeEvidence: 3, primaryScore5y: 4, trendDirection: 'STABLE', trendDelta: 0, evidenceConfidence: 'HIGH' },
];
const KP_DIRECTORY = [
  { id: 'kp-ds-tree', title: '树的遍历应用', subject: '操作系统', chapter: '进程管理' },
];
const QUESTIONS = [
  { id: 'q-1', stem: '题干一', knowledgePointIds: ['kp-ds-tree'], expectedTimeSec: 60, type: '选择题', options: ['A', 'B'], answer: 'A', analysis: '解析' },
  { id: 'q-2', stem: '题干二', knowledgePointIds: ['kp-ds-tree'], expectedTimeSec: 90, type: '选择题', options: ['A', 'B'], answer: 'B', analysis: '解析' },
  { id: 'q-3', stem: '题干二（重复，应被去重）', knowledgePointIds: ['kp-ds-tree'], expectedTimeSec: 60, type: '选择题', options: ['A', 'B'], answer: 'A', analysis: '解析' },
];

function fixturePrisma() {
  return {
    user: { findUnique: async () => ({ id: 'u-1', targetScore: 115, currentScore: 72, remainingDays: 96, dailyHours: 3, studyStage: '强化' }) },
    reviewSchedule: { count: async () => 0 },
    knowledgeNode: { findMany: async () => FIXTURE_ENGINE_NODES },
    knowledgeFrequencySnapshot: {
      findFirst: async () => ({ snapshotDate: new Date('2026-08-01T00:00:00.000Z'), modelVersion: 'test-v1' }),
      findMany: async () => FIXTURE_SNAPSHOTS,
    },
    userKnowledgeMastery: { findMany: async () => FIXTURE_MASTERIES },
    knowledgeRelation: { findMany: async () => [] },
  };
}

function newRecommendation() {
  return new RecommendationService(fixturePrisma());
}

// ---- legacy 参照（internals 注入）----
function legacyInternals(overrides = {}) {
  return {
    getOverviewReport: () => ({
      weakPoints: FIXTURE_REPORT.weakPoints,
      accuracyRate: FIXTURE_REPORT.accuracyRate,
      speedRisks: [],
    }),
    getStudent: () => ({ stage: '强化' }),
    generatePlan: () => ({ dailyTasks: [{ knowledgePointId: 'kp-fallback' }] }),
    questions: QUESTIONS,
    useNodeMastery: false,
    nodeQuestionIdsByNode: new Map(),
    knowledgePoints: KP_DIRECTORY,
    dataSource: 'postgresql',
    todayKey: () => TODAY,
    listWrongQuestions: () => [
      { knowledgePointId: 'kp-ds-tree', wrongCount: 3, latestMistakeReason: '概念混淆' },
    ],
    getMasteryMap: () => ({ weakestPoints: [] }),
    student: { id: 'u-1' },
    ...overrides,
  };
}

function legacyGetRecommendedPracticeSet(internals, userId) {
  internals.ensureNodeMasteryFresh?.();
  const report = internals.getOverviewReport(userId);
  const stage = internals.getStudent(userId).stage ?? '强化';
  const weakPointIds = report.weakPoints.map((point) => point.knowledgePointId);
  const fallbackPointIds = internals.generatePlan(userId).dailyTasks.map((task) => task.knowledgePointId);
  const knowledgePointIds = [...new Set(weakPointIds)].slice(0, 4);
  let matchingQuestions = [];
  if (matchingQuestions.length === 0) {
    const sourceIds = weakPointIds.length ? weakPointIds : fallbackPointIds;
    knowledgePointIds.splice(0, knowledgePointIds.length, ...sourceIds.slice(0, 4));
    matchingQuestions = internals.questions.filter((question) =>
      question.knowledgePointIds.some((id) => knowledgePointIds.includes(id)),
    );
  }
  if (matchingQuestions.length === 0) {
    knowledgePointIds.push(...internals.questions.flatMap((question) => question.knowledgePointIds).slice(0, 2));
    matchingQuestions = internals.questions.filter((question) =>
      question.knowledgePointIds.some((id) => knowledgePointIds.includes(id)),
    );
  }
  const questionCount = stage === '冲刺' ? 20 : report.accuracyRate < 55 ? 16 : 12;
  const questions = shared.dedupeQuestionsByStem(matchingQuestions).slice(0, Math.min(questionCount, matchingQuestions.length));

  return {
    id: `practice-set-${internals.todayKey()}`,
    userId,
    title: stage === '冲刺'
      ? '真题错题回炉训练'
      : report.accuracyRate < 55
        ? '高频基础考点补强'
        : '薄弱专题突破',
    stage,
    focus: stage === '冲刺'
      ? '近年真题、错题重做、限时复盘'
      : report.accuracyRate < 55
        ? '例题理解、概念复述、基础题组'
        : '相似考点辨析、变式题组、错因复盘',
    reason: report.weakPoints[0]
      ? `优先覆盖 ${report.weakPoints[0].title}，当前正确率 ${report.weakPoints[0].accuracyRate}%。`
      : '当前薄弱点较少，按今日计划和高频考点生成练习题组。',
    knowledgePointIds,
    questionCount: questions.length,
    estimatedMinutes: Math.max(10, Math.round(questions.reduce((sum, question) => sum + question.expectedTimeSec, 0) / 60)),
    questions: questions.map((question) => ({ id: question.id, stem: question.stem, options: question.options })),
  };
}

function legacyGetRecommendedReviewResources(internals, userId) {
  const report = internals.getOverviewReport(userId);
  const masteryMap = internals.getMasteryMap(userId);
  const wrongQuestions = internals.listWrongQuestions(userId);
  const weakPointCandidates = report.weakPoints.length
    ? report.weakPoints.map((point) => ({
      knowledgePointId: point.knowledgePointId,
      title: point.title,
      subject: point.subject,
      accuracyRate: point.accuracyRate,
    }))
    : masteryMap.weakestPoints.map((point) => ({
      knowledgePointId: point.knowledgePointId,
      title: point.title,
      subject: point.subject,
      accuracyRate: point.accuracyRate,
    }));
  const selectedPoints = weakPointCandidates.slice(0, 3);
  const fallbackPoint = internals.knowledgePoints[0];
  const resourcePoints = selectedPoints.length
    ? selectedPoints
    : [{
      knowledgePointId: fallbackPoint.id,
      title: fallbackPoint.title,
      subject: fallbackPoint.subject,
      accuracyRate: 70,
    }];
  const items = resourcePoints.flatMap((point, index) => {
    const wrongQuestion = wrongQuestions.find((item) => item.knowledgePointId === point.knowledgePointId);
    const knowledgePoint = internals.knowledgePoints.find((item) => item.id === point.knowledgePointId);
    const title = knowledgePoint?.title ?? point.title;
    const subject = knowledgePoint?.subject ?? point.subject ?? '408';
    const chapter = knowledgePoint?.chapter ?? '高频章节';
    const baseMinutes = point.accuracyRate < 50 ? 18 : 12;

    return [
      {
        id: `resource-${point.knowledgePointId}-concept`,
        knowledgePointId: point.knowledgePointId,
        knowledgePointTitle: title,
        subject,
        resourceType: 'concept_card',
        title: `${title} 核心概念卡`,
        summary: `先复述 ${chapter} 中 ${title} 的定义、适用条件和常见题干关键词。`,
        estimatedMinutes: baseMinutes,
        difficulty: index === 0 ? '基础' : '中等',
        actionText: '看完后做一组同考点题',
        actionAnchor: '#question',
      },
      {
        id: `resource-${point.knowledgePointId}-mistake`,
        knowledgePointId: point.knowledgePointId,
        knowledgePointTitle: title,
        subject,
        resourceType: 'mistake_checklist',
        title: `${title} 错因检查清单`,
        summary: wrongQuestion
          ? `该考点已有 ${wrongQuestion.wrongCount} 次错误，优先检查：${wrongQuestion.latestMistakeReason ?? '概念混淆'}。`
          : '按知识点没学过、概念混淆、公式记错、计算错误、审题错误、推理过程错误、时间不足、蒙题八类检查最近错因。',
        estimatedMinutes: 8,
        difficulty: '基础',
        actionText: '去错题本复盘',
        actionAnchor: '#wrong-book',
      },
      {
        id: `resource-${point.knowledgePointId}-practice`,
        knowledgePointId: point.knowledgePointId,
        knowledgePointTitle: title,
        subject,
        resourceType: 'practice_set',
        title: `${title} 专项验证训练`,
        summary: '完成 3 到 5 道同知识点题目，用正确率和耗时判断是否已经补上。',
        estimatedMinutes: 15,
        difficulty: point.accuracyRate < 60 ? '中等' : '提高',
        actionText: '进入专项训练',
        actionAnchor: '#question',
      },
    ];
  }).slice(0, 6);

  return {
    source: internals.dataSource,
    userId,
    generatedAt: '2026-08-30T08:00:00.000Z',
    weakPointCount: report.weakPoints.length,
    items,
  };
}

// ---- 新链（引擎 + adapter，题目选择逻辑与 study.service 一致）----
async function newPracticeSet() {
  const recommendation = new RecommendationService(fixturePrisma());
  const { result, accuracyRateByNode } = await recommendation.runRecommendationForUser('u-1', {
    availableMinutes: 60, now: new Date('2026-08-30T08:00:00.000Z'),
  });
  const knowledgeItems = result.items.filter((item) => item.kind === 'KNOWLEDGE');
  const weakKnowledgeItems = knowledgeItems.filter((item) => item.facts.mastery < 0.45);
  const questionSet = result.items.find((item) => item.kind === 'QUESTION_SET');
  const nodeIds = weakKnowledgeItems.map((item) => item.knowledgeNodeId);
  const kpIdsByNodeId = { 'node-ds-tree': ['kp-ds-tree'] };
  const knowledgePointIds = adapters.bridge.bridgeKnowledgePointIds({ nodeIds: nodeIds.slice(0, 4), kpIdsByNodeId });
  const topNode = knowledgeItems[0];
  const topKp = KP_DIRECTORY.find((kp) => (kpIdsByNodeId[topNode.knowledgeNodeId] ?? []).includes(kp.id));
  const copy = adapters.bridge.buildPracticeSetCopy({
    stage: '强化',
    overallAccuracyRate: 80,
    questionSetFocus: questionSet?.focus ?? null,
    topWeakPoint: topKp ? { title: topKp.title, accuracyRate: accuracyRateByNode[topNode.knowledgeNodeId] ?? 0 } : null,
  });
  let matchingQuestions = QUESTIONS.filter((question) =>
    question.knowledgePointIds.some((id) => knowledgePointIds.includes(id)),
  );
  if (matchingQuestions.length === 0) {
    const fallbackIds = QUESTIONS.flatMap((question) => question.knowledgePointIds).slice(0, 2);
    knowledgePointIds.push(...fallbackIds);
    matchingQuestions = QUESTIONS.filter((question) =>
      question.knowledgePointIds.some((id) => knowledgePointIds.includes(id)),
    );
  }
  const questionCount = questionSet?.questionCount ?? 12;
  const questions = shared.dedupeQuestionsByStem(matchingQuestions).slice(0, Math.min(questionCount, matchingQuestions.length));
  return {
    id: `practice-set-${TODAY}`,
    userId: 'u-1',
    title: copy.title,
    stage: '强化',
    focus: copy.focus,
    reason: copy.reason,
    knowledgePointIds,
    questionCount: questions.length,
    estimatedMinutes: Math.max(10, Math.round(questions.reduce((sum, question) => sum + question.expectedTimeSec, 0) / 60)),
    questions: questions.map((question) => ({ id: question.id, stem: question.stem, options: question.options })),
  };
}

async function newReviewResources() {
  const recommendation = new RecommendationService(fixturePrisma());
  const { result, accuracyRateByNode } = await recommendation.runRecommendationForUser('u-1', {
    availableMinutes: 60, now: new Date('2026-08-30T08:00:00.000Z'),
  });
  const knowledgeItems = result.items.filter((item) => item.kind === 'KNOWLEDGE');
  const weakKnowledgeItems = knowledgeItems.filter((item) => item.facts.mastery < 0.45);
  const nodeIds = weakKnowledgeItems.map((item) => item.knowledgeNodeId);
  const kpIdsByNodeId = { 'node-ds-tree': ['kp-ds-tree'] };
  const resourcePoints = weakKnowledgeItems.slice(0, 3).map((item) => {
    const kpIds = kpIdsByNodeId[item.knowledgeNodeId] ?? [];
    const kp = KP_DIRECTORY.find((point) => kpIds.includes(point.id));
    return {
      knowledgePointId: kp?.id ?? item.knowledgeNodeId,
      title: kp?.title ?? item.knowledgeNodeId,
      subject: kp?.subject ?? '408',
      chapter: kp?.chapter ?? '高频章节',
      accuracyRate: accuracyRateByNode[item.knowledgeNodeId] ?? 70,
    };
  });
  const wrongQuestions = [
    { knowledgePointId: 'kp-ds-tree', wrongCount: 3, latestMistakeReason: '概念混淆' },
  ];
  return adapters.review.buildReviewResourcesDto({
    userId: 'u-1',
    source: 'postgresql',
    generatedAt: '2026-08-30T08:00:00.000Z',
    weakPointCount: weakKnowledgeItems.length,
    resourcePoints,
    wrongQuestions,
  });
}

test('practice-set parity: title/focus/reason/knowledgePointIds/questionCount match legacy', async () => {
  const internals = legacyInternals();
  const legacy = legacyGetRecommendedPracticeSet(internals, 'u-1');
  const next = await newPracticeSet();
  assert.equal(next.title, legacy.title);
  assert.equal(next.focus, legacy.focus);
  assert.equal(next.reason, legacy.reason);
  assert.deepEqual(next.knowledgePointIds, legacy.knowledgePointIds);
  assert.equal(next.questionCount, legacy.questionCount);
  assert.equal(next.estimatedMinutes, legacy.estimatedMinutes);
  // 题目实例：去重后同集合
  assert.deepEqual(
    next.questions.map((question) => question.id),
    legacy.questions.map((question) => question.id),
  );
});

test('review-resources parity: items and envelope match legacy', async () => {
  const internals = legacyInternals();
  const legacy = legacyGetRecommendedReviewResources(internals, 'u-1');
  const next = await newReviewResources();
  assert.equal(next.weakPointCount, legacy.weakPointCount);
  assert.equal(next.source, legacy.source);
  assert.equal(next.items.length, legacy.items.length);
  assert.deepEqual(next.items, legacy.items);
});
