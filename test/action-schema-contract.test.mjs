import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8');

function modelBody(name) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `model ${name} should exist`);
  return match[1];
}

function hasField(body, name, type) {
  return body.split(/\r?\n/).some((line) => {
    const [field, actualType] = line.trim().split(/\s+/);
    return field === name && actualType === type;
  });
}

test('RecommendationAction schema preserves canonical identity and creation idempotency', () => {
  const body = modelBody('RecommendationAction');
  for (const [name, type] of [
    ['id', 'String'], ['userId', 'String'], ['actionType', 'String'],
    ['targetType', 'String'], ['targetId', 'String'], ['reason', 'String'],
    ['evidenceRefs', 'Json'], ['creationKey', 'String'],
  ]) assert.equal(hasField(body, name, type), true, `${name} should be ${type}`);
  assert.match(body, /status\s+String\s+@default\("CREATED"\)/);
  assert.match(body, /version\s+Int\s+@default\(0\)/);
  assert.match(body, /@@unique\(\[userId, creationKey\]\)/);
});

test('Action attribution fields are nullable and indexed across execution outcomes', () => {
  assert.equal(hasField(modelBody('LearningSession'), 'actionId', 'String?'), true);
  assert.match(modelBody('LearningSession'), /@@index\(\[userId, actionId\]\)/);
  assert.equal(hasField(modelBody('PracticeRecord'), 'actionId', 'String?'), true);
  assert.match(modelBody('PracticeRecord'), /@@index\(\[userId, actionId, submittedAt\]\)/);
  assert.equal(hasField(modelBody('ReviewAttempt'), 'actionId', 'String?'), true);
  assert.equal(hasField(modelBody('ReviewAttempt'), 'idempotencyKey', 'String?'), true);
  assert.match(modelBody('ReviewAttempt'), /@@unique\(\[scheduleId, idempotencyKey\]\)/);
  assert.match(modelBody('ReviewAttempt'), /@@index\(\[actionId, reviewedAt\]\)/);
});

test('StudyTask action link is nullable and unique without changing legacy identity fields', () => {
  assert.equal(hasField(modelBody('RecommendationAction'), 'studyTaskId', 'String?'), true);
  assert.match(modelBody('RecommendationAction'), /studyTaskId\s+String\?\s+@unique/);
  assert.equal(hasField(modelBody('StudyTask'), 'action', 'RecommendationAction?'), true);
  assert.equal(hasField(modelBody('PracticeRecord'), 'knowledgePointId', 'String'), true);
});
