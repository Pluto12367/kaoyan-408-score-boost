import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('PracticeAnswerResult carries timing fields so the UI can show a speed hint', async () => {
  const source = await readFile(new URL('../apps/web/src/api/endpoints/practice.ts', import.meta.url), 'utf8');
  const resultInterface = source.slice(source.indexOf('export interface PracticeAnswerResult'), source.indexOf('export async function submitPracticeAnswer'));
  assert.match(resultInterface, /timeSpentSec: number;/, 'result should expose elapsed seconds');
  assert.match(resultInterface, /expectedTimeSec: number;/, 'result should expose expected seconds');
});

test('PracticePanel shows 用时偏慢 only for correct-but-slow answers and 本次错因 only for wrong answers', async () => {
  const source = await readFile(new URL('../apps/web/src/features/practice/PracticePanel.tsx', import.meta.url), 'utf8');
  assert.match(source, /isSlowAnswer/, 'PracticePanel should use the shared slow-answer rule');
  assert.match(
    source,
    /!answerResult\.correct && answerResult\.mistakeReason/,
    '本次错因 must only render for wrong answers',
  );
  assert.match(
    source,
    /answerResult\.correct[\s\S]*?isSlowAnswer\(answerResult\.timeSpentSec, answerResult\.expectedTimeSec\)/,
    'correct-but-slow answers should render a speed hint instead of a mistake reason',
  );
  assert.match(source, /用时偏慢/, 'the speed hint copy should be 用时偏慢');
});

test('PracticePanel turns answer feedback into immediate learning actions', async () => {
  const source = await readFile(new URL('../apps/web/src/features/practice/PracticePanel.tsx', import.meta.url), 'utf8');

  assert.match(source, /answer-impact-card/);
  assert.match(source, /本次学习影响/);
  assert.match(source, /知识点/);
  assert.match(source, /提升该知识点掌握度/);
  assert.match(source, /进入错题复盘/);
  assert.match(source, /暴露该知识点薄弱点/);
  assert.match(source, /answer-next-action-card/);
  assert.match(source, /下一步建议/);
  assert.match(source, /继续下一题/);
  assert.match(source, /先看解析/);
  assert.match(source, /task-progress-feedback/);
  assert.match(source, /本题会计入今日任务进度/);
  assert.match(source, /达标后系统会推荐下一步/);
});
