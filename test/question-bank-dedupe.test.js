import test from 'node:test';
import assert from 'node:assert/strict';

const { planDedupe, summarizeBank } = await import('../scripts/question-bank-dedupe.mjs');

test('planDedupe keeps the earliest row per duplicate stem and archives the rest', () => {
  const questions = [
    { id: 'q-old', stem: 'Cache 命中率提高后，平均访存时间通常会如何变化？', createdAt: '2026-08-01T00:00:00.000Z', isCurrent: true },
    { id: 'q-new', stem: '  Cache 命中率提高后，平均访存时间通常会如何变化？  ', createdAt: '2026-08-02T00:00:00.000Z', isCurrent: true },
    { id: 'q-single', stem: '进程与程序的主要区别是？', createdAt: '2026-08-01T00:00:00.000Z', isCurrent: true },
  ];
  const actions = planDedupe(questions);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].stem, 'Cache 命中率提高后，平均访存时间通常会如何变化？');
  assert.equal(actions[0].canonicalId, 'q-old');
  assert.deepEqual(actions[0].archiveIds, ['q-new']);
});

test('planDedupe ignores blank stems and single-row stems', () => {
  const actions = planDedupe([
    { id: 'q-a', stem: '', createdAt: '2026-08-01T00:00:00.000Z', isCurrent: true },
    { id: 'q-b', stem: '   ', createdAt: '2026-08-01T00:00:00.000Z', isCurrent: true },
    { id: 'q-c', stem: '唯一题干', createdAt: '2026-08-01T00:00:00.000Z', isCurrent: true },
  ]);
  assert.deepEqual(actions, []);
});

test('summarizeBank reports totals, unique stems and duplicate rows', () => {
  const summary = summarizeBank([
    { id: 'a', stem: '题干一', createdAt: '2026-08-01T00:00:00.000Z', isCurrent: true, _count: { knowledgePoints: 1 } },
    { id: 'b', stem: '题干一', createdAt: '2026-08-02T00:00:00.000Z', isCurrent: true, _count: { knowledgePoints: 1 } },
    { id: 'c', stem: '题干二', createdAt: '2026-08-01T00:00:00.000Z', isCurrent: true, _count: { knowledgePoints: 0 } },
  ]);
  assert.deepEqual(summary, { total: 3, uniqueStems: 2, duplicateStems: 1, duplicateRows: 1, noKp: 1 });
});
