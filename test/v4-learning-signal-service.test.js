/**
 * V4-2 Learning Signal Service integration test (Nest shell).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as realSignalsModule from '../apps/api/dist/adaptive/learning-signals.js';

async function loadService() {
  const path = 'apps/api/src/adaptive/learning-signal.service.ts';
  const input = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(input, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: false },
  }).outputText;
  const module = { exports: {} };
  const stubs = {
    '@nestjs/common': { Injectable: () => (target) => target, Optional: () => () => {}, Logger: class { log() {} warn() {} } },
  };
  Function('require', 'module', 'exports', output)((specifier) => {
    const stubKey = Object.keys(stubs).find((key) => specifier.includes(key));
    if (stubKey) return stubs[stubKey];
    if (specifier.includes('student-context.query.service')) return { StudentContextQueryService: class {} };
    if (specifier.includes('learning-signals')) return realSignalsModule;
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports.LearningSignalService;
}

test('service derives signals through StudentContextQueryService and exposes brief', async () => {
  const Service = await loadService();
  const calls = [];
  const contextFixture = {
    asOf: '2026-09-07T08:00:00.000Z',
    mastery: { weakNodes: [{ knowledgeNodeId: 'n-dl', title: '死锁必要条件', subject: 'OS', mastery: 0.3, attempts: 6, wrongCount: 4 }], improvingPoints: [], masteredPoints: [] },
    practice: { recentAccuracy: { status: 'sufficient', value: 0.4 }, totalCount: 10, latestSubmittedAt: null },
    review: { dueCount: 2, overdueCount: 1, highRiskQuestions: [] },
    plan: { todayTasks: [{ completed: false }, { completed: true }], completion: { rate: { value: 0.2 } } },
    momentum: { studyStreak: 3, isActiveToday: true, recentSessions: [], activityTrend: { value: 4 } },
  };
  const service = new Service({ getContext: async (userId) => { calls.push(userId); return contextFixture; } }, undefined);
  const result = await service.getLearningSignals('u-1', new Date('2026-09-07T08:00:00.000Z'));
  assert.deepEqual(calls, ['u-1']);
  assert.equal(result.userId, 'u-1');
  assert.ok(result.brief.length > 0);
  const accuracy = result.signals.find((s) => s.kind === 'accuracy_trend');
  assert.equal(accuracy.present, true);
  assert.equal(accuracy.severity, 'warning', 'accuracy 0.40 must be warning');
  const overdue = result.signals.find((s) => s.kind === 'review_overdue');
  assert.equal(overdue.severity, 'warning');
});

test('service works without baseline loader (baseline-gated signals degrade)', async () => {
  const Service = await loadService();
  const service = new Service({ getContext: async () => ({ asOf: '2026-09-07T08:00:00.000Z', mastery: { weakNodes: [], improvingPoints: [], masteredPoints: [] } }) }, undefined);
  const result = await service.getLearningSignals('u-1', new Date());
  const regression = result.signals.find((s) => s.kind === 'knowledge_regression');
  assert.equal(regression.present, false);
  assert.equal(regression.evidence.reason, 'no_baseline');
});

test('boundary: signal layer holds no storage and no write primitives', async () => {
  for (const file of ['apps/api/src/adaptive/learning-signals.ts', 'apps/api/src/adaptive/learning-signal.service.ts']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\.create\(|\.update\(|\.delete\(|\.upsert\(/, `${file} must not write`);
    assert.doesNotMatch(source, /INSERT INTO|UPDATE .* SET/i, `${file} must not raw-write`);
  }
});