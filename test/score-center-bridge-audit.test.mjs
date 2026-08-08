import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBridgeAudit,
  computeResolvableCoverage,
} from '../packages/shared/dist/index.js';

function decision(overrides = {}) {
  return {
    knowledgePointId: 'KP1',
    knowledgePointName: '折半查找',
    subject: 'DS',
    chapter: '查找',
    section: null,
    candidateNodes: [],
    selectedNodeIds: [],
    confidence: null,
    matchMethod: null,
    status: null,
    reasons: ['SAME_SUBJECT'],
    ...overrides,
  };
}

function question(overrides = {}) {
  return { id: 'Q1', knowledgePointIds: [], ...overrides };
}

const FIXED_AT = '2026-08-08T00:00:00.000Z';

test('summary counts classify ACTIVE / PENDING_REVIEW / unmatched accurately', () => {
  const decisions = [
    decision({ knowledgePointId: 'KP1', confidence: 'HIGH', matchMethod: 'EXACT_NAME', status: 'ACTIVE', selectedNodeIds: ['n-a'] }),
    decision({ knowledgePointId: 'KP2', confidence: 'MEDIUM', status: 'PENDING_REVIEW', reasons: ['SAME_SUBJECT', 'MULTIPLE_CANDIDATES'], candidateNodes: [{ knowledgeNodeId: 'n-b', similarity: 1 }, { knowledgeNodeId: 'n-c', similarity: 1 }] }),
    decision({ knowledgePointId: 'KP3', reasons: ['SAME_SUBJECT', 'NO_DETERMINISTIC_EVIDENCE'] }),
    decision({ knowledgePointId: 'KP4', confidence: 'HIGH', matchMethod: 'CONTEXT_MATCH', status: 'ACTIVE', selectedNodeIds: ['n-d', 'n-e'] }),
  ];
  const questions = [
    question({ id: 'Q1', knowledgePointIds: ['KP1'] }),
    question({ id: 'Q2', knowledgePointIds: ['KP2'] }),
    question({ id: 'Q3', knowledgePointIds: ['KP3'] }),
    question({ id: 'Q4', knowledgePointIds: [] }),
    question({ id: 'Q5', knowledgePointIds: ['KP1', 'KP2'] }),
    question({ id: 'Q6', directTagNodeIds: ['n-tag'] }),
    question({ id: 'Q7', knowledgePointIds: ['KP4'] }),
  ];
  const report = buildBridgeAudit(decisions, questions, { generatedAt: FIXED_AT });

  assert.equal(report.summary.knowledgePointTotal, 4);
  assert.equal(report.summary.activeKnowledgePoints, 2);
  assert.equal(report.summary.pendingKnowledgePoints, 1);
  assert.equal(report.summary.unmatchedKnowledgePoints, 1);
  assert.equal(report.summary.activeCoverage, 0.5);
  assert.equal(report.summary.liveQuestionTotal, 7);
  assert.equal(report.summary.resolvableQuestions, 4);
  assert.equal(report.summary.questionResolvableCoverage, 4 / 7);

  assert.equal(report.active.length, 2);
  assert.equal(report.pendingReview.length, 1);
  assert.equal(report.unmatched.length, 1);
  assert.equal(report.oneToMany.length, 2, 'deterministic 1:N and ambiguous multi-candidate both classified');
  assert.equal(report.generatedAt, FIXED_AT);
});

test('coverage is numerically safe for empty inputs', () => {
  assert.deepEqual(computeResolvableCoverage([]), { total: 0, resolvable: 0, coverage: 0 });
  const report = buildBridgeAudit([], [], { generatedAt: FIXED_AT });
  assert.equal(report.summary.activeCoverage, 0);
  assert.equal(report.summary.questionResolvableCoverage, 0);
  assert.equal(Number.isNaN(report.summary.activeCoverage), false);
  assert.equal(Number.isNaN(report.summary.questionResolvableCoverage), false);
});

test('PENDING_REVIEW and LOW decisions never count a question resolvable', () => {
  const decisions = [
    decision({ knowledgePointId: 'KP2', confidence: 'MEDIUM', status: 'PENDING_REVIEW', candidateNodes: [{ knowledgeNodeId: 'n-b', similarity: 1 }] }),
    decision({ knowledgePointId: 'KP3', reasons: ['SAME_SUBJECT', 'NO_DETERMINISTIC_EVIDENCE'] }),
  ];
  const questions = [
    question({ id: 'Q2', knowledgePointIds: ['KP2'] }),
    question({ id: 'Q3', knowledgePointIds: ['KP3'] }),
  ];
  const report = buildBridgeAudit(decisions, questions, { generatedAt: FIXED_AT });
  assert.equal(report.summary.resolvableQuestions, 0);
  assert.equal(report.summary.questionResolvableCoverage, 0);
});

test('direct QuestionKnowledgeNodeTag makes a question resolvable (tag priority)', () => {
  const report = buildBridgeAudit(
    [decision({ knowledgePointId: 'KP1', confidence: 'HIGH', status: 'ACTIVE', selectedNodeIds: ['n-a'] })],
    [
      question({ id: 'Q1', knowledgePointIds: ['KP1'] }),
      question({ id: 'Q6', directTagNodeIds: ['n-tag'] }),
      question({ id: 'Q8', knowledgePointIds: ['KP1'], directTagNodeIds: ['n-tag'] }),
    ],
    { generatedAt: FIXED_AT },
  );
  assert.equal(report.summary.resolvableQuestions, 3);
});

test('inactive target nodes never count as resolvable', () => {
  const decisions = [
    decision({ knowledgePointId: 'KP1', confidence: 'HIGH', matchMethod: 'EXACT_NAME', status: 'ACTIVE', selectedNodeIds: ['n-a'] }),
  ];
  const questions = [question({ id: 'Q1', knowledgePointIds: ['KP1'] })];
  const activeNodeIds = new Set(['n-b']);
  const report = buildBridgeAudit(decisions, questions, { activeNodeIds, generatedAt: FIXED_AT });
  assert.equal(report.summary.resolvableQuestions, 0);

  const tagged = buildBridgeAudit(
    [],
    [question({ id: 'Q6', directTagNodeIds: ['n-tag'] })],
    { activeNodeIds: new Set(['n-other']), generatedAt: FIXED_AT },
  );
  assert.equal(tagged.summary.resolvableQuestions, 0, 'inactive direct tag must not resolve');
});

test('one pending KP does not make a multi-KP question unresolvable', () => {
  const decisions = [
    decision({ knowledgePointId: 'KP1', confidence: 'HIGH', status: 'ACTIVE', selectedNodeIds: ['n-a'] }),
    decision({ knowledgePointId: 'KP2', confidence: 'MEDIUM', status: 'PENDING_REVIEW', candidateNodes: [{ knowledgeNodeId: 'n-b', similarity: 1 }] }),
  ];
  const questions = [question({ id: 'Q5', knowledgePointIds: ['KP1', 'KP2'] })];
  const report = buildBridgeAudit(decisions, questions, { generatedAt: FIXED_AT });
  assert.equal(report.summary.resolvableQuestions, 1);
});

test('questions without any KnowledgePoint relation or tag are unresolvable', () => {
  const report = buildBridgeAudit([], [question({ id: 'Q4', knowledgePointIds: [] })], { generatedAt: FIXED_AT });
  assert.equal(report.summary.resolvableQuestions, 0);
});

test('affectedQuestionCount counts distinct live questions only', () => {
  const decisions = [decision({ knowledgePointId: 'KP1', confidence: 'HIGH', status: 'ACTIVE', selectedNodeIds: ['n-a'] })];
  const questions = [
    question({ id: 'Q1', knowledgePointIds: ['KP1', 'KP1'] }),
    question({ id: 'Q5', knowledgePointIds: ['KP1'] }),
  ];
  const report = buildBridgeAudit(decisions, questions, { generatedAt: FIXED_AT });
  const kp1Entry = report.active.find((entry) => entry.knowledgePointId === 'KP1');
  assert.equal(kp1Entry.affectedQuestionCount, 2, 'duplicate relations within one question count once');
});

test('hotspots are sorted by affectedQuestionCount DESC then knowledgePointId ASC', () => {
  const decisions = [
    decision({ knowledgePointId: 'KP2', confidence: 'MEDIUM', status: 'PENDING_REVIEW', candidateNodes: [{ knowledgeNodeId: 'n-b', similarity: 1 }] }),
    decision({ knowledgePointId: 'KP5', confidence: 'MEDIUM', status: 'PENDING_REVIEW', candidateNodes: [{ knowledgeNodeId: 'n-f', similarity: 1 }] }),
    decision({ knowledgePointId: 'KP9', reasons: ['SAME_SUBJECT', 'NO_DETERMINISTIC_EVIDENCE'] }),
    decision({ knowledgePointId: 'KP1', reasons: ['SAME_SUBJECT', 'NO_DETERMINISTIC_EVIDENCE'] }),
  ];
  const questions = [
    question({ id: 'Q1', knowledgePointIds: ['KP2'] }),
    question({ id: 'Q2', knowledgePointIds: ['KP5'] }),
    question({ id: 'Q3', knowledgePointIds: ['KP5'] }),
    question({ id: 'Q4', knowledgePointIds: ['KP5'] }),
    question({ id: 'Q5', knowledgePointIds: ['KP1', 'KP9'] }),
  ];
  const report = buildBridgeAudit(decisions, questions, { generatedAt: FIXED_AT });
  assert.deepEqual(
    report.pendingReview.map((entry) => entry.knowledgePointId),
    ['KP5', 'KP2'],
    'pending hotspots sorted by affected count desc',
  );
  assert.deepEqual(
    report.unmatched.map((entry) => entry.knowledgePointId),
    ['KP1', 'KP9'],
    'unmatched hotspots sorted by affected count desc then id asc',
  );
});

test('conflict classification consumes the stable CONTEXT_CONFLICT reason', () => {
  const decisions = [
    decision({ knowledgePointId: 'KP1', confidence: 'MEDIUM', status: 'PENDING_REVIEW', reasons: ['SAME_SUBJECT', 'NORMALIZED_NAME_MATCH', 'CONTEXT_CONFLICT'], candidateNodes: [{ knowledgeNodeId: 'n-a', similarity: 1 }] }),
    decision({ knowledgePointId: 'KP2', confidence: 'HIGH', status: 'ACTIVE', selectedNodeIds: ['n-b'] }),
  ];
  const report = buildBridgeAudit(decisions, [], { generatedAt: FIXED_AT });
  assert.deepEqual(report.conflicts.map((entry) => entry.knowledgePointId), ['KP1']);
  assert.equal(report.conflicts[0].decision.status, 'PENDING_REVIEW', 'classification must not upgrade status');
});

test('audit report is deterministic for identical inputs', () => {
  const decisions = [
    decision({ knowledgePointId: 'KP1', confidence: 'HIGH', status: 'ACTIVE', selectedNodeIds: ['n-a'] }),
    decision({ knowledgePointId: 'KP2', confidence: 'MEDIUM', status: 'PENDING_REVIEW', candidateNodes: [{ knowledgeNodeId: 'n-b', similarity: 1 }] }),
  ];
  const questions = [question({ id: 'Q1', knowledgePointIds: ['KP1', 'KP2'] })];
  const one = buildBridgeAudit(decisions, questions, { generatedAt: FIXED_AT });
  const two = buildBridgeAudit(decisions, questions, { generatedAt: FIXED_AT });
  assert.deepEqual(one, two);
});

test('computeResolvableCoverage supports tag and active-fallback resolution', () => {
  const questions = [
    question({ id: 'Q1', directTagNodeIds: ['n-tag'] }),
    question({ id: 'Q2', knowledgePointIds: ['KP1'] }),
    question({ id: 'Q3' }),
  ];
  const byQuestion = new Map([['Q2', new Set(['n-a'])]]);
  assert.deepEqual(computeResolvableCoverage(questions, byQuestion), { total: 3, resolvable: 2, coverage: 2 / 3 });
  assert.deepEqual(computeResolvableCoverage(questions), { total: 3, resolvable: 1, coverage: 1 / 3 });
});
