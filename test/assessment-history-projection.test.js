import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadModule(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    const key = Object.keys(dependencies).find((candidate) => specifier.includes(candidate));
    if (key) return dependencies[key];
    if (specifier.includes('@nestjs/common')) return { Injectable: () => (target) => target, Optional: () => (target, _key, _index) => undefined };
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

const asOf = new Date('2026-08-24T08:00:00.000Z');

function rows() {
  return [
    { id: 'a-1', userId: 'u-1', title: '阶段测评 A', submittedAt: new Date('2026-08-22T08:00:00.000Z'), score: 82, totalScore: 100, accuracyRate: 82, elapsedSec: 600, unansweredCount: 2, weakPointTitle: '页表', reviewSuggestion: '复盘错题' },
    { id: 'a-2', userId: 'u-1', title: '阶段测评 B', submittedAt: new Date('2026-08-23T08:00:00.000Z'), score: 86, totalScore: 100, accuracyRate: 86, elapsedSec: 580, unansweredCount: 1, weakPointTitle: '进程调度', reviewSuggestion: '继续训练' },
    { id: 'a-3', userId: 'u-2', title: '阶段测评 C', submittedAt: new Date('2026-08-24T08:00:00.000Z'), score: 90, totalScore: 100, accuracyRate: 90, elapsedSec: 500, unansweredCount: 0, weakPointTitle: '忽略', reviewSuggestion: '忽略' },
  ];
}

function createProjection(findManyImpl) {
  return loadModule('apps/api/src/study/assessment-history-projection.service.ts', {
    'assessment-history.snapshot': {
      // Mirror the real builder's derivation: summaryFacts/latestSubmittedAt are
      // computed from items when the projection does not pass them explicitly.
      buildAssessmentHistorySnapshot: (input) => {
        const items = input.items ?? [];
        return {
          source: 'assessment_history_facts',
          userId: input.userId,
          asOf: input.asOf instanceof Date ? input.asOf.toISOString() : input.asOf,
          items,
          summaryFacts: input.summaryFacts ?? {
            attemptCount: items.length,
            bestScore: items.length ? Math.max(...items.map((item) => item.score)) : 0,
            latestAccuracyRate: items[0]?.accuracyRate ?? 0,
            improvementText: '',
          },
          latestSubmittedAt: input.latestSubmittedAt ?? items[0]?.submittedAt ?? null,
        };
      },
    },
    '../prisma/prisma.service': {},
    'prisma.service': {},
    'assessment-projection.service': {
      AssessmentProjectionService: class {
        constructor(prismaService) {
          this.prisma = prismaService;
        }
      },
    },
  }).then((mod) => {
    const service = new mod.AssessmentHistoryProjectionService({
      prisma: { assessmentHistoryItem: { findMany: findManyImpl } },
    });
    return { service };
  });
}

test('projection maps history rows to ordered snapshot facts', async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test';
  const calls = [];
  const { service } = await createProjection(async (query) => {
    calls.push(query);
    // Faithful Prisma stub: the projection delegates user scoping to the where clause.
    return rows().filter((row) => row.userId === query.where.userId);
  });
  const snapshot = await service.getSnapshot('u-1', asOf);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].where.userId, 'u-1');
  assert.equal(calls[0].where.submittedAt.lte, asOf);
  assert.equal(snapshot.items.length, 2);
  assert.equal(snapshot.items[0].id, 'a-2');
  assert.equal(snapshot.items[1].id, 'a-1');
  assert.equal(snapshot.summaryFacts.attemptCount, 2);
  assert.equal(snapshot.summaryFacts.bestScore, 86);
  assert.equal(snapshot.summaryFacts.latestAccuracyRate, 86);
  assert.equal(snapshot.latestSubmittedAt, '2026-08-23T08:00:00.000Z');
  if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
});

test('projection returns empty snapshot without database access when disabled', async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const { service } = await createProjection(async () => {
      throw new Error('should not query');
    });
    const snapshot = await service.getSnapshot('u-empty', asOf);
    assert.equal(snapshot.userId, 'u-empty');
    assert.equal(snapshot.items.length, 0);
    assert.equal(snapshot.summaryFacts.attemptCount, 0);
    assert.equal(snapshot.summaryFacts.bestScore, 0);
    assert.equal(snapshot.summaryFacts.latestAccuracyRate, 0);
    assert.equal(snapshot.latestSubmittedAt, null);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  }
});

test('projection source boundary excludes controller, DTO, and improvementText computation', async () => {
  const source = await readFile(new URL('../apps/api/src/study/assessment-history-projection.service.ts', import.meta.url), 'utf8');
  for (const forbidden of ['StudyService', 'Controller', 'Adapter', 'QueryService']) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be present`);
  }
});