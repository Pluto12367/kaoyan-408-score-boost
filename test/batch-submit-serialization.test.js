import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// P1.5 regression pin: the three batch submission paths must process answers
// SEQUENTIALLY. Concurrent createPracticeRecord transactions race on the same
// UserKnowledgeMastery row when several questions resolve to one node —
// OCC retry exhaustion → MasteryOptimisticLockConflictError → whole batch 500
// (docs/p15-concurrent-mastery-fix-design.md; reproduced in
// scripts/integration-batch-submit-concurrency.mjs against real PG + HTTP).

const SOURCE = readFileSync(resolve('apps/api/src/study/study.service.ts'), 'utf8');

function methodBody(signature) {
  const start = SOURCE.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const rest = SOURCE.slice(start + signature.length);
  // Method ends at the next member declaration at the same indentation.
  const end = rest.search(/\n {2}(?:async|private|public|protected|get|set) /);
  assert.notEqual(end, -1, `${signature}: next member boundary must exist`);
  return rest.slice(0, end);
}

const BATCH_METHODS = ['async submitPaper(', 'async submitPracticeSet(', 'async submitStageAssessment('];

for (const signature of BATCH_METHODS) {
  test(`${signature} 逐题顺序提交，禁止 Promise.all 并发 createPracticeRecord`, () => {
    const body = methodBody(signature);
    assert.equal(
      /Promise\.all\s*\(\s*answers\.map/.test(body),
      false,
      `${signature} must not fan out answers via Promise.all (OCC exhaustion on same-node questions)`,
    );
    assert.ok(
      body.includes('for (const answer of answers)'),
      `${signature} must iterate answers in submission order`,
    );
    assert.ok(
      body.includes('await this.createPracticeRecord'),
      `${signature} must still create one practice record per answer`,
    );
  });
}

test('会话提交路径保持既有单事务批量 applyAttempts（不在本修复范围，防误改）', () => {
  // The session submit path applies attempts sequentially inside ONE
  // transaction — it never had the defect; pin that it was not "fixed away".
  const applyAttemptsCalls = SOURCE.match(/applyAttempts\(userId, records, tx\)/g) ?? [];
  assert.ok(applyAttemptsCalls.length >= 1, 'session path must keep its single-transaction batch applyAttempts');
});
