import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const Fragment = Symbol('Fragment');

function createJsxRuntime({ invokeFunctions = false } = {}) {
  const createElement = (type, props) => {
    const normalizedProps = props ?? {};
    return invokeFunctions && typeof type === 'function'
      ? type(normalizedProps)
      : { type, props: normalizedProps };
  };
  return { Fragment, jsx: createElement, jsxs: createElement };
}

async function compileModule(path, dependencies = {}, compilerOptions = {}) {
  const input = await source(path);
  const output = ts.transpileModule(input, {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      ...compilerOptions,
    },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    if (specifier in dependencies) return dependencies[specifier];
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return;
  visit(node);
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  walk(node.props?.children, visit);
}

function resultFixture(id = 'assessment-1') {
  return {
    id,
    userId: 'student-1',
    submittedAt: '2026-09-01T08:00:00.000Z',
    score: 60,
    correctCount: 1,
    totalQuestions: 2,
    accuracyRate: 50,
    reviewItems: [{ questionId: 'question-1', stem: 'Review this question', mistakeReason: '概念不清' }],
    nextActions: ['Review the missed question'],
    adjustment: { message: 'Review before advancing.', stage: '强化', planPhase: '补弱' },
  };
}

async function loadStageAssessmentPanel() {
  const assessmentActions = await compileModule('apps/web/src/features/student/actions/adapters/assessmentActionAdapter.ts');
  const destination = await compileModule('apps/web/src/features/student/actions/studentActionDestination.ts');
  const command = await compileModule('apps/web/src/features/student/actions/studentActionCommand.ts', {
    './studentActionDestination': destination,
  });
  return compileModule('apps/web/src/features/assessment/StageAssessmentPanel.tsx', {
    'react/jsx-runtime': createJsxRuntime(),
    'lucide-react': { ClipboardCheck: 'ClipboardCheck', RefreshCw: 'RefreshCw' },
    '../student/actions/adapters/assessmentActionAdapter': assessmentActions,
    '../student/actions/studentActionCommand': command,
  });
}

async function loadStudentSections(capturedHomeProps) {
  const assessmentActions = await compileModule('apps/web/src/features/student/actions/adapters/assessmentActionAdapter.ts');
  const reviewActions = await compileModule('apps/web/src/features/student/actions/adapters/reviewActionAdapter.ts');
  const actionCandidates = await compileModule('apps/web/src/features/student/actions/actionCandidates.ts');
  const canonicalNextAction = await compileModule('apps/web/src/features/student/actions/canonicalNextAction.ts');
  const destination = await compileModule('apps/web/src/features/student/actions/studentActionDestination.ts');
  const command = await compileModule('apps/web/src/features/student/actions/studentActionCommand.ts', {
    './studentActionDestination': destination,
  });
  const StudentHome = (props) => {
    capturedHomeProps.value = props;
    return { kind: 'StudentHome', props };
  };
  const react = {
    lazy: (loader) => ({ kind: 'lazy', loader }),
    Suspense: 'Suspense',
  };
  const jsxRuntime = createJsxRuntime({ invokeFunctions: true });
  const noOpComponent = () => null;

  return compileModule('apps/web/src/features/student/StudentSections.tsx', {
    react,
    'react/jsx-runtime': jsxRuntime,
    '../../components/ModuleResourceState': { ModuleUnavailable: noOpComponent },
    '../../components/ContextualCoach': { ContextualCoach: noOpComponent },
    '../../components/sectionFallback': { sectionFallback: () => null },
    '../../api/env': { isMockAllowed: () => false },
    '../report/ReviewResourcesPanel': { ReviewResourcesPanel: noOpComponent },
    '../report/WeaknessReportPanel': { WeaknessReportPanel: noOpComponent },
    '../dashboard/LearningProfileCard': { LearningProfileCard: noOpComponent },
    '../practice/training-room/TrainingHero': { TrainingHero: noOpComponent },
    '../practice/training-room/TrainingProgress': { TrainingProgress: noOpComponent },
    '../practice/training-room/TrainingSummary': { TrainingSummary: noOpComponent },
    '../practice/training-room/trainingRoomViewModel': { buildTrainingRoomViewModel: () => ({}) },
    './actions/actionCandidates': actionCandidates,
    './actions/adapters/assessmentActionAdapter': assessmentActions,
    './actions/adapters/reviewActionAdapter': reviewActions,
    './actions/adapters/trainingActionAdapter': { buildTrainingActions: () => [] },
    './actions/adapters/todayActionAdapter': { buildTodayAction: () => null },
    './actions/canonicalNextAction': canonicalNextAction,
    './actions/studentActionCommand': command,
    './home/StudentHome': { StudentHome },
    '../onboarding/todayLearningRoute': { deriveTodayTaskNextStep: () => null },
    './student-learning-experience.css': {},
    '../practice/training-room/training-room.css': {},
  }, { jsx: ts.JsxEmit.ReactJSX });
}

function sectionsFixture(onNavigate, onOpenReview) {
  return {
    visibleSection: 'dashboard',
    studentOverviewReady: true,
    overviewResource: { status: 'ready', data: null, error: null, source: 'api' },
    onRetryOverview: () => {},
    student: {},
    questions: [],
    report: { weakPoints: [] },
    plan: {},
    wrongQuestions: [],
    learningCalendar: { streakDays: 0, today: { practiceCount: 0 } },
    stageReport: null,
    masteryMap: null,
    masteryMapResource: { status: 'ready', data: null, error: null, source: 'api' },
    trialProgress: { status: 'ready', data: null, error: null, source: 'api' },
    studyReminders: { status: 'ready', data: null, error: null, source: 'api' },
    sprintPlan: { status: 'ready', data: null, error: null, source: 'api' },
    learningProfile: { status: 'ready', data: null, error: null, source: 'api' },
    reviewResources: { status: 'ready', data: null, error: null, source: 'api' },
    assessmentHistory: { status: 'ready', data: null, error: null, source: 'api' },
    practiceSet: { status: 'ready', data: null, error: null, source: 'api' },
    practiceSetResult: null,
    wrongQuestionSummary: { status: 'ready', data: null, error: null, source: 'api' },
    showOnboarding: false,
    todayPlan: null,
    todayPlanLoading: false,
    todayPlanError: '',
    todayTaskLaunchingId: null,
    todayTaskLaunchError: '',
    todayTaskLaunchContext: null,
    latestPaper: null,
    examResult: null,
    examQuestionCount: 0,
    remoteSessionsEnabled: true,
    redoQuestionId: null,
    practiceStatus: '',
    practiceSubmitting: false,
    practiceAnswerResult: null,
    currentQuestion: {},
    currentQuestionProgress: { current: 0, total: 0 },
    hasNextQuestion: false,
    detailQuestionId: null,
    wrongStatus: '',
    stageResult: resultFixture('assessment-2'),
    stageAssessment: { questions: [], estimatedMinutes: 10, focusKnowledgePoints: [] },
    assessmentStatus: '',
    onSubmitAssessment: () => {},
    onGenerateAssessment: () => {},
    diagnosticStatus: '',
    feedbackStatus: '',
    planFocusTaskId: null,
    tutorReply: null,
    aiFollowUp: null,
    tutorStatus: '',
    tutorFailed: false,
    onNavigate,
    onLaunchTodayTask: () => {},
    onRetryTodayPlan: () => {},
    onOnboardingComplete: () => {},
    onOpenReview,
    onResumeSession: () => {},
    onStartExam: async () => {},
    onRetryStageReport: () => {},
    onRetryTrial: () => {},
    onRetryReminders: () => {},
    onRetrySprint: () => {},
    onRetryMastery: () => {},
    onRetryLearningProfile: () => {},
    onRetryReviewResources: () => {},
    onRetryAssessmentHistory: () => {},
    onSubmitFeedback: async () => true,
    onSubmitDiagnostic: () => {},
    onSubmitAnswer: () => {},
    onNextQuestion: () => {},
    onSubmitPracticeSet: () => {},
    onStartLearningMode: () => {},
    onRestartPracticeSet: () => {},
    onRestartQuestionBank: () => {},
    onRetryPracticeSet: () => {},
    onOpenDetail: () => {},
    onCloseDetail: () => {},
    onOpenCatalog: () => {},
    onReviewWrongQuestion: () => {},
    onRetryWrongQuestionSummary: () => {},
    onRedo: () => {},
    onPracticeVariant: () => {},
    onAskTutor: () => {},
    onAskFollowUp: () => {},
  };
}

test('StageAssessmentPanel forwards the selected assessment descriptor with its IDs', async () => {
  const { StageAssessmentPanel } = await loadStageAssessmentPanel();
  const calls = [];
  const tree = StageAssessmentPanel({
    assessment: { title: 'Stage assessment', questions: [], estimatedMinutes: 10, focusKnowledgePoints: [], description: '' },
    result: resultFixture(),
    status: '',
    onSubmit: () => {},
    onNavigate: (...args) => calls.push(args),
  });
  const buttons = [];
  walk(tree, (node) => {
    if (node.type === 'button' && node.props?.['data-action-type']) buttons.push(node);
  });

  buttons[0].props.onClick();

  assert.deepEqual(calls, [[
    'wrong-book',
    { kind: 'assessment', section: 'wrong-book', assessmentId: 'assessment-1', questionId: 'question-1' },
  ]]);
});

test('StudentSections forwards the canonical assessment descriptor through its Home callback', async () => {
  const capturedHomeProps = { value: null };
  const { StudentSections } = await loadStudentSections(capturedHomeProps);
  const calls = [];
  StudentSections(sectionsFixture((...args) => calls.push(args), () => {}));

  capturedHomeProps.value.onSelectCanonicalAction(capturedHomeProps.value.canonicalAction);

  assert.deepEqual(calls, [[
    'test',
    { kind: 'assessment', section: 'test', assessmentId: 'assessment-2' },
  ]]);
});

test('session candidates remain runtime-capable while StudentSections keeps the legacy resume read model', async () => {
  const candidatesModule = await compileModule('apps/web/src/features/student/actions/actionCandidates.ts');
  const canonicalModule = await compileModule('apps/web/src/features/student/actions/canonicalNextAction.ts');
  const session = {
    id: 'session-1',
    type: 'practice_set',
    questionIds: ['question-1'],
    answers: {},
    markedQuestions: [],
    currentIndex: 0,
    revision: 1,
    totalQuestions: 1,
    answeredCount: 0,
    startedAt: '2026-09-01T08:00:00.000Z',
    lastActiveAt: '2026-09-01T08:00:00.000Z',
    totalActiveMs: 0,
    completed: false,
    progressRate: 0,
  };
  const sessionAdapter = await compileModule('apps/web/src/features/student/actions/adapters/sessionActionAdapter.ts');
  const action = sessionAdapter.buildContinueSessionAction(session);
  const candidates = candidatesModule.buildStudentActionCandidates({ todayAction: null, session: [action] });

  assert.equal(canonicalModule.selectCanonicalNextAction(candidates)?.context.sessionId, 'session-1');
  assert.deepEqual(candidates.session, [action]);

  const sections = await source('apps/web/src/features/student/StudentSections.tsx');
  const launchpad = await source('apps/web/src/features/onboarding/StudentLaunchpad.tsx');
  assert.doesNotMatch(sections, /^\s+(?:activeSession|session)\??:\s*(?:SessionView|readonly\s+SessionView)/m);
  assert.match(launchpad, /<ResumeSessionBanner[\s\S]*onResume=\{onResumeSession\}/);
});

test('App accepts existing action descriptors at the StudentSections navigation edge', async () => {
  const app = await source('apps/web/src/App.tsx');

  assert.match(app, /function handleStudentNavigate\(section: RoleSection, command\?: StudentActionCommandDescriptor\)/);
  assert.match(app, /command\?\.kind === 'quest'[\s\S]*command\.knowledgeNodeId[\s\S]*command\.questionIds/);
  assert.match(app, /command\?\.kind === 'assessment'[\s\S]*command\.assessmentId[\s\S]*command\.questionId/);
  assert.match(app, /<StudentSections[\s\S]*onNavigate=\{handleStudentNavigate\}/);
  assert.match(app, /onOpenReview=\{\(questionId, command\) => \{[\s\S]*command\?\.kind === 'assessment'[\s\S]*command\.assessmentId/);
});
