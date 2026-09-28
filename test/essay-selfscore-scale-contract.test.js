// V14 D-S（Owner 批准 2026-09-27）— 综合题自评刻度按题真实满分。
// 任务书 docs/v14-essay-selfscore-scale-design.md §3。
//
// 钉死：
//   1. 自评输入 max 与展示分母绑定 question.maxScore ?? 10（D-S-1 回退）。
//   2. updateAnswer 不再传常数 10：handleSubjectiveAnswer / handleSelfScore 都传按题满分。
//   3. 自评分超上限被钳制（输入框 max + JS clamp 双保险）。
//   4. maxScore 缺失时显式标注「未定价，按 10 分制」（RULE-06：缺失 ≠ 已定价）。

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('D-S: 自评刻度绑定按题 maxScore，不再硬编码 10', async () => {
  const exam = await source('apps/web/src/components/ExamSession.tsx');

  // 主观题作答与自评写入都走 selfScoreScale(question)（maxScore ?? 10）。
  assert.match(exam, /function selfScoreScale/, 'scale helper must exist');
  assert.match(exam, /question\.maxScore \?\? 10/);
  // 两处写路径不再传常数 10。
  assert.doesNotMatch(exam, /updateAnswer\(([^)]*)\bprevious\?\.selfScore, 10\)/);
  assert.match(exam, /selfScoreScale\(currentQuestion\)/);
  assert.match(exam, /selfScoreScale\(question\)/);
});

test('D-S: 交卷自评输入 min/max/分母动态，超限钳制', async () => {
  const exam = await source('apps/web/src/components/ExamSession.tsx');
  const scoring = exam.slice(exam.indexOf('subjective-scoring'));

  assert.match(scoring, /max=\{selfScoreScale\(question\)\}/);
  assert.match(scoring, /\/ \{selfScoreScale\(question\)\}/);
  // 钳制在 handleSelfScore（全文件范围断言）。
  assert.match(exam, /Math\.min\(Math\.max\(0, score\), selfScoreScale\(question\)\)/, 'handleSelfScore clamps to [0, scale]');
});

test('D-S: 未定价题显式标注回退刻度（RULE-06）', async () => {
  const exam = await source('apps/web/src/components/ExamSession.tsx');
  assert.match(exam, /未定价，按 10 分制/);
  assert.match(exam, /question\.maxScore == null/, 'unpriced branch must test null, not falsy 0');
});
