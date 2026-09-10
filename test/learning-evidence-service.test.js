/**
 * V12-M1 — Learning Evidence Service (write path + query).
 *
 * Proves the two audit breakpoints are closed in the honest direction:
 *   EB-1  task completion now produces a recorded evidence entry
 *   EB-2  "marked as reviewed" now produces a recorded evidence entry
 * but neither is allowed to masquerade as an ability observation, and the
 * service never writes mastery itself.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { LearningEvidenceService } = require('../apps/api/src/study/learning-evidence.service.ts');

const AT = '2026-09-10T02:00:00.000Z';

function createHarness(options = {}) {
  const written = [];
  const stored = options.stored ?? [];
  const enabled = options.enabled ?? true;

  const canonicalEvents = {
    recordCanonicalEvent: async (input) => {
      if (!enabled) return null;
      const duplicate = written.find((row) => row.eventKey === input.eventKey);
      if (duplicate) return duplicate;
      const row = { id: `evt-${written.length + 1}`, ...input, payload: input.payload ?? null };
      written.push(row);
      return row;
    },
  };

  const userEvents = {
    enabled,
    listByType: async (userId, type, limit) => {
      if (!enabled) return [];
      return stored
        .filter((row) => row.userId === userId && row.type === type)
        .slice(0, limit ?? stored.length);
    },
  };

  return {
    written,
    service: new LearningEvidenceService(canonicalEvents, userEvents),
  };
}

// ---------------------------------------------------------------------------
// EB-1 — task completion produces evidence (honestly)
// ---------------------------------------------------------------------------

test('task completion with self-reported numbers records weak evidence, never ability evidence', async () => {
  const { service, written } = createHarness();
  const record = await service.recordTaskCompletion('u1', {
    taskId: 'task-1',
    completedDate: '2026-09-10',
    completedQuestionCount: 10,
    correctCount: 8,
    minutesSpent: 35,
    selfRating: 4,
  });

  assert.equal(record.strength, 'weak');
  assert.equal(record.canInfluenceMastery, false);
  assert.equal(record.metrics.selfReported, true);
  assert.equal(record.metrics.accuracyRate, 80);
  assert.equal(written.length, 1);
  assert.equal(written[0].type, 'EVIDENCE_RECORDED');
  assert.match(written[0].eventKey, /^LEARNING_EVIDENCE:u1:task\.completed:task-1/);
});

test('task completion without reported numbers records activity-only, claiming nothing', async () => {
  const { service } = createHarness();
  const record = await service.recordTaskCompletion('u1', {
    taskId: 'task-1',
    completedDate: '2026-09-10',
  });

  assert.equal(record.strength, 'none');
  assert.equal(record.kind, 'none');
  assert.equal(record.canInfluenceMastery, false);
  assert.equal(record.metrics.attempts, null);
  assert.equal(record.metrics.correctCount, null);
  assert.equal(record.metrics.accuracyRate, null);
  assert.match(record.basis, /完成标记/);
});

test('task completion evidence is idempotent for the same task and date', async () => {
  const { service, written } = createHarness();
  const first = await service.recordTaskCompletion('u1', {
    taskId: 'task-1',
    completedDate: '2026-09-10',
    completedQuestionCount: 5,
    correctCount: 4,
  });
  const second = await service.recordTaskCompletion('u1', {
    taskId: 'task-1',
    completedDate: '2026-09-10',
    completedQuestionCount: 5,
    correctCount: 4,
  });

  assert.equal(first.id, second.id);
  assert.equal(written.length, 1, 'a repeated completion must not create a second evidence row');
});

// ---------------------------------------------------------------------------
// EB-2 — review marking produces evidence (honestly)
// ---------------------------------------------------------------------------

test('marking a question reviewed records activity-only evidence and admits it is not proof', async () => {
  const { service } = createHarness();
  const record = await service.recordReviewMarked('u1', { questionId: 'q1', reviewedAt: AT });

  assert.equal(record.action, 'review.marked');
  assert.equal(record.kind, 'none');
  assert.equal(record.strength, 'none');
  assert.equal(record.canInfluenceMastery, false);
  assert.match(record.basis, /标记已复习/);
});

test('a review with an observed redo outcome records strong recall evidence', async () => {
  const { service } = createHarness();
  const record = await service.recordReviewRecall('u1', {
    questionId: 'q1',
    redoCorrect: false,
    timeSpentSec: 120,
    recordedAt: AT,
  });

  assert.equal(record.action, 'review.recalled');
  assert.equal(record.kind, 'recall_outcome');
  assert.equal(record.strength, 'strong');
  assert.equal(record.canInfluenceMastery, true);
});

test('repeated recalls of the same question on different days are distinct evidence', async () => {
  const { service, written } = createHarness();
  await service.recordReviewRecall('u1', {
    questionId: 'q1',
    redoCorrect: true,
    timeSpentSec: 60,
    recordedAt: '2026-09-10T02:00:00.000Z',
    scope: '2026-09-10',
  });
  await service.recordReviewRecall('u1', {
    questionId: 'q1',
    redoCorrect: true,
    timeSpentSec: 45,
    recordedAt: '2026-09-11T02:00:00.000Z',
    scope: '2026-09-11',
  });

  assert.equal(written.length, 2, 'each observed recall is new evidence');
  assert.notEqual(written[0].eventKey, written[1].eventKey);
});

// ---------------------------------------------------------------------------
// Query surface
// ---------------------------------------------------------------------------

test('listing returns stored evidence with an honest summary', async () => {
  const { service } = createHarness({
    stored: [
      {
        userId: 'u1',
        type: 'EVIDENCE_RECORDED',
        eventKey: 'k1',
        payload: {
          action: 'task.completed',
          kind: 'self_reported',
          strength: 'weak',
          canInfluenceMastery: false,
          basis: '自评数据仅作弱证据。',
          metrics: { attempts: 10, correctCount: 8, accuracyRate: 80, selfReported: true },
          sourceId: 'task-1',
          recordedAt: AT,
        },
      },
      {
        userId: 'u1',
        type: 'EVIDENCE_RECORDED',
        eventKey: 'k2',
        payload: {
          action: 'review.marked',
          kind: 'none',
          strength: 'none',
          canInfluenceMastery: false,
          basis: '标记已复习不构成学习证据。',
          metrics: { attempts: null, correctCount: null, accuracyRate: null, selfReported: false },
          sourceId: 'q1',
          recordedAt: AT,
        },
      },
    ],
  });

  const result = await service.list('u1', { limit: 20 });
  assert.ok(result);
  assert.equal(result.records.length, 2);
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.weak, 1);
  assert.equal(result.summary.none, 1);
  assert.equal(result.summary.hasAbilityEvidence, false);
  assert.match(result.summary.basis, /拒绝/);
});

test('listing reports ability evidence when a strong observation is stored', async () => {
  const { service } = createHarness({
    stored: [
      {
        userId: 'u1',
        type: 'EVIDENCE_RECORDED',
        eventKey: 'k1',
        payload: {
          action: 'practice.answered',
          kind: 'objective_performance',
          strength: 'strong',
          canInfluenceMastery: true,
          basis: '已判分练习事实构成强证据。',
          metrics: { attempts: 4, correctCount: 3, accuracyRate: 75, selfReported: false },
          sourceId: 'q1',
          recordedAt: AT,
        },
      },
    ],
  });

  const result = await service.list('u1', {});
  assert.ok(result);
  assert.equal(result.summary.hasAbilityEvidence, true);
  assert.equal(result.summary.abilityEvidenceCount, 1);
});

test('listing is honestly absent when the store is unavailable', async () => {
  const { service } = createHarness({ enabled: false });
  assert.equal(await service.list('u1', {}), null);
});

test('listing skips malformed rows instead of inventing evidence', async () => {
  const { service } = createHarness({
    stored: [
      { userId: 'u1', type: 'EVIDENCE_RECORDED', eventKey: 'bad', payload: null },
      { userId: 'u1', type: 'EVIDENCE_RECORDED', eventKey: 'bad2', payload: { action: 'nonsense' } },
      {
        userId: 'u1',
        type: 'EVIDENCE_RECORDED',
        eventKey: 'good',
        payload: {
          action: 'review.recalled',
          kind: 'recall_outcome',
          strength: 'strong',
          canInfluenceMastery: true,
          basis: '已观测重做结果。',
          metrics: { attempts: 1, correctCount: 1, accuracyRate: 100, selfReported: false },
          sourceId: 'q1',
          recordedAt: AT,
        },
      },
    ],
  });

  const result = await service.list('u1', {});
  assert.ok(result);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].action, 'review.recalled');
});
