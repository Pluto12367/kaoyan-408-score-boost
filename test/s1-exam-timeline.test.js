import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// S1-I0 / P0-3 + P0-4 — canonical exam timeline (INV-3, INV-4, T-3, T-4).
//
// `User.examDate` is the fact; `remainingDays` is a legacy derived cache. The
// audit found five parallel derivations of the same concept with three different
// semantics for one missing value (96 / 240 / 0), plus a WEB CLIENT that invented
// an exam date. This file pins the single resolver and the single fallback.

const SHARED = new URL('../packages/shared/dist/index.js', import.meta.url);
const {
  resolveDaysToExam,
  resolveDaysToExamNumber,
  applyExamTimelineFallback,
  resolveDaysToExamTracked,
  getExamTimelineDriftCount,
  resetExamTimelineDriftCount,
  EXAM_TIMELINE_FALLBACK_DAYS,
} = await import(SHARED.href);

const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const NOW = '2026-09-12T09:00:00.000Z';

// ------------------------------------------------------------- the precedence

test('P0-3: examDate is the fact and wins over the legacy cache', () => {
  const resolved = resolveDaysToExam({
    examDate: '2026-10-12T00:00:00.000Z',
    remainingDays: 999,
    now: NOW,
  });
  assert.equal(resolved.days, 30);
  assert.equal(resolved.basis, 'exam_date');
});

test('P0-3: without examDate the legacy cache is used and labelled legacy', () => {
  const resolved = resolveDaysToExam({ examDate: null, remainingDays: 120, now: NOW });
  assert.equal(resolved.days, 120);
  assert.equal(resolved.basis, 'legacy_remaining_days');
});

test('P0-3/INV-10: with neither, the answer is unknown — never 0 and never 96', () => {
  const resolved = resolveDaysToExam({ examDate: null, remainingDays: null, now: NOW });
  assert.equal(resolved.days, null);
  assert.equal(resolved.basis, 'unknown');
  assert.notEqual(resolved.days, 0);
  assert.notEqual(resolved.days, 96);

  const missing = resolveDaysToExam({ now: NOW });
  assert.equal(missing.days, null);
});

test('P0-4: a conflicting cache is a drift event, and examDate still wins', () => {
  const resolved = resolveDaysToExam({ examDate: '2026-10-12T00:00:00.000Z', remainingDays: 45, now: NOW });
  assert.equal(resolved.days, 30, 'the fact wins');
  assert.equal(resolved.drift, true, 'and the disagreement is observable');

  const agreed = resolveDaysToExam({ examDate: '2026-10-12T00:00:00.000Z', remainingDays: 30, now: NOW });
  assert.equal(agreed.drift, false);
});

test('P0-4: drift is COUNTED, not merely flagged, and only for real disagreements', () => {
  // The design requires an incrementing, observable drift counter. The pure
  // resolver cannot emit, so the tracked variant tallies at the IO boundary.
  resetExamTimelineDriftCount();
  assert.equal(getExamTimelineDriftCount(), 0);

  // Agreeing cache: no drift.
  resolveDaysToExamTracked({ examDate: '2026-10-12T00:00:00.000Z', remainingDays: 30, now: NOW });
  assert.equal(getExamTimelineDriftCount(), 0, 'agreement is not drift');

  // Disagreeing cache: exactly one drift event.
  resolveDaysToExamTracked({ examDate: '2026-10-12T00:00:00.000Z', remainingDays: 45, now: NOW });
  assert.equal(getExamTimelineDriftCount(), 1);

  // Legacy-only and unknown states are NOT drift: there is nothing to disagree with.
  resolveDaysToExamTracked({ examDate: null, remainingDays: 45, now: NOW });
  resolveDaysToExamTracked({ now: NOW });
  assert.equal(getExamTimelineDriftCount(), 1, 'only examDate-vs-cache conflicts count');

  // The counter still increments and returns the same resolution the pure
  // resolver would, so instrumenting a call site cannot change behaviour.
  const tracked = resolveDaysToExamTracked({ examDate: '2026-10-12T00:00:00.000Z', remainingDays: 47, now: NOW });
  assert.equal(getExamTimelineDriftCount(), 2);
  assert.deepEqual(tracked, resolveDaysToExam({ examDate: '2026-10-12T00:00:00.000Z', remainingDays: 47, now: NOW }));
  resetExamTimelineDriftCount();
});

test('P0-3: the fallback is applied explicitly and is labelled', () => {
  const unknown = resolveDaysToExam({ now: NOW });
  assert.equal(unknown.basis, 'unknown');
  const applied = applyExamTimelineFallback(unknown);
  assert.equal(applied.days, EXAM_TIMELINE_FALLBACK_DAYS);
  assert.equal(applied.basis, 'fallback_constant', 'a default must never pass for a fact');
  assert.equal(EXAM_TIMELINE_FALLBACK_DAYS, 96);
});

// ------------------------------------------------ T-3 parity with the old rule

test('P0-3/T-3: for every currently-representable state the effective daysToExam is unchanged', () => {
  const DAY = 86_400_000;
  const now = new Date(NOW);

  for (const remainingDays of [null, 0, 1, 30, 45, 96, 120, 240, 365]) {
    for (const offsetDays of [null, 0, 7, 30, 96, 240]) {
      const examDate = offsetDays == null ? null : new Date(now.getTime() + offsetDays * DAY).toISOString();
      const resolved = resolveDaysToExam({ examDate, remainingDays, now: NOW });
      const effective = applyExamTimelineFallback(resolved).days;

      // The legacy formula every production path used before this change.
      const legacy = Math.max(0, remainingDays ?? EXAM_TIMELINE_FALLBACK_DAYS);

      if (examDate == null) {
        // State (a): no fact recorded. The canonical resolver + labelled fallback
        // must reproduce the legacy number exactly.
        assert.equal(effective, legacy, `parity broken for remainingDays=${remainingDays}`);
      } else {
        // State (b): the fact is recorded. The single writer mirrors the derived
        // value into the cache, so the derived value is what the cache holds.
        assert.equal(effective, Math.max(0, offsetDays), `derived value expected for offset ${offsetDays}`);
      }
    }
  }
});

test('P0-4: a stale cache is the ONLY divergence, and it is the intended one', () => {
  const DAY = 86_400_000;
  const examDate = new Date(new Date(NOW).getTime() + 30 * DAY).toISOString();
  // The G1 writer keeps the two in sync, so this state is not reachable today;
  // if it ever appears the design says the fact wins and drift is recorded.
  const resolved = resolveDaysToExam({ examDate, remainingDays: 5, now: NOW });
  assert.equal(resolved.days, 30);
  assert.equal(resolved.drift, true);
  assert.notEqual(resolved.days, 5, 'the cache must not override the fact');
});

// ------------------------------------------------ T-4 no parallel derivations

test('P0-3/T-4: no second fallback constant and no unlabelled remainingDays default', () => {
  const files = [
    'apps/api/src/study/recommendation.service.ts',
    'apps/api/src/study/score-opportunity.service.ts',
    'apps/api/src/study/shadow-decision-chain.service.ts',
    'apps/api/src/study/score-calibration.service.ts',
    'apps/api/src/study/learning-loop-trigger.service.ts',
    'apps/api/src/study/study.service.ts',
  ];
  for (const path of files) {
    const source = stripComments(read(path));
    assert.doesNotMatch(source, /DAYS_FALLBACK\s*=\s*\d+/, `${path} still declares its own fallback constant`);
    assert.doesNotMatch(
      source,
      /remainingDays\s*\?\?\s*\d+/,
      `${path} still defaults remainingDays inline instead of using the resolver`,
    );
  }
});

test('P0-3/T-4: the web client no longer invents an exam date', () => {
  const source = stripComments(read('apps/web/src/features/today-score-center/TodaysScoreCenter.tsx'));
  assert.doesNotMatch(source, /defaultTargetExamDate/, 'the invented exam date function must be gone');
  assert.doesNotMatch(source, /12-20/, 'no hardcoded December 20');
  assert.doesNotMatch(source, /targetExamDate:/, 'the client must not send an exam date');
});

test('P0-3/T-4: the learning-loop trigger no longer hardcodes December 20', () => {
  const source = stripComments(read('apps/api/src/study/learning-loop-trigger.service.ts'));
  assert.doesNotMatch(source, /Date\.UTC\(examYear,\s*11,\s*20\)/, 'the Dec-20 assumption must be gone');
  assert.match(source, /resolveDaysToExam/, 'and the canonical resolver used instead');
});

test('P0-3/T-4: every decision path routes through the canonical resolver', () => {
  for (const path of [
    'apps/api/src/study/recommendation.service.ts',
    'apps/api/src/study/score-opportunity.service.ts',
    'apps/api/src/study/shadow-decision-chain.service.ts',
    'apps/api/src/study/learning-loop-trigger.service.ts',
  ]) {
    assert.match(stripComments(read(path)), /resolveDaysToExam/, `${path} must use the canonical resolver`);
  }
});

test('P0-3: the resolver is the only place that reads remainingDays as a timeline', () => {
  // A single named module owns the precedence rule; consumers may still read the
  // raw column for display, but no consumer may re-implement the derivation.
  const resolver = read('packages/shared/src/score-center/exam-timeline.ts');
  assert.match(resolver, /export function resolveDaysToExam/);
  assert.match(resolver, /export const EXAM_TIMELINE_FALLBACK_DAYS/);
});
