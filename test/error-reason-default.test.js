import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('P1-05: redo-correct retest defaults to 已完成复盘 so submission is not blocked', async () => {
  const source = await readFile(new URL('../apps/web/src/components/ErrorReasonSelector.tsx', import.meta.url), 'utf8');
  assert.match(
    source,
    /useState\(\(\) => \(normalizedInferred \?\? \(correct \? REDO_CORRECT_REASON\.value : ''\)\)\)/,
    'correct redos should pre-select the dedicated completion option',
  );
  assert.match(
    source,
    /\{ value: '已完成复盘', label: '已完成复盘', hint: '重做\/复测通过，无需填写错因' \}/,
    'the completion option should exist',
  );
  assert.match(source, /重做已答对，确认本次复盘结果/, 'heading should match the redo-correct flow');
  assert.match(
    source,
    /disabled=\{!reason \|\| submitting\}/,
    'submit remains gated on a selected reason',
  );
});
