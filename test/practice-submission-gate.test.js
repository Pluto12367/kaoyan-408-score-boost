import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function loadGate() {
  const moduleSource = await source('apps/web/src/features/practice/practiceSubmissionGate.ts');
  const compiled = ts.transpileModule(moduleSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

test('P0 race: 旧响应在重做后失效（invalidate 后不能再写回）', async () => {
  const { createPracticeSubmissionGate, tryStartPracticeSubmission, invalidatePracticeAttempt, isCurrentPracticeSubmission } = await loadGate();
  const gate = createPracticeSubmissionGate();
  const tokenA = tryStartPracticeSubmission(gate);
  assert.ok(tokenA);
  invalidatePracticeAttempt(gate);
  assert.equal(isCurrentPracticeSubmission(gate, tokenA), false);
});

test('P0 race: 旧 finally 不能清除新请求', async () => {
  const { createPracticeSubmissionGate, tryStartPracticeSubmission, invalidatePracticeAttempt, isCurrentPracticeSubmission, finishPracticeSubmission } = await loadGate();
  const gate = createPracticeSubmissionGate();
  const tokenA = tryStartPracticeSubmission(gate);
  invalidatePracticeAttempt(gate);
  const tokenB = tryStartPracticeSubmission(gate);
  assert.ok(tokenB);
  // A 的 finally 尝试释放：必须失败，且不能影响 B
  assert.equal(finishPracticeSubmission(gate, tokenA), false);
  assert.equal(isCurrentPracticeSubmission(gate, tokenB), true);
  // B 自己的 finally 正常释放
  assert.equal(finishPracticeSubmission(gate, tokenB), true);
  assert.equal(isCurrentPracticeSubmission(gate, tokenB), false);
});

test('P0 race: 双击提交被同步阻止', async () => {
  const { createPracticeSubmissionGate, tryStartPracticeSubmission } = await loadGate();
  const gate = createPracticeSubmissionGate();
  const first = tryStartPracticeSubmission(gate);
  assert.ok(first);
  assert.equal(tryStartPracticeSubmission(gate), null);
});

test('P0 race: 重做后允许立即开始新提交', async () => {
  const { createPracticeSubmissionGate, tryStartPracticeSubmission, invalidatePracticeAttempt, isCurrentPracticeSubmission } = await loadGate();
  const gate = createPracticeSubmissionGate();
  const tokenA = tryStartPracticeSubmission(gate);
  invalidatePracticeAttempt(gate);
  const tokenB = tryStartPracticeSubmission(gate);
  assert.ok(tokenB);
  assert.equal(isCurrentPracticeSubmission(gate, tokenB), true);
  assert.equal(isCurrentPracticeSubmission(gate, tokenA), false);
});

test('P0 race: 当前请求正常完成并可写回与释放', async () => {
  const { createPracticeSubmissionGate, tryStartPracticeSubmission, isCurrentPracticeSubmission, finishPracticeSubmission } = await loadGate();
  const gate = createPracticeSubmissionGate();
  const tokenB = tryStartPracticeSubmission(gate);
  assert.equal(isCurrentPracticeSubmission(gate, tokenB), true);
  assert.equal(finishPracticeSubmission(gate, tokenB), true);
  assert.equal(isCurrentPracticeSubmission(gate, tokenB), false);
});

test('P0 race: 切题与变式复测均使旧请求失效（连续 invalidate 幂等）', async () => {
  const { createPracticeSubmissionGate, tryStartPracticeSubmission, invalidatePracticeAttempt, isCurrentPracticeSubmission, finishPracticeSubmission } = await loadGate();
  const gate = createPracticeSubmissionGate();
  const tokenA = tryStartPracticeSubmission(gate);
  invalidatePracticeAttempt(gate); // 模拟切下一题
  assert.equal(isCurrentPracticeSubmission(gate, tokenA), false);
  const tokenB = tryStartPracticeSubmission(gate);
  invalidatePracticeAttempt(gate); // 模拟变式复测
  assert.equal(isCurrentPracticeSubmission(gate, tokenB), false);
  // invalidate 后无新请求时，旧 finally 也不能释放任何东西
  assert.equal(finishPracticeSubmission(gate, tokenB), false);
  assert.equal(gate.activeSubmission, null);
});

test('P0 race 接线: App.tsx 使用 gate 同步占锁并在写回前校验 token', async () => {
  const app = await source('apps/web/src/App.tsx');
  const gateModule = await source('apps/web/src/features/practice/practiceSubmissionGate.ts');
  // 模块导出五个函数（行为由上方用例验证）
  assert.match(gateModule, /export function createPracticeSubmissionGate/);
  assert.match(gateModule, /export function tryStartPracticeSubmission/);
  assert.match(gateModule, /export function invalidatePracticeAttempt/);
  assert.match(gateModule, /export function isCurrentPracticeSubmission/);
  assert.match(gateModule, /export function finishPracticeSubmission/);
  // App.tsx 引用了 gate（松散空白匹配，避免格式敏感）
  assert.match(app, /tryStartPracticeSubmission\(/);
  assert.match(app, /isCurrentPracticeSubmission\(/);
  assert.match(app, /finishPracticeSubmission\(/);
  // 边界处 invalidate：onRedo / onPracticeVariant / handleNextQuestion / 错因弹层关闭
  const invalidateCount = (app.match(/invalidatePracticeAttempt\(/g) ?? []).length;
  assert.ok(invalidateCount >= 4, `expected >=4 invalidatePracticeAttempt call sites, got ${invalidateCount}`);
});

test('P0 race 接线: PracticePanel 选项禁用仍由 submitting || answered 控制', async () => {
  const panel = await source('apps/web/src/features/practice/PracticePanel.tsx');
  assert.match(panel, /disabled=\{submitting \|\| answered\}/);
});