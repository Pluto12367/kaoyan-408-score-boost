import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// LE-V10 F3 M1 — review shadow evaluator (pure).
//
// Purpose: measure how well the CURRENT review scheduler retains knowledge,
// from facts that already exist (ReviewAttempt.nextIntervalDays + later
// same-question PracticeRecords). The FSRS predictor will plug into the same
// result shape later; migration decisions need this baseline first.
//
// Honesty rules under test:
//   - attempts with no same-question follow-up are "no evidence", never
//     counted as forgotten
//   - sample below MIN_SHADOW_SAMPLE → confidence insufficient_data and the
//     endpoint consumer must not draw migration conclusions
//   - deterministic, dependency-free, zero IO

const SHADOW_URL = new URL('../packages/shared/src/score-center/review-shadow.ts', import.meta.url);

async function loadShadow() {
  const source = await readFile(SHADOW_URL, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(() => {
    throw new Error('review-shadow must stay dependency-free');
  }, module, module.exports);
  return module.exports;
}

const attempt = (overrides = {}) => ({
  userId: 'u-1',
  questionId: 'q-1',
  reviewedAt: '2026-08-01T00:00:00.000Z',
  redoCorrect: true,
  nextIntervalDays: 4,
  ...overrides,
});

const practice = (daysAfterReview, correct, overrides = {}) => ({
  userId: 'u-1',
  questionId: 'q-1',
  practicedAt: new Date(new Date('2026-08-01T00:00:00.000Z').getTime() + daysAfterReview * 86400000).toISOString(),
  correct,
  ...overrides,
});

test('post-review accuracy counts only same-question follow-ups within 1 day', async () => {
  const { buildReviewShadow } = await loadShadow();
  const result = buildReviewShadow(
    [attempt(), attempt({ questionId: 'q-2' }), attempt({ questionId: 'q-3' })],
    [
      practice(0.5, true),
      practice(0.5, false, { questionId: 'q-2' }),
      practice(5, true, { questionId: 'q-3' }), // outside the 1-day post window
    ],
  );
  assert.equal(result.postReviewAccuracy, 50);
});

test('retention windows: 7-day and 14-day buckets use the first follow-up in range', async () => {
  const { buildReviewShadow } = await loadShadow();
  const result = buildReviewShadow(
    [attempt()],
    [
      practice(5, true),   // in (2,9] → 7d window, retained
      practice(12, false), // in (10,17] → 14d window, lost (first in window decides)
      practice(13, true),  // later follow-up after the first does not flip the outcome
    ],
  );
  const w7 = result.windows.find((w) => w.window === 'retention_7d');
  const w14 = result.windows.find((w) => w.window === 'retention_14d');
  assert.equal(w7.eligibleAttempts, 1);
  assert.equal(w7.retentionRate, 100);
  assert.equal(w14.eligibleAttempts, 1);
  assert.equal(w14.retentionRate, 0);
});

test('attempts with no follow-up are no-evidence, never counted as forgotten', async () => {
  const { buildReviewShadow, MIN_SHADOW_SAMPLE } = await loadShadow();
  const lonely = Array.from({ length: MIN_SHADOW_SAMPLE + 5 }, (_, index) =>
    attempt({ questionId: `q-lonely-${index}` }));
  const result = buildReviewShadow(lonely, []);
  assert.equal(result.totalAttempts, lonely.length);
  assert.equal(result.attemptsWithFollowUp, 0);
  assert.equal(result.postReviewAccuracy, null);
  for (const bucket of result.intervalBuckets) {
    assert.equal(bucket.retentionRate, null, 'no evidence bucket → null rate, not 0%');
  }
});

test('confidence is insufficient below the preregistered sample floor', async () => {
  const { buildReviewShadow, MIN_SHADOW_SAMPLE } = await loadShadow();
  assert.equal(MIN_SHADOW_SAMPLE, 30);
  const thin = buildReviewShadow([attempt()], [practice(0.5, true)]);
  assert.equal(thin.confidence, 'insufficient_data');
  assert.equal(thin.attemptsWithFollowUp, 1);

  const enough = Array.from({ length: MIN_SHADOW_SAMPLE }, (_, index) => attempt({ questionId: `q-${index}` }));
  const practices = enough.map((a, index) => practice(0.5, true, { questionId: a.questionId }));
  assert.equal(buildReviewShadow(enough, practices).confidence, 'sufficient');
});

test('interval buckets group by the scheduled interval of the old algorithm', async () => {
  const { buildReviewShadow } = await loadShadow();
  const attempts = [
    attempt({ questionId: 'q-a', nextIntervalDays: 1 }),
    attempt({ questionId: 'q-b', nextIntervalDays: 4 }),
    attempt({ questionId: 'q-c', nextIntervalDays: 8 }),
    attempt({ questionId: 'q-d', nextIntervalDays: 20 }),
  ];
  const practices = [
    practice(1, true, { questionId: 'q-a' }),
    practice(4, false, { questionId: 'q-b' }),
    practice(8, true, { questionId: 'q-c' }),
    practice(16, true, { questionId: 'q-d' }),
  ];
  const result = buildReviewShadow(attempts, practices);
  assert.equal(result.intervalBuckets.length, 4);
  const byName = Object.fromEntries(result.intervalBuckets.map((bucket) => [bucket.window, bucket.retentionRate]));
  assert.equal(byName['interval_1_2'], 100);
  assert.equal(byName['interval_3_6'], 0);
  assert.equal(byName['interval_7_13'], 100);
  assert.equal(byName['interval_14_plus'], 100);
});

test('same user+question pairs are required — other users never pollute', async () => {
  const { buildReviewShadow } = await loadShadow();
  const result = buildReviewShadow(
    [attempt()],
    [practice(0.5, true, { userId: 'u-other' })],
  );
  assert.equal(result.attemptsWithFollowUp, 0);
  assert.equal(result.postReviewAccuracy, null);
});

test('purity: dependency-free, no clock, no randomness; constants exported', async () => {
  const source = await readFile(SHADOW_URL, 'utf8');
  const imports = [...source.matchAll(/^import\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/gm)].map((match) => match[1]);
  assert.deepEqual(imports, [], 'review-shadow stays dependency-free');
  assert.doesNotMatch(source, /Date\.now|Math\.random/);
  assert.match(source, /MIN_SHADOW_SAMPLE/);
});

test('M1 wiring: coach endpoint (admin/teacher) and StudyModule registration', async () => {
  const service = await readFile(new URL('../apps/api/src/study/review-shadow.service.ts', import.meta.url), 'utf8');
  assert.match(service, /buildReviewShadow\(/);

  const controller = await readFile(new URL('../apps/api/src/study/daily-brief.controller.ts', import.meta.url), 'utf8');
  assert.match(controller, /Get\('coach\/review-shadow'\)/);
  assert.match(controller, /@Roles\('teacher', 'admin'\)/, 'shadow metrics are not a student surface');

  const serviceFile = await readFile(new URL('../apps/api/src/study/review-shadow.service.ts', import.meta.url), 'utf8');
  assert.match(serviceFile, /reviewAttempt\.findMany/);
  assert.match(serviceFile, /practiceRecord\.findMany/);
  assert.doesNotMatch(serviceFile, /\.create\(|\.update\(|\.delete\(/, 'read-only service');

  const moduleSource = await readFile(new URL('../apps/api/src/study/study.module.ts', import.meta.url), 'utf8');
  assert.match(moduleSource, /ReviewShadowService/);
});
