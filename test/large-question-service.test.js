/**
 * F4 V1 — large-question rubric service.
 *
 * Pins the requirements stated with the V1 scope: the rubric is served exactly
 * as authored, an absent or unreadable rubric never produces a score, and a
 * scored attempt records the rubric revision it was scored under so a later
 * edit cannot re-explain it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://stub:stub@127.0.0.1:5432/stub';
require('ts-node/register');

const { LargeQuestionService, decodeRubric } = require('../apps/api/src/study/large-question.service.ts');

const RUBRIC = {
  version: 1,
  totalPoints: 10,
  criteria: [
    { id: 'c1', description: '写出页表项结构', points: 6, evidenceHint: '出现页表项/PTE', matchAny: ['页表项', 'PTE'], knowledgeNodeIds: ['node-pte'] },
    { id: 'c2', description: '结论正确', points: 4, required: true, evidenceHint: '有结论性表述', matchAny: ['因此', '所以'], knowledgeNodeIds: ['node-c'] },
  ],
};

function harness(options = {}) {
  const prisma = {
    question: {
      findUnique: async () => options.question ?? { id: 'q1', rubric: RUBRIC },
    },
  };
  const evidenceCalls = [];
  const learningEvidence = {
    recordObservedPerformance: async (userId, input) => {
      evidenceCalls.push({ userId, input });
      return { id: `ev-${evidenceCalls.length}` };
    },
  };
  const service = new LargeQuestionService(
    options.enabled === false ? undefined : prisma,
    options.withEvidence === false ? undefined : learningEvidence,
  );
  return { service, evidenceCalls };
}

test('the rubric is served exactly as authored, with its content hash', async () => {
  const { service } = harness();
  const view = await service.getRubric('q1');

  assert.equal(view.hasRubric, true);
  assert.equal(view.rubric.version, 1);
  assert.equal(view.rubric.criteria.length, 2);
  assert.ok(view.rubricHash.startsWith('rv1-'));
  assert.equal(view.validation.valid, true);
});

test('a question with no rubric reports that plainly instead of defaulting', async () => {
  const { service } = harness({ question: { id: 'q1', rubric: null } });
  const view = await service.getRubric('q1');

  assert.equal(view.hasRubric, false);
  assert.equal(view.rubric, null);
  assert.equal(view.rubricHash, null);
  assert.equal(view.reason, 'no_rubric');
});

test('the rubric is absent, not guessed, when the store is unavailable', async () => {
  const { service } = harness({ enabled: false });
  const view = await service.getRubric('q1');
  assert.equal(view.hasRubric, false);
  assert.equal(view.reason, 'store_unavailable');
});

test('submitAttempt scores offline and records the rubric revision with the evidence', async () => {
  const { service, evidenceCalls } = harness();
  const result = await service.submitAttempt('u1', 'q1', '页表项记录了物理帧号，因此方案可行。');

  assert.equal(result.score.score, 10);
  assert.equal(result.score.verdict, 'perfect');
  assert.equal(result.evidenceRecorded, true);
  assert.ok(result.evidenceKey);

  assert.equal(evidenceCalls.length, 1);
  const detail = evidenceCalls[0].input.detail;
  assert.equal(detail.kind, 'rubric_scored_attempt');
  assert.equal(detail.rubricVersion, 1, 'the evidence carries the rubric revision');
  assert.match(detail.rubricHash, /^rv1-/);
  assert.deepEqual(detail.hitNodeIds, ['node-c', 'node-pte']);
  assert.equal(detail.criteria.length, 2, 'per-criterion awards are auditable later');
  assert.equal(evidenceCalls[0].input.observedCorrectCount, 1);
});

test('a critical miss is recorded as an unsuccessful observation', async () => {
  const { service, evidenceCalls } = harness();
  const result = await service.submitAttempt('u1', 'q1', '页表项结构如此，但没有收尾。');

  assert.equal(result.score.criticalMiss, true);
  assert.equal(evidenceCalls[0].input.observedCorrectCount, 0, 'a missed required point is not a success');
  assert.match(result.nextStep, /必答/);
});

test('submitAttempt records no evidence when there is no rubric to score against', async () => {
  const { service, evidenceCalls } = harness({ question: { id: 'q1', rubric: null } });
  const result = await service.submitAttempt('u1', 'q1', '任何答案');

  assert.equal(result.score.score, null);
  assert.equal(result.score.verdict, 'no_rubric');
  assert.equal(result.evidenceRecorded, false);
  assert.equal(result.evidenceKey, null);
  assert.equal(evidenceCalls.length, 0, 'a non-score is not an observation');
  assert.match(result.nextStep, /暂无评分标准/);
});

test('submitAttempt refuses an empty or oversized answer', async () => {
  const { service } = harness();
  await assert.rejects(() => service.submitAttempt('u1', 'q1', '   '), /must not be empty/);
  await assert.rejects(() => service.submitAttempt('u1', 'q1', 'x'.repeat(5001)), /at most/);
});

// ---------------------------------------------------------------------------
// Historical-score integrity
// ---------------------------------------------------------------------------

test('an edit to the rubric produces a new hash while the old score keeps its own revision', async () => {
  const { service: before, evidenceCalls: beforeCalls } = harness();
  const first = await before.submitAttempt('u1', 'q1', '页表项');
  const firstHash = beforeCalls[0].input.detail.rubricHash;

  const edited = {
    ...RUBRIC,
    version: 2,
    criteria: RUBRIC.criteria.map((criterion) =>
      criterion.id === 'c1' ? { ...criterion, evidenceHint: '改为要求物理帧号' } : criterion,
    ),
  };
  const { service: after, evidenceCalls: afterCalls } = harness({ question: { id: 'q1', rubric: edited } });
  const second = await after.submitAttempt('u1', 'q1', '页表项');
  const secondHash = afterCalls[0].input.detail.rubricHash;

  assert.notEqual(firstHash, secondHash, 'a revision must be distinguishable');
  assert.equal(beforeCalls[0].input.detail.rubricVersion, 1);
  assert.equal(afterCalls[0].input.detail.rubricVersion, 2);
  assert.equal(first.score.rubricVersion, 1, 'the earlier result still names its own revision');
  assert.equal(second.score.rubricVersion, 2);
});

test('an unreadable rubric shape is treated as absent rather than half-interpreted', () => {
  assert.equal(decodeRubric(null), null);
  assert.equal(decodeRubric([]), null);
  assert.equal(decodeRubric({ criteria: [] }), null, 'missing version is not a usable rubric');
  assert.equal(decodeRubric({ version: 1 }), null, 'missing criteria is not a usable rubric');
  assert.ok(decodeRubric({ version: 1, criteria: [], totalPoints: 0 }), 'shape present, validation decides');
});

test('the service writes no learning table and calls no model', () => {
  const source = require('node:fs').readFileSync(
    fileURLToPath(new URL('../apps/api/src/study/large-question.service.ts', import.meta.url)),
    'utf8',
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const forbidden of ['.create(', '.update(', '.upsert(', '.delete(', 'saveMastery', 'fetch(']) {
    assert.ok(!code.includes(forbidden), `the rubric service must not contain ${forbidden}`);
  }
});
