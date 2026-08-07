import test from 'node:test';
import assert from 'node:assert/strict';
import { composeDailyPlan } from '../packages/shared/dist/index.js';

const candidate = (overrides = {}) => ({
  knowledgePointId: 'KP-1',
  subject: 'DS',
  difficulty: 3,
  mastery: 0.5,
  recentAccuracy: 0.7,
  recentWrongCount: 0,
  forgetting: 0.4,
  retention: 0.6,
  lastReviewedAt: null,
  score: 80,
  reasonCodes: ['HIGH_RECENT_FREQUENCY'],
  prerequisites: [],
  ...overrides,
});

test('prerequisite gate replaces high-level task when prerequisite mastery < .45', () => {
  const plan = composeDailyPlan({
    candidates: [
      candidate({ knowledgePointId: 'KP-H', mastery: 0.6, prerequisites: ['KP-P'], score: 95 }),
      candidate({ knowledgePointId: 'KP-P', mastery: 0.3, score: 50 }),
    ],
    availableMinutes: 60,
    daysToExam: 120,
    prerequisiteMastery: { 'KP-P': 0.3 },
  });
  assert.ok(plan.some((item) => item.knowledgePointId === 'KP-P'), 'prerequisite should enter the plan');
  assert.ok(!plan.some((item) => item.knowledgePointId === 'KP-H'), 'high-level task should be replaced');
  const gap = plan.find((item) => item.knowledgePointId === 'KP-P');
  assert.equal(gap.replacedByPrerequisiteOf, 'KP-H');
  assert.ok(gap.reasonCodes.includes('PREREQUISITE_GAP'));
});

test('120-minute plan covers at least two subjects when candidates allow it', () => {
  const candidates = [
    ...Array.from({ length: 6 }, (_, index) => candidate({
      knowledgePointId: `DS-${index}`,
      subject: 'DS',
      score: 90 - index,
      difficulty: 2,
      mastery: 0.6,
      recentAccuracy: 0.8,
    })),
    candidate({
      knowledgePointId: 'OS-1',
      subject: 'OS',
      score: 84,
      difficulty: 3,
      mastery: 0.5,
      recentAccuracy: 0.7,
    }),
  ];
  const plan = composeDailyPlan({ candidates, availableMinutes: 120, daysToExam: 120 });
  const subjects = new Set(plan.map((item) => candidates.find((c) => c.knowledgePointId === item.knowledgePointId)?.subject));
  assert.ok(subjects.size >= 2, `plan subjects ${[...subjects]} should cover at least two subjects`);
});

test('foundation plan caps new LEARN items at 40 percent', () => {
  const candidates = [
    ...Array.from({ length: 10 }, (_, index) => candidate({
      knowledgePointId: `LEARN-${index}`,
      mastery: 0.3,
      recentAccuracy: 0.5,
      score: 90 - index,
      difficulty: 3,
    })),
    ...Array.from({ length: 3 }, (_, index) => candidate({
      knowledgePointId: `REVIEW-${index}`,
      mastery: 0.7,
      recentAccuracy: 0.9,
      forgetting: 0.7,
      score: 80 - index,
      difficulty: 2,
    })),
  ];
  const plan = composeDailyPlan({ candidates, availableMinutes: 120, daysToExam: 180 });
  const learnCount = plan.filter((item) => item.action === 'LEARN').length;
  assert.ok(learnCount <= Math.ceil(plan.length * 0.4), `LEARN ${learnCount} exceeds cap ${Math.ceil(plan.length * 0.4)}`);
  const totalMinutes = plan.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  assert.ok(totalMinutes <= 120, `plan minutes ${totalMinutes} exceed budget`);
});

test('high-retention recently reviewed item enters cooldown', () => {
  const now = Date.now();
  const cooled = candidate({
    knowledgePointId: 'KP-COOLED',
    mastery: 0.8,
    recentAccuracy: 0.9,
    retention: 0.9,
    lastReviewedAt: new Date(now - 24 * 60 * 60 * 1000),
    score: 90,
  });
  const normal = candidate({
    knowledgePointId: 'KP-NORMAL',
    mastery: 0.8,
    recentAccuracy: 0.9,
    retention: 0.6,
    score: 89,
  });
  const plan = composeDailyPlan({
    candidates: [cooled, normal],
    availableMinutes: 60,
    daysToExam: 120,
  });
  assert.ok(plan.length >= 2, 'both candidates should fit');
  assert.equal(plan[0].knowledgePointId, 'KP-NORMAL', 'cooled item must rank below a normal item');
  const cooledItem = plan.find((item) => item.knowledgePointId === 'KP-COOLED');
  assert.ok(cooledItem.score < cooled.score, 'cooldown must reduce the persisted score');
});

test('plan never exceeds the requested time budget', () => {
  const candidates = Array.from({ length: 12 }, (_, index) => candidate({
    knowledgePointId: `KP-${index}`,
    subject: index % 2 === 0 ? 'DS' : 'CO',
    score: 95 - index,
    difficulty: index % 2 === 0 ? 4 : 2,
  }));
  for (const availableMinutes of [30, 60, 120, 180]) {
    const plan = composeDailyPlan({ candidates, availableMinutes, daysToExam: 120 });
    const totalMinutes = plan.reduce((sum, item) => sum + item.estimatedMinutes, 0);
    assert.ok(totalMinutes <= availableMinutes, `${availableMinutes}min plan used ${totalMinutes}`);
  }
});

test('30 minute plan returns a compact 1-3 task plan', () => {
  const candidates = Array.from({ length: 8 }, (_, index) => candidate({
    knowledgePointId: `KP-${index}`,
    score: 95 - index,
    difficulty: 4,
  }));
  const plan = composeDailyPlan({ candidates, availableMinutes: 30, daysToExam: 120 });
  assert.ok(plan.length >= 1 && plan.length <= 3, `plan length ${plan.length} should be 1-3`);
  const totalMinutes = plan.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  assert.ok(totalMinutes <= 30);
});

test('plan keeps unique knowledge points after prerequisite replacement', () => {
  const plan = composeDailyPlan({
    candidates: [
      candidate({ knowledgePointId: 'KP-A', mastery: 0.6, prerequisites: ['KP-P'], score: 95 }),
      candidate({ knowledgePointId: 'KP-B', mastery: 0.6, prerequisites: ['KP-P'], score: 94 }),
      candidate({ knowledgePointId: 'KP-P', mastery: 0.3, score: 50 }),
    ],
    availableMinutes: 60,
    daysToExam: 120,
    prerequisiteMastery: { 'KP-P': 0.3 },
  });
  const ids = plan.map((item) => item.knowledgePointId);
  assert.equal(new Set(ids).size, ids.length, 'plan must not contain duplicate knowledge points');
});
