import test from 'node:test';
import assert from 'node:assert/strict';
import { planQuestionNodeLinks } from '../scripts/link-question-bank-to-nodes.mjs';

test('already tagged questions are skipped and counted as linked', () => {
  const plan = planQuestionNodeLinks({
    questions: [{ id: 'q1', knowledgePointIds: ['ds-list'] }],
    nodeMapByPoint: new Map([['ds-list', 'DS-C02-S01-P01']]),
    taggedQuestionIds: new Set(['q1']),
  });
  assert.equal(plan.toCreate.length, 0);
  assert.equal(plan.linked, 1);
  assert.equal(plan.coverage, 1);
});

test('mapped questions produce PRIMARY bridge tags with a source marker', () => {
  const plan = planQuestionNodeLinks({
    questions: [{ id: 'q2', knowledgePointIds: ['co-cache'] }],
    nodeMapByPoint: new Map([['co-cache', 'CO-C03-S05-P01']]),
    taggedQuestionIds: new Set(),
  });
  assert.equal(plan.toCreate.length, 1);
  const link = plan.toCreate[0];
  assert.equal(link.questionId, 'q2');
  assert.equal(link.knowledgeNodeId, 'CO-C03-S05-P01');
  assert.equal(link.role, 'PRIMARY');
  assert.equal(link.source, 'bridge:knowledge-point-map');
});

test('unmapped questions are reported unresolvable and excluded from coverage', () => {
  const plan = planQuestionNodeLinks({
    questions: [
      { id: 'q2', knowledgePointIds: ['co-cache'] },
      { id: 'q3', knowledgePointIds: ['not-mapped'] },
    ],
    nodeMapByPoint: new Map([['co-cache', 'CO-C03-S05-P01']]),
    taggedQuestionIds: new Set(),
  });
  assert.deepEqual(plan.toCreate.map((link) => link.questionId), ['q2']);
  assert.deepEqual(plan.unresolvable.map((item) => item.questionId), ['q3']);
  assert.equal(plan.linked, 1);
  assert.equal(plan.coverage, 0.5);
});

test('multi-point questions produce one link per mapped node', () => {
  const plan = planQuestionNodeLinks({
    questions: [{ id: 'q4', knowledgePointIds: ['ds-list', 'ds-tree'] }],
    nodeMapByPoint: new Map([
      ['ds-list', 'DS-C02-S01-P01'],
      ['ds-tree', 'DS-C04-S02-P11'],
    ]),
    taggedQuestionIds: new Set(),
  });
  assert.deepEqual(plan.toCreate.map((link) => link.knowledgeNodeId), [
    'DS-C02-S01-P01',
    'DS-C04-S02-P11',
  ]);
  assert.equal(plan.linked, 1);
});
