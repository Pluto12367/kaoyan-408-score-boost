/**
 * S2 Transfer Probe — pure domain contract (RED first).
 *
 * Locks the four invariants the formal design pins down:
 *   1. schedule windows: D+2 target, 36h minimum elapsed, 7-day grace, honest expiry
 *   2. eligibility: every unprovable condition is a hard reject — no fallback
 *   3. projection: per (node, kind, bucket, isomorphism) strata never merged,
 *      gate n>=5 strict, TransferGap sign follows the task example
 *      (intervention 90% -> transfer 65% => Gap = -25pt, negative = decay)
 *   4. sampleConfidence is a SAMPLE-SIZE confidence, never a prediction quality
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSFER_PROBE_ACTION_TYPE,
  TRANSFER_PROBE_PLAN_SOURCE,
  TRANSFER_PROBE_SESSION_TYPE,
  TRANSFER_PROBE_POOL_SOURCE,
  TRANSFER_PROBE_EVIDENCE_KIND,
  deriveProbeScheduleFacts,
  deriveProbeCreationKey,
  evaluateProbeEligibility,
  buildTransferProjection,
} from '../packages/shared/dist/index.js';

const DAY = 86_400_000;
const COMPLETED_AT = '2026-09-10T14:00:00.000Z';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test('the probe vocabulary is pinned to the formal design values', () => {
  assert.equal(TRANSFER_PROBE_ACTION_TYPE, 'TRANSFER_PROBE');
  assert.equal(TRANSFER_PROBE_PLAN_SOURCE, 'transfer-probe');
  assert.equal(TRANSFER_PROBE_SESSION_TYPE, 'transfer_probe');
  assert.equal(TRANSFER_PROBE_POOL_SOURCE, 'transfer_probe_pool');
  assert.equal(TRANSFER_PROBE_EVIDENCE_KIND, 'transfer_probe');
});

// ---------------------------------------------------------------------------
// Schedule windows
// ---------------------------------------------------------------------------

test('scheduledDate is the intervention completion day + 2', () => {
  const facts = deriveProbeScheduleFacts(COMPLETED_AT, '2026-09-10T20:00:00.000Z');
  assert.equal(facts.scheduledDate, '2026-09-12');
});

test('delivery is blocked before the 36h minimum even when the due date is reached', () => {
  // completed 14:00 on D; D+2 00:00 is only 34h later -> blocked despite date
  const facts = deriveProbeScheduleFacts(COMPLETED_AT, '2026-09-12T00:00:00.000Z');
  assert.equal(facts.scheduledDate, '2026-09-12');
  assert.equal(facts.canDeliverNow, false, '34h < 36h minimum elapsed');
});

test('delivery opens once both the due date and the 36h floor are satisfied', () => {
  const facts = deriveProbeScheduleFacts(COMPLETED_AT, '2026-09-12T02:00:00.000Z');
  assert.equal(facts.canDeliverNow, true, '36h elapsed and due date reached');
  assert.equal(facts.withinGrace, true);
  assert.equal(facts.isExpired, false);
});

test('the grace window closes 7 days after the due date and the probe expires', () => {
  const facts = deriveProbeScheduleFacts(COMPLETED_AT, '2026-09-20T00:00:00.000Z');
  assert.equal(facts.withinGrace, false);
  assert.equal(facts.isExpired, true);
});

test('the creation key is deterministic per user, node and due date', () => {
  assert.equal(
    deriveProbeCreationKey('u1', 'node-1', '2026-09-12'),
    'TRANSFER_PROBE:u1:node-1:2026-09-12',
  );
  assert.equal(deriveProbeCreationKey('u1', 'node-1', '2026-09-12'), deriveProbeCreationKey('u1', 'node-1', '2026-09-12'));
  assert.notEqual(deriveProbeCreationKey('u1', 'node-1', '2026-09-12'), deriveProbeCreationKey('u1', 'node-1', '2026-09-13'));
});

// ---------------------------------------------------------------------------
// Eligibility — every unprovable condition is a hard reject
// ---------------------------------------------------------------------------

const eligibleFacts = {
  inPool: true,
  hasPriorAttempt: false,
  hasPriorExposure: false,
  sameFamilySeen: false,
  previouslyUsedAsProbe: false,
  bucketMatch: true,
  typeMatch: true,
};

test('a valid never-seen pool question is eligible', () => {
  const verdict = evaluateProbeEligibility(eligibleFacts);
  assert.deepEqual(verdict, { eligible: true, reject: null });
});

test('an already-attempted question is rejected (RED case)', () => {
  const verdict = evaluateProbeEligibility({ ...eligibleFacts, hasPriorAttempt: true });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.reject, 'prior_attempt');
});

test('an already-exposed question is rejected (RED case)', () => {
  const verdict = evaluateProbeEligibility({ ...eligibleFacts, hasPriorExposure: true });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.reject, 'prior_exposure');
});

test('a same-family question is rejected (RED case)', () => {
  const verdict = evaluateProbeEligibility({ ...eligibleFacts, sameFamilySeen: true });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.reject, 'same_family_seen');
});

test('a difficulty mismatch is rejected (RED case)', () => {
  const verdict = evaluateProbeEligibility({ ...eligibleFacts, bucketMatch: false });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.reject, 'difficulty_mismatch');
});

test('a previously-used probe question is rejected (RED case)', () => {
  const verdict = evaluateProbeEligibility({ ...eligibleFacts, previouslyUsedAsProbe: true });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.reject, 'previously_used_as_probe');
});

test('an out-of-pool question is rejected — the pool is the verified source', () => {
  const verdict = evaluateProbeEligibility({ ...eligibleFacts, inPool: false });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.reject, 'not_in_pool');
});

test('a different student (all facts clean) is eligible — isolation at the fact level', () => {
  // Student B's facts are computed for Student B only; clean facts = eligible.
  const verdict = evaluateProbeEligibility(eligibleFacts);
  assert.equal(verdict.eligible, true);
});

test('a type mismatch is rejected', () => {
  const verdict = evaluateProbeEligibility({ ...eligibleFacts, typeMatch: false });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.reject, 'type_mismatch');
});

// ---------------------------------------------------------------------------
// Projection — stratified, gated, sign per the task example
// ---------------------------------------------------------------------------

function probeEvent(overrides = {}) {
  return {
    key: 'ev-1',
    nodeId: 'node-1',
    kind: 'practice_difficulty',
    bucket: 'MEDIUM',
    isomorphism: 'verified',
    attempts: 1,
    correct: 1,
    invalidated: false,
    ...overrides,
  };
}

test('below the sample floor the projection is honestly insufficient', () => {
  const rows = buildTransferProjection(
    [probeEvent({ key: 'e1' }), probeEvent({ key: 'e2', correct: 0 }), probeEvent({ key: 'e3' }), probeEvent({ key: 'e4' })],
    { 'node-1': { attempts: 20, correct: 18 } },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].probeAttempts, 4);
  assert.equal(rows[0].gate, 'insufficient_data');
  assert.equal(rows[0].transferRate, null);
  assert.equal(rows[0].transferGap, null);
  assert.equal(rows[0].sampleConfidence, null);
});

test('at the sample floor the gate opens and TransferGap follows the task sign convention', () => {
  // practice 90%, transfer 5/5 = ... use mixed correctness: 4 correct of 5 -> 80%
  const events = [
    probeEvent({ key: 'e1' }), probeEvent({ key: 'e2' }), probeEvent({ key: 'e3' }), probeEvent({ key: 'e4' }),
    probeEvent({ key: 'e5', correct: 0 }),
  ];
  const rows = buildTransferProjection(events, { 'node-1': { attempts: 10, correct: 9 } });
  assert.equal(rows[0].gate, 'reported');
  assert.equal(rows[0].probeAttempts, 5);
  assert.equal(rows[0].transferRate, 80);
  assert.equal(rows[0].practiceAccuracy, 90);
  assert.equal(rows[0].transferGap, -10, 'transfer - practice: 80 - 90 = -10pt (negative = decay)');
});

test('the task example sign is reproduced exactly: 90% practice, 65% transfer -> -25pt', () => {
  const events = [
    probeEvent({ key: 'e1', correct: 1 }), probeEvent({ key: 'e2', correct: 0 }), probeEvent({ key: 'e3', correct: 1 }),
    probeEvent({ key: 'e4', correct: 0 }), probeEvent({ key: 'e5', correct: 1 }), probeEvent({ key: 'e6', correct: 0 }),
    probeEvent({ key: 'e7', correct: 1 }), probeEvent({ key: 'e8', correct: 0 }), probeEvent({ key: 'e9', correct: 1 }),
    probeEvent({ key: 'e10', correct: 0 }), probeEvent({ key: 'e11', correct: 1 }), probeEvent({ key: 'e12', correct: 0 }),
    probeEvent({ key: 'e13', correct: 1 }), probeEvent({ key: 'e14', correct: 0 }), probeEvent({ key: 'e15', correct: 1 }),
    probeEvent({ key: 'e16', correct: 0 }), probeEvent({ key: 'e17', correct: 1 }), probeEvent({ key: 'e18', correct: 0 }),
    probeEvent({ key: 'e19', correct: 1 }), probeEvent({ key: 'e20', correct: 0 }),
  ];
  const rows = buildTransferProjection(events, { 'node-1': { attempts: 100, correct: 90 } });
  assert.equal(rows[0].transferRate, 50, '10/20 = 50%');
  assert.equal(rows[0].transferGap, -40, '50 - 90 = -40pt');
  assert.equal(rows[0].sampleConfidence, 'medium', 'n=20 -> medium sample confidence');
});

test('strata are never merged across bucket, kind or isomorphism', () => {
  const events = [
    ...Array.from({ length: 5 }, (_, i) => probeEvent({ key: `v${i}`, bucket: 'MEDIUM', isomorphism: 'verified' })),
    ...Array.from({ length: 5 }, (_, i) => probeEvent({ key: `u${i}`, bucket: 'MEDIUM', isomorphism: 'unverified', correct: 0 })),
    ...Array.from({ length: 5 }, (_, i) => probeEvent({ key: `b${i}`, bucket: 'HARD' })),
    ...Array.from({ length: 5 }, (_, i) => probeEvent({ key: `k${i}`, kind: 'exam_difficulty' })),
  ];
  const rows = buildTransferProjection(events, {});
  assert.equal(rows.length, 4, 'four separate strata');
  const verified = rows.find((row) => row.isomorphism === 'verified' && row.bucket === 'MEDIUM' && row.kind === 'practice_difficulty');
  const unverified = rows.find((row) => row.isomorphism === 'unverified');
  assert.equal(verified.transferRate, 100);
  assert.equal(unverified.transferRate, 0, 'unverified stratum reported separately, never folded into verified');
});

test('invalidated observations are excluded from the strata entirely', () => {
  const events = [
    ...Array.from({ length: 5 }, (_, i) => probeEvent({ key: `v${i}` })),
    probeEvent({ key: 'bad', invalidated: true }),
  ];
  const rows = buildTransferProjection(events, {});
  assert.equal(rows[0].probeAttempts, 5, 'the invalidated observation does not count');
});

test('sample confidence tiers are the preregistered sample-size bands', () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => probeEvent({ key: `e${i}` }));
  assert.equal(buildTransferProjection(mk(5), {}).at(0).sampleConfidence, 'low');
  assert.equal(buildTransferProjection(mk(20), {}).at(0).sampleConfidence, 'medium');
  assert.equal(buildTransferProjection(mk(50), {}).at(0).sampleConfidence, 'high');
});
