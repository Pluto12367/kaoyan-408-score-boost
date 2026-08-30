import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  buildContextualCoachSystemPrompt,
  buildContextualCoachUserPrompt,
} from '../apps/api/dist/study/contextual-coach.prompt.js';

const context = {
  version: 'contextual-coach-v1',
  context: { type: 'question', id: 'q-1' },
  student: { goal: {}, masterySummary: {}, weakPoints: [] },
  focus: {},
  currentTasks: [],
  assembledAt: '2026-08-30T00:00:00.000Z',
};

test('system prompt states the learning plan and mastery boundaries', () => {
  const prompt = buildContextualCoachSystemPrompt();
  assert.match(prompt, /不能修改学习计划/);
  assert.match(prompt, /不能修改掌握度/);
  assert.match(prompt, /只能解释、提醒和建议/);
  assert.match(prompt, /不是学习系统执行器/);
});

test('system prompt prevents execution claims and constrains suggested actions', () => {
  const prompt = buildContextualCoachSystemPrompt();
  assert.match(prompt, /创建学习任务/);
  assert.match(prompt, /安排复习/);
  assert.match(prompt, /写入系统/);
  assert.match(prompt, /create task/);
  assert.match(prompt, /update plan/);
  assert.match(prompt, /modify mastery/);
  assert.match(prompt, /schedule review/);
  assert.match(prompt, /practice this concept/);
  assert.match(prompt, /review this topic/);
  assert.match(prompt, /check related questions/);
});

test('all four context types remain part of the request contract', async () => {
  const types = await readFile(new URL('../apps/api/src/study/contextual-coach.types.ts', import.meta.url), 'utf8');
  for (const type of ['question', 'wrong_question', 'knowledge_node', 'assessment']) {
    assert.match(types, new RegExp(`contextType: '${type}'`));
    const userPrompt = buildContextualCoachUserPrompt({
      ...context,
      context: { type, id: null },
    }, '请给出建议');
    assert.match(userPrompt, new RegExp(`"type":"${type}"`));
  }
});
