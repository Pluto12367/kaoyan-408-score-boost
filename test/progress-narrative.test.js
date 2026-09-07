import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// V9 Phase 3 — ProgressStory: coach-voiced week-over-week progress.
// Only comparable deltas get narrated; everything else is no_data.

async function loadModule() {
  const source = await readFile(new URL('../apps/api/src/study/progress-narrative.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(() => {
    throw new Error('progress-narrative must stay dependency-free');
  }, module, module.exports);
  return module.exports;
}

const masterySeries = (thisWeek, lastWeek) => {
  const toPoint = (date, value) => ({ date, averageMastery: value });
  const last = lastWeek.map((value, index) => toPoint(`2026-08-2${index}`, value));
  const current = thisWeek.map((value, index) => toPoint(`2026-09-0${index + 1}`, value));
  return [...last, ...current];
};

test('a rising week narrates a gain with the delta', async () => {
  const { buildProgressStory } = await loadModule();
  const story = buildProgressStory({
    masterySeries: masterySeries([60, 62], [50, 52]),
    accuracyTrend: { status: 'sufficient', value: 0.8, baseline: 0.72 },
    gatesPassed: 1,
    resolvedCount: 4,
    streak: 3,
  });
  const masteryLine = story.lines.find((line) => line.kind === 'gain' || line.kind === 'decline');
  assert.ok(masteryLine, 'comparable halves must narrate');
  assert.match(masteryLine.text, /\+10 点/);
  assert.equal(story.weekDelta, 10);
});

test('a falling week narrates a decline without spin', async () => {
  const { buildProgressStory } = await loadModule();
  const story = buildProgressStory({
    masterySeries: masterySeries([55, 54], [70, 72]),
    accuracyTrend: { status: 'insufficient_data', value: null, baseline: null },
    gatesPassed: 0,
    resolvedCount: 0,
    streak: 0,
  });
  assert.equal(story.weekDelta, -16.5);
  const decline = story.lines.find((line) => line.kind === 'decline');
  assert.match(decline.text, /回落/);
});

test('fewer than two valid values per half stays no_data', async () => {
  const { buildProgressStory } = await loadModule();
  const story = buildProgressStory({
    masterySeries: [60, null, null, null].map((value, index) => ({ date: `2026-09-0${index + 1}`, averageMastery: value })),
    accuracyTrend: { status: 'insufficient_data', value: null, baseline: null },
    gatesPassed: 0,
    resolvedCount: 0,
    streak: 0,
  });
  assert.equal(story.weekDelta, null);
  assert.ok(story.lines.some((line) => line.kind === 'no_data'), 'no baseline → honest no_data line');
});

test('milestones appear only with evidence', async () => {
  const { buildProgressStory } = await loadModule();
  const withEvidence = buildProgressStory({
    masterySeries: masterySeries([60], [50]),
    accuracyTrend: { status: 'insufficient_data', value: null, baseline: null },
    gatesPassed: 2,
    resolvedCount: 5,
    streak: 8,
  });
  const texts = withEvidence.lines.map((line) => line.text).join('\n');
  assert.match(texts, /2 个知识节点通过证据门槛/);
  assert.match(texts, /重做解决 5 道错题/);
  assert.match(texts, /连续学习 8 天/);

  const clean = buildProgressStory({
    masterySeries: [50, null, null, null].map((value, index) => ({ date: `2026-09-0${index + 1}`, averageMastery: value })),
    accuracyTrend: { status: 'insufficient_data', value: null, baseline: null },
    gatesPassed: 0,
    resolvedCount: 0,
    streak: 0,
  });
  assert.equal(clean.lines.length, 1);
  assert.equal(clean.lines[0].kind, 'no_data');
});

test('V9 #P3: narrative endpoint and report card wiring', async () => {
  const controller = await readFile(new URL('../apps/api/src/study/daily-brief.controller.ts', import.meta.url), 'utf8');
  assert.match(controller, /Get\('coach\/progress-narrative'\)/);
  assert.match(controller, /buildProgressStory\(/);
  assert.match(controller, /getMasteryTrend\(userId, 14\)/);

  const card = await readFile(new URL('../apps/web/src/features/report/ProgressStoryCard.tsx', import.meta.url), 'utf8');
  assert.match(card, /coach\/progress-narrative/);
  assert.match(card, /isStaticDemoMode\(\)\) return null/);

  const workspace = await readFile(new URL('../apps/web/src/features/report/ReportWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /<ProgressStoryCard \/>/);
});
