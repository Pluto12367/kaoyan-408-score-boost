import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('score center offers generation when the loaded plan is empty', () => {
  const source = readFileSync('apps/web/src/features/today-score-center/TodaysScoreCenter.tsx', 'utf8');
  assert.match(source, /isEmptyPlan/);
  assert.match(source, /plan\.items\.length === 0/);
  assert.match(source, /生成今日计划/);
  assert.doesNotMatch(source, /共 \{plan\.summary\.totalTasks\} 项 · 建议总时长 \{plan\.summary\.totalMinutes\} 分钟[\s\S]*生成今日计划/);
});
