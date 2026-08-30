import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source = async (path) => readFile(new URL(path, root), 'utf8');

test('ContextualCoachContextAssembler exposes the four context types and stable envelope order', async () => {
  const file = await source('apps/api/src/study/contextual-coach-context-assembler.service.ts');
  const types = await source('apps/api/src/study/contextual-coach.types.ts');
  assert.match(types, /ContextualCoachRequest[\s\S]*contextType: 'question'/);
  assert.match(types, /contextType: 'wrong_question'/);
  assert.match(types, /contextType: 'knowledge_node'/);
  assert.match(types, /contextType: 'assessment'/);
  assert.match(file, /version: 'contextual-coach-v1'/);
  assert.match(file, /version:[\s\S]*context:[\s\S]*student:[\s\S]*focus:[\s\S]*currentTasks[\s\S]*assembledAt/);
  assert.doesNotMatch(file, /\bprisma\b/);
  assert.doesNotMatch(file, /\.(create|update|delete|upsert)\s*\(/);
});

test('context assembly applies bounded slices without exposing the complete student state', async () => {
  const file = await source('apps/api/src/study/contextual-coach-context-assembler.service.ts');
  assert.match(file, /slice\(0, 3\)/);
  assert.match(file, /slice\(0, 5\)/);
  assert.match(file, /slice\(0, 3\)/g);
  assert.match(file, /practiceHistory/);
  assert.match(file, /reviewHistory/);
  assert.match(file, /knowledgeEvidence/);
  assert.doesNotMatch(file, /studentState\s*:\s*\{/);
});

test('context assembly uses user-scoped query services for wrong questions and assessments', async () => {
  const file = await source('apps/api/src/study/contextual-coach-context-assembler.service.ts');
  assert.match(file, /StudentStateProjectionService/);
  assert.match(file, /WrongQuestionProjectionService/);
  assert.match(file, /AssessmentHistoryProjectionService/);
  assert.match(file, /getSnapshot\(userId/);
  assert.match(file, /findQuestionById/);
  assert.match(file, /getKnowledgeDetail/);
});

test('ContextualCoachService does not depend on recommendation or state writes', async () => {
  const file = await source('apps/api/src/study/contextual-coach.service.ts');
  assert.match(file, /contextualCoach\(/);
  assert.match(file, /contextAssembler/);
  assert.match(file, /aiTutorService/);
  assert.doesNotMatch(file, /RecommendationService|generateDailyPlanFromState|runRecommendationForUser/);
  assert.doesNotMatch(file, /\.(create|update|delete|upsert)\s*\(/);
});

test('contextual coach API uses the authenticated user and rejects body userId', async () => {
  const controller = await source('apps/api/src/study/study.controller.ts');
  assert.match(controller, /Post\('ai\/contextual-coach'\)/);
  assert.match(controller, /contextualCoach\(/);
  assert.match(controller, /user\.id/);
  assert.match(controller, /userId.*not.*allowed|userId.*forbidden|userId.*不允许/i);
});
