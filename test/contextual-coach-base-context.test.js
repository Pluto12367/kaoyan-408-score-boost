import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadAssembler() {
  const path = 'apps/api/src/study/contextual-coach-context-assembler.service.ts';
  const input = readFileSync(path, 'utf8');
  const output = ts.transpileModule(input, {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true,
      emitDecoratorMetadata: false,
    },
  }).outputText;
  const module = { exports: {} };
  const stubs = {
    '@nestjs/common': {
      Injectable: () => (target) => target,
      Optional: () => (target, _key, _index) => undefined,
      BadRequestException: class BadRequestException extends Error {},
      NotFoundException: class NotFoundException extends Error {},
    },
  };
  Function('require', 'module', 'exports', output)((specifier) => {
    const stubKey = Object.keys(stubs).find((key) => specifier.includes(key));
    if (stubKey) return stubs[stubKey];
    if (specifier.includes('questions.service')) return { QuestionsService: class {} };
    if (specifier.includes('score-center/service')) return { ScoreCenterService: class {} };
    if (specifier.includes('practice-record.repository')) return { PracticeRecordRepository: class {} };
    if (specifier.includes('assessment-history-projection.service')) return { AssessmentHistoryProjectionService: class {} };
    if (specifier.includes('student-state-projection.service')) return { StudentStateProjectionService: class {} };
    if (specifier.includes('wrong-question-projection.service')) return { WrongQuestionProjectionService: class {} };
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

function nodeRow(id, mastery, overrides = {}) {
  return {
    knowledgeNodeId: id, subject: '操作系统', chapter: '进程', title: `节点${id}`,
    mastery, accuracy: 0.5, attempts: 5, wrongCount: 2, status: 'weak', updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function studentContextFixture() {
  return {
    version: 'student-context-v1',
    userId: 'u-1',
    asOf: '2026-09-03T08:00:00.000Z',
    freshness: { asOf: '2026-09-03T08:00:00.000Z', status: 'sufficient', sources: [] },
    profile: { userId: 'u-1', name: '小明', role: 'STUDENT', targetSchool: 'BUPT', weakestSubject: '计算机网络', diagnosis: null },
    exam: { examYear: 2027, targetScore: 130, currentScore: 85, remainingDays: 90, studyStage: '冲刺' },
    mastery: {
      source: 'user_knowledge_mastery',
      weakNodes: [nodeRow('node-a', 0.4), nodeRow('node-b', 0.5)],
      weakPoints: [{ knowledgePointId: 'point-x', subject: '操作系统', chapter: '进程', title: 'Point薄弱', attempts: 5, wrongCount: 3, accuracy: 0.4, latestAt: null }],
      improvingPoints: [nodeRow('node-c', 0.72, { status: 'improving' })],
      masteredPoints: [nodeRow('node-d', 0.9, { status: 'mastered' })],
      lastUpdatedAt: '2026-09-02T00:00:00.000Z',
    },
    practice: { source: 'practice_record', recentAccuracy: { window: 'last7d', baseline: null, sampleSize: 4, status: 'sufficient', value: 0.75 }, recentVolume: { window: 'last7d', baseline: null, sampleSize: 12, status: 'sufficient', value: 12 }, subjectDistribution: { status: 'sufficient', items: [] }, totalCount: 12, latestSubmittedAt: null },
    review: { source: 'review_schedule', dueCount: 3, overdueCount: 1, reviewedCount: 2, resolvedCount: 1, highRiskQuestions: [], nextReviewAt: null },
    plan: {
      source: 'study_plan',
      planId: 'plan-1',
      todayTasks: Array.from({ length: 6 }, (_, index) => ({
        studyTaskId: `task-${index + 1}`,
        actionId: index === 0 ? 'action-9' : null,
        title: `任务${index + 1}`,
        status: 'pending',
        scheduledDate: '2026-09-03',
        completed: false,
        completedAt: null,
        knowledgePointId: null,
        knowledgeNodeId: null,
        minutes: 30,
        questionCount: 5,
      })),
      completion: { completedCount: 0, totalCount: 6, rate: { window: 'last7d', baseline: null, sampleSize: 6, status: 'sufficient', value: 0 } },
    },
    momentum: { studyStreak: 4, recentSessions: [], activityTrend: { window: 'last7d', baseline: null, sampleSize: 4, status: 'sufficient', value: 5 } },
    recommendationEvidence: [],
  };
}

function stateSnapshotFixture() {
  return {
    goal: { targetScore: 120, currentScore: 80, dailyHours: 3, remainingDays: 100, stage: '强化', weakestSubject: '操作系统' },
    mastery: { source: 'user_knowledge_mastery', averageMastery: 62, weakCount: 1, reviewCount: 1, masteredCount: 2, lastUpdatedAt: null },
    weakPoints: [
      { knowledgeNodeId: 'legacy-node-1', title: 'Legacy弱点', masteryRate: 42 },
    ],
    studyTasks: { today: [
      { id: 'task-1', title: '复习进程同步', status: 'pending', scheduledDate: '2026-09-03', completed: false, mode: 'review', questionCount: 5 },
      { id: 'task-2', title: '练习分页', status: 'pending', scheduledDate: '2026-09-03', completed: false, mode: 'practice', questionCount: 5 },
    ] },
  };
}

function createAssembler(options = {}) {
  const calls = {
    state: [], questions: [], wrongQuestions: [], assessments: [], records: [], knowledge: [], studentContext: [],
  };
  const studentState = {
    getSnapshot: async (...args) => { calls.state.push(args); return options.state ?? stateSnapshotFixture(); },
  };
  const studentContext = options.studentContext === null
    ? undefined
    : { getContext: async (...args) => { calls.studentContext.push(args); return options.studentContext ?? studentContextFixture(); } };
  const assembler = new (loadAssembler().ContextualCoachContextAssembler)(
    studentState,
    { findQuestionById: async (questionId) => { calls.questions.push(questionId); return { id: questionId, stem: '进程同步题', options: ['A', 'B'], answer: 'A', analysis: '标准解析', knowledgePointIds: ['node-1'] }; } },
    { getSnapshot: async (...args) => { calls.wrongQuestions.push(args); return { currentWrongItems: [{ questionId: 'wrong-1', stem: '错题题干', answer: 'A', analysis: '错题解析', knowledgePointId: 'point-1', knowledgePointTitle: '错题知识点', latestCorrect: false, latestMistakeReason: '知识点混淆', wrongCount: 2, attemptCount: 3, attemptHistory: [], reviewHistory: [] }], resolvedItems: [] }; } },
    { getSnapshot: async (...args) => { calls.assessments.push(args); return { items: [{ id: 'assessment-latest', score: 80 }, { id: 'assessment-old', score: 70 }] }; } },
    { listByUser: async (...args) => { calls.records.push(args); return [
      { questionId: 'question-1', correct: false, selectedAnswer: 'B', mistakeReason: '概念不清', submittedAt: '2026-09-01T00:00:00.000Z' },
      { questionId: 'question-1', correct: true, selectedAnswer: 'A', mistakeReason: null, submittedAt: '2026-09-02T00:00:00.000Z' },
      { questionId: 'question-2', correct: true, selectedAnswer: 'A', mistakeReason: null, submittedAt: '2026-09-02T00:00:00.000Z' },
    ]; } },
    { getKnowledgeDetail: async (...args) => { calls.knowledge.push(args); return { knowledgePoint: { id: args[1], title: '进程同步' }, userState: { masteryRate: 42 }, frequency: {}, relations: { prerequisites: [], related: [] }, relatedQuestions: [], examQuestions: [] }; } },
    studentContext,
  );
  return { assembler, calls };
}

test('coach base goal comes from StudentContext exam/profile, not legacy StudentState summary', async () => {
  const { assembler } = createAssembler();
  const context = await assembler.assemble('u-1', { contextType: 'question', questionId: 'question-1' });

  assert.equal(context.student.goal.targetScore, 130);
  assert.equal(context.student.goal.currentScore, 85);
  assert.equal(context.student.goal.remainingDays, 90);
  assert.equal(context.student.goal.stage, '冲刺');
  assert.equal(context.student.goal.weakestSubject, '计算机网络');
});

test('coach dailyHours still comes from the legacy StudentState goal field', async () => {
  const { assembler } = createAssembler();
  const context = await assembler.assemble('u-1', { contextType: 'question', questionId: 'question-1' });

  assert.equal(context.student.goal.dailyHours, 3);
});

test('coach masterySummary is derived from StudentContext mastery buckets with percent average', async () => {
  const { assembler } = createAssembler();
  const context = await assembler.assemble('u-1', { contextType: 'question', questionId: 'question-1' });

  assert.equal(context.student.masterySummary.source, 'user_knowledge_mastery');
  assert.equal(context.student.masterySummary.averageMastery, 63);
  assert.equal(context.student.masterySummary.weakCount, 2);
  assert.equal(context.student.masterySummary.reviewCount, 1);
  assert.equal(context.student.masterySummary.masteredCount, 1);
  assert.equal(context.student.masterySummary.lastUpdatedAt, '2026-09-02T00:00:00.000Z');
});

test('coach weakPoints come from StudentContext weakNodes and preserve knowledgeNodeId', async () => {
  const { assembler } = createAssembler();
  const context = await assembler.assemble('u-1', { contextType: 'question', questionId: 'question-1' });

  assert.equal(context.student.weakPoints.length, 2);
  assert.deepEqual(context.student.weakPoints.map((point) => point.knowledgeNodeId), ['node-a', 'node-b']);
  assert.equal(context.student.weakPoints[0].masteryRate, 40);
  for (const point of context.student.weakPoints) {
    assert.ok(!('knowledgePointId' in point), 'Node mastery must not be re-labelled as knowledgePointId');
  }
  // Point-level practice weakness stays out of the node mastery list.
  assert.ok(!context.student.weakPoints.some((point) => point.title === 'Point薄弱'));
});

test('coach currentTasks come from StudentContext plan.todayTasks with legacy mode joined by studyTaskId', async () => {
  const { assembler } = createAssembler();
  const context = await assembler.assemble('u-1', { contextType: 'question', questionId: 'question-1' });

  assert.equal(context.currentTasks.length, 5);
  assert.equal(context.currentTasks[0].id, 'task-1');
  assert.equal(context.currentTasks[0].mode, 'review');
  assert.equal(context.currentTasks[1].mode, 'practice');
  assert.deepEqual(
    Object.keys(context.currentTasks[0]).sort(),
    ['completed', 'id', 'mode', 'questionCount', 'scheduledDate', 'status', 'title'].sort(),
  );
  assert.ok(!('actionId' in context.currentTasks[0]), 'actionId must not be merged into the task shape');
  assert.ok(!('studyTaskId' in context.currentTasks[0]));
  assert.equal(context.currentTasks.some((task) => task.id === 'task-6'), false);
});

test('scenario focus loaders remain untouched when the base bridge is active', async () => {
  const { assembler, calls } = createAssembler();
  const question = await assembler.assemble('u-1', { contextType: 'question', questionId: 'question-1', selectedAnswer: 'B' });
  assert.equal(question.focus.question.id, 'question-1');
  assert.equal(question.focus.selectedAnswer, 'B');
  assert.equal(question.focus.practiceHistory.length, 2);
  assert.deepEqual(calls.questions, ['question-1']);
  assert.deepEqual(calls.records.map((args) => args[0]), ['u-1']);

  const wrong = await assembler.assemble('u-1', { contextType: 'wrong_question', questionId: 'wrong-1' });
  assert.equal(wrong.focus.wrongQuestion.questionId, 'wrong-1');
  assert.deepEqual(calls.wrongQuestions.map((args) => args[0]), ['u-1']);

  const node = await assembler.assemble('u-1', { contextType: 'knowledge_node', knowledgeNodeId: 'node-9' });
  assert.equal(node.focus.knowledgeNode.id, 'node-9');
  assert.deepEqual(calls.knowledge, [['u-1', 'node-9']]);

  const assessment = await assembler.assemble('u-1', { contextType: 'assessment', assessmentId: 'assessment-old' });
  assert.equal(assessment.focus.assessment.id, 'assessment-old');
  assert.deepEqual(calls.assessments.map((args) => args[0]), ['u-1']);

  // Base still needs the legacy StudentState read for dailyHours/task.mode.
  assert.deepEqual(calls.state.map((args) => args[0]), ['u-1', 'u-1', 'u-1', 'u-1']);
});

test('assembler does not fabricate a StudentContext asOf; the query boundary default applies', async () => {
  const { assembler, calls } = createAssembler();
  await assembler.assemble('u-1', { contextType: 'assessment' });
  for (const args of calls.studentContext) {
    assert.equal(args.length, 1, 'getContext must be called with userId only; asOf is resolved by the query boundary');
    assert.equal(args[0], 'u-1');
  }
});

test('without StudentContextQueryService the assembler keeps the legacy StudentState base', async () => {
  const { assembler } = createAssembler({ studentContext: null });
  const context = await assembler.assemble('u-1', { contextType: 'question', questionId: 'question-1' });

  assert.equal(context.student.goal.targetScore, 120);
  assert.equal(context.student.goal.dailyHours, 3);
  assert.equal(context.student.masterySummary.averageMastery, 62);
  assert.equal(context.student.weakPoints[0].knowledgeNodeId, 'legacy-node-1');
  assert.equal(context.currentTasks[0].id, 'task-1');
  assert.equal(context.currentTasks[0].mode, 'review');
  assert.equal(context.currentTasks.length, 2);
});

test('base mapping is deterministic apart from assembledAt response metadata', async () => {
  const { assembler } = createAssembler();
  const first = await assembler.assemble('u-1', { contextType: 'assessment' });
  const second = await assembler.assemble('u-1', { contextType: 'assessment' });
  const strip = (value) => {
    const { assembledAt: _ignored, ...rest } = value;
    return rest;
  };
  assert.deepEqual(strip(first), strip(second));
  assert.equal(typeof first.assembledAt, 'string');
});
