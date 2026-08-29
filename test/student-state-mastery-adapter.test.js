import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('toStudentStateMasteryDto maps mastery summary and weakPoints without report-only fields', () => {
  const { toStudentStateMasteryDto } = require('../apps/api/src/study/mastery-summary-projection.service.ts');

  const result = toStudentStateMasteryDto(projection(), '2026-08-23T09:00:00.000Z');

  assert.deepEqual(result.mastery, {
    source: 'user_knowledge_mastery',
    nodeCount: 3,
    practicedNodeCount: 2,
    averageMastery: 60,
    weakCount: 1,
    reviewCount: 0,
    masteredCount: 1,
    lastUpdatedAt: '2026-08-23T09:00:00.000Z',
  });
  assert.deepEqual(result.weakPoints, [
    {
      knowledgeNodeId: 'node-os-sync',
      subject: '操作系统',
      chapter: '进程管理',
      title: '进程同步',
      masteryRate: 38,
      accuracyRate: 25,
      attempts: 4,
      wrongCount: 3,
    },
  ]);
  assert.equal('weaknessScore' in result.weakPoints[0], false);
  assert.equal('suggestion' in result.weakPoints[0], false);
  assert.equal('topReason' in result.weakPoints[0], false);
});

test('toStudentStateMasteryDto preserves empty projection and null lastUpdatedAt', () => {
  const { toStudentStateMasteryDto } = require('../apps/api/src/study/mastery-summary-projection.service.ts');

  const result = toStudentStateMasteryDto({
    ...projection(),
    source: 'empty',
    nodeCount: 0,
    practicedNodeCount: 0,
    averageMastery: 0,
    weakCount: 0,
    reviewCount: 0,
    masteredCount: 0,
    subjects: [],
    weakPoints: [],
  }, null);

  assert.deepEqual(result, {
    mastery: {
      source: 'empty',
      nodeCount: 0,
      practicedNodeCount: 0,
      averageMastery: 0,
      weakCount: 0,
      reviewCount: 0,
      masteredCount: 0,
      lastUpdatedAt: null,
    },
    weakPoints: [],
  });
});

function projection() {
  return {
    userId: 'u-001',
    generatedAt: '2026-08-24T00:00:00.000Z',
    source: 'user_knowledge_mastery',
    nodeCount: 3,
    practicedNodeCount: 2,
    averageMastery: 60,
    weakCount: 1,
    reviewCount: 0,
    masteredCount: 1,
    subjects: [],
    weakPoints: [
      {
        knowledgeNodeId: 'node-os-sync',
        title: '进程同步',
        subject: '操作系统',
        chapter: '进程管理',
        importance: 5,
        frequency: 4,
        masteryRate: 38,
        accuracyRate: 25,
        practiceCount: 4,
        wrongCount: 3,
        status: 'weak',
        weaknessScore: 62,
        suggestion: '建议回归基础概念，配合真题巩固该节点。',
        topReason: null,
      },
    ],
  };
}
