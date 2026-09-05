import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { createRecommendationActionKey } = require('../apps/api/src/study/action-creation-key.ts');

test('same generation and target produce a stable action key', () => {
  const input = [
    'LEARNING_LOOP:user-1:2026-09-03:v1',
    'PRACTICE',
    'KNOWLEDGE_NODE',
    'node-1',
  ];

  assert.equal(
    createRecommendationActionKey(...input),
    'ACTION:LEARNING_LOOP:user-1:2026-09-03:v1:PRACTICE:KNOWLEDGE_NODE:node-1',
  );
  assert.equal(createRecommendationActionKey(...input), createRecommendationActionKey(...input));
});

test('different generations isolate action identities', () => {
  const actionForGenerationA = createRecommendationActionKey(
    'LEARNING_LOOP:user-1:2026-09-03:v1',
    'PRACTICE',
    'KNOWLEDGE_NODE',
    'node-1',
  );
  const actionForGenerationB = createRecommendationActionKey(
    'LEARNING_LOOP:user-1:2026-09-04:v1',
    'PRACTICE',
    'KNOWLEDGE_NODE',
    'node-1',
  );

  assert.notEqual(actionForGenerationA, actionForGenerationB);
});

test('action key namespace is distinct from generation key namespaces', () => {
  const actionKey = createRecommendationActionKey(
    'LEARNING_LOOP:user-1:2026-09-03:v1',
    'PRACTICE',
    'KNOWLEDGE_NODE',
    'node-1',
  );

  assert.match(actionKey, /^ACTION:/);
  assert.notEqual(actionKey, 'LEARNING_LOOP:user-1:2026-09-03:v1:PRACTICE:KNOWLEDGE_NODE:node-1');
});

test('action target fields participate in the action identity', () => {
  const base = ['LEARNING_LOOP:user-1:2026-09-03:v1', 'PRACTICE', 'KNOWLEDGE_NODE', 'node-1'];

  assert.notEqual(
    createRecommendationActionKey(...base),
    createRecommendationActionKey(base[0], 'REVIEW', base[2], base[3]),
  );
  assert.notEqual(
    createRecommendationActionKey(...base),
    createRecommendationActionKey(base[0], base[1], 'KNOWLEDGE_POINT', 'point-1'),
  );
  assert.notEqual(
    createRecommendationActionKey(...base),
    createRecommendationActionKey(base[0], base[1], base[2], 'node-2'),
  );
});

test('required action identity inputs reject empty values', () => {
  assert.throws(
    () => createRecommendationActionKey('', 'PRACTICE', 'KNOWLEDGE_NODE', 'node-1'),
    /generationKey/,
  );
  assert.throws(
    () => createRecommendationActionKey('generation-1', 'PRACTICE', 'KNOWLEDGE_NODE', ''),
    /targetId/,
  );
});
