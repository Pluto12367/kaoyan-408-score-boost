import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePriority } from '../packages/shared/dist/index.js';

const hot = {
  knowledgePointId: 'CN-C05-S03-P01',
  importance: 5,
  difficulty: 4,
  recent3Y: { frequency: 5 },
  recent5Y: { frequency: 5, primaryCount: 4, secondaryCount: 2, primaryScore: 12 },
  allTimeEvidence: { frequency: 5 },
  trend: { direction: 'RISING', delta: 0.6 },
  evidenceConfidence: 'HIGH',
};

const low = {
  knowledgePointId: 'CO-C01-S01-P01',
  importance: 2,
  difficulty: 5,
  recent3Y: { frequency: 1 },
  recent5Y: { frequency: 1, primaryCount: 0, secondaryCount: 0, primaryScore: 0 },
  allTimeEvidence: { frequency: 1 },
  trend: { direction: 'FALLING', delta: -0.4 },
  evidenceConfidence: 'LOW',
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

test('lower mastery never lowers priority', () => {
  const weak = calculatePriority(hot, weakUser, { daysToExam: 120 });
  const strong = calculatePriority(hot, { ...strongUser, mastery: 0.8, retention: 0.9 }, { daysToExam: 120 });
  assert.ok(weak.score >= strong.score, 'weaker mastery must not lower priority');
});

test('lower retention never lowers priority', () => {
  const lowRetention = calculatePriority(hot, { ...strongUser, retention: 0.3 }, { daysToExam: 120 });
  const highRetention = calculatePriority(hot, { ...strongUser, retention: 0.9 }, { daysToExam: 120 });
  assert.ok(lowRetention.score >= highRetention.score, 'lower retention must not lower priority');
});

test('score is always 0..100', () => {
  const extreme = calculatePriority(
    { ...hot, recent3Y: { frequency: 5 }, recent5Y: { frequency: 5, primaryScore: 45 } },
    { ...weakUser, mastery: 0, recentAccuracy: 0, wrongCount: 100, retention: 0 },
    { daysToExam: 5 },
  );
  const gentle = calculatePriority(
    { ...low, recent3Y: { frequency: 1 }, recent5Y: { frequency: 1, primaryScore: 0 } },
    { ...strongUser, mastery: 1, recentAccuracy: 1, wrongCount: 0, retention: 1 },
    { daysToExam: 400 },
  );
  assert.ok(extreme.score >= 0 && extreme.score <= 100, `extreme score ${extreme.score}`);
  assert.ok(gentle.score >= 0 && gentle.score <= 100, `gentle score ${gentle.score}`);
});

test('near exam increases the relative value of a recent high-frequency point', () => {
  const gapAt300 = calculatePriority(hot, weakUser, { daysToExam: 300 }).score
    - calculatePriority(low, strongUser, { daysToExam: 300 }).score;
  const gapAt30 = calculatePriority(hot, weakUser, { daysToExam: 30 }).score
    - calculatePriority(low, strongUser, { daysToExam: 30 }).score;
  assert.ok(gapAt30 > gapAt300, `sprint gap ${gapAt30} should exceed foundation gap ${gapAt300}`);
});

test('low-frequency hard point cannot outrank high-frequency weak point in sprint', () => {
  const hotWeak = calculatePriority(hot, weakUser, { daysToExam: 30 });
  const lowStrong = calculatePriority(low, strongUser, { daysToExam: 30 });
  assert.ok(hotWeak.score > lowStrong.score, `${hotWeak.score} should beat ${lowStrong.score}`);
});

test('deterministic reason codes fire on threshold conditions', () => {
  const result = calculatePriority(hot, weakUser, { daysToExam: 30 });
  assert.ok(result.reasons.includes('HIGH_RECENT_FREQUENCY'));
  assert.ok(result.reasons.includes('LOW_MASTERY'));
  assert.ok(result.reasons.includes('REPEATED_WRONG'));
  assert.ok(result.reasons.includes('REVIEW_DUE'));
  assert.ok(result.reasons.includes('RISING_TREND'));
  assert.ok(result.reasons.includes('EXAM_NEAR'));
});

test('G1.1 (was: at least two reasons): reasons are never fabricated to pad the list', () => {
  // This assertion previously encoded the defect fixed by G1.1 / owner decision
  // A1: `reasons` used to be padded to a minimum of two from a generic pool,
  // which let the UI print causes that had never been observed. The contract is
  // now "1 real reason > 2 real + fabricated", so the count is no longer forced.
  for (const user of [undefined, weakUser, strongUser]) {
    for (const daysToExam of [10, 60, 200]) {
      const result = calculatePriority(hot, user, { daysToExam });
      // Description parity: every fired code has a detail with a real basis.
      assert.deepEqual(
        result.reasonDetails.map((detail) => detail.code),
        result.reasons,
        `reasonDetails must describe exactly the fired reasons (days ${daysToExam})`,
      );
      for (const detail of result.reasonDetails) {
        assert.ok(detail.basis && detail.basis.length > 0, 'each reason carries a checkable basis');
      }
      // Fabricated codes never enter `reasons`.
      for (const code of result.fallbackReasons) {
        assert.ok(!result.reasons.includes(code), `${code} was padding and must not be presented as a reason`);
      }
      for (const key of ['examValue', 'weakness', 'forgetting', 'difficulty', 'trend', 'pinned']) {
        assert.ok(Number.isFinite(result.breakdown[key]), `breakdown.${key} must be finite`);
      }
    }
  }
});

test('missing user state uses neutral defaults, not failure', () => {
  const result = calculatePriority(low, undefined, { daysToExam: 200 });
  assert.ok(result.score >= 0 && result.score <= 100);
});
