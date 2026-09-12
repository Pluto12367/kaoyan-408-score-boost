import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BEHAVIOR_SIGNAL_IDS,
  BEHAVIOR_THRESHOLDS,
  COMPLETION_BOUNDARY_NOTE,
  EMPTY_DELIVERY_STATE,
  HOW_GUIDANCE,
  LEARNING_CONTRACT,
  NEXT_ACTIONS,
  buildTodayMissionContract,
  cooldownForTrigger,
  describeVerification,
  detectBehaviorSignals,
  resolveFirstUseGuidance,
  resolveNextAction,
  selectDeliverableGuidance,
} from '../packages/shared/dist/index.js';

// G1.2–G1.6 — the guidance protocol contract.
//
// These tests pin the *product* rules, not the implementation:
//   • one primary action, four mandatory answers (task §5)
//   • no fabricated WHY (task §2.2)
//   • Detection → Explanation → Correction → Verification for every guardrail (task §9)
//   • every major state yields a NEXT or an explicit honest no-next (task §11)
//   • copy never claims ability from activity (task §20)

const NOW = '2026-09-12T09:00:00.000Z';

function healthyInput() {
  return {
    asOf: NOW,
    windowDays: 14,
    attempts: Array.from({ length: 12 }, (_, index) => ({
      questionId: `q-${index}`,
      nodeId: 'node-a',
      difficulty: index % 2 === 0 ? 'MEDIUM' : 'HARD',
      correct: index % 3 !== 0,
      submittedAt: NOW,
      firstSeen: true,
    })),
    sessions: { count: 3, totalQuestions: 12, abandonedQuestions: 0 },
    verification: { probeEvents: 2, probeExpired: 0, assessments: 1 },
    recommendations: { failures: [] },
    mastery: { rising: [], withTransferEvidence: ['node-a'] },
  };
}

// ------------------------------------------------------------ TODAY (G1.2)

test('G1.2: the today contract answers WHAT / WHY / TIME / VERIFY for one action', () => {
  const contract = buildTodayMissionContract({
    asOf: NOW,
    dateKey: '2026-09-12',
    tasks: [
      {
        id: 't-2', title: '树的遍历应用', subject: 'DS', chapter: '树', minutes: 25, questionCount: 8,
        completed: false, reasonCodes: ['HIGH_RECENT_FREQUENCY', 'LOW_MASTERY'], reason: '近3年高频考点；掌握度偏低',
      },
      {
        id: 't-1', title: '已经做完的任务', subject: 'CO', chapter: 'Cache', minutes: 20, questionCount: 8,
        completed: true, reasonCodes: ['LOW_ACCURACY'], reason: '正确率偏低',
      },
    ],
    reviewDue: 0,
    verification: { probeDue: false, probeUnavailable: false, assessments: 0 },
  });

  assert.equal(contract.what.taskId, 't-2', 'the primary action is the first unfinished task');
  assert.equal(contract.time, '约 25 分钟 · 8 题');
  assert.ok(contract.verify.includes('判分作答'), 'VERIFY must say what the system will observe');
  assert.equal(contract.whySufficient, true);
  // Hardened A1: only the evidenced reason is the why; the frequency statistic is
  // preserved as a sorting factor and clearly separated from it.
  assert.deepEqual(contract.why.map((entry) => entry.code), ['LOW_MASTERY']);
  assert.deepEqual(contract.sortingFactors.map((entry) => entry.code), ['HIGH_RECENT_FREQUENCY']);
  assert.ok(contract.next && contract.next.id, 'a NEXT is always present');
  assert.equal(contract.boundary, COMPLETION_BOUNDARY_NOTE);
});

test('G1.A1: a task whose only codes are inferred or contextual has no why', () => {
  const contract = buildTodayMissionContract({
    asOf: NOW,
    dateKey: '2026-09-12',
    tasks: [{
      id: 't-9', title: '只有统计依据的任务', subject: 'DS', chapter: '树', minutes: 20, questionCount: 8,
      completed: false, reasonCodes: ['HIGH_RECENT_FREQUENCY', 'RISING_TREND', 'EXAM_NEAR'], reason: null,
    }],
    reviewDue: 0,
    verification: { probeDue: false, probeUnavailable: false, assessments: 0 },
  });
  assert.deepEqual(contract.why, [], 'statistics and context are not evidence');
  assert.equal(contract.whySufficient, false);
  assert.match(contract.insufficientNote, /证据不足/);
  assert.deepEqual(contract.sortingFactors.map((entry) => entry.code), ['HIGH_RECENT_FREQUENCY', 'RISING_TREND']);
  assert.deepEqual(contract.context.map((entry) => entry.code), ['EXAM_NEAR']);
});

test('G1.2: a task with no real reason reports insufficiency instead of a fabricated why', () => {
  const contract = buildTodayMissionContract({
    asOf: NOW,
    dateKey: '2026-09-12',
    tasks: [{
      id: 't-3', title: '无理由任务', subject: 'OS', chapter: '进程', minutes: 20, questionCount: 8,
      completed: false, reasonCodes: [], reason: null,
    }],
    reviewDue: 0,
    verification: { probeDue: false, probeUnavailable: false, assessments: 0 },
  });
  assert.equal(contract.whySufficient, false);
  assert.deepEqual(contract.why, []);
  assert.ok(contract.insufficientNote && contract.insufficientNote.includes('证据不足'));
  // Context facts are never promoted into the why list.
  assert.ok(!contract.why.some((entry) => entry.tier === 'CONTEXTUAL_FACT'));
});
test('G1.2: context facts are carried separately from reasons', () => {
  const contract = buildTodayMissionContract({
    asOf: NOW,
    dateKey: '2026-09-12',
    tasks: [{
      id: 't-4', title: '临近考试的任务', subject: 'CN', chapter: 'TCP', minutes: 30, questionCount: 8,
      completed: false, reasonCodes: ['EXAM_NEAR'], reason: '临近考试',
    }],
    reviewDue: 0,
    verification: { probeDue: false, probeUnavailable: false, assessments: 0 },
  });
  assert.deepEqual(contract.why, [], 'EXAM_NEAR is context, not a why');
  assert.deepEqual(contract.context.map((entry) => entry.code), ['EXAM_NEAR']);
});

// ------------------------------------------------- GUARDRAILS (G1.3 / §8)

test('G1.6: every guardrail carries Detection → Explanation → Correction → Verification', () => {
  const cases = {
    A_repeat_familiar: {
      ...healthyInput(),
      attempts: Array.from({ length: 10 }, (_, index) => ({
        questionId: `q-${index % 3}`, nodeId: 'node-a', difficulty: 'MEDIUM',
        correct: true, submittedAt: NOW, firstSeen: index < 3,
      })),
    },
    B_easy_only: {
      ...healthyInput(),
      attempts: Array.from({ length: 12 }, (_, index) => ({
        questionId: `q-${index}`, nodeId: 'node-a', difficulty: 'BASIC',
        correct: true, submittedAt: NOW, firstSeen: true,
      })),
    },
    C_explain_only: {
      ...healthyInput(),
      sessions: { count: 2, totalQuestions: 10, abandonedQuestions: 7 },
    },
    D_practice_without_verification: {
      ...healthyInput(),
      attempts: Array.from({ length: 60 }, (_, index) => ({
        questionId: `q-${index}`, nodeId: 'node-a', difficulty: 'MEDIUM',
        correct: true, submittedAt: NOW, firstSeen: true,
      })),
      verification: { probeEvents: 0, probeExpired: 0, assessments: 0 },
    },
    E_probe_expired: {
      ...healthyInput(),
      verification: { probeEvents: 0, probeExpired: 3, assessments: 0 },
    },
    F_recommendation_failed: {
      ...healthyInput(),
      recommendations: { failures: [{ nodeId: 'node-a', actionType: 'PRACTICE', failures: 2 }] },
    },
    G_mastery_without_transfer: {
      ...healthyInput(),
      verification: { probeEvents: 0, probeExpired: 0, assessments: 1 },
      mastery: { rising: [{ nodeId: 'node-b', attempts: 6 }], withTransferEvidence: [] },
    },
  };

  for (const id of BEHAVIOR_SIGNAL_IDS) {
    const signals = detectBehaviorSignals(cases[id]);
    const signal = signals.find((entry) => entry.id === id);
    assert.ok(signal, `${id} must be detected by its constructed evidence`);
    assert.ok(signal.fact && signal.fact.kind === 'FACT' && signal.fact.text.length > 0, `${id} needs a FACT line`);
    assert.ok(signal.inference && signal.inference.text.length > 0, `${id} needs an explanation`);
    assert.ok(signal.action && signal.action.id && signal.action.section, `${id} needs a real correction action`);
    assert.ok(signal.verification.length > 0, `${id} needs a verification condition`);
    assert.ok(signal.cooldownDays >= 0);
  }
});

test('G1.6: a healthy student triggers nothing (quiet by default)', () => {
  assert.deepEqual(detectBehaviorSignals(healthyInput()), []);
});

test('G1.6: repeated-probe-expiry never counts as a failure', () => {
  const signal = detectBehaviorSignals({
    ...healthyInput(),
    verification: { probeEvents: 0, probeExpired: 4, assessments: 0 },
  }).find((entry) => entry.id === 'E_probe_expired');
  assert.ok(signal);
  assert.equal(signal.evidence.countsAsFailure, false);
  assert.ok(signal.inference.text.includes('不计入失败'));
  assert.equal(signal.priority, 'P2', 'expiry is informational, never P0 pressure');
});

test('G1.6: thresholds are pre-registered constants, not magic numbers', () => {
  assert.equal(BEHAVIOR_THRESHOLDS.repeatRatio, 0.5);
  assert.equal(BEHAVIOR_THRESHOLDS.verifyMinAttempts, 60);
  assert.equal(BEHAVIOR_THRESHOLDS.probeExpiredCount, 3);
  assert.equal(BEHAVIOR_THRESHOLDS.recommendationFailures, 2);
});

// --------------------------------------------------- FIRST USE (G1.3 / §6)

test('G1.3: first-use guidance is quiet, single and derived from existing state', () => {
  const base = {
    onboardingOutstanding: false,
    gradedPracticeCount: 0,
    wrongQuestionCount: 0,
    reviewAttemptCount: 0,
    hasProbeHistory: false,
    probeDeliverable: false,
    paperSessionCount: 0,
  };
  assert.equal(resolveFirstUseGuidance({ facts: base, seen: [] }).featureKey, 'first_practice');
  // Once seen, it never comes back.
  assert.equal(resolveFirstUseGuidance({ facts: base, seen: ['first_practice'] }), null);
  // Muted is silent.
  assert.equal(resolveFirstUseGuidance({ facts: base, seen: [], muted: true }), null);
  // A brand-new user is taught the diagnostic first, not practice.
  assert.equal(
    resolveFirstUseGuidance({ facts: { ...base, onboardingOutstanding: true }, seen: [] }).featureKey,
    'first_diagnostic',
  );
  // Nothing pending -> silence.
  assert.equal(
    resolveFirstUseGuidance({
      facts: { ...base, gradedPracticeCount: 10, wrongQuestionCount: 0, reviewAttemptCount: 3, paperSessionCount: 1 },
      seen: ['first_practice', 'first_mock_exam', 'first_wrong_question', 'first_review'],
    }),
    null,
  );
});

test('G1.3: every HOW guide is actionable and explains why', () => {
  for (const [key, guide] of Object.entries(HOW_GUIDANCE)) {
    assert.equal(guide.featureKey, key);
    assert.ok(guide.why.length > 0, `${key} must explain why`);
    assert.ok(guide.how.length >= 2, `${key} needs checkable steps`);
    assert.ok(guide.after.length > 0, `${key} must say what the system gets`);
  }
});

// ------------------------------------------------------ COOLDOWN (task §16)

test('G1.6: dismissal is honoured for its cooldown and then expires', () => {
  const candidate = { triggerId: 'C_explain_only', priority: 'P0', cooldownDays: cooldownForTrigger('C_explain_only') };
  const dismissed = { ...EMPTY_DELIVERY_STATE, dismissedAt: { C_explain_only: '2026-09-12T08:00:00.000Z' } };
  assert.deepEqual(selectDeliverableGuidance([candidate], dismissed, NOW), [], 'inside cooldown it stays dismissed');
  const later = '2026-09-20T09:00:00.000Z';
  assert.equal(selectDeliverableGuidance([candidate], dismissed, later).length, 1, 'after cooldown it may return');
});

test('G1.6: caps and priority ordering are enforced', () => {
  const candidates = [
    { triggerId: 'P3_info', priority: 'P3', cooldownDays: 1 },
    { triggerId: 'P0_misuse', priority: 'P0', cooldownDays: 1 },
    { triggerId: 'P1_verify', priority: 'P1', cooldownDays: 1 },
  ];
  const picked = selectDeliverableGuidance(candidates, EMPTY_DELIVERY_STATE, NOW);
  assert.equal(picked.length, 1, 'one slot per surface');
  assert.equal(picked[0].triggerId, 'P0_misuse', 'the strongest signal wins the slot');
  // Daily cap wins over the per-surface cap when the day is already full.
  const full = { ...EMPTY_DELIVERY_STATE, shownToday: 3 };
  assert.deepEqual(selectDeliverableGuidance(candidates, full, NOW), []);
});

// ------------------------------------------------- VERIFICATION (G1.4 / §10)

test('G1.4: completing a task without any observation never claims ability', () => {
  const view = describeVerification({ domain: 'task', strength: 'none', attempts: 0, verdict: 'insufficient_data' });
  assert.equal(view.heading, '任务完成');
  assert.ok(view.meaning.some((line) => line.kind === 'INSUFFICIENT_DATA'));
  assert.ok(!view.meaning.some((line) => /学习成功|已经掌握|能力提升/.test(line.text)));
  assert.ok(view.next && view.next.id, 'verification always yields a NEXT');
});

test('G1.4: practice evidence is never equated with transfer', () => {
  const view = describeVerification({
    domain: 'practice', strength: 'strong', attempts: 8, accuracyRate: 75,
    verdict: 'practiced', hasTransferEvidence: false,
  });
  assert.ok(view.meaning.some((line) => line.text.includes('陌生新题')), 'must ask for transfer');
});

test('G1.4: transfer outcomes use the four honest branches', () => {
  const passed = describeVerification({ domain: 'transfer_probe', probeOutcome: 'passed' });
  assert.ok(passed.meaning.some((line) => line.text.includes('迁移证据成立')));
  const failed = describeVerification({ domain: 'transfer_probe', probeOutcome: 'failed' });
  assert.ok(failed.meaning.some((line) => line.text.includes('不是失败')));
  const expired = describeVerification({ domain: 'transfer_probe', probeOutcome: 'expired' });
  assert.ok(expired.meaning.some((line) => line.text.includes('这不是失败')));
  const none = describeVerification({ domain: 'transfer_probe', probeOutcome: 'no_probe_available' });
  assert.ok(none.meaning.some((line) => line.kind === 'INSUFFICIENT_DATA'));
  assert.ok(none.meaning.some((line) => line.text.includes('不会拿旧题冒充')));
});

// ---------------------------------------------------------- NEXT (G1.5 / §11)

test('G1.5: every major state yields a NEXT or an explicit honest no-next', () => {
  const states = [
    { mockJustFinished: true },
    { lastProbeOutcome: 'failed' },
    { lastProbeOutcome: 'passed' },
    { probeDue: true },
    { hasPendingTask: true },
    { reviewDue: 4 },
    { verdict: 'practiced_no_gain' },
    { hasWrongQuestions: true },
    { assessments: 0 },
    {},
  ];
  for (const state of states) {
    const resolution = resolveNextAction({
      hasPendingTask: false, reviewDue: 0, probeDue: false, assessments: 1, probeEvents: 1, ...state,
    });
    assert.ok(resolution.action && resolution.action.id, `no action for ${JSON.stringify(state)}`);
    assert.ok(resolution.reason.length > 0, `no reason for ${JSON.stringify(state)}`);
  }
  const none = resolveNextAction({ hasPendingTask: false, reviewDue: 0, probeDue: false, assessments: 2, probeEvents: 3 });
  assert.equal(none.action.id, NEXT_ACTIONS.none_available.id);
  assert.equal(none.honestNoNext, true);
  assert.ok(none.reason.length > 0, 'the no-next branch must explain itself');
});

test('G1.5: every NEXT target is a real student section', () => {
  const allowed = new Set(['dashboard', 'question', 'wrong-book', 'test', 'knowledge-catalog', 'ai']);
  for (const spec of Object.values(NEXT_ACTIONS)) {
    assert.ok(allowed.has(spec.section), `${spec.id} points at unknown section ${spec.section}`);
    assert.ok(spec.label.length > 0 && spec.reason.length > 0);
  }
});

// ------------------------------------------------- COPY DISCIPLINE (task §19/§20)

test('G1: no guidance copy claims ability from activity or scores from mastery', () => {
  const corpus = [
    ...Object.values(HOW_GUIDANCE).flatMap((guide) => [guide.title, guide.why, guide.after, ...guide.how]),
    ...Object.values(NEXT_ACTIONS).map((spec) => `${spec.label}${spec.reason}`),
    ...LEARNING_CONTRACT.map((line) => line.text),
    ...Object.values(NEXT_ACTIONS).map((spec) => spec.reason),
  ].join('\n');
  for (const banned of ['你已经掌握', '学习成功', '已经学会', '必须学', '预计考', '一定能提高']) {
    assert.ok(!corpus.includes(banned), `banned phrasing leaked into guidance copy: ${banned}`);
  }
});

test('G1: the learning contract states the seven agreed lines with honest kinds', () => {
  assert.equal(LEARNING_CONTRACT.length, 7);
  assert.ok(LEARNING_CONTRACT.some((line) => line.kind === 'UNVERIFIED'));
  assert.ok(LEARNING_CONTRACT.some((line) => line.kind === 'INSUFFICIENT_DATA'));
  for (const line of LEARNING_CONTRACT) {
    assert.ok(line.evidenceHint.length > 0, 'every contract line must be checkable in the product');
  }
});
