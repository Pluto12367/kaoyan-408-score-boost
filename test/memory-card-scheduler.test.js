// V14-② — Memory-card scheduling contract tests (task book:
// docs/v14-memory-card-design.md, approved by Owner 2026-09-26).
//
// What is pinned here:
//   • 三档自评 → controlled ReviewQuality mapping (remembered→4 / fuzzy→2 /
//     forgot→0) — the SAME STABILITY_MULTIPLIERS the canonical applyReview
//     uses; zero second memory formula (Owner constraint #1/#2)
//   • exam-date density policy consumes the ONE canonical timeline resolver
//     (resolveDaysToExam) with the labelled 96-day fallback (Owner constraint
//     #3 + D6); the factor only ever scales the SCHEDULE, never retention
//   • retention honesty: a never-reviewed card reports null, never 0.5
//     (unknown ≠ a measurement, RULE-06)
//   • deterministic due queue: due (nextReviewAt ≤ now) first by retention
//     asc (null last), then new cards in input order, with caps
//   • interval clamp [0.5, 365] days so 没记住 always resurfaces

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMORY_CARD_RATING_QUALITY,
  MEMORY_CARD_SESSION_CAP,
  MEMORY_CARD_NEW_CARD_CAP,
  MEMORY_CARD_MIN_INTERVAL_DAYS,
  MEMORY_CARD_MAX_INTERVAL_DAYS,
  isCardSelfRating,
  applyCardReviewStability,
  resolveCardDensity,
  nextCardInterval,
  nextCardReviewAt,
  deriveCardRetention,
  applyMemoryCardReview,
  buildMemoryCardQueue,
  collectIntraSessionRetries,
} from '../packages/shared/dist/index.js';

const NOW = new Date('2026-12-10T00:00:00.000Z');
const DAY = 86_400_000;

function examDateIn(days) {
  return new Date(NOW.getTime() + days * DAY).toISOString().slice(0, 10);
}

test('M1: three self-rating levels map onto the controlled quality subset', () => {
  assert.deepEqual(MEMORY_CARD_RATING_QUALITY, { remembered: 4, fuzzy: 2, forgot: 0 });
  assert.equal(isCardSelfRating('remembered'), true);
  assert.equal(isCardSelfRating('fuzzy'), true);
  assert.equal(isCardSelfRating('forgot'), true);
  assert.equal(isCardSelfRating('easy'), false);
  assert.equal(isCardSelfRating(4), false);
  assert.equal(isCardSelfRating(null), false);
});

test('M1: stability updates reuse the shared multiplier table (zero second formula)', () => {
  // First touch: shared baseline previousStabilityDays ?? 1.
  assert.deepEqual(applyCardReviewStability({ stabilityDays: null }, 'remembered'), { stabilityBefore: null, stabilityAfter: 1.7 });
  assert.deepEqual(applyCardReviewStability({ stabilityDays: null }, 'fuzzy'), { stabilityBefore: null, stabilityAfter: 1 });
  assert.deepEqual(applyCardReviewStability({ stabilityDays: null }, 'forgot'), { stabilityBefore: null, stabilityAfter: 0.6 });
  // Existing stability: exact multiples of the shared table (4→1.7, 2→1.0, 0→0.6).
  assert.deepEqual(applyCardReviewStability({ stabilityDays: 2 }, 'remembered'), { stabilityBefore: 2, stabilityAfter: 3.4 });
  assert.deepEqual(applyCardReviewStability({ stabilityDays: 2 }, 'fuzzy'), { stabilityBefore: 2, stabilityAfter: 2 });
  assert.deepEqual(applyCardReviewStability({ stabilityDays: 2 }, 'forgot'), { stabilityBefore: 2, stabilityAfter: 1.2 });
});

test('M1: density phase boundaries follow the approved policy table', () => {
  const density = (days) => resolveCardDensity({ examDate: examDateIn(days), now: NOW });
  assert.equal(density(61).factor, 1.25);
  assert.equal(density(61).phase, 'relaxed');
  assert.equal(density(60).factor, 1.0);
  assert.equal(density(31).factor, 1.0);
  assert.equal(density(30).factor, 0.7);
  assert.equal(density(30).phase, 'intensified');
  assert.equal(density(8).factor, 0.7);
  assert.equal(density(7).factor, 0.5);
  assert.equal(density(7).phase, 'sprint');
  assert.equal(density(1).factor, 0.5);
});

test('M1: density consumes the canonical exam-timeline resolver (fact > cache > labelled fallback)', () => {
  const byDate = resolveCardDensity({ examDate: examDateIn(19), now: NOW });
  assert.equal(byDate.basis, 'exam_date');
  assert.equal(byDate.daysToExam, 19);
  assert.equal(byDate.isFallback, false);

  const byCache = resolveCardDensity({ examDate: null, remainingDays: 10, now: NOW });
  assert.equal(byCache.basis, 'legacy_remaining_days');
  assert.equal(byCache.factor, 0.7);

  const unset = resolveCardDensity({ examDate: null, remainingDays: null, now: NOW });
  assert.equal(unset.basis, 'fallback_constant');
  assert.equal(unset.isFallback, true);
  assert.equal(unset.daysToExam, 96, 'the one named fallback (96d), labelled');
  assert.equal(unset.factor, 1.25, '96d lands in the approved relaxed band (>60 → ×1.25)');
});

test('M1: context label is honest about unset exam dates', () => {
  const set = resolveCardDensity({ examDate: examDateIn(5), now: NOW });
  assert.match(set.contextLabel, /距离考试 5 天/);
  assert.match(set.contextLabel, /冲刺/);
  const unset = resolveCardDensity({ examDate: null, remainingDays: null, now: NOW });
  assert.match(unset.contextLabel, /考试日期未设置/);
});

test('M1: interval clamp keeps 没记住 resurfacing and caps runaway growth', () => {
  assert.equal(nextCardInterval(2, 1.25), 2.5);
  assert.equal(nextCardInterval(1, 0.3), MEMORY_CARD_MIN_INTERVAL_DAYS, 'floor 0.5d');
  assert.equal(nextCardInterval(10_000, 1.25), MEMORY_CARD_MAX_INTERVAL_DAYS, 'ceiling 365d');
  assert.equal(MEMORY_CARD_MIN_INTERVAL_DAYS, 0.5);
  assert.equal(MEMORY_CARD_MAX_INTERVAL_DAYS, 365);
  const at = nextCardReviewAt('2026-12-10T00:00:00.000Z', 1.5);
  assert.equal(at.toISOString(), '2026-12-11T12:00:00.000Z');
});

test('M1: retention is the shared formula — and null for never-reviewed cards', () => {
  const reviewed = deriveCardRetention(
    { lastReviewedAt: new Date(NOW.getTime() - 10 * DAY).toISOString(), stabilityDays: 2 },
    NOW,
  );
  assert.ok(Math.abs(reviewed - Math.exp(-5)) < 1e-9, `retention=${reviewed}`);
  const fresh = deriveCardRetention({ lastReviewedAt: null, stabilityDays: null }, NOW);
  assert.equal(fresh, null, 'never-reviewed must be null, never the 0.5 unknown-prior');
  assert.equal(deriveCardRetention({ lastReviewedAt: null, stabilityDays: 3 }, NOW), null);
  assert.equal(deriveCardRetention({ lastReviewedAt: NOW.toISOString(), stabilityDays: null }, NOW), null);
});

test('M1: full review application composes stability × density into the schedule only', () => {
  const standard = resolveCardDensity({ examDate: examDateIn(45), now: NOW });
  const applied = applyMemoryCardReview({
    state: { stabilityDays: null },
    rating: 'remembered',
    density: standard,
    reviewedAt: NOW,
  });
  assert.equal(applied.quality, 4);
  assert.equal(applied.stabilityBefore, null);
  assert.equal(applied.stabilityAfter, 1.7);
  assert.equal(applied.intervalDays, 1.7);
  assert.equal(applied.nextReviewAt.toISOString(), '2026-12-11T16:48:00.000Z');

  const sprint = resolveCardDensity({ examDate: examDateIn(3), now: NOW });
  const lapsed = applyMemoryCardReview({
    state: { stabilityDays: 2 },
    rating: 'forgot',
    density: sprint,
    reviewedAt: NOW,
  });
  assert.equal(lapsed.quality, 0);
  assert.equal(lapsed.stabilityAfter, 1.2);
  assert.equal(lapsed.intervalDays, 0.6);
  assert.equal(lapsed.densityFactor, 0.5);
  assert.equal(lapsed.densityBasis, 'exam_date');
});

test('M1: due queue orders by retention asc (null last), ties by cardId', () => {
  const cards = [
    { cardId: 'c-strong', knowledgeNodeId: 'n1', cardType: 'CONCLUSION', front: 'f', back: 'b', state: { stabilityDays: 5, lastReviewedAt: new Date(NOW.getTime() - 1 * DAY).toISOString(), nextReviewAt: new Date(NOW.getTime() - DAY).toISOString() } },
    { cardId: 'c-weak', knowledgeNodeId: 'n1', cardType: 'FORMULA', front: 'f', back: 'b', state: { stabilityDays: 1, lastReviewedAt: new Date(NOW.getTime() - 9 * DAY).toISOString(), nextReviewAt: new Date(NOW.getTime() - 2 * DAY).toISOString() } },
    { cardId: 'c-tie-b', knowledgeNodeId: 'n2', cardType: 'CONCLUSION', front: 'f', back: 'b', state: { stabilityDays: 2, lastReviewedAt: new Date(NOW.getTime() - 5 * DAY).toISOString(), nextReviewAt: new Date(NOW.getTime() - DAY).toISOString() } },
    { cardId: 'c-tie-a', knowledgeNodeId: 'n2', cardType: 'CONCLUSION', front: 'f', back: 'b', state: { stabilityDays: 2, lastReviewedAt: new Date(NOW.getTime() - 5 * DAY).toISOString(), nextReviewAt: new Date(NOW.getTime() - DAY).toISOString() } },
    { cardId: 'c-nostability', knowledgeNodeId: 'n3', cardType: 'FORMULA', front: 'f', back: 'b', state: { stabilityDays: null, lastReviewedAt: null, nextReviewAt: new Date(NOW.getTime() - DAY).toISOString() } },
    { cardId: 'c-future', knowledgeNodeId: 'n3', cardType: 'FORMULA', front: 'f', back: 'b', state: { stabilityDays: 3, lastReviewedAt: NOW.toISOString(), nextReviewAt: new Date(NOW.getTime() + 2 * DAY).toISOString() } },
    { cardId: 'c-new', knowledgeNodeId: 'n4', cardType: 'CONCLUSION', front: 'f', back: 'b', state: null },
  ];
  const result = buildMemoryCardQueue({ cards, now: NOW });
  assert.deepEqual(
    result.queue.map((item) => item.cardId),
    ['c-weak', 'c-tie-a', 'c-tie-b', 'c-strong', 'c-nostability', 'c-new'],
    'weakest retention first, ties alphabetical, no-stability due card last among due, future card excluded',
  );
  assert.equal(result.queue[0].phase, 'due');
  assert.equal(result.queue[5].phase, 'new');
  assert.ok(result.queue[0].retention < result.queue[1].retention);
  assert.equal(result.queue[4].retention, null);
  assert.equal(result.summary.dueCount, 5);
  assert.equal(result.summary.newCount, 1);
  assert.equal(result.summary.returned, 6);
});

test('M1: caps bind — new cards capped independently, session cap binds the total', () => {
  const dueCards = Array.from({ length: 15 }, (_, i) => ({
    cardId: `d-${String(i).padStart(2, '0')}`,
    knowledgeNodeId: 'n1',
    cardType: 'CONCLUSION',
    front: 'f',
    back: 'b',
    state: { stabilityDays: 2, lastReviewedAt: new Date(NOW.getTime() - 5 * DAY).toISOString(), nextReviewAt: new Date(NOW.getTime() - DAY).toISOString() },
  }));
  const newCards = Array.from({ length: 12 }, (_, i) => ({
    cardId: `n-${String(i).padStart(2, '0')}`,
    knowledgeNodeId: 'n2',
    cardType: 'FORMULA',
    front: 'f',
    back: 'b',
    state: null,
  }));
  const full = buildMemoryCardQueue({ cards: [...dueCards, ...newCards], now: NOW });
  assert.equal(full.summary.dueCount, 15);
  assert.equal(full.summary.newCount, 12);
  assert.equal(full.summary.returned, MEMORY_CARD_SESSION_CAP, 'session cap 20 binds');
  const newInFull = full.queue.filter((item) => item.phase === 'new');
  assert.equal(newInFull.length, 5, '20 - 15 due = 5 new slots');
  assert.deepEqual(newInFull.map((item) => item.cardId), ['n-00', 'n-01', 'n-02', 'n-03', 'n-04'], 'new cards keep input order');

  const quiet = buildMemoryCardQueue({ cards: [...dueCards.slice(0, 2), ...newCards], now: NOW });
  assert.equal(quiet.queue.filter((item) => item.phase === 'new').length, MEMORY_CARD_NEW_CARD_CAP, 'new-card cap 10 binds when due is small');
  assert.equal(MEMORY_CARD_NEW_CARD_CAP, 10);
  assert.equal(MEMORY_CARD_SESSION_CAP, 20);
});

test('M1: empty catalog produces an honest empty queue, not an error', () => {
  const result = buildMemoryCardQueue({ cards: [], now: NOW });
  assert.deepEqual(result.queue, []);
  assert.equal(result.summary.dueCount, 0);
  assert.equal(result.summary.newCount, 0);
  assert.equal(result.summary.returned, 0);
});

test('M1: intra-session retry collects exactly the 没记住 cards, once each, in first-forgot order', () => {
  const evaluations = [
    { cardId: 'c-1', rating: 'remembered' },
    { cardId: 'c-2', rating: 'forgot' },
    { cardId: 'c-3', rating: 'fuzzy' },
    { cardId: 'c-4', rating: 'forgot' },
    { cardId: 'c-2', rating: 'forgot' }, // re-rated forgot in retry round — must not duplicate
    { cardId: 'c-5', rating: 'remembered' },
  ];
  assert.deepEqual(collectIntraSessionRetries(evaluations), ['c-2', 'c-4']);
  assert.deepEqual(collectIntraSessionRetries([]), []);
  assert.deepEqual(
    collectIntraSessionRetries([{ cardId: 'c-1', rating: 'fuzzy' }, { cardId: 'c-2', rating: 'remembered' }]),
    [],
    '模糊/记住 never trigger intra-session reappearance',
  );
});
