import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function compileModule(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    if (specifier in dependencies) return dependencies[specifier];
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

async function loadTodayAdapter() {
  const route = await compileModule('apps/web/src/features/onboarding/todayLearningRoute.ts');
  return compileModule('apps/web/src/features/student/actions/adapters/todayActionAdapter.ts', {
    '../../../onboarding/todayLearningRoute': route,
  });
}

async function loadReviewAdapter() {
  return compileModule('apps/web/src/features/student/actions/adapters/reviewActionAdapter.ts');
}

async function loadKnowledgeAdapter() {
  return compileModule('apps/web/src/features/student/actions/adapters/knowledgeActionAdapter.ts');
}

async function loadAssessmentAdapter() {
  return compileModule('apps/web/src/features/student/actions/adapters/assessmentActionAdapter.ts');
}

async function loadReportAdapter() {
  return compileModule('apps/web/src/features/student/actions/adapters/reportActionAdapter.ts');
}

function task(overrides = {}) {
  return {
    id: 'task-1', knowledgePointId: 'kp-1', subject: '数据结构', chapter: '树',
    title: '二叉树专项', minutes: 20, questionCount: 10, mode: '专项训练',
    priority: '中', reason: '近期错误较多', nextAction: '完成专项训练',
    scheduledDate: '2026-08-09', status: 'pending', postponeCount: 0,
    ...overrides,
  };
}

test('Today: turns the highest-priority pending task into a today action', async () => {
  const { buildTodayAction } = await loadTodayAdapter();
  const result = buildTodayAction({ priorityTasks: [
    task({ id: 'low', priority: '低' }),
    task({ id: 'high', priority: '高', title: '高优先级任务', reason: '高优先级原因' }),
  ] }, Date.parse('2026-08-09T10:00:00+08:00'));

  assert.deepEqual(result, {
    id: 'today-task:high', type: 'today_task', title: '高优先级任务',
    destination: 'practice', source: 'today-plan', reason: '高优先级原因', priority: '高',
    context: { taskId: 'high', knowledgeNodeId: 'kp-1' },
  });
});

test('Today: preserves an in-progress task ID and source priority', async () => {
  const { buildTodayAction } = await loadTodayAdapter();
  const result = buildTodayAction({ priorityTasks: [
    task({ id: 'in-progress', status: 'in_progress', priority: '中' }),
  ] });

  assert.equal(result.id, 'today-task:in-progress');
  assert.equal(result.context.taskId, 'in-progress');
  assert.equal(result.priority, '中');
});

test('Today: returns null when the only task is completed', async () => {
  const { buildTodayAction } = await loadTodayAdapter();
  assert.equal(buildTodayAction({ priorityTasks: [
    task({ status: 'completed', completed: true }),
  ] }), null);
});

test('Today: waits for postponed tasks until the route makes them current', async () => {
  const { buildTodayAction } = await loadTodayAdapter();
  const nextAvailableAt = '2026-08-09T11:00:00+08:00';
  const plan = { priorityTasks: [task({ status: 'postponed', nextAvailableAt })] };

  assert.equal(buildTodayAction(plan, Date.parse('2026-08-09T10:00:00+08:00')), null);
  assert.equal(buildTodayAction(plan, Date.parse(nextAvailableAt)).context.taskId, 'task-1');
});

test('Today: maps task modes through the route destination helper without question counts', async () => {
  const { buildTodayAction } = await loadTodayAdapter();
  for (const [mode, destination] of [
    ['专项训练', 'practice'],
    ['诊断复盘', 'review'],
    ['服务端新模式', 'home'],
  ]) {
    const result = buildTodayAction({ priorityTasks: [task({ mode, questionCount: 999 })] });
    assert.equal(result.destination, destination);
  }
});

function dueReview(overrides = {}) {
  return {
    questionId: 'due-1', userId: 'u-1', selfReportedReason: '概念混淆', redoCorrect: false,
    timeSpentSec: 60, consecutiveCorrect: 0, stability: 'learning', nextReviewAt: '2026-08-08T08:00:00.000Z',
    reviewCount: 1, lastReviewedAt: '2026-08-07T08:00:00.000Z', stem: '到期题目',
    knowledgePointTitle: '二叉树', subject: '数据结构', ...overrides,
  };
}

function priorityRedo(overrides = {}) {
  return {
    questionId: 'redo-1', stem: '优先重做题目', knowledgePointTitle: '缓存映射', wrongCount: 3,
    latestMistakeReason: '概念混淆', reviewStatus: 'pending', nextAction: '先复盘再重做', ...overrides,
  };
}

function wrongQuestion(overrides = {}) {
  return {
    questionId: 'fallback-1', stem: '展示兜底题目', knowledgePointId: 'kp-1', knowledgePointTitle: '进程管理',
    subject: '操作系统', chapter: '进程', wrongCount: 1, latestMistakeReason: '审题问题',
    latestSubmittedAt: '2026-08-08T08:00:00.000Z', reviewStatus: 'pending', masteryStatus: '未掌握',
    nextAction: '回看解析', ...overrides,
  };
}

test('Review: due items precede server priority redo items', async () => {
  const { buildReviewActions } = await loadReviewAdapter();
  const result = buildReviewActions({
    dueReviews: [dueReview()], priorityRedoItems: [priorityRedo()],
  });

  assert.deepEqual(result.map((action) => action.id), ['review-due:due-1', 'redo-wrong-question:redo-1']);
  assert.equal(result[0].type, 'review_due');
  assert.equal(result[1].type, 'redo_wrong_question');
});

test('Review: overdue and due items keep their source data', async () => {
  const { buildReviewActions } = await loadReviewAdapter();
  const result = buildReviewActions({
    dueReviews: [
      dueReview({ questionId: 'overdue', stem: '逾期题', inferredReason: '推断错因' }),
      dueReview({ questionId: 'due', stem: '到期题', selfReportedReason: '自述错因' }),
    ],
    priorityRedoItems: [],
  });

  assert.deepEqual(result, [
    {
      id: 'review-due:overdue', type: 'review_due', title: '逾期题', destination: 'review',
      source: 'review-due', reason: '推断错因', context: { questionId: 'overdue' },
    },
    {
      id: 'review-due:due', type: 'review_due', title: '到期题', destination: 'review',
      source: 'review-due', reason: '自述错因', context: { questionId: 'due' },
    },
  ]);
});

test('Wrong: uses server priority redo items when no due review exists', async () => {
  const { buildReviewActions } = await loadReviewAdapter();
  const result = buildReviewActions({ dueReviews: [], priorityRedoItems: [priorityRedo()] });

  assert.deepEqual(result, [{
    id: 'redo-wrong-question:redo-1', type: 'redo_wrong_question', title: '先复盘再重做',
    destination: 'practice', source: 'wrong-summary', reason: '概念混淆',
    context: { questionId: 'redo-1' },
  }]);
});

test('Wrong: uses display fallback last and identifies its source without priority', async () => {
  const { buildReviewActions } = await loadReviewAdapter();
  const result = buildReviewActions({
    dueReviews: [], priorityRedoItems: [priorityRedo()], displayFallbackItems: [wrongQuestion()],
  });

  assert.deepEqual(result.at(-1), {
    id: 'redo-wrong-question:fallback-1', type: 'redo_wrong_question', title: '展示兜底：回看解析',
    destination: 'review', source: 'wrong-summary-fallback', reason: '审题问题', context: { questionId: 'fallback-1' },
  });
});

test('Wrong: duplicate question IDs keep the due occurrence', async () => {
  const { buildReviewActions } = await loadReviewAdapter();
  const result = buildReviewActions({
    dueReviews: [dueReview({ questionId: 'same', stem: '到期版本' })],
    priorityRedoItems: [priorityRedo({ questionId: 'same', stem: '服务端版本' })],
    displayFallbackItems: [wrongQuestion({ questionId: 'same', stem: '展示版本' })],
  });

  assert.deepEqual(result, [{
    id: 'review-due:same', type: 'review_due', title: '到期版本', destination: 'review',
    source: 'review-due', reason: '概念混淆', context: { questionId: 'same' },
  }]);
});

test('Wrong: review adapter does not call a risk or priority engine', async () => {
  const source = await readFile(new URL('../apps/web/src/features/student/actions/adapters/reviewActionAdapter.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /wrongReviewPriority|buildWrongReviewPriority|rankWrongReviewItems|scoreWrongQuestion/);
});

function catalogContext(nodeId, title) {
  return {
    point: { id: nodeId, name: title },
    subjectCode: 'DS', subjectName: '数据结构', chapterId: 'chapter-1', chapterName: '树',
    sectionId: 'section-1', sectionName: '二叉树',
  };
}

test('Knowledge: creates an explore action for the selected catalog node', async () => {
  const { buildKnowledgeActions } = await loadKnowledgeAdapter();
  const result = buildKnowledgeActions({ nodeId: 'node-selected', title: '二叉树遍历' });

  assert.deepEqual(result, [{
    id: 'knowledge-explore:node-selected', type: 'knowledge_explore', title: '二叉树遍历',
    destination: 'knowledge', source: 'knowledge', context: { knowledgeNodeId: 'node-selected' },
  }]);
});

test('Knowledge: creates an explore action for each prerequisite context ID', async () => {
  const { buildKnowledgeActions } = await loadKnowledgeAdapter();
  const result = buildKnowledgeActions({
    nodeId: 'node-selected', title: '二叉树遍历',
    prerequisiteContexts: [catalogContext('node-prerequisite', '树的基本概念')],
  });

  assert.deepEqual(result.at(-1), {
    id: 'knowledge-explore:node-prerequisite', type: 'knowledge_explore', title: '树的基本概念',
    destination: 'knowledge', source: 'knowledge', context: { knowledgeNodeId: 'node-prerequisite' },
  });
});

test('Knowledge: creates an explore action for each related context ID', async () => {
  const { buildKnowledgeActions } = await loadKnowledgeAdapter();
  const result = buildKnowledgeActions({
    nodeId: 'node-selected', title: '二叉树遍历',
    relatedContexts: [catalogContext('node-related', '二叉树性质')],
  });

  assert.deepEqual(result.at(-1), {
    id: 'knowledge-explore:node-related', type: 'knowledge_explore', title: '二叉树性质',
    destination: 'knowledge', source: 'knowledge', context: { knowledgeNodeId: 'node-related' },
  });
});

test('Knowledge: retains selected node and related question IDs for practice', async () => {
  const { buildKnowledgeActions } = await loadKnowledgeAdapter();
  const result = buildKnowledgeActions({
    nodeId: 'node-selected', title: '二叉树遍历', relatedQuestionIds: ['question-related'],
  });

  assert.deepEqual(result.at(-1), {
    id: 'knowledge-practice:node-selected:question-related', type: 'practice_recommended', title: '二叉树遍历',
    destination: 'practice', source: 'training', context: { knowledgeNodeId: 'node-selected', questionId: 'question-related' },
  });
});

test('Knowledge: retains exact catalog quest question IDs', async () => {
  const { buildKnowledgeActions } = await loadKnowledgeAdapter();
  const result = buildKnowledgeActions({
    nodeId: 'node-selected', title: '二叉树遍历', questQuestionIds: ['quest-2', 'quest-1'],
  });

  assert.deepEqual(result.at(-1), {
    id: 'knowledge-quest:node-selected', type: 'knowledge_quest', title: '二叉树遍历',
    destination: 'practice', source: 'knowledge', context: { knowledgeNodeId: 'node-selected', questionIds: ['quest-2', 'quest-1'] },
  });
});

test('Knowledge: deduplicates valid quest question IDs in source order', async () => {
  const { buildKnowledgeActions } = await loadKnowledgeAdapter();
  const result = buildKnowledgeActions({
    nodeId: 'node-selected', title: '二叉树遍历',
    questQuestionIds: ['quest-2', 'quest-1', 'quest-2', 'quest-3', 'quest-1'],
  });

  assert.deepEqual(result.at(-1).context.questionIds, ['quest-2', 'quest-1', 'quest-3']);
});

test('Knowledge: missing node ID produces no executable action', async () => {
  const { buildKnowledgeActions } = await loadKnowledgeAdapter();
  const result = buildKnowledgeActions({
    title: '二叉树遍历',
    prerequisiteContexts: [catalogContext('node-prerequisite', '树的基本概念')],
    relatedContexts: [catalogContext('node-related', '二叉树性质')],
    relatedQuestionIds: ['question-related'], questQuestionIds: ['quest-1'],
  });

  assert.deepEqual(result, []);
});

test('Knowledge: skips invalid nested node and question IDs', async () => {
  const { buildKnowledgeActions } = await loadKnowledgeAdapter();
  const result = buildKnowledgeActions({
    nodeId: 'node-selected', title: '二叉树遍历',
    prerequisiteContexts: [catalogContext('', '空 ID'), catalogContext('   ', '空白 ID'), catalogContext(42, '数字 ID')],
    relatedContexts: [catalogContext(null, '空值 ID'), catalogContext('node-related', '二叉树性质')],
    relatedQuestionIds: ['', '   ', 42, 'question-related'],
    questQuestionIds: ['', '   ', 42, 'quest-valid'],
  });

  assert.deepEqual(result, [
    {
      id: 'knowledge-explore:node-selected', type: 'knowledge_explore', title: '二叉树遍历',
      destination: 'knowledge', source: 'knowledge', context: { knowledgeNodeId: 'node-selected' },
    },
    {
      id: 'knowledge-explore:node-related', type: 'knowledge_explore', title: '二叉树性质',
      destination: 'knowledge', source: 'knowledge', context: { knowledgeNodeId: 'node-related' },
    },
    {
      id: 'knowledge-practice:node-selected:question-related', type: 'practice_recommended', title: '二叉树遍历',
      destination: 'practice', source: 'training', context: { knowledgeNodeId: 'node-selected', questionId: 'question-related' },
    },
    {
      id: 'knowledge-quest:node-selected', type: 'knowledge_quest', title: '二叉树遍历',
      destination: 'practice', source: 'knowledge', context: { knowledgeNodeId: 'node-selected', questionIds: ['quest-valid'] },
    },
  ]);
});

test('Knowledge: deduplicates by real ID with selected-node authority and source order', async () => {
  const { buildKnowledgeActions } = await loadKnowledgeAdapter();
  const result = buildKnowledgeActions({
    nodeId: 'node-selected', title: '二叉树遍历',
    prerequisiteContexts: [
      catalogContext('node-selected', '不应替换选中节点标题'),
      catalogContext('node-prerequisite', '树的基本概念'),
      catalogContext('node-prerequisite', '重复前置知识'),
    ],
    relatedContexts: [
      catalogContext('node-prerequisite', '重复相关知识'),
      catalogContext('node-related', '二叉树性质'),
    ],
    relatedQuestionIds: ['question-1', 'question-1', 'question-2'],
  });

  assert.deepEqual(result.map((action) => action.id), [
    'knowledge-explore:node-selected',
    'knowledge-explore:node-prerequisite',
    'knowledge-explore:node-related',
    'knowledge-practice:node-selected:question-1',
    'knowledge-practice:node-selected:question-2',
  ]);
  assert.equal(result[0].title, '二叉树遍历');
});

test('Knowledge: adapter source remains free of navigation, mastery, and fetch calls', async () => {
  const source = await readFile(new URL('../apps/web/src/features/student/actions/adapters/knowledgeActionAdapter.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetchMyMastery|fetchKnowledgeDetail|onNavigate|navigate\s*\(|fetch\s*\(/);
});

function assessmentResult(overrides = {}) {
  return {
    id: 'assessment-1', userId: 'u-1', submittedAt: '2026-08-31T08:00:00.000Z',
    totalQuestions: 2, correctCount: 1, score: 50,
    adjustment: { previousStage: '基础', stage: '强化', planPhase: '巩固', scoreBand: '待提升', message: '补强错题' },
    reviewItems: [{
      questionId: 'assessment-question-1', stem: '二叉树遍历题', knowledgePointId: 'kp-tree',
      knowledgePointTitle: '二叉树遍历', mistakeReason: '概念混淆',
    }],
    nextActions: ['先复盘错题'],
    ...overrides,
  };
}

function practiceSetResult(overrides = {}) {
  return {
    id: 'practice-result-1', practiceSetId: 'practice-set-1', userId: 'u-1',
    submittedAt: '2026-08-31T08:00:00.000Z', totalQuestions: 1, correctCount: 0, accuracyRate: 0,
    results: [{
      questionId: 'practice-question-1', stem: '缓存题', correct: false, mistakeReason: '概念混淆',
    }],
    nextActions: ['回顾缓存映射'],
    ...overrides,
  };
}

test('Assessment: report action keeps the real assessment ID', async () => {
  const { buildAssessmentActions } = await loadAssessmentAdapter();
  const result = buildAssessmentActions(assessmentResult());

  assert.deepEqual(result.find((action) => action.type === 'open_report'), {
    id: 'assessment-report:assessment-1', type: 'open_report', title: '查看阶段测评报告',
    destination: 'test', source: 'assessment', context: { reportId: 'assessment:assessment-1', assessmentId: 'assessment-1' },
  });
});

test('Assessment: wrong-question action keeps the real question ID', async () => {
  const { buildAssessmentActions } = await loadAssessmentAdapter();
  const result = buildAssessmentActions(assessmentResult());

  assert.deepEqual(result.find((action) => action.type === 'assessment_wrong_questions'), {
    id: 'assessment-wrong-question:assessment-1:assessment-question-1', type: 'assessment_wrong_questions', title: '二叉树遍历题',
    destination: 'review', source: 'assessment', reason: '概念混淆',
    context: { assessmentId: 'assessment-1', questionId: 'assessment-question-1' },
  });
});

test('Assessment: missing assessment ID produces no actions', async () => {
  const { buildAssessmentActions } = await loadAssessmentAdapter();

  assert.deepEqual(buildAssessmentActions(assessmentResult({ id: '' })), []);
});

test('Assessment: practice action is distinct from review actions', async () => {
  const { buildAssessmentActions } = await loadAssessmentAdapter();
  const result = buildAssessmentActions(assessmentResult());

  assert.deepEqual(result.find((action) => action.type === 'assessment_practice'), {
    id: 'assessment-practice:assessment-1', type: 'assessment_practice', title: '进行针对性练习',
    destination: 'practice', source: 'assessment', context: { assessmentId: 'assessment-1' },
  });
});

test('Assessment: multiple review items remain separately addressable', async () => {
  const { buildAssessmentActions } = await loadAssessmentAdapter();
  const result = buildAssessmentActions(assessmentResult({ reviewItems: [
    { questionId: 'question-a', stem: '题目 A', knowledgePointId: 'kp-a', knowledgePointTitle: 'A', mistakeReason: null },
    { questionId: 'question-b', stem: '题目 B', knowledgePointId: 'kp-b', knowledgePointTitle: 'B', mistakeReason: '审题问题' },
  ] }));

  assert.deepEqual(result.filter((action) => action.type === 'assessment_wrong_questions').map((action) => action.context.questionId), ['question-a', 'question-b']);
});

test('Assessment: a practice set without real question IDs does not invent an assessment ID', async () => {
  const { buildPracticeSetActions } = await loadAssessmentAdapter();
  const result = buildPracticeSetActions(practiceSetResult({ id: '', results: [], nextActions: ['去练习'] }));

  assert.deepEqual(result, []);
});

test('Assessment: an explicit practice result question maps safely', async () => {
  const { buildPracticeSetActions } = await loadAssessmentAdapter();
  const result = buildPracticeSetActions(practiceSetResult());

  assert.deepEqual(result, [{
    id: 'practice-result-question:practice-question-1', type: 'practice_recommended', title: '缓存题',
    destination: 'practice', source: 'training', reason: '概念混淆', context: { questionId: 'practice-question-1' },
  }]);
});

test('Report: known explicit action targets map to test, review, and practice', async () => {
  const { buildReportActions } = await loadReportAdapter();
  const result = buildReportActions({
    scopeKey: ' weekly-summary ',
    insights: [
      { action: '查看测评报告', assessmentId: 'assessment-1' },
      { action: '查看测评报告' },
      { action: '去错题本', assessmentId: 'assessment-1', questionId: 'report-question-1' },
      { action: '去练习薄弱点', assessmentId: 'assessment-1', questionId: 'report-question-2' },
    ],
  });

  assert.deepEqual(result.map((action) => [action.type, action.destination, action.context]), [
    ['open_report', 'test', { reportId: 'report:weekly-summary' }],
    ['assessment_review', 'test', { assessmentId: 'assessment-1' }],
    ['assessment_wrong_questions', 'review', { assessmentId: 'assessment-1', questionId: 'report-question-1' }],
    ['assessment_practice', 'practice', { assessmentId: 'assessment-1', questionId: 'report-question-2' }],
  ]);
});

test('Report: unknown action text remains unstructured', async () => {
  const { buildReportActions } = await loadReportAdapter();
  const result = buildReportActions({
    scopeKey: 'weekly-summary', insights: [{ action: '开始阶段测评', assessmentId: 'assessment-1', questionId: 'question-1' }],
  });

  assert.deepEqual(result, [{
    id: 'report:weekly-summary', type: 'open_report', title: '查看学习报告',
    destination: 'test', source: 'report', context: { reportId: 'report:weekly-summary' },
  }]);
});
