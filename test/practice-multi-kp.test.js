import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  computeMasteryReport,
  createPracticeRecord,
} from '../packages/shared/dist/learning.js';

test('P2-4: createPracticeRecord snapshots every knowledge point of the question', () => {
  const record = createPracticeRecord({
    userId: 'u-1',
    question: {
      id: 'q-multi',
      stem: '综合考点题',
      options: ['A', 'B', 'C', 'D'],
      answer: 'A',
      analysis: '解析',
      knowledgePointIds: ['os-sync', 'os-memory'],
      difficulty: '中等',
      type: '选择题',
      source: '测试',
      expectedTimeSec: 100,
    },
    selectedAnswer: 'A',
    timeSpentSec: 60,
  });

  assert.deepEqual(record.knowledgePointIds, ['os-sync', 'os-memory']);
});

test('P2-4: a multi-knowledge-point record counts toward every related point', () => {
  const knowledgePoints = [
    { id: 'os-sync', subject: '操作系统', chapter: '进程管理', title: '进程同步', importance: 5, frequency: 5 },
    { id: 'os-memory', subject: '操作系统', chapter: '内存管理', title: '内存分配', importance: 4, frequency: 4 },
  ];
  const report = computeMasteryReport({
    knowledgePoints,
    records: [{
      id: 'r-1',
      userId: 'u-1',
      questionId: 'q-multi',
      knowledgePointId: 'os-sync',
      knowledgePointIds: ['os-sync', 'os-memory'],
      selectedAnswer: 'B',
      correct: false,
      timeSpentSec: 80,
      expectedTimeSec: 90,
      mistakeReason: '概念混淆',
      submittedAt: '2026-08-06',
    }],
    targetScore: 100,
  });

  const sync = report.points.find((point) => point.knowledgePointId === 'os-sync');
  const memory = report.points.find((point) => point.knowledgePointId === 'os-memory');
  assert.equal(sync?.attempts, 1);
  assert.equal(memory?.attempts, 1);
  assert.equal(sync?.wrongCount, 1);
  assert.equal(memory?.wrongCount, 1);
  assert.ok(report.weakPoints.some((point) => point.knowledgePointId === 'os-memory'), 'both points should appear as weak');
});

test('P2-4: schema, migration and repository carry the knowledge-point snapshot', async () => {
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  assert.match(schema, /knowledgePointIds\s+String\[\]\s+@default\(\[\]\)/, 'PracticeRecord should snapshot all knowledge point ids');

  const migration = await readFile(
    new URL('../prisma/migrations/20260806120000_practice_record_knowledge_points/migration.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /ADD COLUMN "knowledgePointIds" TEXT\[\] NOT NULL DEFAULT ARRAY\[\]::TEXT\[\];/, 'migration should add the column with a safe default');

  const repository = await readFile(new URL('../apps/api/src/study/practice-record.repository.ts', import.meta.url), 'utf8');
  assert.match(repository, /knowledgePointIds: record\.knowledgePointIds \?\? \[\],/, 'repository should persist the snapshot');
  assert.match(repository, /knowledgePointIds: record\.knowledgePointIds\.length \? record\.knowledgePointIds : undefined,/, 'repository should read the snapshot back');

  const service = await readFile(new URL('../apps/api/src/study/study.service.ts', import.meta.url), 'utf8');
  assert.match(service, /knowledgePointIds: \[\.\.\.question\.knowledgePointIds\],/, 'buildPracticeRecord should snapshot all question knowledge points');
});
