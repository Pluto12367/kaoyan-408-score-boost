import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const {
  resolveWrongQuestion,
  touchWrongQuestion,
} = require('../apps/api/src/score-center/repository.ts');
const { ScoreCenterService } = require('../apps/api/src/score-center/service.ts');
const { StudyService } = require('../apps/api/src/study/study.service.ts');
const { buildStudentStateSnapshot } = require('../apps/api/src/study/student-state.snapshot.ts');

const USER_ID = 'student-wrong';
const QUESTION_ID = 'q-original';
const VARIANT_ID = 'q-variant';
const NODE_ID = 'node-cache';
const KNOWLEDGE_POINT_ID = 'co-cache';
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

test.after(() => {
  if (ORIGINAL_DATABASE_URL == null) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  }
});

test('touchWrongQuestion creates an unresolved row and lets the schema provide the initial reviewedAt', async () => {
  const db = new FakeWrongQuestionDb();
  const answeredAt = new Date('2026-08-23T01:00:00.000Z');

  await touchWrongQuestion(db, USER_ID, QUESTION_ID, answeredAt);

  const row = db.reviewFor(USER_ID, QUESTION_ID);
  assert.equal(row.resolved, false);
  assert.equal(row.resolvedAt, null);
  assert.ok(row.reviewedAt instanceof Date);
});

test('touchWrongQuestion reopens a resolved question without refreshing reviewedAt', async () => {
  const db = new FakeWrongQuestionDb();
  const reviewedAt = new Date('2026-08-20T10:00:00.000Z');
  db.seedReview({
    userId: USER_ID,
    questionId: QUESTION_ID,
    reviewedAt,
    resolved: true,
    resolvedAt: new Date('2026-08-21T10:00:00.000Z'),
  });

  await touchWrongQuestion(db, USER_ID, QUESTION_ID, new Date('2026-08-23T01:00:00.000Z'));

  const row = db.reviewFor(USER_ID, QUESTION_ID);
  assert.equal(row.resolved, false);
  assert.equal(row.resolvedAt, null);
  assert.equal(row.reviewedAt.toISOString(), reviewedAt.toISOString());
});

test('resolveWrongQuestion marks lifecycle resolved without refreshing reviewedAt', async () => {
  const db = new FakeWrongQuestionDb();
  const reviewedAt = new Date('2026-08-20T10:00:00.000Z');
  const resolvedAt = new Date('2026-08-23T02:00:00.000Z');
  db.seedReview({
    userId: USER_ID,
    questionId: QUESTION_ID,
    reviewedAt,
    resolved: false,
    resolvedAt: null,
  });

  await resolveWrongQuestion(db, USER_ID, QUESTION_ID, resolvedAt);

  const row = db.reviewFor(USER_ID, QUESTION_ID);
  assert.equal(row.resolved, true);
  assert.equal(row.resolvedAt.toISOString(), resolvedAt.toISOString());
  assert.equal(row.reviewedAt.toISOString(), reviewedAt.toISOString());
});

test('resolveWrongQuestion does not write UserKnowledgeMastery state', async () => {
  const db = new FakeWrongQuestionDb();
  db.userKnowledgeMastery = {
    update: async () => assert.fail('题级 resolved 不应该直接修改 UserKnowledgeMastery'),
    updateMany: async () => assert.fail('题级 resolved 不应该直接修改 UserKnowledgeMastery'),
    upsert: async () => assert.fail('题级 resolved 不应该直接修改 UserKnowledgeMastery'),
  };

  await resolveWrongQuestion(db, USER_ID, QUESTION_ID, new Date('2026-08-23T02:00:00.000Z'));

  assert.equal(db.reviewFor(USER_ID, QUESTION_ID).resolved, true);
});

test('ScoreCenterService.applyReview updates mastery but no longer directly resolves wrong questions', async () => {
  process.env.DATABASE_URL = 'postgresql://unit.test/wrong-lifecycle';
  const db = new FakeScoreCenterDb();
  const service = new ScoreCenterService(db);

  await service.applyReview(USER_ID, QUESTION_ID, {
    reviewedAt: new Date('2026-08-23T03:00:00.000Z'),
    redoCorrect: true,
  });

  assert.equal(db.masteryWrites, 1);
  assert.equal(db.wrongQuestionReviewUpserts, 0);
});

test('manual wrong-question review only updates reviewedAt and does not create attempts or mastery updates', async () => {
  const harness = createStudyHarness();
  const reviewedBefore = harness.learningProgress.reviewedWrites.length;

  const response = await harness.service.reviewWrongQuestion(QUESTION_ID, USER_ID);

  assert.equal(response.reviewStatus, 'reviewed');
  assert.equal(harness.learningProgress.reviewedWrites.length, reviewedBefore + 1);
  assert.equal(harness.reviewSchedules.reviewAttempts.length, 0);
  assert.equal(harness.scoreCenter.reviewCalls.length, 0);
  assert.equal(harness.wrongReviews.reviewFor(USER_ID, QUESTION_ID)?.resolved, false);
});

test('reportWrongReason with isReview=false records wrong reason without ReviewAttempt, resolved write, or mastery update', async () => {
  const harness = createStudyHarness();

  await harness.service.reportWrongReason(QUESTION_ID, USER_ID, {
    selfReportedReason: '概念混淆',
    redoCorrect: false,
    timeSpentSec: 40,
    isReview: false,
  });

  assert.equal(harness.reviewSchedules.savedSchedules.length, 1);
  assert.equal(harness.reviewSchedules.reviewAttempts.length, 0);
  assert.equal(harness.scoreCenter.reviewCalls.length, 0);
  assert.equal(harness.wrongReviews.reviewFor(USER_ID, QUESTION_ID)?.resolved, false);
});

test('original retest below mastered updates schedule and attempt but does not change resolved', async () => {
  const harness = createStudyHarness({ consecutiveCorrect: 0 });

  await harness.service.reportWrongReason(QUESTION_ID, USER_ID, {
    selfReportedReason: '复盘后重做',
    redoCorrect: true,
    timeSpentSec: 50,
    isReview: true,
  });

  assert.equal(harness.reviewSchedules.reviewAttempts.length, 1);
  assert.equal(harness.reviewSchedules.lastReviewSchedule().stability, 'review');
  assert.equal(harness.scoreCenter.reviewCalls.length, 1);
  assert.equal(harness.wrongReviews.reviewFor(USER_ID, QUESTION_ID).resolved, false);
});

test('original retest resolves only when the ReviewSchedule reaches mastered', async () => {
  const harness = createStudyHarness({ consecutiveCorrect: 2 });

  await harness.service.reportWrongReason(QUESTION_ID, USER_ID, {
    selfReportedReason: '连续正确',
    redoCorrect: true,
    timeSpentSec: 50,
    isReview: true,
  });

  const row = harness.wrongReviews.reviewFor(USER_ID, QUESTION_ID);
  assert.equal(harness.reviewSchedules.lastReviewSchedule().stability, 'mastered');
  assert.equal(row.resolved, true);
  assert.ok(row.resolvedAt instanceof Date);
});

test('variant retest below mastered updates schedule and attempt but does not change resolved', async () => {
  const harness = createStudyHarness({ consecutiveCorrect: 1 });

  await harness.service.applyVariantRetest(
    practiceRecord({ questionId: VARIANT_ID, correct: true, timeSpentSec: 45 }),
    QUESTION_ID,
    harness.wrongReviews,
  );

  assert.equal(harness.reviewSchedules.reviewAttempts.length, 1);
  assert.equal(harness.reviewSchedules.lastReviewSchedule().stability, 'review');
  assert.equal(harness.wrongReviews.reviewFor(USER_ID, QUESTION_ID).resolved, false);
});

test('variant retest resolves only when the ReviewSchedule reaches mastered', async () => {
  const harness = createStudyHarness({ consecutiveCorrect: 2 });

  await harness.service.applyVariantRetest(
    practiceRecord({ questionId: VARIANT_ID, correct: true, timeSpentSec: 45 }),
    QUESTION_ID,
    harness.wrongReviews,
  );

  const row = harness.wrongReviews.reviewFor(USER_ID, QUESTION_ID);
  assert.equal(harness.reviewSchedules.lastReviewSchedule().stability, 'mastered');
  assert.equal(row.resolved, true);
  assert.ok(row.resolvedAt instanceof Date);
});

test('listWrongQuestions and StudentStateSnapshot both treat latest wrong as current even when resolved is true', () => {
  const harness = createStudyHarness();
  harness.wrongReviews.seedReview({
    userId: USER_ID,
    questionId: QUESTION_ID,
    reviewedAt: new Date('2026-08-22T10:00:00.000Z'),
    resolved: true,
    resolvedAt: new Date('2026-08-22T11:00:00.000Z'),
  });

  const wrongQuestions = harness.service.listWrongQuestions(USER_ID);
  const snapshot = buildStudentStateSnapshot({
    userId: USER_ID,
    asOf: '2026-08-23T12:00:00.000Z',
    user: null,
    masteryRows: [],
    wrongQuestionRows: [
      {
        questionId: QUESTION_ID,
        latestCorrect: false,
        latestSubmittedAt: new Date('2026-08-23T01:00:00.000Z'),
        reviewedAt: new Date('2026-08-22T10:00:00.000Z'),
        resolved: true,
      },
    ],
    reviewSchedules: [],
    studyTasks: [],
    assessmentSummary: {
      attemptCount: 0,
      bestScore: 0,
      latestAccuracyRate: 0,
      improvementText: '还没有测评记录，先完成一套模拟卷建立基线。',
    },
  });

  assert.deepEqual(wrongQuestions.map((item) => item.questionId), [QUESTION_ID]);
  assert.equal(snapshot.wrongQuestionSummary.total, 1);
  assert.equal(snapshot.wrongQuestionSummary.unresolved, 1);
});

function createStudyHarness(options = {}) {
  const wrongReviews = new FakeWrongQuestionDb();
  wrongReviews.seedReview({
    userId: USER_ID,
    questionId: QUESTION_ID,
    reviewedAt: new Date('2026-08-20T10:00:00.000Z'),
    resolved: options.resolved ?? false,
    resolvedAt: options.resolved ? new Date('2026-08-22T10:00:00.000Z') : null,
  });

  const reviewSchedules = new FakeReviewScheduleRepository();
  const learningProgress = new FakeLearningProgressRepository();
  const scoreCenter = new FakeStudyScoreCenterService();
  const userEvents = new FakeUserEventRepository();
  const service = new StudyService(
    new FakeQuestionsService(),
    disabledRepository(),
    disabledRepository(),
    learningProgress,
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    reviewSchedules,
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    userEvents,
    scoreCenter,
    wrongReviews,
    disabledRepository(),
  );
  service.records.splice(0, service.records.length, practiceRecord({ questionId: QUESTION_ID, correct: false }));
  service.reviewSchedules.set(scheduleKey(USER_ID, QUESTION_ID), reviewSchedule({
    consecutiveCorrect: options.consecutiveCorrect ?? 0,
    stability: options.stability ?? 'learning',
  }));
  return {
    service,
    wrongReviews,
    learningProgress,
    reviewSchedules,
    scoreCenter,
  };
}

function disabledRepository() {
  return { enabled: false };
}

function scheduleKey(userId, questionId) {
  return `${userId}@${questionId}`;
}

function practiceRecord(overrides = {}) {
  return {
    id: overrides.id ?? `record-${overrides.questionId ?? QUESTION_ID}-${overrides.correct === true ? 'correct' : 'wrong'}`,
    userId: overrides.userId ?? USER_ID,
    questionId: overrides.questionId ?? QUESTION_ID,
    knowledgePointId: overrides.knowledgePointId ?? KNOWLEDGE_POINT_ID,
    knowledgePointIds: overrides.knowledgePointIds ?? [KNOWLEDGE_POINT_ID],
    selectedAnswer: overrides.selectedAnswer ?? 'A',
    correct: overrides.correct ?? false,
    timeSpentSec: overrides.timeSpentSec ?? 60,
    expectedTimeSec: overrides.expectedTimeSec ?? 60,
    mistakeReason: overrides.correct ? null : '概念不清',
    submittedAt: overrides.submittedAt ?? '2026-08-23T01:00:00.000Z',
    confidence: overrides.confidence,
    usedHint: overrides.usedHint,
    answerModified: overrides.answerModified,
    variantQuestionId: overrides.variantQuestionId,
  };
}

function reviewSchedule(overrides = {}) {
  return {
    questionId: QUESTION_ID,
    userId: USER_ID,
    inferredReason: '概念不清',
    selfReportedReason: '概念混淆',
    note: undefined,
    lastWrongRecordId: 'record-q-original-wrong',
    redoCorrect: false,
    timeSpentSec: 40,
    consecutiveCorrect: overrides.consecutiveCorrect ?? 0,
    stability: overrides.stability ?? 'learning',
    nextReviewAt: '2026-08-24T01:00:00.000Z',
    reviewCount: overrides.reviewCount ?? 0,
    lastReviewedAt: undefined,
  };
}

class FakeQuestionsService {
  listQuestions() {
    return [
      {
        id: QUESTION_ID,
        stem: 'Cache 映射题',
        options: ['A', 'B', 'C', 'D'],
        answer: 'B',
        analysis: 'Cache analysis',
        difficulty: '中等',
        type: '选择题',
        source: 'unit',
        expectedTimeSec: 60,
        knowledgePointIds: [KNOWLEDGE_POINT_ID],
      },
      {
        id: VARIANT_ID,
        stem: 'Cache 变式题',
        options: ['A', 'B', 'C', 'D'],
        answer: 'B',
        analysis: 'Variant analysis',
        difficulty: '中等',
        type: '选择题',
        source: 'unit',
        expectedTimeSec: 60,
        knowledgePointIds: [KNOWLEDGE_POINT_ID],
      },
    ];
  }
}

class FakeLearningProgressRepository {
  constructor() {
    this.enabled = true;
    this.reviewedWrites = [];
  }

  async saveWrongQuestionReview(userId, questionId, reviewedAt) {
    this.reviewedWrites.push({ userId, questionId, reviewedAt });
  }
}

class FakeReviewScheduleRepository {
  constructor() {
    this.enabled = true;
    this.savedSchedules = [];
    this.reviewAttempts = [];
  }

  async saveSchedule(schedule) {
    this.savedSchedules.push(schedule);
  }

  async saveReview(schedule, attempt) {
    this.savedSchedules.push(schedule);
    this.reviewAttempts.push(attempt);
  }

  lastReviewSchedule() {
    return this.savedSchedules.at(-1);
  }
}

class FakeStudyScoreCenterService {
  constructor() {
    this.reviewCalls = [];
  }

  async applyReview(userId, questionId, input) {
    this.reviewCalls.push({ userId, questionId, input });
  }
}

class FakeUserEventRepository {
  async record() {}
}

class FakeWrongQuestionDb {
  constructor() {
    this.rows = new Map();
    this.defaultReviewedAt = new Date('2026-08-23T00:00:00.000Z');
    this.wrongQuestionReview = {
      upsert: async ({ where, create, update }) => {
        const key = this.key(where.userId_questionId.userId, where.userId_questionId.questionId);
        const existing = this.rows.get(key);
        if (existing) {
          const next = { ...existing, ...update };
          this.rows.set(key, next);
          return this.clone(next);
        }
        const row = {
          reviewedAt: this.defaultReviewedAt,
          resolved: null,
          resolvedAt: null,
          ...create,
        };
        this.rows.set(key, row);
        return this.clone(row);
      },
    };
  }

  key(userId, questionId) {
    return `${userId}:${questionId}`;
  }

  seedReview(row) {
    this.rows.set(this.key(row.userId, row.questionId), { ...row });
  }

  reviewFor(userId, questionId) {
    return this.rows.get(this.key(userId, questionId));
  }

  clone(row) {
    return row ? { ...row } : null;
  }
}

class FakeScoreCenterDb {
  constructor() {
    this.masteryWrites = 0;
    this.wrongQuestionReviewUpserts = 0;
    this.questionKnowledgeNodeTag = {
      findMany: async () => [{ knowledgeNodeId: NODE_ID, role: 'PRIMARY' }],
    };
    this.questionKnowledgePoint = {
      findMany: async () => [],
    };
    this.knowledgeNode = {
      findMany: async () => [{ id: NODE_ID, difficulty: 3, isActive: true }],
    };
    this.userKnowledgeMastery = {
      findUnique: async () => null,
      create: async ({ data }) => {
        this.masteryWrites += 1;
        return {
          id: 'ukm-1',
          userId: data.userId,
          knowledgeNodeId: data.knowledgeNodeId,
          ...data,
          retention: data.retention ?? null,
          stabilityDays: data.stabilityDays ?? null,
          lastLearnedAt: data.lastLearnedAt ?? null,
          lastReviewedAt: data.lastReviewedAt ?? null,
          nextReviewAt: data.nextReviewAt ?? null,
          pinned: data.pinned ?? false,
          version: data.version ?? 0,
          createdAt: new Date('2026-08-23T00:00:00.000Z'),
          updatedAt: new Date('2026-08-23T00:00:00.000Z'),
        };
      },
      updateMany: async () => ({ count: 1 }),
    };
    this.userMasterySnapshot = {
      upsert: async () => null,
    };
    this.wrongQuestionReview = {
      upsert: async () => {
        this.wrongQuestionReviewUpserts += 1;
        return null;
      },
    };
  }

  async $transaction(work) {
    return work(this);
  }
}
