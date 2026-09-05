/**
 * V4-9 Adaptive Exam Simulation tests — strategy modes and progression.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStrategyExam } from '../apps/api/dist/adaptive/adaptive-exam.js';

function question(overrides = {}) {
  return {
    id: `q-${Math.random().toString(36).slice(2, 8)}`,
    stem: '题目', type: 'SINGLE_CHOICE', difficulty: 'MEDIUM',
    knowledgePointIds: ['p1'], subject: 'OS',
    ...overrides,
  };
}

const BANK = [
  question({ id: 'b1', difficulty: 'BASIC', knowledgePointIds: ['pv'] }),
  question({ id: 'b2', difficulty: 'BASIC', knowledgePointIds: ['pv'] }),
  question({ id: 'm1', difficulty: 'MEDIUM', knowledgePointIds: ['pv'] }),
  question({ id: 'm2', difficulty: 'MEDIUM', knowledgePointIds: ['pv'] }),
  question({ id: 'h1', difficulty: 'HARD', knowledgePointIds: ['pv'] }),
  question({ id: 'c1', difficulty: 'MEDIUM', knowledgePointIds: ['cn'] , subject: 'CN' }),
];

test('topic drill: single-point scope with BASIC-first progression', () => {
  const paper = buildStrategyExam({
    candidates: BANK,
    mode: 'topic_drill',
    questionCount: 4,
    scopePointIds: ['pv'],
  });
  assert.equal(paper.mode, 'topic_drill');
  assert.equal(paper.questions.length, 4);
  const difficulties = paper.difficultyProgression;
  // BASIC wave (2) precedes HARD-only leftovers ascending into HARD
  assert.equal(difficulties.filter((d) => d === 'BASIC').length, 2);
  if (difficulties.includes('HARD')) {
    assert.ok(difficulties.indexOf('BASIC') < difficulties.indexOf('HARD'), 'BASIC warms up before HARD');
  }
});

test('chapter test: 5-question mix follows mode shares (30/45/25 rounding)', () => {
  const bank = [
    question({ id: 'c-b1', difficulty: 'BASIC' }),
    question({ id: 'c-b2', difficulty: 'BASIC' }),
    question({ id: 'c-m1', difficulty: 'MEDIUM' }),
    question({ id: 'c-m2', difficulty: 'MEDIUM' }),
    question({ id: 'c-h1', difficulty: 'HARD' }),
  ];
  const paper = buildStrategyExam({ candidates: bank, mode: 'chapter_test', questionCount: 4 });
  assert.equal(paper.questions.length, 4);
  // chapter_test shares: BASIC 30% → 1, MEDIUM 45% → 2, HARD → remainder
  const counts = paper.difficultyProgression.reduce((map, difficulty) => {
    map[difficulty] = (map[difficulty] ?? 0) + 1;
    return map;
  }, {});
  assert.ok(counts.BASIC >= 1);
  assert.ok((counts.MEDIUM ?? 0) >= (counts.BASIC ?? 0) - 1);
});

test('comprehensive: subject filter keeps the paper scoped', () => {
  const paper = buildStrategyExam({ candidates: BANK.concat([question({ id: 'cn-1', subject: 'CN' })]), mode: 'comprehensive', questionCount: 4, subject: 'OS' });
  assert.ok(paper.questions.every((question) => question.subject === 'OS'));
});

test('mock exam: 30% HARD target produces harder tails on a large bank', () => {
  const bigBank = [];
  for (let i = 0; i < 10; i++) bigBank.push(question({ id: `basic-${i}`, difficulty: 'BASIC', knowledgePointIds: [`pb-${i}`] }));
  for (let i = 0; i < 10; i++) bigBank.push(question({ id: `med-${i}`, difficulty: 'MEDIUM', knowledgePointIds: [`pm-${i}`] }));
  for (let i = 0; i < 10; i++) bigBank.push(question({ id: `hard-${i}`, difficulty: 'HARD', knowledgePointIds: [`ph-${i}`] }));
  const paper = buildStrategyExam({ candidates: bigBank, mode: 'mock_exam', questionCount: 10 });
  assert.equal(paper.questions.length, 10);
  const counts = paper.difficultyProgression.reduce((map, difficulty) => {
    map[difficulty] = (map[difficulty] ?? 0) + 1;
    return map;
  }, {});
  assert.equal(counts.BASIC, 2, '20% BASIC');
  assert.equal(counts.MEDIUM, 5, '50% MEDIUM');
  assert.equal(counts.HARD, 3, '30% HARD');
  // progression: BASIC wave first, HARD wave last
  assert.equal(paper.difficultyProgression[0], 'BASIC');
  assert.equal(paper.difficultyProgression.at(-1), 'HARD');
});

test('topic drill: falls back to any difficulty when the bucket runs dry', () => {
  const paper = buildStrategyExam({
    candidates: [question({ id: 'only-basic', difficulty: 'BASIC', knowledgePointIds: ['pv'] })],
    mode: 'topic_drill',
    questionCount: 3,
  });
  assert.equal(paper.questions.length, 1, 'only 1 candidate exists; shortfall cannot fabricate');
});