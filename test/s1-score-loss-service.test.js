/**
 * S1-P1 — ScoreLossService (derivation wiring + read projection + access spine).
 *
 * Pins the service contract around the pure derivation (test/s1-score-loss.test.js):
 *   • derivation only runs against an existing ledger assessment row;
 *   • price precedence: Question.maxScore (content) → record.maxScore (paper) → null;
 *   • self-assessed grading derives PROXY rows, objective derives OBSERVED;
 *   • conservation violations store NOTHING and surface the rejection reason;
 *   • persistence is append-only and idempotent (skipDuplicates);
 *   • the read endpoint follows the /coach/score-evidence access spine;
 *   • INV-16: attribution goes through the canonical resolver only — this
 *     service never queries QuestionKnowledgeNodeTag itself;
 *   • INV-11: no mastery write primitive appears anywhere in the module.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://stub:stub@127.0.0.1:5432/stub';
require('ts-node/register');

const { ScoreLossService } = require('../apps/api/src/score-anchor/score-loss.service.ts');

const SERVICE_SOURCE = readFileSync(
  new URL('../apps/api/src/score-anchor/score-loss.service.ts', import.meta.url),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function harness(options = {}) {
  const state = { created: [], calls: { createMany: 0 }, lastCreateArgs: null };
  const prisma = {
    scoreAssessment: {
      findUnique: async () => options.assessment ?? null,
      findMany: async () => options.assessments ?? [],
    },
    question: { findMany: async () => options.questions ?? [] },
    scoreLossItem: {
      createMany: async (args) => {
        state.calls.createMany += 1;
        state.lastCreateArgs = args;
        state.created.push(...args.data);
        return { count: args.data.length };
      },
      findMany: async () => options.lossRows ?? [],
      count: async () => options.lossCount ?? 0,
    },
    teacherStudentAuthorization: { findFirst: async () => (options.authorized ? { id: 'auth-1' } : null) },
    // Canonical resolver inputs. Default: one bridge-shaped PRIMARY mapping for
    // every question asked (production's 332-question reality), overridable.
    questionKnowledgeNodeTag: { findMany: async () => options.tags ?? [] },
    questionKnowledgePoint: {
      findMany: async () => options.links ?? [],
    },
  };
  const service = new ScoreLossService(options.enabled === false ? undefined : prisma);
  return { service, state, prisma };
}

const LEDGER_ROW = {
  id: 'assess-1',
  semantic: 'accuracy_rate',
  rawScore: 60,
  rawTotalScale: 100,
};

const record = (overrides = {}) => ({
  questionId: 'q-1',
  correct: false,
  gradingMode: 'objective',
  selfScore: null,
  maxScore: 2,
  ...overrides,
});

const derive = async (options = {}) => {
  const h = harness({
    assessment: LEDGER_ROW,
    questions: options.questions ?? [{ id: 'q-1', maxScore: 2 }],
    links: options.links ?? [{
      knowledgePoint: { nodeMaps: [{ knowledgeNodeId: 'node-1', confidence: 1, taggedBy: null }] },
    }],
    ...options,
  });
  const result = await h.service.deriveFromPaperSession('u1', 'sess-1', options.records ?? [record()]);
  return { ...h, result };
};

// ------------------------------------------------------------------ the gates

test('the service is honestly absent without a store', async () => {
  const { service } = harness({ enabled: false });
  assert.equal(await service.deriveFromPaperSession('u1', 's1', []), null);
  assert.equal(await service.getScoreLoss({ userId: 'u1', role: 'student' }, 'u1'), null);
});

test('no ledger row means nothing to derive against', async () => {
  const { result, state } = await derive({ assessment: null });
  assert.equal(result, null);
  assert.equal(state.calls.createMany, 0);
});

test('no attempt records means nothing to derive from', async () => {
  const { result, state } = await derive({ records: [] });
  assert.equal(result, null);
  assert.equal(state.calls.createMany, 0);
});

// -------------------------------------------------------------- the derivation

test('objective loss derives an OBSERVED row priced by Question.maxScore', async () => {
  const { result, state } = await derive({
    questions: [{ id: 'q-1', maxScore: 4 }],
  });
  assert.equal(result.stored, true);
  assert.equal(state.created.length, 1);
  const row = state.created[0];
  assert.equal(row.scoreEntryKind, 'assessment');
  assert.equal(row.scoreEntryId, 'assess-1');
  assert.equal(row.lostScore, 4, 'content price (①) wins over the record max (②)');
  assert.equal(row.maxScore, 4);
  assert.equal(row.lossKind, 'OBSERVED');
  assert.equal(row.gradingMethod, 'exact_match');
  assert.equal(row.nodeId, 'node-1', 'attribution came from the canonical resolver fallback chain');
});

test('self-assessed partial credit derives a PROXY row with the content price', async () => {
  const { result, state } = await derive({
    records: [record({ questionId: 'q-subj', gradingMode: 'self_assessed', correct: true, selfScore: 7, maxScore: 10 })],
    questions: [{ id: 'q-subj', maxScore: 8 }],
    links: [{
      knowledgePoint: { nodeMaps: [{ knowledgeNodeId: 'node-subj', confidence: 1, taggedBy: null }] },
    }],
  });
  assert.equal(result.stored, true);
  assert.equal(state.created.length, 1);
  const row = state.created[0];
  assert.equal(row.lossKind, 'PROXY');
  assert.equal(row.gradingMethod, 'self_report');
  assert.equal(row.earnedScore, 5.6, 'ratio 7/10 × content price 8');
  assert.equal(row.lostScore, 2.4);
  assert.equal(result.observedLoss, null);
  assert.equal(result.proxyLoss, 2.4);
});

test('price precedence: no content price falls back to the record max; neither → unpriced nulls', async () => {
  const second = await derive({
    records: [record({ questionId: 'q-1', maxScore: 3 }), record({ questionId: 'q-2', maxScore: null })],
    questions: [{ id: 'q-1', maxScore: null }, { id: 'q-2', maxScore: null }],
    links: [],
  });
  assert.equal(second.state.created.length, 2);
  assert.equal(second.state.created[0].maxScore, 3, '② the paper structure price');
  const unpriced = second.state.created[1];
  assert.equal(unpriced.maxScore, null);
  assert.equal(unpriced.lostScore, null, 'unpriced: counted, never zeroed or imputed');
  assert.equal(second.result.unpricedLostQuestions, 1);
  assert.equal(second.result.pricedLostQuestions, 1);
});

test('a conservation violation stores nothing and returns the reason (拒绝出数)', async () => {
  // exam_total row: the row's own envelope is rawTotalScale − rawScore = 50,
  // while the priced questions lost 170 — a data defect the derivation must
  // refuse, never clip. (On accuracy_rate rows the envelope is the paper's
  // priced total, so per-question clamps make violation structurally impossible
  // there — the service test for that basis lives in the pure-module suite.)
  const { result, state } = await derive({
    assessment: { id: 'assess-1', semantic: 'exam_total', rawScore: 100, rawTotalScale: 150 },
    records: [record({ questionId: 'q-1', maxScore: 90 }), record({ questionId: 'q-2', maxScore: 80 })],
    questions: [{ id: 'q-1', maxScore: 90 }, { id: 'q-2', maxScore: 80 }],
    links: [],
  });
  assert.equal(result.stored, false, '170 lost points cannot come from a 50-point row envelope');
  assert.match(result.rejectionReason, /守恒|conservation/);
  assert.equal(state.calls.createMany, 0);
});

test('re-deriving the same session is idempotent (skipDuplicates on the unique key)', async () => {
  const { service, state } = await derive({});
  await service.deriveFromPaperSession('u1', 'sess-1', [record()]);
  assert.equal(state.calls.createMany, 2, 'both derivations attempted the write');
  assert.equal(state.lastCreateArgs.skipDuplicates, true, 'the unique key absorbs the second write');
  assert.ok(
    state.lastCreateArgs.data.every((row) => row.scoreEntryKind === 'assessment' && row.scoreEntryId === 'assess-1'),
  );
});

// --------------------------------------------------------------- the read side

test('the read projection groups rows per entry with the classes separate', async () => {
  const { service } = harness({
    lossRows: [
      { questionId: 'q1', nodeId: 'n1', maxScore: 2, earnedScore: 0, lostScore: 2, lossKind: 'OBSERVED', gradingMethod: 'exact_match', scoreEntryKind: 'assessment', scoreEntryId: 'a-1' },
      { questionId: 'q2', nodeId: 'n1', maxScore: 10, earnedScore: 5, lostScore: 5, lossKind: 'PROXY', gradingMethod: 'self_report', scoreEntryKind: 'assessment', scoreEntryId: 'a-1' },
    ],
    assessments: [{ id: 'a-1', semantic: 'accuracy_rate', rawScore: 60, rawTotalScale: 100, title: '模考', recordedAt: new Date('2026-09-13T00:00:00Z') }],
  });
  const result = await service.getScoreLoss({ userId: 'u1', role: 'student' }, 'u1');
  assert.equal(result.storeAvailable, true);
  assert.equal(result.kind, 'DERIVED');
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].observedLoss, 2);
  assert.equal(result.entries[0].proxyLoss, 5);
  assert.equal(result.totals.observedLoss, 2);
  assert.equal(result.totals.proxyLoss, 5, 'never blended into one number');
});

// ------------------------------------------------------------- the access spine

test('access spine: a student cannot read another student’s loss', async () => {
  const { service } = harness({ lossRows: [] });
  await assert.rejects(
    () => service.getScoreLoss({ userId: 'u1', role: 'student' }, 'u2'),
    /own score loss/,
  );
});

test('access spine: a teacher without an authorization record is rejected', async () => {
  const { service } = harness({ lossRows: [], authorized: false });
  await assert.rejects(
    () => service.getScoreLoss({ userId: 't1', role: 'teacher' }, 'u2'),
    /not authorized/,
  );
});

test('access spine: an authorized teacher may read the student’s loss', async () => {
  const { service } = harness({ lossRows: [], authorized: true });
  const result = await service.getScoreLoss({ userId: 't1', role: 'teacher' }, 'u2');
  assert.equal(result.storeAvailable, true);
  assert.equal(result.userId, 'u2');
});

// ------------------------------------------------------- the boundary (source)

test('INV-16: the service attributes only through the canonical resolver', () => {
  assert.match(SERVICE_SOURCE, /resolvePrimaryNodeByQuestion/, 'the canonical resolver must be the attribution entry');
  assert.doesNotMatch(
    SERVICE_SOURCE,
    /questionKnowledgeNodeTag/,
    'the service must not touch the tag table itself (V12.1 lesson: the direct tier is blind on production)',
  );
});

test('INV-11 / append-only: no mastery write, no loss-row update or delete', () => {
  assert.doesNotMatch(SERVICE_SOURCE, /userKnowledgeMastery|applyAttempts|applyReview|saveMastery/, 'no mastery write primitive');
  assert.doesNotMatch(SERVICE_SOURCE, /scoreLossItem\.(update|delete|upsert)/, 'loss rows are append-only');
  assert.match(SERVICE_SOURCE, /skipDuplicates: true/, 'idempotent re-derivation is part of the contract');
});
