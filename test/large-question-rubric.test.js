/**
 * V12-M6 / F4 — large-question rubric and offline shadow evaluation.
 *
 * Mission constraint: Question.rubric is an approval gate, so NO schema change
 * happens here. What is built instead is the pure module, the offline rubric
 * shape, a deterministic shadow evaluator, and tests.
 *
 * The honesty rules under test are those the mission states directly:
 *   • AI may only assist evaluation, never be the absolute source of truth
 *   • evaluation must be explainable, evidence-based, versioned and auditable
 *   • without a rubric there is no score at all - not a zero
 *   • an offline keyword match is NOT a semantic judgement and must say so
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RUBRIC_SCHEMA_VERSION,
  RUBRIC_EVALUATION_BASIS,
  validateRubric,
  scoreLargeQuestion,
} from '../packages/shared/dist/index.js';

const rubric = {
  schemaVersion: RUBRIC_SCHEMA_VERSION,
  totalPoints: 10,
  points: [
    {
      id: 'p1',
      label: '写出页表项结构',
      points: 4,
      matchAny: ['页表项', 'PTE'],
      knowledgeNodeIds: ['node-pte'],
    },
    {
      id: 'p2',
      label: '说明两级页表的作用',
      points: 4,
      matchAny: ['两级', '二级页表'],
      knowledgeNodeIds: ['node-two-level'],
    },
    {
      id: 'p3',
      label: '结论正确',
      points: 2,
      matchAny: ['因此', '所以'],
      required: true,
      knowledgeNodeIds: ['node-conclusion'],
    },
  ],
};

test('the rubric schema is versioned so stored content stays auditable', () => {
  assert.ok(RUBRIC_SCHEMA_VERSION.length > 0);
  const result = validateRubric(rubric);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validation rejects a rubric whose points do not sum to its total', () => {
  const result = validateRubric({ ...rubric, totalPoints: 12 });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /总分|totalPoints/);
});

test('validation rejects unidentifiable points rather than scoring them', () => {
  const broken = { ...rubric, points: [{ label: 'x', points: 10, matchAny: ['x'] }] };
  const result = validateRubric(broken);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /id/);
});

test('without a rubric there is no score at all, and the reason is stated', () => {
  const result = scoreLargeQuestion({ rubric: null, answerText: '任何内容' });

  assert.equal(result.score, null, 'a missing rubric is not a zero score');
  assert.equal(result.verdict, 'no_rubric');
  assert.equal(result.authoritative, false);
  assert.match(result.basis, /缺少评分标准|rubric/);
});

test('an invalid rubric is refused instead of being scored approximately', () => {
  const result = scoreLargeQuestion({ rubric: { ...rubric, totalPoints: 99 }, answerText: '页表项' });
  assert.equal(result.score, null);
  assert.equal(result.verdict, 'invalid_rubric');
});

test('a full answer earns every point and each point is explained', () => {
  const result = scoreLargeQuestion({
    rubric,
    answerText: '页表项记录了物理帧号；采用两级页表可以节省空间；因此该方案可行。',
  });

  assert.equal(result.score, 10);
  assert.equal(result.verdict, 'perfect');
  assert.equal(result.points.length, 3);
  for (const point of result.points) {
    assert.equal(point.awarded, point.points);
    assert.ok(point.basis.length > 0, 'each awarded point says why');
  }
  assert.equal(result.criticalMiss, false);
});

test('a partial answer earns only the matched points and names what is missing', () => {
  const result = scoreLargeQuestion({ rubric, answerText: '这里说明页表项的结构。' });

  assert.equal(result.score, 4);
  assert.equal(result.verdict, 'partial');
  const missing = result.points.filter((point) => !point.matched).map((point) => point.id);
  assert.deepEqual(missing, ['p2', 'p3']);
  assert.ok(result.missingLabels.includes('说明两级页表的作用'));
});

test('a missed required point is flagged as a critical miss', () => {
  const result = scoreLargeQuestion({ rubric, answerText: '页表项与两级页表都写了，但没有收尾。' });
  assert.equal(result.score, 8);
  assert.equal(result.criticalMiss, true);
  assert.match(result.basis, /必答|关键/);
});

test('the evaluation states that keyword matching is not a semantic judgement', () => {
  const result = scoreLargeQuestion({ rubric, answerText: '页表项' });

  assert.equal(result.evaluationBasis, RUBRIC_EVALUATION_BASIS);
  assert.match(result.limitations, /关键词|语义/);
  assert.match(result.limitations, /人工|复核/);
  assert.equal(result.authoritative, false, 'a shadow evaluation never claims authority');
});

test('implicated knowledge nodes are reported so the result can feed ability evidence', () => {
  const result = scoreLargeQuestion({ rubric, answerText: '页表项' });

  assert.deepEqual(result.hitNodeIds, ['node-pte']);
  assert.ok(result.missedNodeIds.includes('node-two-level'));
  assert.ok(result.missedNodeIds.includes('node-conclusion'));
});

test('matching normalises case and whitespace so formatting does not change the score', () => {
  const spaced = scoreLargeQuestion({ rubric, answerText: '  页表项   记录物理帧号  ' });
  const tight = scoreLargeQuestion({ rubric, answerText: '页表项记录物理帧号' });
  assert.equal(spaced.score, tight.score);
});

test('an empty answer scores zero but is distinguished from a missing rubric', () => {
  const result = scoreLargeQuestion({ rubric, answerText: '   ' });

  assert.equal(result.score, 0);
  assert.equal(result.verdict, 'zero');
  assert.equal(result.criticalMiss, true);
});

test('the same input always yields the same score (no model, no randomness)', () => {
  const a = scoreLargeQuestion({ rubric, answerText: '页表项' });
  const b = scoreLargeQuestion({ rubric, answerText: '页表项' });
  assert.equal(a.score, b.score);
  assert.deepEqual(a.points.map((point) => point.awarded), b.points.map((point) => point.awarded));
});

test('the module contains no LLM or network dependency', async () => {
  const source = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../packages/shared/src/score-center/large-question-rubric.ts', import.meta.url), 'utf8'),
  );
  for (const forbidden of ['fetch(', 'openai', 'deepseek', 'axios', 'http']) {
    assert.ok(!source.includes(forbidden), `offline scoring must not contain ${forbidden}`);
  }
});
