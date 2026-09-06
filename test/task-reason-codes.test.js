import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// V8 backlog #58 — structured reason codes for classic 7-day plan tasks.
// Score-center tasks already carry reasonCodes; classic tasks had only free
// text. Read-time derivation must stay honest: only codes backed by real
// aggregates (weakness list, accuracy, wrong counts, exam proximity).

async function loadModule() {
  const source = await readFile(
    new URL('../apps/api/src/study/task-reason-codes.ts', import.meta.url),
    'utf8',
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(() => {
    throw new Error('task-reason-codes must stay dependency-free');
  }, module, module.exports);
  return module.exports;
}

const weakPoints = [
  { knowledgePointId: 'kp-cache', title: 'Cache 映射与替换', accuracyRate: 48, wrongCount: 6 },
  { knowledgePointId: 'kp-sem', title: '信号量', accuracyRate: 61, wrongCount: 1 },
];
const context = { weakPoints, remainingDays: 30 };

test('a weak-point task derives mastery/accuracy/wrong codes by evidence', async () => {
  const { deriveTaskReasonCodes } = await loadModule();
  const codes = deriveTaskReasonCodes({ knowledgePointId: 'kp-cache' }, context);
  assert.deepEqual(codes, ['LOW_MASTERY', 'LOW_ACCURACY', 'REPEATED_WRONG'],
    'EXAM_NEAR is the least task-specific code and is dropped when the cap hits');
});

test('a moderate point keeps LOW_MASTERY (list membership) and adds only exam proximity', async () => {
  const { deriveTaskReasonCodes } = await loadModule();
  const codes = deriveTaskReasonCodes({ knowledgePointId: 'kp-sem' }, context);
  assert.deepEqual(codes, ['LOW_MASTERY', 'EXAM_NEAR'],
    'accuracy 61 is above the low bar, wrongCount 1 below repeated — list membership itself is the LOW_MASTERY evidence');
});

test('tasks on untracked points get no codes far from the exam', async () => {
  const { deriveTaskReasonCodes } = await loadModule();
  assert.deepEqual(
    deriveTaskReasonCodes({ knowledgePointId: 'kp-other' }, { weakPoints, remainingDays: 120 }),
    [],
    'no evidence → no codes, never fabricated ones',
  );
});

test('unknown remaining days suppresses EXAM_NEAR', async () => {
  const { deriveTaskReasonCodes } = await loadModule();
  const codes = deriveTaskReasonCodes(
    { knowledgePointId: 'kp-sem' },
    { weakPoints, remainingDays: null },
  );
  assert.deepEqual(codes, ['LOW_MASTERY']);
});

test('code list is capped at three, highest-signal first', async () => {
  const { deriveTaskReasonCodes } = await loadModule();
  const codes = deriveTaskReasonCodes({ knowledgePointId: 'kp-cache' }, { weakPoints, remainingDays: 30 });
  assert.ok(codes.length <= 3, 'documented cap of 3');
});

test('V8 #41: ai-metrics controller exposes the learning-intelligence snapshot', async () => {
  const controller = await readFile(new URL('../apps/api/src/ai-metrics/ai-metrics.controller.ts', import.meta.url), 'utf8');
  assert.match(controller, /Get\('ai\/learning-intelligence'\)/);
  assert.match(controller, /snapshotLearningIntelligence\(\)/);
  const roles = controller.slice(controller.indexOf('learning-intelligence'));
  assert.match(roles, /@Roles\('admin'\)/, 'learning-intelligence snapshot stays admin-only');
});

test('V8 #29: wrong-row variant action launches variant practice directly', async () => {
  const workspace = await readFile(new URL('../apps/web/src/features/mistakes/MistakeWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /onClick=\{\(\) => onPracticeVariant\?\.\(item\.questionId, item\.questionId\)\}>做同考点变式/);
});
