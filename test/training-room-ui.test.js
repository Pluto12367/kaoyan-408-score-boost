import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function loadViewModel() {
  const moduleSource = await source('apps/web/src/features/practice/training-room/trainingRoomViewModel.ts');
  const compiled = ts.transpileModule(moduleSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

test('training hero uses the existing training context without hardcoded totals', async () => {
  const { buildTrainingRoomViewModel } = await loadViewModel();
  const model = buildTrainingRoomViewModel({
    source: 'today_task',
    title: '树的遍历专项训练',
    target: '二叉树',
    estimatedMinutes: 18,
    questionProgress: { current: 3, total: 7 },
  });

  assert.deepEqual(model, {
    title: '树的遍历专项训练',
    source: 'today_task',
    sourceLabel: '今日任务',
    target: '二叉树',
    estimatedMinutes: 18,
    progress: { current: 3, total: 7, percent: 43 },
    result: null,
  });
});

test('session progress is adapted from existing session fields', async () => {
  const { buildTrainingRoomViewModel } = await loadViewModel();
  const model = buildTrainingRoomViewModel({
    source: 'practice_set',
    title: '操作系统专项练习',
    target: '进程同步',
    sessionProgress: { currentIndex: 4, totalQuestions: 12 },
  });

  assert.deepEqual(model.progress, { current: 5, total: 12, percent: 42 });
});

test('missing context stays explicit and does not invent a question count', async () => {
  const { buildTrainingRoomViewModel } = await loadViewModel();
  const model = buildTrainingRoomViewModel({ source: 'question_bank' });

  assert.equal(model.title, '训练空间');
  assert.equal(model.target, '暂无数据');
  assert.equal(model.estimatedMinutes, null);
  assert.equal(model.progress, null);
});

test('summary passes through server result fields without recalculating mastery or accuracy', async () => {
  const { buildTrainingRoomViewModel } = await loadViewModel();
  const result = {
    completed: true,
    totalQuestions: 10,
    correctCount: 8,
    accuracyRate: 80,
    nextActions: ['复盘进程同步错题'],
  };
  const model = buildTrainingRoomViewModel({ source: 'stage_assessment', result });

  assert.deepEqual(model.result, result);
  assert.equal(Object.prototype.hasOwnProperty.call(model, 'mastery'), false);
});

test('training room composition preserves existing submit, navigation, feedback and session flows', async () => {
  const studentSections = await source('apps/web/src/features/student/StudentSections.tsx');
  const app = await source('apps/web/src/App.tsx');
  const practicePanel = await source('apps/web/src/features/practice/PracticePanel.tsx');
  const examSession = await source('apps/web/src/components/ExamSession.tsx');

  assert.match(studentSections, /TrainingHero/);
  assert.match(studentSections, /TrainingProgress/);
  assert.match(studentSections, /TrainingSummary/);
  assert.match(studentSections, /onSubmitAnswer=\{props\.onSubmitAnswer\}/);
  assert.match(studentSections, /onNextQuestion=\{props\.onNextQuestion\}/);
  assert.match(studentSections, /onNavigate=\{props\.onNavigate\}/);
  assert.match(app, /<ExamSession/);
  assert.match(app, /onExit=\{\(\) =>/);
  assert.match(app, /onSubmit=\{\(result\) =>/);
  assert.match(practicePanel, /onSubmitAnswer/);
  assert.match(examSession, /submitSession/);
  assert.match(examSession, /onSubmit\(result\)/);
});

test('training room presentation adds no API or learning-state write path', async () => {
  const files = [
    'apps/web/src/features/practice/training-room/trainingRoomViewModel.ts',
    'apps/web/src/features/practice/training-room/TrainingHero.tsx',
    'apps/web/src/features/practice/training-room/TrainingProgress.tsx',
    'apps/web/src/features/practice/training-room/TrainingSummary.tsx',
  ];
  const contents = await Promise.all(files.map(source));
  const combined = contents.join('\n');

  assert.doesNotMatch(combined, /fetchWithAuth|submitPracticeAnswer|submitPracticeSession|usePracticeSession|PracticeRecord|AnswerReceipt|RecommendationService/);
  assert.doesNotMatch(combined, /masteryEngine|masteryRate\s*=|StudentState/);
});
