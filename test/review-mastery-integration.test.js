/**
 * V12-M3-C — the authoritative review→mastery projection, unit level.
 *
 * What this file pins is the shape of the production chain, not the arithmetic
 * (the E2E proves the numbers against the shared model):
 *
 *   Review Observation → Evidence Receipt → Projection → Mastery,
 *
 * with the mastery write conditioned on a DURABLE receipt, applied exactly once,
 * and carried in the SAME transaction as the receipt and the claim — so the whole
 * unit commits or rolls back together.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const {
  ReviewMasteryIntegrationService,
  reviewMasteryMarkerKey,
  REVIEW_MASTERY_APPLIED_EVENT_TYPE,
} = require('../apps/api/src/study/review-mastery-integration.service.ts');

const ATTEMPT = 'att-1';
const RECEIPT = `LEARNING_EVIDENCE:u1:review.recalled:q1:2026-09-11:${ATTEMPT}`;

function harness(options = {}) {
  const calls = { evidence: [], markerReads: [], markerWrites: [], mastery: [], nodeResolution: [] };
  // The fake mirrors the SHAPE production's resolver queries, so each tier can be
  // exercised independently:
  //   tagRows  → QuestionKnowledgeNodeTag   (tiers 1 and 2)
  //   linkRows → QuestionKnowledgePoint     (tier 3, via KnowledgePoint.nodeMaps)
  const tagRows = options.tagRows === undefined
    ? [{ knowledgeNodeId: 'node-1', role: 'PRIMARY' }]
    : options.tagRows;
  const linkRows = options.linkRows === undefined ? [] : options.linkRows;
  const prisma = {
    questionKnowledgeNodeTag: {
      findMany: async () => {
        calls.nodeResolution.push('tag');
        return tagRows;
      },
    },
    questionKnowledgePoint: {
      findMany: async () => {
        calls.nodeResolution.push('bridge');
        return linkRows;
      },
    },
    knowledgeNode: { findUnique: async () => ({ difficulty: 3 }) },
  };
  // A real Prisma interactive-transaction client exposes every model delegate,
  // so the fake must too — otherwise the test would "prove" that the code avoids
  // reads inside a transaction, which is not what it does.
  const tx = { ...prisma, __transaction: true };
  const evidence = {
    enabled: options.evidenceEnabled ?? true,
    recordReviewRecallDurable: async (userId, input, passedTx) => {
      calls.evidence.push({ userId, input, tx: passedTx });
      return options.durable ?? {
        record: {
          id: RECEIPT,
          occurrence: input.occurrence,
          kind: 'recall_outcome',
          strength: 'strong',
          canInfluenceMastery: true,
        },
        persisted: true,
      };
    },
  };
  const events = {
    findCanonicalEvent: async (userId, key, passedTx) => {
      calls.markerReads.push({ userId, key, tx: passedTx });
      return options.existingMarker ?? null;
    },
    recordCanonicalEvent: async (input) => {
      calls.markerWrites.push(input);
      return { id: 'marker-row' };
    },
  };
  const scoreCenter = {
    enabled: options.scoreCenterEnabled ?? true,
    applyReviewObservation: async (userId, input, passedTx) => {
      calls.mastery.push({ userId, input, tx: passedTx });
      if (options.masteryReturnsNull) return null;
      return {
        questionId: input.questionId,
        evidenceEventKey: input.evidenceEventKey,
        isCorrect: input.isCorrect,
        semantics: 'legacy',
        nodes: [{
          nodeId: 'node-1', role: 'PRIMARY', masteryBefore: 0.6, masteryAfter: 0.6513, masteryDelta: 0.0513, attemptsAfter: 5,
        }],
        authoritative: true,
      };
    },
  };
  const service = new ReviewMasteryIntegrationService(
    options.prismaEnabled === false ? undefined : prisma,
    evidence,
    events,
    scoreCenter,
  );
  return { service, calls, tx };
}

const input = (overrides = {}) => ({
  attemptId: ATTEMPT,
  scheduleId: 'sched-1',
  questionId: 'q1',
  reviewedAt: new Date('2026-09-11T10:00:00.000Z'),
  redoCorrect: true,
  timeSpentSec: 45,
  actionId: null,
  isReview: true,
  ...overrides,
});

test('the happy path applies once and records the claim it was applied under', async () => {
  const { service, calls, tx } = harness();
  const result = await service.applyFromReviewObservation('u1', input(), tx);

  assert.equal(result.applied, true);
  assert.equal(result.reason, 'applied');
  assert.equal(result.evidenceEventKey, RECEIPT);
  assert.equal(result.occurrence, ATTEMPT);
  assert.equal(calls.mastery.length, 1, 'the mastery writer must be called exactly once');
  assert.equal(calls.markerWrites.length, 1);
  assert.equal(calls.markerWrites[0].type, REVIEW_MASTERY_APPLIED_EVENT_TYPE);
  assert.equal(calls.markerWrites[0].payload.evidenceEventKey, RECEIPT);
  assert.equal(calls.markerWrites[0].payload.semantics, 'legacy', 'C1 must stay off');
  assert.equal(calls.markerWrites[0].payload.authoritative, true);
  assert.match(result.basis, /复习观测经证据回执/);
});

test('every step runs in the SAME transaction — the chain is one atomic unit', async () => {
  const { service, calls, tx } = harness();
  await service.applyFromReviewObservation('u1', input(), tx);

  assert.equal(calls.evidence[0].tx, tx, 'the receipt must be written in the caller transaction');
  assert.equal(calls.markerReads[0].tx, tx, 'the claim must be read in the caller transaction');
  assert.equal(calls.mastery[0].tx, tx, 'the mastery write must be in the caller transaction');
  assert.equal(calls.markerWrites[0].tx, tx, 'the claim must be written in the caller transaction');
});

test('the receipt is recorded BEFORE the mastery decision, keyed by the occurrence', async () => {
  const { service, calls, tx } = harness();
  await service.applyFromReviewObservation('u1', input(), tx);
  assert.equal(calls.evidence[0].input.occurrence, ATTEMPT, 'the receipt must carry the occurrence identity');
  assert.equal(calls.mastery[0].input.evidenceEventKey, RECEIPT, 'mastery must be conditioned on that receipt');
  assert.equal(calls.mastery[0].input.isCorrect, true);
});

test('no durable receipt means no mastery change', async () => {
  // The boundary in its strictest form: if the ledger could not persist the
  // observation, nothing may move the ability estimate — otherwise no later
  // audit could explain the change.
  const { service, calls, tx } = harness({
    durable: {
      record: { id: RECEIPT, occurrence: ATTEMPT, kind: 'recall_outcome', strength: 'strong', canInfluenceMastery: true },
      persisted: false,
    },
  });
  const result = await service.applyFromReviewObservation('u1', input(), tx);

  assert.equal(result.applied, false);
  assert.equal(result.reason, 'evidence_not_persisted');
  assert.equal(calls.mastery.length, 0, 'an unpersisted observation must not reach the mastery engine');
  assert.equal(calls.markerWrites.length, 0, 'and must not claim an application either');
  assert.match(result.basis, /未持久化/);
});

test('an already-claimed receipt is not applied a second time', async () => {
  const { service, calls, tx } = harness({ existingMarker: { id: 'marker-row' } });
  const result = await service.applyFromReviewObservation('u1', input(), tx);

  assert.equal(result.applied, false);
  assert.equal(result.reason, 'already_applied');
  assert.equal(calls.mastery.length, 0, 'replay must not double-apply');
  assert.equal(calls.markerWrites.length, 0);
  assert.match(result.basis, /不重复应用/);
});

test('the claim key is deterministic and derived from the receipt', async () => {
  const { service, calls, tx } = harness();
  await service.applyFromReviewObservation('u1', input(), tx);
  assert.equal(calls.markerReads[0].key, reviewMasteryMarkerKey({ userId: 'u1', evidenceEventKey: RECEIPT }));
  assert.equal(
    reviewMasteryMarkerKey({ userId: 'u1', evidenceEventKey: RECEIPT }),
    reviewMasteryMarkerKey({ userId: 'u1', evidenceEventKey: RECEIPT }),
    'the same receipt must always map to the same claim (replay safe across processes)',
  );
  assert.notEqual(
    reviewMasteryMarkerKey({ userId: 'u1', evidenceEventKey: RECEIPT }),
    reviewMasteryMarkerKey({ userId: 'u2', evidenceEventKey: RECEIPT }),
    'claims must be student-scoped',
  );
});

test('a question with no knowledge node keeps the receipt but changes no mastery', async () => {
  // No direct tag AND no legacy bridge link → genuinely unresolvable. The
  // observation is still recorded (the absence is the finding) but nothing may
  // move the ability estimate, and no node may be invented.
  const { service, calls, tx } = harness({ tagRows: [], linkRows: [] });
  const result = await service.applyFromReviewObservation('u1', input(), tx);

  assert.equal(result.applied, false);
  assert.equal(result.reason, 'no_knowledge_node');
  assert.equal(calls.evidence.length, 1, 'the observation is still recorded — the absence is the finding');
  assert.equal(calls.mastery.length, 0);
  assert.match(result.basis, /知识节点/);
  // The resolver must have walked BOTH tiers before giving up.
  assert.deepEqual(calls.nodeResolution, ['tag', 'bridge'], 'production resolution order must be respected');
});

test('V12.1 fix: a question whose node lives only in the legacy bridge still projects', async () => {
  // This is the production shape that broke: QuestionKnowledgeNodeTag is empty
  // (332 questions, 0 rows) and every node association comes from
  // QuestionKnowledgePoint → KnowledgePointNodeMap. The old implementation
  // queried the tag table directly and declined all of them.
  const { service, calls, tx } = harness({
    tagRows: [],
    linkRows: [{
      knowledgePoint: {
        nodeMaps: [{ knowledgeNodeId: 'node-bridge', confidence: 0.9, taggedBy: 'HYBRID' }],
      },
    }],
  });
  const result = await service.applyFromReviewObservation('u1', input(), tx);

  assert.deepEqual(calls.nodeResolution, ['tag', 'bridge'], 'the bridge tier must be consulted');
  assert.equal(result.applied, true, `expected the bridge-resolved question to project, got ${result.reason}`);
  assert.equal(result.observation.nodeId, 'node-bridge');
  assert.equal(calls.mastery.length, 1, 'mastery must be applied exactly once');
  assert.equal(calls.markerWrites.length, 1, 'the exactly-once claim must be recorded');
});

test('V12.1 fix: a directly tagged question still projects exactly once', async () => {
  // The bridge fallback must not change behaviour for the normal shape.
  const { service, calls, tx } = harness({
    tagRows: [{ knowledgeNodeId: 'node-direct', role: 'PRIMARY' }],
    linkRows: [{
      knowledgePoint: {
        nodeMaps: [{ knowledgeNodeId: 'node-wrong', confidence: 0.1, taggedBy: 'HYBRID' }],
      },
    }],
  });
  const result = await service.applyFromReviewObservation('u1', input(), tx);

  assert.equal(result.applied, true);
  assert.equal(result.observation.nodeId, 'node-direct', 'a direct tag must win over the bridge fallback');
  assert.deepEqual(calls.nodeResolution, ['tag'], 'the bridge must not even be consulted when a tag exists');
  assert.equal(calls.mastery.length, 1);
});

test('V12.1 fix: PRIMARY wins over SECONDARY within the resolved set', async () => {
  const { service, tx } = harness({
    tagRows: [
      { knowledgeNodeId: 'node-secondary', role: 'SECONDARY' },
      { knowledgeNodeId: 'node-primary', role: 'PRIMARY' },
    ],
  });
  const result = await service.applyFromReviewObservation('u1', input(), tx);
  assert.equal(result.observation.nodeId, 'node-primary');
});

test('a mastery writer that declines does not leave a false claim behind', async () => {
  const { service, calls, tx } = harness({ masteryReturnsNull: true });
  const result = await service.applyFromReviewObservation('u1', input(), tx);

  assert.equal(result.applied, false);
  assert.equal(result.reason, 'mastery_writer_unavailable');
  assert.equal(calls.markerWrites.length, 0, 'no claim may be recorded for a write that did not happen');
});

test('every decline path leaves the mastery engine untouched', async () => {
  const declines = [
    harness({ evidenceEnabled: false }),
    harness({ prismaEnabled: false }),
    harness({ durable: { record: { id: RECEIPT, occurrence: ATTEMPT }, persisted: false } }),
    harness({ existingMarker: { id: 'm' } }),
    harness({ tagRows: [], linkRows: [] }),
    harness({ masteryReturnsNull: true }),
  ];
  for (const { service, calls, tx } of declines) {
    const result = await service.applyFromReviewObservation('u1', input(), tx);
    assert.equal(result.applied, false);
    // No decline may ever leave an exactly-once claim behind: a claim is a
    // durable statement that mastery was written.
    assert.equal(calls.markerWrites.length, 0, `declined path ${result.reason} must not record a claim`);
    // Every decline except the one where the mastery writer itself declined
    // must not even reach it.
    if (result.reason !== 'mastery_writer_unavailable') {
      assert.equal(calls.mastery.length, 0, `declined path ${result.reason} must not call the mastery writer`);
    } else {
      assert.equal(calls.mastery.length, 1, 'the writer was called once and declined; that is the decline');
    }
  }
});

test('the projection reuses the published V12-M1 taxonomy rather than restating it', async () => {
  const { service, tx } = harness();
  const result = await service.applyFromReviewObservation('u1', input(), tx);
  assert.ok(result.observation, 'the applied path must expose the projected observation');
  assert.equal(result.observation.taxonomyCanInfluenceMastery, true);
  assert.equal(result.observation.eligibleForMastery, true);
  assert.equal(result.observation.evidenceKind, 'recall_outcome');
  assert.equal(result.observation.receiptMatch, 'occurrence', 'the receipt must match by occurrence identity');
  assert.equal(result.observation.sharedReceipt, false);
});
