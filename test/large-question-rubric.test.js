/**
 * F4 V1 — large-question rubric and offline shadow evaluation.
 *
 * Scope is deliberately small (an owner decision): one versioned criteria list,
 * no rubric DSL. The tests below pin the requirements that were stated with it:
 * versionable, auditable, explainable, usable by a human scorer, usable by an
 * AI assistant, AI never the sole source of truth, and — the one that needs real
 * design — a rubric edit must not pollute historical scores.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RUBRIC_SCHEMA_VERSION,
  RUBRIC_EVALUATION_BASIS,
  validateRubric,
  scoreLargeQuestion,
  hashRubric,
} from '../packages/shared/dist/index.js';

const rubric = {
  version: 1,
  totalPoints: 10,
  criteria: [
    {
      id: 'c1',
      description: '写出页表项结构',
      points: 4,
      evidenceHint: '答案中出现"页表项"或缩写 PTE',
      matchAny: ['页表项', 'PTE'],
      knowledgeNodeIds: ['node-pte'],
    },
    {
      id: 'c2',
      description: '说明两级页表的作用',
      points: 4,
      evidenceHint: '答案中出现"两级/二级页表"并说明节省空间',
      matchAny: ['两级', '二级页表'],
      knowledgeNodeIds: ['node-two-level'],
    },
    {
      id: 'c3',
      description: '结论正确',
      points: 2,
      required: true,
      evidenceHint: '答案有明确结论性表述（因此/所以）',
      matchAny: ['因此', '所以'],
      knowledgeNodeIds: ['node-conclusion'],
    },
  ],
};

// ---------------------------------------------------------------------------
// Versionable
// ---------------------------------------------------------------------------

test('the rubric shape carries an explicit version', () => {
  assert.ok(RUBRIC_SCHEMA_VERSION.length > 0);
  assert.equal(rubric.version, 1);
  assert.equal(validateRubric(rubric).valid, true);
});

test('a rubric without a usable version is refused', () => {
  const result = validateRubric({ ...rubric, version: 0 });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /version/);
});

test('validation rejects a rubric whose criteria do not sum to totalPoints', () => {
  const result = validateRubric({ ...rubric, totalPoints: 12 });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /合计|totalPoints/);
});

test('validation rejects unidentifiable or unexplained criteria', () => {
  const noId = validateRubric({ ...rubric, criteria: [{ description: 'x', points: 10, evidenceHint: 'y', matchAny: ['x'] }] });
  assert.equal(noId.valid, false);
  assert.match(noId.errors.join(' '), /id/);

  const noHint = validateRubric({
    ...rubric,
    criteria: [{ id: 'c1', description: 'x', points: 10, evidenceHint: '', matchAny: ['x'] }],
  });
  assert.equal(noHint.valid, false);
  assert.match(noHint.errors.join(' '), /evidenceHint/);

  const noDescription = validateRubric({
    ...rubric,
    criteria: [{ id: 'c1', description: '', points: 10, evidenceHint: 'y', matchAny: ['x'] }],
  });
  assert.equal(noDescription.valid, false);
  assert.match(noDescription.errors.join(' '), /description/);
});

// ---------------------------------------------------------------------------
// Rubric edits must not pollute historical scores
// ---------------------------------------------------------------------------

test('a score records the exact rubric version and content hash it was produced under', () => {
  const result = scoreLargeQuestion({ rubric, answerText: '页表项' });

  assert.equal(result.rubricVersion, 1);
  assert.ok(result.rubricHash, 'the hash must be recorded');
  assert.match(result.rubricHash, /^rv1-/);
  assert.match(result.basis, /评分标准 v1/);
});

test('editing a rubric changes its hash, so an old score cannot be silently re-explained', () => {
  const edited = {
    ...rubric,
    version: 2,
    criteria: rubric.criteria.map((criterion) =>
      criterion.id === 'c1' ? { ...criterion, evidenceHint: '改为要求写出物理帧号' } : criterion,
    ),
  };

  const before = hashRubric(rubric);
  const after = hashRubric(edited);
  assert.notEqual(before, after, 'a different revision must hash differently');
  assert.ok(after.startsWith('rv2-'), 'the version is part of the identity');

  const oldScore = scoreLargeQuestion({ rubric, answerText: '页表项' });
  const newScore = scoreLargeQuestion({ rubric: edited, answerText: '页表项' });
  assert.notEqual(oldScore.rubricHash, newScore.rubricHash);
  assert.equal(oldScore.rubricVersion, 1, 'a historical score keeps its own version');
  assert.equal(newScore.rubricVersion, 2);
});

test('the hash is stable regardless of property order or array noise', () => {
  const reordered = {
    criteria: rubric.criteria.map((criterion) => ({
      matchAny: criterion.matchAny,
      knowledgeNodeIds: criterion.knowledgeNodeIds,
      required: criterion.required,
      points: criterion.points,
      description: criterion.description,
      evidenceHint: criterion.evidenceHint,
      id: criterion.id,
    })),
    totalPoints: rubric.totalPoints,
    version: rubric.version,
  };
  assert.equal(hashRubric(reordered), hashRubric(rubric));
  assert.equal(hashRubric(rubric), hashRubric({ ...rubric }), 'deterministic across calls');
});

// ---------------------------------------------------------------------------
// Fallbacks: two kinds of "no score" stay distinct
// ---------------------------------------------------------------------------

test('without a rubric there is no score at all, and the reason is stated', () => {
  const result = scoreLargeQuestion({ rubric: null, answerText: '任何内容' });
  assert.equal(result.score, null, 'a missing rubric is not a zero score');
  assert.equal(result.verdict, 'no_rubric');
  assert.equal(result.rubricVersion, null);
  assert.equal(result.rubricHash, null);
  assert.match(result.basis, /缺少评分标准/);
});

test('an invalid rubric is refused instead of being scored approximately', () => {
  const result = scoreLargeQuestion({ rubric: { ...rubric, totalPoints: 99 }, answerText: '页表项' });
  assert.equal(result.score, null);
  assert.equal(result.verdict, 'invalid_rubric');
});

test('an empty answer with a valid rubric scores zero, which is a real zero', () => {
  const result = scoreLargeQuestion({ rubric, answerText: '   ' });
  assert.equal(result.score, 0);
  assert.equal(result.verdict, 'zero');
  assert.equal(result.criticalMiss, true);
});

// ---------------------------------------------------------------------------
// Explainable + usable by a human scorer
// ---------------------------------------------------------------------------

test('every criterion explains its award and keeps the hint a human scorer needs', () => {
  const result = scoreLargeQuestion({
    rubric,
    answerText: '页表项记录了物理帧号；采用两级页表可以节省空间；因此该方案可行。',
  });

  assert.equal(result.score, 10);
  assert.equal(result.verdict, 'perfect');
  assert.equal(result.criteria.length, 3);
  for (const row of result.criteria) {
    assert.ok(row.basis.length > 0, 'each award says why');
    assert.ok(row.evidenceHint.length > 0, 'each criterion keeps its human evidence hint');
    assert.ok(row.description.length > 0, 'each criterion is student-readable');
    assert.equal(row.awarded, row.points);
  }
});

test('a partial answer names exactly which criteria are missing', () => {
  const result = scoreLargeQuestion({ rubric, answerText: '这里说明页表项的结构。' });

  assert.equal(result.score, 4);
  assert.equal(result.verdict, 'partial');
  assert.deepEqual(result.missingDescriptions, ['说明两级页表的作用', '结论正确']);
  assert.ok(result.criteria.filter((row) => !row.matched).every((row) => row.matchedTerm === null));
});

test('a missed required criterion is flagged as a critical miss', () => {
  const result = scoreLargeQuestion({ rubric, answerText: '页表项与两级页表都写了，但没有收尾。' });
  assert.equal(result.score, 8);
  assert.equal(result.criticalMiss, true);
  assert.match(result.basis, /必答|关键/);
});

test('criteria map to knowledge nodes so the result can feed ability evidence', () => {
  const result = scoreLargeQuestion({ rubric, answerText: '页表项' });
  assert.deepEqual(result.hitNodeIds, ['node-pte']);
  assert.ok(result.missedNodeIds.includes('node-two-level'));
  assert.ok(result.missedNodeIds.includes('node-conclusion'));
});

// ---------------------------------------------------------------------------
// AI boundary
// ---------------------------------------------------------------------------

test('the evaluation stays a stated offline baseline, never an authority', () => {
  const result = scoreLargeQuestion({ rubric, answerText: '页表项' });
  assert.equal(result.evaluationBasis, RUBRIC_EVALUATION_BASIS);
  assert.equal(result.authoritative, false, 'a shadow evaluation never claims authority');
  assert.match(result.limitations, /关键词|语义/);
  assert.match(result.limitations, /人工|复核/);
});

test('the module contains no model or network call', () => {
  const source = readFileSync(
    new URL('../packages/shared/src/score-center/large-question-rubric.ts', import.meta.url),
    'utf8',
  );
  for (const forbidden of ['fetch(', 'openai', 'deepseek', 'axios', 'http://', 'https://']) {
    assert.ok(!source.includes(forbidden), `offline scoring must not contain ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('matching normalises case and whitespace so formatting never changes the score', () => {
  const spaced = scoreLargeQuestion({ rubric, answerText: '  页表项   记录物理帧号  ' });
  const tight = scoreLargeQuestion({ rubric, answerText: '页表项记录物理帧号' });
  assert.equal(spaced.score, tight.score);
});

test('the same input always yields the same score and the same hash', () => {
  const a = scoreLargeQuestion({ rubric, answerText: '页表项' });
  const b = scoreLargeQuestion({ rubric, answerText: '页表项' });
  assert.equal(a.score, b.score);
  assert.equal(a.rubricHash, b.rubricHash);
  assert.deepEqual(a.criteria.map((row) => row.awarded), b.criteria.map((row) => row.awarded));
});
