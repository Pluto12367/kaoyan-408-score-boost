// Sprint 3.2 parity：旧 generateDailyPlan（git HEAD@f95601d 逐语句转录）vs 新引擎路径。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const shared = require('../packages/shared/dist/index.js');

// G1.1 — mirrors apps/api/src/study/recommendation.service.ts `studentReasonText`.
function studentReasonText(reasonCodes) {
  const labels = (reasonCodes ?? [])
    .map((code) => shared.REASON_LABELS[code] ?? null)
    .filter((label) => Boolean(label));
  const unique = [...new Set(labels)];
  if (unique.length === 0) {
    return '当前证据不足：这个任务没有触发可解释的推荐原因，系统不会替你编一个。';
  }
  return unique.join('；');
}

const repo = require('../apps/api/src/score-center/repository.ts');
const studyDate = require('../apps/api/src/study/study-date.ts');
const { RecommendationService } = require('../apps/api/src/study/recommendation.service.ts');

// ---- fixture ----
const TARGET_EXAM = new Date('2027-01-15T00:00:00.000Z');

const FIXTURE_NODES = [
  { id: 'node-ds', subject: 'DS', name: '树的遍历应用', importance: 5, difficulty: 3, isActive: true, nodeType: 'atomicPoint' },
  { id: 'node-co', subject: 'CO', name: 'Cache 映射与替换', importance: 4, difficulty: 4, isActive: true, nodeType: 'atomicPoint' },
  { id: 'node-os', subject: 'OS', name: '进程同步与互斥', importance: 5, difficulty: 3, isActive: true, nodeType: 'atomicPoint' },
];

const FIXTURE_SNAPSHOTS = [
  { knowledgeNodeId: 'node-ds', recent3Frequency: 4, recent5Frequency: 4, allTimeEvidence: 4, primaryScore5y: 6, trendDirection: 'STABLE', trendDelta: 0, evidenceConfidence: 'HIGH' },
  { knowledgeNodeId: 'node-co', recent3Frequency: 2, recent5Frequency: 3, allTimeEvidence: 5, primaryScore5y: 4, trendDirection: 'RISING', trendDelta: 1, evidenceConfidence: 'MEDIUM' },
  // V11-M3: every fixture node carries a snapshot so the parity guarantee
  // covers the fully-snapshotted universe (no-snapshot nodes are exercised
  // by the recommendation-honesty tests instead).
  { knowledgeNodeId: 'node-os', recent3Frequency: 3, recent5Frequency: 3, allTimeEvidence: 3, primaryScore5y: 3, trendDirection: 'STABLE', trendDelta: 0, evidenceConfidence: 'MEDIUM' },
];

const FIXTURE_MASTERIES = [
  { knowledgeNodeId: 'node-ds', mastery: 0.42, accuracy: 0.6, recentAccuracy: 0.5, attempts: 8, correctCount: 4, wrongCount: 4, retention: 0.4, stabilityDays: 3, lastReviewedAt: new Date('2026-08-25T00:00:00.000Z'), pinned: false },
  { knowledgeNodeId: 'node-co', mastery: 0.7, accuracy: 0.8, recentAccuracy: 0.75, attempts: 6, correctCount: 5, wrongCount: 1, retention: 0.9, stabilityDays: 7, lastReviewedAt: new Date('2026-08-20T00:00:00.000Z'), pinned: false },
];

const FIXTURE_RELATIONS = [{ fromId: 'node-co', toId: 'node-ds', type: 'PREREQUISITE' }];

function createPrisma(captures) {
  const tx = {
    studyPlan: {
      updateMany: async (args) => { captures.archive.push(args); return { count: 0 }; },
      create: async (args) => {
        captures.create.push(args);
        const tasks = args.data.tasks.create.map((task, index) => ({ id: 'task-' + index, ...task }));
        return { id: 'plan-1', createdAt: new Date('2026-08-30T08:00:00.000Z'), ...args.data, tasks };
      },
    },
  };
  return {
    user: { findUnique: async ({ where }) => ({ id: where.id, targetScore: 115, currentScore: 72, remainingDays: 96, dailyHours: 3, studyStage: '强化' }) },
    reviewSchedule: { count: async () => 0 },
    knowledgeNode: { findMany: async () => FIXTURE_NODES },
    knowledgeFrequencySnapshot: {
      findFirst: async () => ({ snapshotDate: new Date('2026-08-01T00:00:00.000Z'), modelVersion: 'test-v1' }),
      findMany: async () => FIXTURE_SNAPSHOTS,
    },
    userKnowledgeMastery: { findMany: async () => FIXTURE_MASTERIES },
    knowledgeRelation: { findMany: async () => FIXTURE_RELATIONS },
    $transaction: async (fn) => fn(tx),
  };
}

function legacyDeps() {
  return {
    loadEvidenceNodes: repo.loadEvidenceNodes,
    loadLatestFrequencySnapshots: repo.loadLatestFrequencySnapshots,
    loadMasteries: repo.loadMasteries,
    loadKnowledgeRelations: repo.loadKnowledgeRelations,
    archiveScoreCenterPlans: repo.archiveScoreCenterPlans,
    createScoreCenterPlan: repo.createScoreCenterPlan,
    calculatePriority: shared.calculatePriority,
    composeDailyPlan: shared.composeDailyPlan,
    todayKey: studyDate.todayKey,
    startOfDay: (date) => { const v = new Date(date); v.setHours(0, 0, 0, 0); return v; },
  };
}

// ---- 旧链参照：score-center/service.ts@f95601d generateDailyPlan 逐语句转录 ----
const MODEL_VERSION = 'score-center-v1';
const ACTION_LABELS = { LEARN: '新学', REVIEW: '复习', PRACTICE: '练习', WRONG_QUESTION: '错题重做', MOCK: '模拟测试' };

function priorityLabel(score) {
  if (score >= 70) return '高';
  if (score >= 45) return '中';
  return '低';
}

function toMasteryState(row) {
  return {
    mastery: row.mastery, accuracy: row.accuracy, recentAccuracy: row.recentAccuracy,
    attempts: row.attempts, correctCount: row.correctCount, wrongCount: row.wrongCount,
    confidence: row.confidence,
  };
}

function legacyStartOfDay(date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

async function legacyGenerateDailyPlan(prisma, userId, input, deps) {
  const {
    loadEvidenceNodes, loadLatestFrequencySnapshots, loadMasteries, loadKnowledgeRelations,
    archiveScoreCenterPlans, createScoreCenterPlan, calculatePriority, composeDailyPlan,
    todayKey, startOfDay,
  } = deps;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const scheduledDate = todayKey();
  const daysToExam = Math.max(
    0,
    Math.ceil((legacyStartOfDay(input.targetExamDate).getTime() - Date.now()) / 86_400_000),
  );

  const [nodes, snapshots, masteries, relations] = await Promise.all([
    loadEvidenceNodes(prisma),
    loadLatestFrequencySnapshots(prisma),
    loadMasteries(prisma, userId),
    loadKnowledgeRelations(prisma),
  ]);
  const snapshotByNode = new Map(snapshots.map((snapshot) => [snapshot.knowledgeNodeId, snapshot]));
  const masteryByNode = new Map(masteries.map((mastery) => [mastery.knowledgeNodeId, mastery]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const prerequisiteByNode = new Map();
  const prerequisiteMastery = {};
  for (const relation of relations) {
    const list = prerequisiteByNode.get(relation.fromId) ?? [];
    list.push(relation.toId);
    prerequisiteByNode.set(relation.fromId, list);
  }

  const candidates = [];
  const breakdownByNode = new Map();
  for (const node of nodes) {
    const snapshot = snapshotByNode.get(node.id);
    if (!snapshot) continue;
    const mastery = masteryByNode.get(node.id);
    const userState = mastery
      ? { ...toMasteryState(mastery), retention: mastery.retention, pinned: mastery.pinned }
      : undefined;
    const evidence = {
      knowledgePointId: node.id,
      importance: node.importance,
      difficulty: node.difficulty,
      recent3Y: { frequency: snapshot.recent3Frequency },
      recent5Y: { frequency: snapshot.recent5Frequency, primaryScore: snapshot.primaryScore5y },
      allTimeEvidence: { frequency: snapshot.allTimeEvidence },
      trend: { direction: snapshot.trendDirection, delta: snapshot.trendDelta },
      evidenceConfidence: snapshot.evidenceConfidence,
    };
    const priority = calculatePriority(evidence, userState, { daysToExam });
    breakdownByNode.set(node.id, priority.breakdown);
    const prerequisites = prerequisiteByNode.get(node.id) ?? [];
    for (const prerequisiteId of prerequisites) {
      const prerequisiteMasteryValue = masteryByNode.get(prerequisiteId)?.mastery;
      if (prerequisiteMasteryValue != null) {
        prerequisiteMastery[prerequisiteId] = prerequisiteMasteryValue;
      }
    }
    candidates.push({
      knowledgePointId: node.id,
      subject: node.subject,
      difficulty: node.difficulty,
      mastery: userState?.mastery ?? 0.5,
      recentAccuracy: userState?.recentAccuracy ?? 0.55,
      recentWrongCount: userState?.wrongCount ?? 0,
      forgetting: userState?.retention != null ? Math.max(0, 1 - userState.retention) : 0.5,
      retention: mastery?.retention ?? null,
      lastReviewedAt: mastery?.lastReviewedAt ?? null,
      score: priority.score,
      reasonCodes: priority.reasons,
      prerequisites,
      pinned: mastery?.pinned ?? false,
    });
  }

  const drafts = composeDailyPlan({
    candidates,
    availableMinutes: input.availableMinutes,
    daysToExam,
    prerequisiteMastery,
  });

  const plan = await prisma.$transaction(async (tx) => {
    await archiveScoreCenterPlans(tx, userId);
    return createScoreCenterPlan(
      tx,
      userId,
      {
        targetScore: user?.targetScore ?? 115,
        remainingDays: user?.remainingDays ?? daysToExam,
        dailyHours: user?.dailyHours ?? 3.5,
        modelVersion: MODEL_VERSION,
        targetExamDate: input.targetExamDate,
        availableMinutes: input.availableMinutes,
        scheduledDate,
      },
      drafts.map((draft, index) => {
        const node = nodeById.get(draft.knowledgePointId);
        return {
          knowledgePointId: draft.knowledgePointId,
          knowledgeNodeId: draft.knowledgePointId,
          subject: node?.subject ?? '',
          chapter: '',
          title: node?.name ?? draft.knowledgePointId,
          mode: ACTION_LABELS[draft.action],
          minutes: draft.estimatedMinutes,
          questionCount: draft.action === 'MOCK' ? 30 : 8,
          scheduledDate,
          priority: priorityLabel(draft.score),
          // G1.1: the legacy transcript used `draft.reasonCodes.join('、')`, which
          // leaked raw engine codes to students and fell back to the machine token
          // `recommendation:${action}`. The service now translates through the
          // shared REASON_LABELS table; the transcript mirrors the fixed contract
          // so the 18-field parity assertion stays strict and meaningful.
          reason: studentReasonText(draft.reasonCodes),
          nextAction: ACTION_LABELS[draft.action],
          status: 'pending',
          priorityScore: draft.score,
          recommendationAction: draft.action,
          reasonCodes: draft.reasonCodes,
          scoreBreakdown: breakdownByNode.get(draft.knowledgePointId) ?? {},
          generatedRank: index + 1,
        };
      }),
    );
  });

  return plan;
}

// ---- 新链 ----
function newService(captures) {
  return new RecommendationService(createPrisma(captures));
}

test('daily plan parity: legacy and engine paths persist identical StudyPlan data', async () => {
  const legacyCaptures = { archive: [], create: [] };
  const newCaptures = { archive: [], create: [] };

  const legacyPlan = await legacyGenerateDailyPlan(createPrisma(legacyCaptures), 'u-1', {
    targetExamDate: TARGET_EXAM, availableMinutes: 60,
  }, legacyDeps());

  const service = newService(newCaptures);
  const newPlan = await service.generateDailyPlanFromState('u-1', {
    targetExamDate: TARGET_EXAM, availableMinutes: 60,
  });

  assert.deepEqual(newCaptures.create[0].data, legacyCaptures.create[0].data);
  assert.deepEqual(newCaptures.archive, legacyCaptures.archive);
  assert.equal(newPlan.id, 'plan-1');
  assert.ok(legacyPlan.tasks.length > 0, 'legacy plan should contain tasks');
});

test('daily plan parity: tasks match field-by-field (nodeId/action/questionCount/subject/priority/reason)', async () => {
  const legacyCaptures = { archive: [], create: [] };
  const newCaptures = { archive: [], create: [] };

  await legacyGenerateDailyPlan(createPrisma(legacyCaptures), 'u-1', {
    targetExamDate: TARGET_EXAM, availableMinutes: 60,
  }, legacyDeps());
  const service = newService(newCaptures);
  await service.generateDailyPlanFromState('u-1', {
    targetExamDate: TARGET_EXAM, availableMinutes: 60,
  });

  const legacyTasks = legacyCaptures.create[0].data.tasks.create;
  const newTasks = newCaptures.create[0].data.tasks.create;
  assert.equal(newTasks.length, legacyTasks.length);
  for (let i = 0; i < legacyTasks.length; i += 1) {
    for (const field of ['knowledgePointId', 'knowledgeNodeId', 'subject', 'chapter', 'title', 'mode', 'minutes', 'questionCount', 'scheduledDate', 'priority', 'reason', 'nextAction', 'status', 'priorityScore', 'recommendationAction', 'reasonCodes', 'scoreBreakdown', 'generatedRank']) {
      assert.deepEqual(newTasks[i][field], legacyTasks[i][field], `task ${i} field ${field} must match`);
    }
  }
});

test('recommendation service exposes engine result for Sprint 3.3/3.4 reuse', async () => {
  const service = newService({ archive: [], create: [] });
  const { result } = await service.runRecommendationForUser('u-1', {
    availableMinutes: 60, targetExamDate: TARGET_EXAM, now: new Date('2026-08-30T08:00:00.000Z'),
  });
  assert.equal(result.source, 'recommendation_engine_v1');
  assert.ok(Array.isArray(result.items) && result.items.length > 0);
  for (const item of result.items) {
    assert.ok(!('knowledgePointId' in item), 'engine items must not carry knowledgePointId');
  }
});
