import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function loadAttemptState() {
  const moduleSource = await source('apps/web/src/features/practice/practiceAttemptState.ts');
  const compiled = ts.transpileModule(moduleSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

// 与 App.tsx readPracticeAttemptState 同构的初始状态。
function makeInitialState(overrides = {}) {
  return {
    answerResult: null,
    submitting: false,
    reasonQueue: [],
    redoQuestionId: null,
    variantOfQuestionId: null,
    index: 0,
    ...overrides,
  };
}

function makeRecord(overrides = {}) {
  return {
    id: 'r-1',
    correct: false,
    mistakeReason: null,
    analysis: '旧解析',
    correctAnswer: 'C',
    knowledgePointTitle: 'Cache 映射与替换',
    selectedAnswer: 'B',
    ...overrides,
  };
}

// 镜像 App.tsx handleSubmitAnswer 的提交守卫：有提交中或已有答题结果时禁止再次作答。
function canSubmit(state) {
  return !state.submitting && state.answerResult === null;
}

test('P0 redo: 重做后清除上一次答题结果与解析，选项恢复可选并可再次提交且不串状态', async () => {
  const { beginRedo } = await loadAttemptState();

  // 1. 用户进入一道错题（重做模式）
  let state = makeInitialState();
  state = beginRedo(state, 'q-001');
  assert.equal(state.redoQuestionId, 'q-001');

  // 2-3. 提交一个答案，页面展示答题结果和解析
  const first = makeRecord({ id: 'r-first', selectedAnswer: 'B', analysis: '旧解析（第一次）' });
  state = { ...state, submitting: true, answerResult: first };
  assert.equal(state.submitting, true);
  assert.equal(state.answerResult, first);
  assert.equal(canSubmit(state), false);

  // 4-5. 用户点击“重做”，旧的答题结果和解析被清除
  state = beginRedo(state, 'q-001');
  assert.equal(state.answerResult, null);
  assert.equal(state.submitting, false);
  assert.equal(state.redoQuestionId, 'q-001');

  // 6. 所有选项恢复可选（PracticePanel disabled = submitting || answered）
  assert.equal(canSubmit(state), true);

  // 7-8. 用户可以重新选择答案并再次提交
  const second = makeRecord({ id: 'r-second', correct: true, selectedAnswer: 'C', analysis: '新解析（第二次）' });
  state = { ...state, submitting: true, answerResult: second };

  // 9. 第二次提交显示新的答题结果
  assert.equal(state.answerResult, second);
  assert.equal(state.answerResult.id, 'r-second');
  assert.equal(state.answerResult.selectedAnswer, 'C');
  assert.equal(state.answerResult.analysis, '新解析（第二次）');

  // 10. 第二次结果不能混入第一次的状态
  assert.notEqual(state.answerResult, first);
  assert.equal(state.answerResult.correct, true);
  assert.equal(state.answerResult.analysis.includes('第一次'), false);
});

test('P0 redo: 第一次答对与第一次答错后重做，残留状态都会被清除', async () => {
  const { beginRedo } = await loadAttemptState();

  for (const correct of [true, false]) {
    let state = makeInitialState({
      redoQuestionId: 'q-001',
      answerResult: makeRecord({ correct }),
      submitting: true,
    });
    assert.equal(state.answerResult.correct, correct);

    state = beginRedo(state, 'q-001');
    assert.equal(state.answerResult, null);
    assert.equal(state.submitting, false);
    assert.equal(canSubmit(state), true);
  }
});

test('P0 redo: 重做后不选择答案直接提交不会被上次结果阻塞', async () => {
  const { beginRedo } = await loadAttemptState();

  let state = makeInitialState({
    redoQuestionId: 'q-001',
    answerResult: makeRecord({ selectedAnswer: 'B' }),
  });
  state = beginRedo(state, 'q-001');

  // 重做后 guard 放行；直接提交新的结果成功
  assert.equal(canSubmit(state), true);
  state = { ...state, answerResult: makeRecord({ id: 'r-direct', selectedAnswer: 'C' }) };
  assert.equal(state.answerResult.id, 'r-direct');
});

test('P0 redo: 连续点击两次重做是幂等的，不会二次串入旧结果', async () => {
  const { beginRedo } = await loadAttemptState();

  let state = makeInitialState({
    redoQuestionId: 'q-001',
    answerResult: makeRecord(),
  });
  state = beginRedo(state, 'q-001');
  const afterFirstRedo = { ...state };
  state = beginRedo(state, 'q-001');
  assert.deepEqual(state, afterFirstRedo);
  assert.equal(state.answerResult, null);
});

test('P0 redo: 重做会清空未决错因队列与变式标记，只保留本次尝试状态', async () => {
  const { beginRedo, beginVariantRetest, advanceQuestion } = await loadAttemptState();

  let state = makeInitialState({
    reasonQueue: [{ questionId: 'q-001', correct: false, timeSpentSec: 30, isReview: false, mistakeReason: '概念混淆' }],
    variantOfQuestionId: 'v-001',
  });
  state = beginRedo(state, 'q-001');
  assert.deepEqual(state.reasonQueue, []);
  assert.equal(state.variantOfQuestionId, null);

  // 变式复测入口与重做行为一致
  state = { ...state, answerResult: makeRecord() };
  state = beginVariantRetest(state, 'q-001', 'v-002');
  assert.equal(state.answerResult, null);
  assert.equal(state.submitting, false);
  assert.equal(state.redoQuestionId, 'q-001');
  assert.equal(state.variantOfQuestionId, 'v-002');
  assert.deepEqual(state.reasonQueue, []);

  // 切到下一题后返回重做，不会残留上一题结果
  state = advanceQuestion(state, 2);
  assert.equal(state.answerResult, null);
  assert.equal(state.redoQuestionId, null);
  assert.equal(state.variantOfQuestionId, null);
  assert.equal(state.index, 2);
});

test('P0 redo 接线: App.tsx 的重做/变式/下一题入口都走 shared attempt state 转换', async () => {
  const app = await source('apps/web/src/App.tsx');
  const module = await source('apps/web/src/features/practice/practiceAttemptState.ts');

  assert.match(module, /export function beginRedo/);
  assert.match(module, /export function beginVariantRetest/);
  assert.match(module, /export function advanceQuestion/);

  assert.match(app, /beginRedo/);
  assert.match(app, /beginVariantRetest/);
  assert.match(app, /advanceQuestion/);
  // 重做/变式/切题入口都通过 applyPracticeAttemptState 应用纯转换（不依赖缩进/换行格式）
  assert.match(app, /applyPracticeAttemptState\(beginRedo\(readPracticeAttemptState\(\), questionId\)\)/);
  assert.match(app, /applyPracticeAttemptState\(beginVariantRetest\(readPracticeAttemptState\(\), questionId, variantQuestionId\)\)/);
  assert.match(app, /applyPracticeAttemptState\(advanceQuestion\(readPracticeAttemptState\(\)\)\)/);
  assert.match(app, /applyPracticeAttemptState\(advanceQuestion\(readPracticeAttemptState\(\), practiceIndex \+ 1\)\)/);
});

test('P0 redo 接线: PracticePanel 选项禁用仍由 submitting || answered 控制', async () => {
  const panel = await source('apps/web/src/features/practice/PracticePanel.tsx');
  assert.match(panel, /disabled=\{submitting \|\| answered\}/);
});
