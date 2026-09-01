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

async function loadSessionAdapter() {
  return compileModule('apps/web/src/features/student/actions/adapters/sessionActionAdapter.ts');
}

async function loadTrainingAdapter() {
  return compileModule('apps/web/src/features/student/actions/adapters/trainingActionAdapter.ts');
}

async function loadActionCandidates() {
  return compileModule('apps/web/src/features/student/actions/actionCandidates.ts');
}

async function loadCanonicalNextAction() {
  return compileModule('apps/web/src/features/student/actions/canonicalNextAction.ts');
}

function action(overrides = {}) {
  return {
    id: 'action-1', type: 'practice_recommended', title: '开始练习',
    destination: 'practice', source: 'training', context: { taskId: 'task-1' },
    ...overrides,
  };
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

test('all action adapters emit data-only contexts without network or recommendation calculations', async () => {
  const paths = [
    'apps/web/src/features/student/actions/adapters/todayActionAdapter.ts',
    'apps/web/src/features/student/actions/adapters/reviewActionAdapter.ts',
    'apps/web/src/features/student/actions/adapters/knowledgeActionAdapter.ts',
    'apps/web/src/features/student/actions/adapters/assessmentActionAdapter.ts',
    'apps/web/src/features/student/actions/adapters/reportActionAdapter.ts',
    'apps/web/src/features/student/actions/adapters/sessionActionAdapter.ts',
    'apps/web/src/features/student/actions/adapters/trainingActionAdapter.ts',
  ];

  for (const path of paths) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fetch\s*\(|authenticatedFetch|localStorage|RecommendationService|StudentState|Prisma/i, `${path} must not perform I/O or state writes`);
    assert.doesNotMatch(source, /(?:build|calculate|compute|derive|rank|score)(?:Mastery|ReviewPriority|WrongReviewPriority)/i, `${path} must consume existing evidence rather than recalculate it`);
    assert.doesNotMatch(source, /on(?:Click|Navigate|Select|Review|Redo|Practice)\s*[:=]/, `${path} must not own React callbacks`);
  }
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

function session(overrides = {}) {
  return {
    id: 'session-1', type: 'practice_set', resourceId: 'practice-set-1',
    questionIds: ['question-1', 'question-2'], questions: [], answers: {},
    markedQuestions: [], currentIndex: 0, revision: 2, totalQuestions: 2,
    answeredCount: 1, startedAt: '2026-08-31T08:00:00.000Z',
    lastActiveAt: '2026-08-31T08:10:00.000Z', totalActiveMs: 600000,
    completed: false, progressRate: 50, ...overrides,
  };
}

test('Session: resumable session produces a practice continue action', async () => {
  const { buildContinueSessionAction } = await loadSessionAdapter();

  assert.deepEqual(buildContinueSessionAction(session()), {
    id: 'continue-session:session-1', type: 'continue_session', title: '继续练习',
    destination: 'practice', source: 'session', context: { sessionId: 'session-1' },
  });
});

test('Session: completed, non-resumable, and missing-ID sessions are excluded', async () => {
  const { buildContinueSessionAction } = await loadSessionAdapter();

  assert.equal(buildContinueSessionAction(session({ completed: true })), null);
  assert.equal(buildContinueSessionAction(session({ questionIds: [], totalQuestions: 0 })), null);
  assert.equal(buildContinueSessionAction(session({ id: '  ' })), null);
});

test('Session: preserves the exact session ID in action context', async () => {
  const { buildContinueSessionAction } = await loadSessionAdapter();
  const result = buildContinueSessionAction(session({ id: 'session-real-408-17' }));

  assert.equal(result.context.sessionId, 'session-real-408-17');
  assert.equal(result.id, 'continue-session:session-real-408-17');
});

test('Training: string-only next actions remain display text', async () => {
  const { buildTrainingActions } = await loadTrainingAdapter();

  assert.deepEqual(buildTrainingActions({
    sourceId: 'practice-set-1', source: 'practice_set', nextActions: ['先复盘错题', '继续保持'],
  }), []);
});

test('Training: explicit practice context produces a practice action with real IDs', async () => {
  const { buildTrainingActions } = await loadTrainingAdapter();

  assert.deepEqual(buildTrainingActions({
    sourceId: 'practice-set-1', source: 'practice_set', nextActions: ['去练习'],
    questionId: 'question-real-1', knowledgeNodeId: 'node-real-1', taskId: 'task-real-1',
  }), [{
    id: 'training-practice:practice-set-1', type: 'practice_recommended', title: '开始训练',
    destination: 'practice', source: 'training',
    context: { questionId: 'question-real-1', knowledgeNodeId: 'node-real-1', taskId: 'task-real-1' },
  }]);
});

test('Training: does not recalculate mastery or recommendation from presentation data', async () => {
  const { buildTrainingActions } = await loadTrainingAdapter();

  assert.deepEqual(buildTrainingActions({
    sourceId: 'stage-assessment-1', source: 'stage_assessment',
    nextActions: ['推荐掌握度最低的知识点'], mastery: 0.2, recommendationPriority: 99,
  }), []);
});

test('Training: generic question context cannot produce a review-due action', async () => {
  const { buildTrainingActions } = await loadTrainingAdapter();

  assert.deepEqual(buildTrainingActions({
    sourceId: 'training-1', source: 'practice_set', actionType: 'review_due', questionId: 'generic-question-1',
  }), []);
});

test('Training: explicit review-due question context produces a review-due action', async () => {
  const { buildTrainingActions } = await loadTrainingAdapter();

  assert.deepEqual(buildTrainingActions({
    sourceId: 'training-1', source: 'practice_set', actionType: 'review_due', reviewDueQuestionId: 'due-question-1',
  }), [{
    id: 'training-review-due:training-1', type: 'review_due', title: '开始复习',
    destination: 'review', source: 'review-due', context: { questionId: 'due-question-1' },
  }]);
});

test('Training: generic question context cannot produce a wrong-question action', async () => {
  const { buildTrainingActions } = await loadTrainingAdapter();

  assert.deepEqual(buildTrainingActions({
    sourceId: 'training-1', source: 'practice_set', actionType: 'redo_wrong_question', questionId: 'generic-question-1',
  }), []);
});

test('Training: explicit wrong-question context produces a wrong-question action', async () => {
  const { buildTrainingActions } = await loadTrainingAdapter();

  assert.deepEqual(buildTrainingActions({
    sourceId: 'training-1', source: 'practice_set', actionType: 'redo_wrong_question', wrongQuestionId: 'wrong-question-1',
  }), [{
    id: 'training-redo-wrong-question:training-1', type: 'redo_wrong_question', title: '重做错题',
    destination: 'practice', source: 'wrong-summary', context: { questionId: 'wrong-question-1' },
  }]);
});

test('Training: stage assessment source context cannot identify an open report', async () => {
  const { buildTrainingActions } = await loadTrainingAdapter();

  assert.deepEqual(buildTrainingActions({
    sourceId: 'stage-assessment-1', source: 'stage_assessment', actionType: 'open_report',
  }), []);
});

test('Training: explicit report context does not invent an assessment ID', async () => {
  const { buildTrainingActions } = await loadTrainingAdapter();

  assert.deepEqual(buildTrainingActions({
    sourceId: 'stage-assessment-1', source: 'stage_assessment', actionType: 'open_report', reportId: 'report-real-1',
  }), [{
    id: 'training-report:stage-assessment-1', type: 'open_report', title: '查看训练报告',
    destination: 'test', source: 'report', context: { reportId: 'report-real-1' },
  }]);
});

test('Training: unknown action types produce no action', async () => {
  const { buildTrainingActions } = await loadTrainingAdapter();

  assert.deepEqual(buildTrainingActions({
    sourceId: 'training-1', source: 'practice_set', actionType: 'unknown_action', questionId: 'question-1',
  }), []);
});

test('Canonical: a resumable session wins over every later source', async () => {
  const { buildStudentActionCandidates } = await loadActionCandidates();
  const { selectCanonicalNextAction } = await loadCanonicalNextAction();
  const sessionAction = action({
    id: 'session-action', type: 'continue_session', title: '继续练习', source: 'session',
    context: { sessionId: 'session-1' },
  });

  const candidates = buildStudentActionCandidates({
    session: [sessionAction],
    todayAction: action({ id: 'today-action', type: 'today_task', source: 'today-plan', context: { taskId: 'task-2' } }),
    review: [action({ id: 'review-action', type: 'review_due', source: 'review-due', context: { questionId: 'question-1' } })],
  });

  assert.equal(selectCanonicalNextAction(candidates), sessionAction);
});

test('Canonical: today action wins when there is no resumable session', async () => {
  const { buildStudentActionCandidates } = await loadActionCandidates();
  const { selectCanonicalNextAction } = await loadCanonicalNextAction();
  const todayAction = action({ id: 'today-action', type: 'today_task', source: 'today-plan', context: { taskId: 'task-2' } });

  const candidates = buildStudentActionCandidates({
    session: [],
    todayAction,
    review: [action({ id: 'review-action', type: 'review_due', source: 'review-due', context: { questionId: 'question-1' } })],
  });

  assert.equal(selectCanonicalNextAction(candidates), todayAction);
});

test('Canonical: due review beats a server priority wrong-question action', async () => {
  const { buildStudentActionCandidates } = await loadActionCandidates();
  const { selectCanonicalNextAction } = await loadCanonicalNextAction();
  const dueReview = action({ id: 'due-review', type: 'review_due', source: 'review-due', context: { questionId: 'due-1' } });
  const priorityRedo = action({ id: 'priority-redo', type: 'redo_wrong_question', source: 'wrong-summary', context: { questionId: 'redo-1' } });

  const candidates = buildStudentActionCandidates({
    todayAction: null, review: [dueReview], wrongQuestion: [priorityRedo],
  });

  assert.equal(selectCanonicalNextAction(candidates), dueReview);
});

test('Canonical: a server priority wrong-question action beats a report action', async () => {
  const { buildStudentActionCandidates } = await loadActionCandidates();
  const { selectCanonicalNextAction } = await loadCanonicalNextAction();
  const priorityRedo = action({ id: 'priority-redo', type: 'redo_wrong_question', source: 'wrong-summary', context: { questionId: 'redo-1' } });
  const report = action({ id: 'report-action', type: 'open_report', source: 'report', context: { reportId: 'report-1' } });

  const candidates = buildStudentActionCandidates({
    todayAction: null, wrongQuestion: [priorityRedo], report: [report],
  });

  assert.equal(selectCanonicalNextAction(candidates), priorityRedo);
});

test('Canonical: no valid non-coach candidate returns null', async () => {
  const { buildStudentActionCandidates } = await loadActionCandidates();
  const { selectCanonicalNextAction } = await loadCanonicalNextAction();
  const coachAction = action({ id: 'coach-action', type: 'coach_explain', destination: 'ai', source: 'coach', context: { questionId: 'question-1' } });

  const candidates = buildStudentActionCandidates({ todayAction: null, coach: [coachAction] });

  assert.equal(selectCanonicalNextAction(candidates), null);
});

test('Candidates: deduplicate IDs, preserve source order, and ignore numeric priority across buckets', async () => {
  const { buildStudentActionCandidates } = await loadActionCandidates();
  const { selectCanonicalNextAction } = await loadCanonicalNextAction();
  const firstReview = action({ id: 'review-first', title: '源内第一个', priority: 1, type: 'review_due', source: 'review-due', context: { questionId: 'question-1' } });
  const secondReview = action({ id: 'review-second', title: '源内第二个', priority: 99, type: 'review_due', source: 'review-due', context: { questionId: 'question-2' } });
  const duplicate = action({ id: 'review-first', title: '重复动作', priority: 100, type: 'redo_wrong_question', source: 'wrong-summary', context: { questionId: 'question-3' } });
  const report = action({ id: 'report-action', type: 'open_report', source: 'report', context: { reportId: 'report-1' } });

  const candidates = buildStudentActionCandidates({
    todayAction: null,
    review: [firstReview, secondReview],
    wrongQuestion: [duplicate],
    report: [report],
  });

  assert.deepEqual(candidates.review.map((candidate) => candidate.id), ['review-first', 'review-second']);
  assert.deepEqual(candidates.wrongQuestion, []);
  assert.equal(selectCanonicalNextAction(candidates), firstReview);
});
