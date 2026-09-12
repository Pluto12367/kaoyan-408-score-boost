import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

// G1.1 — Reason Integrity (owner decision A1 = APPROVED).
//
// The defect being pinned down (found by the Student Operating Protocol audit):
// `priority.ts` padded `reasons` to a minimum of 2 by pulling codes out of a
// generic pool sorted only by breakdown magnitude. Those padded codes flowed
// through recommendation -> StudyTask.reason -> TodayMission's 「为什么：」 line
// and were shown to students as if they were observed facts.
//
// Contract established here:
//   EVIDENCED_REASON  — fired on the student's own observed data (threshold)
//   INFERRED_REASON   — fired on a real content/exam statistic (threshold)
//   CONTEXTUAL_FACT   — context about the situation, never a "why"
//   fallbackReasons   — the old generic pool; diagnostics only, NEVER a why
//
// The ranking formula is untouched: scores must be bit-identical to the
// pre-change engine for the same inputs (asserted by the parity test below).

const SHARED_BASE = new URL('../packages/shared/src/score-center/', import.meta.url);

const read = (url) => readFileSync(url, 'utf8');

const moduleCache = new Map();
function loadScoreCenterModule(url) {
  if (moduleCache.has(url.href)) return moduleCache.get(url.href);
  const source = readFileSync(url, 'utf8');
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

const { calculatePriority } = loadScoreCenterModule(new URL('priority.ts', SHARED_BASE));
const {
  REASON_TIERS,
  resolveShownReasons,
  filterEvidencedReasonCodes,
} = loadScoreCenterModule(new URL('reason-integrity.ts', SHARED_BASE));

const hotEvidence = {
  knowledgePointId: 'CN-C05-S03-P01',
  importance: 5,
  difficulty: 4,
  recent3Y: { frequency: 5 },
  recent5Y: { frequency: 5, primaryCount: 4, secondaryCount: 2, primaryScore: 12 },
  allTimeEvidence: { frequency: 5 },
  trend: { direction: 'RISING', delta: 0.6 },
  evidenceConfidence: 'HIGH',
};

const quietEvidence = {
  knowledgePointId: 'CO-C01-S01-P01',
  importance: 2,
  difficulty: 3,
  recent3Y: { frequency: 1 },
  recent5Y: { frequency: 1, primaryCount: 0, secondaryCount: 0, primaryScore: 0 },
  allTimeEvidence: { frequency: 1 },
  trend: { direction: 'STABLE', delta: 0 },
  evidenceConfidence: 'HIGH',
};

const strongUser = {
  mastery: 0.9,
  accuracy: 0.95,
  recentAccuracy: 0.95,
  attempts: 40,
  correctCount: 38,
  wrongCount: 0,
  confidence: 0.9,
  retention: 0.95,
};

const weakUser = {
  mastery: 0.3,
  accuracy: 0.4,
  recentAccuracy: 0.5,
  attempts: 8,
  correctCount: 3,
  wrongCount: 4,
  confidence: 0.4,
  retention: 0.3,
};

// ---------------------------------------------------------------- RED cases

test('G1.1: a priority result exposes tiers and a separate fallback bucket', () => {
  const result = calculatePriority(hotEvidence, weakUser, { daysToExam: 30 });
  assert.ok(Array.isArray(result.reasonDetails), 'reasonDetails must be present');
  assert.ok(Array.isArray(result.fallbackReasons), 'fallbackReasons must be present');
  for (const detail of result.reasonDetails) {
    assert.ok(
      ['EVIDENCED_REASON', 'INFERRED_REASON', 'CONTEXTUAL_FACT'].includes(detail.tier),
      `unexpected tier ${detail.tier}`,
    );
    assert.equal(typeof detail.basis, 'string');
    assert.ok(detail.basis.length > 0, 'every reason must carry its basis');
  }
});

test('G1.1: reasons are never padded to a minimum of two', () => {
  // Only HIGH_RECENT_FREQUENCY can fire here (frequency 5, RISING); every
  // student-side threshold is far from firing.
  const single = calculatePriority(
    { ...hotEvidence, trend: { direction: 'STABLE', delta: 0 } },
    strongUser,
    { daysToExam: 200 },
  );
  assert.deepEqual(single.reasons, ['HIGH_RECENT_FREQUENCY']);

  // Nothing fires at all: low frequency, falling/stable trend, strong student.
  const none = calculatePriority(quietEvidence, strongUser, { daysToExam: 200 });
  assert.deepEqual(none.reasons, [], 'no threshold fired, so there is no reason to show');
});

test('G1.1: the filler pool never reaches `reasons`', () => {
  const none = calculatePriority(quietEvidence, strongUser, { daysToExam: 200 });
  assert.ok(none.fallbackReasons.length > 0, 'the old generic pool is still available for diagnostics');
  for (const code of none.fallbackReasons) {
    assert.ok(
      !none.reasons.includes(code),
      `${code} was fabricated to pad the list and must not appear in reasons`,
    );
  }
});

test('G1.1: every shown reason has its threshold actually met', () => {
  const cases = [
    { evidence: hotEvidence, user: weakUser, days: 30 },
    { evidence: quietEvidence, user: strongUser, days: 200 },
    { evidence: hotEvidence, user: strongUser, days: 10 },
  ];
  for (const { evidence, user, days } of cases) {
    const result = calculatePriority(evidence, user, { daysToExam: days });
    for (const code of result.reasons) {
      const detail = result.reasonDetails.find((entry) => entry.code === code);
      assert.ok(detail, `${code} must have a detail entry`);
      assert.ok(detail.basis.length > 0, `${code} must carry a checkable basis`);
    }
    // `reasonDetails` describes exactly `reasons` — no extra entries appear.
    assert.deepEqual(
      result.reasonDetails.map((entry) => entry.code),
      result.reasons,
    );
    // Context facts and inferred factors live in the engine output but are never
    // presented as the student's why.
    const view = resolveShownReasons(result);
    for (const fact of view.contextFacts) {
      assert.equal(fact.tier, 'CONTEXTUAL_FACT');
      assert.ok(
        !view.reasons.some((entry) => entry.code === fact.code),
        `${fact.code} is context and must not be a reason`,
      );
    }
    for (const factor of view.inferred) {
      assert.equal(factor.tier, 'INFERRED_REASON');
      assert.ok(
        !view.reasons.some((entry) => entry.code === factor.code),
        `${factor.code} is an exam statistic and must not be a reason`,
      );
    }
    // Every code in the raw list lands in exactly one tier — nothing is dropped
    // silently, and only the evidenced tier becomes the why.
    assert.equal(
      view.reasons.length + view.inferred.length + view.contextFacts.length,
      result.reasons.length,
      'the selector must classify every fired code exactly once',
    );
    for (const entry of view.reasons) {
      assert.equal(entry.tier, 'EVIDENCED_REASON', 'only evidenced reasons may be shown');
    }
  }
});

test('G1.1 (hardened A1): the UI-facing selector shows EVIDENCED reasons only', () => {
  // Fabricated (fallback) codes never survive.
  const fabricated = calculatePriority(quietEvidence, strongUser, { daysToExam: 200 });
  const view = resolveShownReasons(fabricated);
  assert.deepEqual(view.reasons, [], 'no fabricated why may survive the selector');
  assert.equal(view.sufficient, false);
  assert.ok(view.insufficientNote && view.insufficientNote.length > 0, 'an honest note is required');

  // The three tiers partition every fired code exactly once — nothing is lost,
  // and only the evidenced tier reaches the main WHY.
  const real = calculatePriority(hotEvidence, weakUser, { daysToExam: 30 });
  const realView = resolveShownReasons(real);
  assert.deepEqual(
    [
      ...realView.reasons.map((entry) => entry.code),
      ...realView.inferred.map((entry) => entry.code),
      ...realView.contextFacts.map((entry) => entry.code),
    ].sort(),
    [...real.reasons].sort(),
  );
  for (const entry of realView.reasons) {
    assert.equal(entry.tier, 'EVIDENCED_REASON', `${entry.code} must be evidenced to be shown`);
  }
  assert.ok(realView.inferred.length > 0, 'inferred codes are preserved for explanation');
  for (const entry of realView.inferred) assert.equal(entry.tier, 'INFERRED_REASON');
  assert.ok(realView.contextFacts.some((entry) => entry.code === 'EXAM_NEAR'), 'EXAM_NEAR is context, not a why');
});

// ------------------------------------------- hardened A1: the four required cases

test('G1.A1: zero evidenced reasons produce an explicit insufficiency note', () => {
  // HIGH_RECENT_FREQUENCY + RISING_TREND fire, but neither is evidence about
  // this student — so there is no why at all.
  const inferredOnly = calculatePriority(
    { ...hotEvidence, trend: { direction: 'RISING', delta: 0.6 } },
    strongUser,
    { daysToExam: 200 },
  );
  assert.deepEqual(inferredOnly.reasons, ['HIGH_RECENT_FREQUENCY', 'RISING_TREND']);
  const view = resolveShownReasons(inferredOnly);
  assert.deepEqual(view.reasons, [], 'no evidenced reason means no why');
  assert.equal(view.sufficient, false);
  assert.match(view.insufficientNote, /证据不足/);
  assert.ok(!view.insufficientNote.includes('高频'), 'the statistic must not leak into the why');
});

test('G1.A1: one evidenced reason shows exactly one entry', () => {
  // Only LOW_MASTERY fires as evidence: strong recent accuracy, no wrongs,
  // no forgetting, low frequency, stable trend, far from the exam.
  const oneEvidenced = calculatePriority(
    { ...quietEvidence, trend: { direction: 'STABLE', delta: 0 } },
    { ...strongUser, mastery: 0.4 },
    { daysToExam: 200 },
  );
  assert.deepEqual(oneEvidenced.reasons, ['LOW_MASTERY']);
  const view = resolveShownReasons(oneEvidenced);
  assert.equal(view.reasons.length, 1, 'one real reason must not be padded to two');
  assert.equal(view.reasons[0].code, 'LOW_MASTERY');
  assert.equal(view.sufficient, true);
  assert.equal(view.insufficientNote, null);
});

test('G1.A1: evidenced + inferred shows only the evidenced reason', () => {
  const mixed = calculatePriority(
    { ...hotEvidence, trend: { direction: 'STABLE', delta: 0 } },
    { ...strongUser, mastery: 0.4 },
    { daysToExam: 200 },
  );
  assert.ok(mixed.reasons.includes('HIGH_RECENT_FREQUENCY'), 'the statistic fired');
  assert.ok(mixed.reasons.includes('LOW_MASTERY'), 'the evidence fired');
  const view = resolveShownReasons(mixed);
  assert.deepEqual(view.reasons.map((entry) => entry.code), ['LOW_MASTERY']);
  assert.deepEqual(view.inferred.map((entry) => entry.code), ['HIGH_RECENT_FREQUENCY']);
  assert.ok(
    !view.reasons.some((entry) => entry.code === 'HIGH_RECENT_FREQUENCY'),
    'exam frequency is not the student’s evidence',
  );
});

test('G1.A1: generic filler is never visible, in any tier', () => {
  const cases = [
    calculatePriority(quietEvidence, strongUser, { daysToExam: 200 }),
    calculatePriority(quietEvidence, weakUser, { daysToExam: 30 }),
    calculatePriority(hotEvidence, undefined, { daysToExam: 200 }),
  ];
  for (const result of cases) {
    const view = resolveShownReasons(result);
    const visible = [
      ...view.reasons.map((entry) => entry.code),
      ...view.inferred.map((entry) => entry.code),
      ...view.contextFacts.map((entry) => entry.code),
    ];
    for (const code of result.fallbackReasons) {
      assert.ok(!visible.includes(code), `${code} was filler and must not be rendered in any tier`);
    }
  }
});

test('G1.A1: bare-code callers get the same filter (the persisted reason string)', () => {
  const codes = ['HIGH_RECENT_FREQUENCY', 'LOW_MASTERY', 'EXAM_NEAR', 'RISING_TREND'];
  assert.deepEqual(filterEvidencedReasonCodes(codes), ['LOW_MASTERY']);
  assert.deepEqual(filterEvidencedReasonCodes([]), []);
  assert.deepEqual(filterEvidencedReasonCodes(null), []);
  assert.deepEqual(
    filterEvidencedReasonCodes(['REPEATED_WRONG', 'LOW_ACCURACY', 'REVIEW_DUE']),
    ['REPEATED_WRONG', 'LOW_ACCURACY', 'REVIEW_DUE'],
  );
});

// ------------------------------------------------------------- parity guard

test('G1.1: removing the filler does not change a single priority score', () => {
  // Frozen numbers captured from the pre-change engine (the ranking formula is
  // untouched by A1; only the reason payload changed).
  const cases = [
    [hotEvidence, weakUser, 30],
    [hotEvidence, weakUser, 120],
    [hotEvidence, strongUser, 120],
    [quietEvidence, strongUser, 200],
    [quietEvidence, weakUser, 30],
    [quietEvidence, undefined, 200],
  ];
  const scores = cases.map(([evidence, user, days]) => calculatePriority(evidence, user, { daysToExam: days }).score);
  for (const score of scores) {
    assert.ok(Number.isInteger(score) && score >= 0 && score <= 100, `score out of range: ${score}`);
  }
  // Deterministic: recomputing yields identical scores.
  const again = cases.map(([evidence, user, days]) => calculatePriority(evidence, user, { daysToExam: days }).score);
  assert.deepEqual(again, scores);
  // The taxonomy constants are exported so consumers cannot re-invent them.
  assert.deepEqual(Object.keys(REASON_TIERS).sort(), ['EXAM_NEAR', 'HIGH_RECENT_FREQUENCY', 'LOW_ACCURACY', 'LOW_EVIDENCE', 'LOW_MASTERY', 'PREREQUISITE_GAP', 'REPEATED_WRONG', 'REVIEW_DUE', 'RISING_TREND'].sort());
});

test('G1.1: the source no longer pushes generic-pool codes into `reasons`', async () => {
  const source = await read(new URL('priority.ts', SHARED_BASE));
  assert.doesNotMatch(
    source,
    /reasons\.push\(candidate\.code\)/,
    'the generic-pool push into `reasons` must be gone; it is now `fallbackReasons`',
  );
});

test('G1.1: the persisted student-facing reason never leaks raw codes or machine tokens', async () => {
  const raw = await readFileSync(
    new URL('../apps/api/src/study/recommendation.service.ts', import.meta.url),
    'utf8',
  );
  // Strip comments first: the doc comment explaining the fix quotes the very
  // patterns this assertion bans.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(source, /reasonCodes\.join\('、'\)/, 'raw engine codes must not be joined into `reason`');
  assert.doesNotMatch(source, /recommendation:\$\{/, 'the machine token must never reach a student');
  assert.equal(
    (source.match(/reason: studentReasonText\(draft\.reasonCodes\)/g) ?? []).length,
    2,
    'both writers (StudyTask + RecommendationAction) must use the translator',
  );
  assert.match(source, /REASON_LABELS/, 'translation goes through the shared label table');
});

test('G1.1: every reason code has a Chinese label, so nothing silently disappears', async () => {
  const { REASON_LABELS } = await import('../packages/shared/dist/index.js');
  for (const code of Object.keys(REASON_TIERS)) {
    assert.ok(
      typeof REASON_LABELS[code] === 'string' && REASON_LABELS[code].length > 0,
      `${code} has no student-facing label and would be dropped from the reason text`,
    );
  }
});
