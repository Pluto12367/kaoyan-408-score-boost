import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadNodeMastery() {
  const source = await readFile(new URL('../packages/shared/src/nodeMastery.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('deriveNodeQuestStatus maps mastery and quest milestones to node quest states', async () => {
  const { deriveNodeQuestStatus, QUEST_STATUS_LABELS } = await loadNodeMastery();
  assert.equal(deriveNodeQuestStatus({ masteryAttempts: 0, questAttempts: 0, questPassed: false }), 'not_started');
  assert.equal(deriveNodeQuestStatus({ masteryAttempts: 3, questAttempts: 0, questPassed: false }), 'in_progress');
  assert.equal(deriveNodeQuestStatus({ masteryAttempts: 0, questAttempts: 1, questPassed: false }), 'in_progress');
  assert.equal(deriveNodeQuestStatus({ masteryAttempts: 3, questAttempts: 2, questPassed: true }), 'passed');
  assert.equal(QUEST_STATUS_LABELS.not_started, '未开始');
  assert.equal(QUEST_STATUS_LABELS.in_progress, '进行中');
  assert.equal(QUEST_STATUS_LABELS.passed, '已通关');
});

test('QUEST_PASS_THRESHOLD is 60 percent', async () => {
  const { QUEST_PASS_THRESHOLD } = await loadNodeMastery();
  assert.equal(QUEST_PASS_THRESHOLD, 60);
});
