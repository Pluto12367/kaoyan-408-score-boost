import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// V11-M2 — Learning Evidence Projection (pure).
//
// Closes audit P1-1: "completing a task produces no capability evidence".
// The projection joins a completed task with the practice/mastery facts on
// its own questions and nodes, then states — honestly — whether capability
// actually changed:
//   - a completion marker alone is never evidence (insufficient_data)
//   - practice after completion on the task's questions + a mastery rise on
//     its nodes → improved (with the numbers attached)
//   - practice without mastery movement → practiced (no improvement claimed)
//   - no practice → insufficient_data
// Pure module: zero imports, deterministic; the service owns all IO.

const EV_URL = new URL('../packages/shared/src/score-center/task-evidence.ts', import.meta.url);

async function loadEvidence() {
  const source = await readFile(EV_URL, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(() => {
    throw new Error('task-evidence must stay dependency-free');
  }, module, module.exports);
  return module.exports;
}

const base = (overrides = {}) => ({
  taskId: 'task-1',
  title: '树与二叉树专题训练',
  completedDate: '2026-09-07',
  nodeIds: ['DS-TREE'],
  attempts: [
    { questionId: 'q-1', submittedAt: '2026-09-07T10:00:00.000Z', correct: true },
    { questionId: 'q-2', submittedAt: '2026-09-07T10:05:00.000Z', correct: true },
  ],
  masteryByNode: {
    'DS-TREE': { atCompletion: 0.45, current: 0.58 },
  },
  asOf: '2026-09-08T00:00:00.000Z',
  ...overrides,
});

test('completed task with rising mastery and correct practice → improved', async () => {
  const { buildTaskEvidence } = await loadEvidence();
  const evidence = buildTaskEvidence(base());
  assert.equal(evidence.completionState, 'completed');
  assert.equal(evidence.verdict, 'improved');
  assert.equal(evidence.practice.attempts, 2);
  assert.equal(evidence.practice.accuracyRate, 100);
  const delta = evidence.masteryDeltas[0];
  assert.equal(delta.nodeId, 'DS-TREE');
  assert.equal(delta.before, 0.45);
  assert.equal(delta.current, 0.58);
  assert.equal(delta.delta, 0.13);
  assert.match(evidence.verdictBasis, /掌握度/);
});

test('completed task with all-wrong practice and no mastery rise → no improvement claimed', async () => {
  const { buildTaskEvidence } = await loadEvidence();
  const evidence = buildTaskEvidence(base({
    attempts: [
      { questionId: 'q-1', submittedAt: '2026-09-07T10:00:00.000Z', correct: false },
      { questionId: 'q-2', submittedAt: '2026-09-07T10:05:00.000Z', correct: false },
    ],
    masteryByNode: { 'DS-TREE': { atCompletion: 0.5, current: 0.48 } },
  }));
  assert.equal(evidence.verdict, 'practiced_no_gain');
  assert.equal(evidence.practice.accuracyRate, 0);
});

test('completed task with no practice on its questions → insufficient_data, stated plainly', async () => {
  const { buildTaskEvidence } = await loadEvidence();
  const evidence = buildTaskEvidence(base({ attempts: [] }));
  assert.equal(evidence.verdict, 'insufficient_data');
  assert.match(evidence.verdictBasis, /完成标记≠能力证据|无练习/);
});

test('uncompleted task → pending, never mistaken for evidence', async () => {
  const { buildTaskEvidence } = await loadEvidence();
  const evidence = buildTaskEvidence(base({ completedDate: null }));
  assert.equal(evidence.completionState, 'pending');
  assert.equal(evidence.verdict, 'insufficient_data');
});

test('mastery missing entirely → deltas are null-based, verdict falls to practice facts', async () => {
  const { buildTaskEvidence } = await loadEvidence();
  const evidence = buildTaskEvidence(base({
    attempts: [
      { questionId: 'q-1', submittedAt: '2026-09-07T10:00:00.000Z', correct: true },
    ],
    masteryByNode: {},
  }));
  assert.equal(evidence.masteryDeltas.length, 0);
  assert.equal(evidence.verdict, 'practiced');
  assert.match(evidence.verdictBasis, /无掌握度快照/);
});

test('mastery rise requires practice evidence too (no rise without doing)', async () => {
  const { buildTaskEvidence } = await loadEvidence();
  const evidence = buildTaskEvidence(base({ attempts: [] }));
  assert.notEqual(evidence.verdict, 'improved', 'mastery movement with zero practice is not claimed as task evidence');
});

test('purity: dependency-free, deterministic', async () => {
  const source = await readFile(EV_URL, 'utf8');
  const imports = [...source.matchAll(/^import\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/gm)].map((match) => match[1]);
  assert.deepEqual(imports, [], 'task-evidence stays dependency-free');
  assert.doesNotMatch(source, /Date\.now|Math\.random/);
});

test('M2 wiring: coach endpoint surfaces recent completed-task evidence', async () => {
  const service = await readFile(new URL('../apps/api/src/study/task-evidence.service.ts', import.meta.url), 'utf8');
  assert.match(service, /studyTaskCompletion\.findMany/);
  assert.match(service, /studyTask\.findMany/);
  assert.match(service, /practiceRecord\.findMany/);
  assert.match(service, /buildTaskEvidence/);
  assert.doesNotMatch(service, /\.create\(|\.update\(|\.delete\(/, 'read-only service');

  const controller = await readFile(new URL('../apps/api/src/study/daily-brief.controller.ts', import.meta.url), 'utf8');
  assert.match(controller, /Get\('coach\/task-evidence'\)/);
  assert.match(controller, /@Roles\('student', 'teacher', 'admin'\)/);

  const moduleSource = await readFile(new URL('../apps/api/src/study/study.module.ts', import.meta.url), 'utf8');
  assert.match(moduleSource, /TaskEvidenceService/);
});
