// V14-R4-C — enhanced data-screen pure-function contracts (task book §3.3,
// R4-C scope): 章节命题图谱 / 命题轨迹 / 难题榜.
//
// Pinned rules:
//   • chapter scores aggregate PRIMARY-tagged ExamQuestion scores by the
//     node-id chapter segment (DS-C02 style), per year — never double-counted
//     through SECONDARY tags
//   • 命题轨迹 = 曾高频（考过 ≥3 年）且近 3 年沉默（lastYear ≤ currentYear−3）
//   • 难题榜 = 全站实测错误率 TOP，样本 <2 次作答 → insufficient_data（不进榜）
//
// RED = functions absent before implementation.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://stub:stub@127.0.0.1:5432/stub';
require('ts-node/register');

const {
  deriveChapterYearScores,
  deriveSilentHighFrequency,
  deriveHardQuestionRanking,
} = require('../apps/api/src/study/real-exam-board.service.ts');

// ---------------------------------------------------------------- 章节命题图谱

test('P0-CH chapter scores aggregate PRIMARY-tag scores by chapter segment and year', () => {
  const rows = [
    { knowledgeNodeId: 'DS-C02-S02-P04', year: 2026, score: 2 },
    { knowledgeNodeId: 'DS-C02-S03-P01', year: 2026, score: 2 },
    { knowledgeNodeId: 'DS-C02-S02-P01', year: 2025, score: 10 },
    { knowledgeNodeId: 'CO-C03-S05-P01', year: 2026, score: 10 },
    { knowledgeNodeId: 'OS-C02-S04-P20', year: 2024, score: 7 },
  ];
  const chapters = deriveChapterYearScores(rows);
  const find = (id) => chapters.find((chapter) => chapter.chapter === id);
  assert.equal(find('DS-C02').years[2026], 4, 'two primary-tagged questions merge into the chapter-year cell');
  assert.equal(find('DS-C02').years[2025], 10);
  assert.equal(find('CO-C03').years[2026], 10);
  assert.equal(find('OS-C02').years[2024], 7);
  assert.equal(find('DS-C02').subject, 'DS');
});

test('P0-CH chapters carry their full year axis (missing years stay 0, no guessing)', () => {
  const rows = [{ knowledgeNodeId: 'DS-C02-S02-P04', year: 2026, score: 2 }];
  const chapters = deriveChapterYearScores(rows, [2025, 2026]);
  const chapter = chapters[0];
  assert.deepEqual(chapter.years, { 2025: 0, 2026: 2 });
});

// ---------------------------------------------------------------- 命题轨迹

test('P0-TR silent high-frequency: ≥3 years tested AND last seen ≤ currentYear−3', () => {
  const rows = [
    { knowledgeNodeId: 'n-hot-silent', yearsTested: 4, totalScore: 30, lastYear: 2022 },
    { knowledgeNodeId: 'n-hot-recent', yearsTested: 5, totalScore: 40, lastYear: 2026 },
    { knowledgeNodeId: 'n-cold-silent', yearsTested: 1, totalScore: 13, lastYear: 2022 },
    { knowledgeNodeId: 'n-edge', yearsTested: 3, totalScore: 20, lastYear: 2023 },
  ];
  const silent = deriveSilentHighFrequency(rows, 2026);
  // 2023 is exactly currentYear−3 → counts as 沉默 (≤ boundary, matches the
  // 任务书 wording 近 3 年沉默 = 最近一次考察在 3 年前或更早)
  assert.deepEqual(silent.map((row) => row.knowledgeNodeId), ['n-hot-silent', 'n-edge']);
});

test('P0-TR empty window → honest empty list (no fabricated trajectory)', () => {
  assert.deepEqual(deriveSilentHighFrequency([{ knowledgeNodeId: 'n', yearsTested: 5, totalScore: 50, lastYear: 2026 }], 2026), []);
});

// ---------------------------------------------------------------- 难题榜

test('P0-HQ hard-question ranking: wrong-rate desc, attempts desc, sample <2 excluded', () => {
  const rows = [
    { questionId: 'q-1-attempt', attempts: 1, wrong: 1 },
    { questionId: 'q-all-wrong-3', attempts: 3, wrong: 3 },
    { questionId: 'q-half-4', attempts: 4, wrong: 2 },
    { questionId: 'q-all-wrong-2', attempts: 2, wrong: 2 },
  ];
  const ranking = deriveHardQuestionRanking(rows);
  assert.deepEqual(
    ranking.map((row) => row.questionId),
    ['q-all-wrong-3', 'q-all-wrong-2', 'q-half-4'],
    'sample <2 excluded; 100% wrong rate first sorted by attempts; then lower rate',
  );
  assert.equal(ranking[0].wrongRatePct, 100);
  assert.equal(ranking[2].wrongRatePct, 50);
});

test('P0-HQ cap at 20 entries', () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({
    questionId: `q-${index}`,
    attempts: 3,
    wrong: index % 2,
  }));
  const ranking = deriveHardQuestionRanking(rows);
  assert.equal(ranking.length, 20);
});
