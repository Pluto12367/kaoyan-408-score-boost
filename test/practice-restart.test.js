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

function makeState(overrides = {}) {
  return {
    answerResult: { id: 'r-1', correct: true, mistakeReason: null, timeSpentSec: 30, expectedTimeSec: 90, analysis: 'a', correctAnswer: 'A', knowledgePointTitle: 'kp' },
    submitting: false,
    reasonQueue: [{ questionId: 'q-1', correct: false, timeSpentSec: 20, isReview: false }],
    redoQuestionId: 'q-1',
    variantOfQuestionId: 'v-1',
    index: 3,
    ...overrides,
  };
}

test('task practice next uses the displayed question id when the stored index is stale', async () => {
  const { advanceQuestionByCurrentId } = await loadAttemptState();
  const next = advanceQuestionByCurrentId(makeState({ index: 0 }), ['q-1', 'q-2', 'q-3'], 'q-2');

  assert.equal(next.answerResult, null);
  assert.deepEqual(next.reasonQueue, []);
  assert.equal(next.redoQuestionId, null);
  assert.equal(next.variantOfQuestionId, null);
  assert.equal(next.index, 2);
});

test('task practice next stays on the final question when the displayed question is already last', async () => {
  const { advanceQuestionByCurrentId } = await loadAttemptState();
  const next = advanceQuestionByCurrentId(makeState({ index: 1 }), ['q-1', 'q-2'], 'q-2');

  assert.equal(next.answerResult, null);
  assert.deepEqual(next.reasonQueue, []);
  assert.equal(next.index, 1);
});

test('task practice next availability uses the displayed question id when the stored index is stale', async () => {
  const { hasNextQuestionByCurrentId } = await loadAttemptState();

  assert.equal(hasNextQuestionByCurrentId(['q-1', 'q-2', 'q-3'], 'q-2', 2), true);
  assert.equal(hasNextQuestionByCurrentId(['q-1', 'q-2', 'q-3'], 'q-3', 0), false);
});

test('App advances today-task practice by current question identity instead of stale index only', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /advanceQuestionByCurrentId,/, 'App should import the identity-based transition');
  assert.match(app, /hasNextQuestionByCurrentId,/, 'App should import the identity-based availability check');
  assert.match(
    app,
    /const activePracticeQuestionIds = activePracticeQuestions\.map\(\(question\) => question\.id\);/,
    'App should derive the currently scoped question id order',
  );
  assert.match(
    app,
    /advanceQuestionByCurrentId\(readPracticeAttemptState\(\), activePracticeQuestionIds, currentQuestion\.id\)/,
    'next-question should advance from the displayed question id',
  );
  assert.match(
    app,
    /hasNextQuestion=\{hasNextActivePracticeQuestion\}/,
    'next button visibility should use the displayed question id instead of stale index only',
  );
});

test('App passes visible question progress into the practice panel', async () => {
  const app = await source('apps/web/src/App.tsx');
  const studentSections = await source('apps/web/src/features/student/StudentSections.tsx');
  const panel = await source('apps/web/src/features/practice/PracticePanel.tsx');

  assert.match(app, /const activePracticeQuestionPosition = activePracticeQuestionIds\.indexOf\(currentQuestion\.id\);/);
  assert.match(app, /currentQuestionProgress=\{\{\s*current: activePracticeQuestionPosition \+ 1,\s*total: activePracticeQuestions\.length,\s*\}\}/);
  assert.match(studentSections, /currentQuestionProgress: \{ current: number; total: number \};/);
  assert.match(studentSections, /questionProgress=\{props\.currentQuestionProgress\}/);
  assert.match(panel, /questionProgress: \{ current: number; total: number \};/);
  assert.match(panel, /第 \{questionProgress\.current\} \/ \{questionProgress\.total\} 题/);
  assert.match(panel, /className="practice-question-progress"/);
});

test('P2-08: restartAttempt resets the attempt and returns to the first question', async () => {
  const { restartAttempt } = await loadAttemptState();
  const next = restartAttempt(makeState());

  assert.equal(next.answerResult, null);
  assert.equal(next.submitting, false);
  assert.deepEqual(next.reasonQueue, []);
  assert.equal(next.redoQuestionId, null);
  assert.equal(next.variantOfQuestionId, null);
  assert.equal(next.index, 0);
});

test('P2-08: App wires 再来一组 and 重新练习本组 through shared attempt state', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /restartAttempt,/, 'App should import the shared restart transition');
  assert.match(app, /applyPracticeAttemptState\(restartAttempt\(readPracticeAttemptState\(\)\)\)/, 'question-bank restart must go through the shared transition');
  assert.match(app, /onRestartPracticeSet=\{handleRestartPracticeSet\}/, 'App should pass the practice-set restart handler');
  assert.match(app, /onRestartQuestionBank=\{handleRestartQuestionBank\}/, 'App should pass the question-bank restart handler');
  assert.match(app, /再来一组：同知识点训练已开始/, 'practice-set restart should have clear status copy');
});

test('P2-08: PracticePanel offers 再来一组 after a set and 重新练习本组 after the bank ends', async () => {
  const panel = await source('apps/web/src/features/practice/PracticePanel.tsx');
  assert.match(panel, /onRestartPracticeSet\?: \(\) => void;/, 'panel should accept the set-restart prop');
  assert.match(panel, /onRestartQuestionBank\?: \(\) => void;/, 'panel should accept the bank-restart prop');
  assert.match(panel, /再来一组（同知识点）/, 'panel should render the same-knowledge-point restart button');
  assert.match(panel, /重新练习本组/, 'panel should render the bank restart button');
});
