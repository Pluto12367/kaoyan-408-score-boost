import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// LE/V11-M4 — Learning Impact Measurement Layer (pure projections).
//   M4.1 review priority (fsrs-scheduler.reviewPriority)
//   M4.2 mastery calibration shadow (stored EMA vs observed accuracy)
//   M4.3 outcome tracking (before/after windows around an intervention)
// Honesty: missing data → null/hold/insufficient_data, never fabricated.

const BASE = new URL('../packages/shared/src/score-center/', import.meta.url);

const read = (url) => readFileSync(url, 'utf8');

const moduleCache = new Map();
function loadScoreCenterModule(url) {
  if (moduleCache.has(url.href)) return moduleCache.get(url.href);
  const source = read(url);
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  moduleCache.set(url.href, module.exports);
  const localRequire = (requested) => {
    if (!requested.startsWith('.')) {
      throw new Error(`bare specifier not allowed in sandbox: ${requested}`);
    }
    const resolved = requested.endsWith('.ts') ? new URL(requested, url) : new URL(`${requested}.ts`, url);
    return loadScoreCenterModule(resolved);
  };
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

const loadModule = loadScoreCenterModule;

const sourceOf = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// M4.1 review priority
// ---------------------------------------------------------------------------

test('M4.1 review priority: urgency rises as recall falls; suggested interval targets retention', () => {
  const { reviewPriority, DEFAULT_TARGET_RETENTION } = loadModule(new URL('fsrs-scheduler.ts', BASE));
  assert.ok(DEFAULT_TARGET_RETENTION > 0.8 && DEFAULT_TARGET_RETENTION < 0.95);
  const fresh = reviewPriority({ stability: 7, elapsedDays: 0 });
  const due = reviewPriority({ stability: 7, elapsedDays: 20 });
  assert.equal(fresh.retrievability, 1);
  assert.equal(fresh.urgency, 0, 'just-reviewed → no urgency');
  assert.ok(due.urgency > fresh.urgency, 'overdue review is more urgent');
  assert.ok(due.retrievability < fresh.retrievability);
  assert.ok(due.suggestedIntervalDays >= 1);
});

// ---------------------------------------------------------------------------
// M4.2 mastery calibration shadow
// ---------------------------------------------------------------------------

const calibrationNode = (overrides = {}) => ({
  nodeId: 'DS-TREE',
  currentMastery: 0.7,
  attempts: [
    { correct: true }, { correct: true }, { correct: false },
    { correct: true }, { correct: true }, { correct: true },
  ],
  ...overrides,
});

test('M4.2 calibration: stored mastery above evidence suggests lowering', () => {
  const { buildMasteryCalibration } = loadModule(new URL('mastery-calibration.ts', BASE));
  const result = buildMasteryCalibration([
    calibrationNode({ currentMastery: 0.9, attempts: Array.from({ length: 10 }, (_, i) => ({ correct: i % 2 === 0 })) }),
  ]);
  const entry = result.entries[0];
  assert.equal(entry.evidenceEstimate, 0.5);
  assert.equal(entry.difference, 0.4);
  assert.equal(entry.suggestedDirection, 'lower');
  assert.equal(entry.confidence, 'high');
  assert.equal(result.source, 'derived');
});

test('M4.2 calibration: evidence above stored mastery suggests lowering expectation; thin sample stays low-confidence', () => {
  const { buildMasteryCalibration } = loadModule(new URL('mastery-calibration.ts', BASE));
  const strong = buildMasteryCalibration([
    calibrationNode({ currentMastery: 0.4, attempts: Array.from({ length: 6 }, () => ({ correct: true })) }),
  ]);
  assert.equal(strong.entries[0].evidenceEstimate, 1);
  assert.equal(strong.entries[0].suggestedDirection, 'raise', 'evidence above stored → suggest raising');
  assert.equal(strong.entries[0].confidence, 'medium');

  const thin = buildMasteryCalibration([
    calibrationNode({ currentMastery: 0.4, attempts: [{ correct: true }, { correct: true }] }),
  ]);
  assert.equal(thin.entries[0].confidence, 'low');
  assert.equal(thin.entries[0].suggestedDirection, 'raise');
});

test('M4.2 calibration: no attempts → hold with null estimate (never fabricated)', () => {
  const { buildMasteryCalibration } = loadModule(new URL('mastery-calibration.ts', BASE));
  const result = buildMasteryCalibration([calibrationNode({ attempts: [] })]);
  assert.equal(result.entries[0].evidenceEstimate, null);
  assert.equal(result.entries[0].difference, null);
  assert.equal(result.entries[0].confidence, 'low');
});

// ---------------------------------------------------------------------------
// M4.3 outcome tracking
// ---------------------------------------------------------------------------

const OUTCOME_T0 = '2026-09-01T00:00:00.000Z';
const attemptAt = (daysFromT0, correct, nodeId = 'OS-DEADLOCK') => ({
  questionId: `q-${Math.abs(daysFromT0)}-${correct ? 'y' : 'n'}`,
  submittedAt: new Date(new Date(OUTCOME_T0).getTime() + daysFromT0 * 86400000).toISOString(),
  correct,
  nodeIds: [nodeId],
});

test('M4.3 outcome: before/after windows with a ≥10pt accuracy lift → improved', () => {
  const { buildOutcomeTracking } = loadModule(new URL('outcome-tracking.ts', BASE));
  const createdMs = new Date(OUTCOME_T0).getTime();
  const attempts = [
    attemptAt(-5, false), attemptAt(-3, false), attemptAt(-2, false),
    attemptAt(2, true), attemptAt(4, true), attemptAt(6, true), attemptAt(8, false),
  ];
  const result = buildOutcomeTracking({
    intervention: { actionId: 'act-1', actionType: 'PRACTICE', nodeId: 'OS-DEADLOCK', createdAt: OUTCOME_T0 },
    attempts,
    masteryPoints: [],
    asOf: '2026-09-09T00:00:00.000Z',
  });
  assert.equal(result.verdict, 'improved');
  assert.match(result.basis, /正确率/);
});

test('M4.3 outcome: fewer than 3 after-attempts → insufficient_data', () => {
  const { buildOutcomeTracking } = loadModule(new URL('outcome-tracking.ts', BASE));
  const createdMs = new Date(OUTCOME_T0).getTime();
  const attempts = [attemptAt(2, true), attemptAt(4, true)];
  const result = buildOutcomeTracking({
    intervention: { actionId: 'act-1', actionType: 'PRACTICE', nodeId: 'OS-DEADLOCK', createdAt: OUTCOME_T0 },
    attempts,
    masteryPoints: [],
    asOf: '2026-09-09T00:00:00.000Z',
  });
  assert.equal(result.verdict, 'insufficient_data');
  assert.match(result.basis, /不足 3 次/);
});

test('M4.3 outcome: no_change when rates stay flat (never negative-spin)', () => {
  const { buildOutcomeTracking } = loadModule(new URL('outcome-tracking.ts', BASE));
  const createdMs = new Date(OUTCOME_T0).getTime();
  const attempts = [
    attemptAt(-6, true), attemptAt(-4, true), attemptAt(-2, false),
    attemptAt(2, true), attemptAt(4, true), attemptAt(6, false),
  ];
  const result = buildOutcomeTracking({
    intervention: { actionId: 'act-1', actionType: 'PRACTICE', nodeId: 'OS-DEADLOCK', createdAt: OUTCOME_T0 },
    attempts,
    masteryPoints: [],
    asOf: '2026-09-09T00:00:00.000Z',
  });
  assert.equal(result.verdict, 'no_change');
  assert.match(result.basis, /未见统计意义的变化/);
});

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

test('M4 wiring: learning-impact service, coach endpoints, module registration', () => {
  const service = readFileSync(new URL('../apps/api/src/study/learning-impact.service.ts', import.meta.url), 'utf8');
  assert.match(service, /userKnowledgeMastery\.findMany/);
  assert.match(service, /recommendationAction\.findMany/);
  assert.match(service, /userMasterySnapshot\.findMany/);
  assert.match(service, /buildMasteryCalibration/);
  assert.match(service, /buildOutcomeTracking/);
  assert.doesNotMatch(service, /\.create\(|\.update\(|\.delete\(/, 'read-only service');

  const controller = await0Controller();
  function await0Controller() {
    return readFileSync(new URL('../apps/api/src/study/daily-brief.controller.ts', import.meta.url), 'utf8');
  }
  assert.match(controller, /Get\('coach\/mastery-calibration'\)/);
  assert.match(controller, /Get\('coach\/outcome-tracking'\)/);
  assert.match(controller, /LearningImpactService/);

  const moduleSource = readFileSync(new URL('../apps/api/src/study/study.module.ts', import.meta.url), 'utf8');
  assert.match(moduleSource, /LearningImpactService/);
});
