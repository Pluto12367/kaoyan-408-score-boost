/**
 * V12-M1 — Evidence Foundation boundary & wiring proof.
 *
 * These tests exist to stop the milestone from being "green on paper":
 *   • the evidence layer must actually be CALLED by the write paths (EB-1/EB-2)
 *   • it must receive the student's real numbers and never a synthesised one
 *   • it must never write mastery (single-writer discipline preserved)
 *   • evidence must not be forgeable from the client
 *   • the endpoint must stay self-only
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { StudyService } = require('../apps/api/src/study/study.service.ts');
const {
  TELEMETRY_EVENT_TYPES,
  RESERVED_CANONICAL_EVENT_TYPES,
} = require('../apps/api/src/study/canonical-event-writer.service.ts');

const unavailable = { enabled: false };

function buildService(options = {}) {
  const completionRows = [];
  const evidenceCalls = [];
  const learningProgress = {
    enabled: true,
    async saveTaskCompletion(input) {
      completionRows.push(input);
    },
    async saveWrongQuestionReview() {},
  };
  const learningEvidence = {
    async recordTaskCompletionEvidence(userId, input) {
      evidenceCalls.push({ kind: 'task.completed', userId, input });
      return { selfReported: { id: 'e1' }, observed: null };
    },
    async recordReviewMarked(userId, input) {
      evidenceCalls.push({ kind: 'review.marked', userId, input });
      return { id: 'e2' };
    },
    async recordReviewRecall(userId, input) {
      evidenceCalls.push({ kind: 'review.recalled', userId, input });
      return { id: 'e3' };
    },
  };
  const scoreCenterService = options.scoreCenterCompletes
    ? { async completeTask() { return { id: options.taskId ?? 'task-1', status: 'completed' }; } }
    : {};

  const dependencies = [
    { listQuestions: () => [], findQuestionById: async () => null },
    unavailable,
    { enabled: false, save: async (record) => record },
    learningProgress,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    { enabled: false, saveSchedule: async () => {} },
    unavailable,
    { enabled: false },
    unavailable,
    { get: (id) => ({ id, name: 'Student', role: 'student' }) },
    unavailable,
    unavailable,
    unavailable,
    { record: async () => {} },
    scoreCenterService,
    undefined,
    undefined,
    undefined,
    undefined,
    { maybeGenerateLearningLoopPlan: async () => null },
  ];
  // 26..29 then the V12-M1 dependency at position 30.
  while (dependencies.length < 29) dependencies.push(undefined);
  dependencies.push(learningEvidence);

  const service = new StudyService(...dependencies);
  return { service, completionRows, evidenceCalls };
}

function seedPlan(service, userId, task) {
  service.sevenDayPlansByUser.set(userId, {
    id: 'plan-1',
    userId,
    phase: '强化',
    targetScore: 120,
    remainingDays: 90,
    dailyHours: 2,
    checkpoint: '',
    startDate: '2026-08-30',
    tasks: [task],
  });
}

const scheduledTask = {
  id: 'task-1',
  knowledgePointId: 'kp-1',
  subject: '数据结构',
  chapter: '',
  title: 'Task',
  mode: '训练',
  minutes: 30,
  questionCount: 5,
  scheduledDate: '2026-08-30',
  priority: '高',
  reason: '',
  nextAction: '',
  status: 'pending',
  postponeCount: 0,
};

// ---------------------------------------------------------------------------
// EB-1 — the write path actually records evidence, with real numbers
// ---------------------------------------------------------------------------

test('completing a scheduled task records evidence with exactly the student-reported values', async () => {
  const { service, evidenceCalls } = buildService();
  seedPlan(service, 'u-1', { ...scheduledTask });

  await service.completeStudyTask('task-1', {
    userId: 'u-1',
    completedQuestionCount: 5,
    correctCount: 4,
    minutesSpent: 30,
    selfRating: 4,
  });

  assert.equal(evidenceCalls.length, 1, 'completion must record evidence (EB-1)');
  assert.equal(evidenceCalls[0].kind, 'task.completed');
  assert.equal(evidenceCalls[0].input.taskId, 'task-1');
  assert.equal(evidenceCalls[0].input.completedQuestionCount, 5);
  assert.equal(evidenceCalls[0].input.correctCount, 4);
  assert.equal(evidenceCalls[0].input.minutesSpent, 30);
  assert.equal(evidenceCalls[0].input.selfRating, 4);
});

test('evidence records a missing correctCount as null, never the synthesised 75% default', async () => {
  const { service, evidenceCalls } = buildService({ scoreCenterCompletes: true, taskId: 'sc-task' });

  // The score-center branch is the reachable path where metrics may be partial.
  // Inside completeStudyTaskUnlocked the in-memory metric is defaulted to
  // Math.round(questionCount * 0.75) = 4 for a 5-question task; evidence must
  // not inherit that invented number.
  await service.completeStudyTask('sc-task', {
    userId: 'u-1',
    completedQuestionCount: 5,
  });

  const call = evidenceCalls.find((row) => row.kind === 'task.completed');
  assert.ok(call, 'evidence must be recorded even when only partial metrics are given');
  assert.equal(call.input.completedQuestionCount, 5);
  assert.equal(call.input.correctCount ?? null, null, 'an unreported correct count stays unknown');
  assert.notEqual(call.input.correctCount, 4, 'must not inherit the fabricated questionCount*0.75');
});

test('score-center tasks (recommendation-generated) also record evidence', async () => {
  const { service, evidenceCalls } = buildService({ scoreCenterCompletes: true, taskId: 'sc-task' });
  // No plan seeded → the task is resolved by the score-center branch.
  const result = await service.completeStudyTask('sc-task', {
    userId: 'u-1',
    completedQuestionCount: 3,
    correctCount: 2,
  });

  assert.ok(result);
  const call = evidenceCalls.find((row) => row.kind === 'task.completed');
  assert.ok(call, 'the score-center branch is where engine tasks complete — it must record evidence');
  assert.equal(call.input.taskId, 'sc-task');
});

// ---------------------------------------------------------------------------
// Evidence must not be forgeable by a client
// ---------------------------------------------------------------------------

test('EVIDENCE_RECORDED is server-only: reserved canonical, never a client telemetry type', () => {
  assert.ok(
    RESERVED_CANONICAL_EVENT_TYPES.includes('EVIDENCE_RECORDED'),
    'evidence must be writable by the canonical writer',
  );
  assert.ok(
    !TELEMETRY_EVENT_TYPES.includes('EVIDENCE_RECORDED'),
    'a client must not be able to POST forged learning evidence',
  );
});

// ---------------------------------------------------------------------------
// Single-writer discipline: the evidence layer never touches mastery
// ---------------------------------------------------------------------------

test('the evidence layer contains no mastery write primitive', () => {
  const files = [
    'packages/shared/src/score-center/learning-evidence.ts',
    'apps/api/src/study/learning-evidence.service.ts',
  ];
  const forbidden = [
    'userKnowledgeMastery',
    'applyAttempts(',
    'applyReview(',
    'saveMastery',
    'userMasterySnapshot',
  ];
  for (const file of files) {
    const source = readFileSync(`${root}${file}`, 'utf8');
    for (const primitive of forbidden) {
      assert.ok(
        !source.includes(primitive),
        `${file} must not reference ${primitive} — mastery has exactly one writer`,
      );
    }
  }
});

test('recall evidence is recorded after the review transaction commits', () => {
  const source = readFileSync(`${root}apps/api/src/study/study.service.ts`, 'utf8');
  const commitMarker = source.indexOf('Only committed attempts may become visible');
  const recallEvidence = source.indexOf("recordLearningEvidence('review.recalled'");
  assert.ok(commitMarker > 0, 'the commit marker must still exist');
  assert.ok(recallEvidence > 0, 'recall evidence must be recorded');
  assert.ok(
    recallEvidence > commitMarker,
    'evidence must never describe an attempt that could still roll back',
  );
});

// ---------------------------------------------------------------------------
// Endpoint contract
// ---------------------------------------------------------------------------

test('the learning-evidence endpoint exists and cannot be pointed at another student', () => {
  const source = readFileSync(`${root}apps/api/src/study/daily-brief.controller.ts`, 'utf8');
  assert.ok(source.includes("@Get('coach/learning-evidence')"), 'route must be declared');

  const start = source.indexOf("@Get('coach/learning-evidence')");
  const end = source.indexOf('async getLearningEvidence');
  // Bound the slice at the NEXT route, not at a doc comment: inserting another
  // endpoint between them must not drag its decorators into this assertion.
  const nextRoute = source.indexOf('@Get(', end);
  const body = source.slice(end, nextRoute > end ? nextRoute : source.length);
  // Positive control: the slice must actually cover the method, otherwise the
  // assertion below would pass vacuously on an empty string.
  assert.ok(body.includes("user.id"), 'slice must cover the method body');
  assert.ok(body.includes("@Query('limit')"), 'slice must cover the method signature');
  assert.ok(
    !body.includes("@Query('userId')"),
    'evidence is personal data: the endpoint must not accept a userId override',
  );
  assert.ok(body.includes('user.id'), 'the endpoint must scope to the caller');
  void start;
});

test('evidence endpoint guards roles like the other coach endpoints', () => {
  const source = readFileSync(`${root}apps/api/src/study/daily-brief.controller.ts`, 'utf8');
  const at = source.indexOf("@Get('coach/learning-evidence')");
  const window = source.slice(at, at + 400);
  assert.ok(window.includes('@UseGuards(RoleGuard)'));
  assert.ok(window.includes("@Roles('student', 'teacher', 'admin')"));
});
