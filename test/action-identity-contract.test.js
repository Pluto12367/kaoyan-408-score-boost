import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../packages/shared/tsconfig.json', import.meta.url));
require('ts-node/register');

test('recommendation action identity keeps action and target identity separate', () => {
  const { isRecommendationActionIdentity } = require('../packages/shared/src/actionContract.ts');
  const action = {
    actionId: 'action-1',
    actionType: 'PRACTICE',
    targetType: 'KNOWLEDGE_NODE',
    targetId: 'node-cache',
    reason: 'LOW_MASTERY',
    evidenceRefs: [{ kind: 'mastery_row', id: 'mastery-1', idType: 'knowledgeNodeId' }],
    sourceRecommendationId: 'recommendation-1',
  };

  assert.equal(isRecommendationActionIdentity(action), true);
  assert.equal(action.actionId, 'action-1');
  assert.equal(action.targetId, 'node-cache');
  assert.notEqual(action.actionId, action.targetId);
});

test('recommendation action identity rejects ambiguous or incomplete target contracts', () => {
  const { isRecommendationActionIdentity } = require('../packages/shared/src/actionContract.ts');
  const base = {
    actionId: 'action-1',
    actionType: 'PRACTICE',
    targetType: 'KNOWLEDGE_POINT',
    targetId: 'point-cache',
    reason: 'LOW_ACCURACY',
    evidenceRefs: [{ kind: 'practice_record', id: 'record-1', idType: 'knowledgePointId' }],
  };

  assert.equal(isRecommendationActionIdentity({ ...base, targetType: 'UNKNOWN' }), false);
  assert.equal(isRecommendationActionIdentity({ ...base, targetId: '' }), false);
  assert.equal(isRecommendationActionIdentity({ ...base, evidenceRefs: [] }), false);
  assert.equal(isRecommendationActionIdentity({ ...base, actionId: 'point-cache' }), false);
});

test('recommendation action identity permits only the minimum current target types', () => {
  const { isRecommendationActionIdentity } = require('../packages/shared/src/actionContract.ts');
  const targetTypes = ['KNOWLEDGE_NODE', 'KNOWLEDGE_POINT', 'QUESTION', 'STUDY_TASK'];
  for (const targetType of targetTypes) {
    assert.equal(isRecommendationActionIdentity({
      actionId: `action-${targetType}`,
      actionType: 'REVIEW',
      targetType,
      targetId: `${targetType.toLowerCase()}-1`,
      reason: 'REVIEW_DUE',
      evidenceRefs: [{ kind: 'review_schedule', id: 'schedule-1' }],
    }), true, `${targetType} should be supported`);
  }
  assert.equal(isRecommendationActionIdentity({
    actionId: 'action-review',
    actionType: 'REVIEW',
    targetType: 'RESOURCE',
    targetId: 'resource-1',
    reason: 'REVIEW_DUE',
    evidenceRefs: [{ kind: 'review_schedule', id: 'schedule-1' }],
  }), false);
});
