// V14-R4-A — real-exam board/data-screen service contract tests.
//
// Task book: docs/v14-r4-presentation-design.md §3.1/§3.3. Pinned rules:
//   • board slot status = the LATEST PracticeRecord for (user, question);
//     unanswered when none; null stays an honest absence (RULE-06)
//   • novel KP = node whose earliest recorded appearance year == board year
//   • returning KP = node seen in board year whose previous appearance is
//     ≥3 years earlier (沉寂 ≥2 年后回归，与 2026 实测口径一致)
//   • frequency levels by years-tested: ≥10 high / 5-9 mid / 2-4 low / ≤1 cold
//
// RED = module absent before implementation.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://stub:stub@127.0.0.1:5432/stub';
require('ts-node/register');

const {
  deriveBoardSlots,
  deriveNovelReturning,
  deriveFrequencyLevels,
} = require('../apps/api/src/study/real-exam-board.service.ts');

// ---------------------------------------------------------------- board slots

test('P0-BD board slot status follows the LATEST practice record', () => {
  const questions = [
    { id: 'q1', examNo: 1, maxScore: 2 },
    { id: 'q2', examNo: 2, maxScore: 2 },
    { id: 'q3', examNo: 3, maxScore: 13 },
  ];
  const records = [
    { questionId: 'q1', correct: true, submittedAt: '2026-09-01T10:00:00Z' },
    { questionId: 'q1', correct: false, submittedAt: '2026-09-02T10:00:00Z' },
    { questionId: 'q2', correct: true, submittedAt: '2026-09-03T10:00:00Z' },
  ];
  const slots = deriveBoardSlots(questions, records);
  assert.equal(slots.length, 3);
  assert.deepEqual(
    slots.map((slot) => slot.status),
    ['wrong', 'correct', 'unanswered'],
    'latest record wins for q1; q3 has no record',
  );
  assert.equal(slots[2].maxScore, 13);
});

test('P0-BD empty question list stays empty (no fabricated slots)', () => {
  assert.deepEqual(deriveBoardSlots([], [{ questionId: 'x', correct: true }]), []);
});

// ---------------------------------------------------------------- novel / returning

test('P0-BD novel KP: earliest recorded appearance == board year', () => {
  const tagYears = new Map([
    ['node-a', [2022, 2023, 2026]],
    ['node-b', [2026]],
    ['node-c', [2023, 2025]],
  ]);
  const { novel } = deriveNovelReturning(2026, tagYears);
  assert.deepEqual(novel, ['node-b']);
});

test('P0-BD returning KP: previous appearance ≥3 years earlier; gap of 2 is NOT returning', () => {
  const tagYears = new Map([
    ['node-a', [2022, 2026]],   // gap 4 → returning
    ['node-b', [2024, 2026]],   // gap 2 → not returning
    ['node-c', [2023, 2026]],   // gap 3 → returning
  ]);
  const { returning } = deriveNovelReturning(2026, tagYears);
  assert.deepEqual(
    returning.map((row) => row.knowledgeNodeId).sort(),
    ['node-a', 'node-c'],
  );
  assert.deepEqual(returning.find((row) => row.knowledgeNodeId === 'node-c').lastYear, 2023);
});

test('P0-BD earliest year (2022): everything first-seen is novel, nothing returns yet', () => {
  const tagYears = new Map([['node-a', [2022]], ['node-b', [2022, 2023]]]);
  const { novel, returning } = deriveNovelReturning(2022, tagYears);
  assert.deepEqual(novel, ['node-a', 'node-b']);
  assert.deepEqual(returning, []);
});

// ---------------------------------------------------------------- frequency levels

test('P0-BD frequency levels by years-tested: ≥10 high / 5-9 mid / 2-4 low / ≤1 cold', () => {
  const levels = deriveFrequencyLevels([1, 2, 5, 9, 10, 12, 3]);
  assert.deepEqual(levels, { high: 2, mid: 2, low: 2, cold: 1 });
});
