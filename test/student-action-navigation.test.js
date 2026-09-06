import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function readSource(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

async function loadModule(path, dependencies = {}) {
  const source = await readSource(path);
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

async function loadCommandModule() {
  const destination = await loadModule('apps/web/src/features/student/actions/studentActionDestination.ts');
  return loadModule('apps/web/src/features/student/actions/studentActionCommand.ts', {
    './studentActionDestination': destination,
  });
}

function action(overrides = {}) {
  return {
    id: 'action-1',
    type: 'today_task',
    title: 'Today task',
    destination: 'practice',
    source: 'today-plan',
    context: { taskId: 'task-1' },
    ...overrides,
  };
}

test('maps today_task to the existing today launch port with its task ID', async () => {
  const { toCommandDescriptor } = await loadCommandModule();

  assert.deepEqual(toCommandDescriptor(action()), {
    kind: 'today',
    taskId: 'task-1',
  });
});

test('maps review and redo actions to separate question command ports', async () => {
  const { toCommandDescriptor } = await loadCommandModule();

  assert.deepEqual(toCommandDescriptor(action({
    type: 'review_due',
    title: 'Due review',
    destination: 'review',
    source: 'review-due',
    context: { questionId: 'question-due' },
  })), {
    kind: 'review',
    questionId: 'question-due',
  });
  assert.deepEqual(toCommandDescriptor(action({
    type: 'redo_wrong_question',
    title: 'Redo wrong question',
    destination: 'practice',
    source: 'wrong-summary',
    context: { questionId: 'question-redo' },
  })), {
    kind: 'redo',
    questionId: 'question-redo',
  });
});

test('maps practice recommendations while retaining every available practice ID', async () => {
  const { toCommandDescriptor } = await loadCommandModule();

  assert.deepEqual(toCommandDescriptor(action({
    type: 'practice_recommended',
    title: 'Practice weak point',
    destination: 'practice',
    source: 'training',
    context: {
      questionId: 'question-1',
      knowledgeNodeId: 'node-1',
      taskId: 'task-1',
    },
  })), {
    kind: 'practice',
    section: 'question',
    questionId: 'question-1',
    knowledgeNodeId: 'node-1',
    taskId: 'task-1',
  });
});

test('maps knowledge_explore to the catalog-node port with its node ID', async () => {
  const { toCommandDescriptor } = await loadCommandModule();

  assert.deepEqual(toCommandDescriptor(action({
    type: 'knowledge_explore',
    title: 'Explore node',
    destination: 'knowledge',
    source: 'knowledge',
    context: { knowledgeNodeId: 'node-1' },
  })), {
    kind: 'catalog-node',
    knowledgeNodeId: 'node-1',
  });
});

test('maps knowledge_quest to the quest port with node and question IDs', async () => {
  const { toCommandDescriptor } = await loadCommandModule();

  assert.deepEqual(toCommandDescriptor(action({
    type: 'knowledge_quest',
    title: 'Node quest',
    destination: 'practice',
    source: 'knowledge',
    context: { knowledgeNodeId: 'node-quest', questionIds: ['question-1', 'question-2'] },
  })), {
    kind: 'quest',
    knowledgeNodeId: 'node-quest',
    questionIds: ['question-1', 'question-2'],
  });
});

test('maps assessment and report actions through RoleSection compatibility without replacing IDs', async () => {
  const { toCommandDescriptor } = await loadCommandModule();

  assert.deepEqual(toCommandDescriptor(action({
    type: 'assessment_review',
    title: 'Review assessment',
    destination: 'test',
    source: 'assessment',
    context: { assessmentId: 'assessment-1', questionId: 'question-1' },
  })), {
    kind: 'assessment',
    section: 'test',
    assessmentId: 'assessment-1',
    questionId: 'question-1',
  });
  assert.deepEqual(toCommandDescriptor(action({
    type: 'assessment_wrong_questions',
    title: 'Assessment wrong question',
    destination: 'review',
    source: 'assessment',
    context: { assessmentId: 'assessment-2', questionId: 'question-2' },
  })), {
    kind: 'assessment',
    section: 'wrong-book',
    assessmentId: 'assessment-2',
    questionId: 'question-2',
  });
  assert.deepEqual(toCommandDescriptor(action({
    type: 'assessment_practice',
    title: 'Assessment practice',
    destination: 'practice',
    source: 'assessment',
    context: { assessmentId: 'assessment-3' },
  })), {
    kind: 'assessment',
    section: 'question',
    assessmentId: 'assessment-3',
  });
  assert.deepEqual(toCommandDescriptor(action({
    type: 'open_report',
    title: 'Open report',
    destination: 'test',
    source: 'report',
    context: { reportId: 'report-1', assessmentId: 'assessment-4' },
  })), {
    kind: 'report',
    section: 'test',
    reportId: 'report-1',
    assessmentId: 'assessment-4',
  });
});

test('maps session resume by session ID and leaves coach explain at its existing edge', async () => {
  const { toCommandDescriptor } = await loadCommandModule();

  assert.deepEqual(toCommandDescriptor(action({
    type: 'continue_session',
    title: 'Continue session',
    destination: 'practice',
    source: 'session',
    context: { sessionId: 'session-1' },
  })), {
    kind: 'session-resume',
    section: 'question',
    sessionId: 'session-1',
  });
  assert.equal(toCommandDescriptor(action({
    type: 'coach_explain',
    title: 'Explain',
    destination: 'ai',
    source: 'coach',
    context: { questionId: 'question-1' },
  })), null);
});

test('loads due reviews through the existing endpoint at the App boundary', async () => {
  const source = await readSource('apps/web/src/App.tsx');

  assert.match(source, /import\s*\{\s*fetchDueReviews,\s*type DueReviewsResponse\s*\}\s*from '\.\/api\/endpoints\/review';/);
  assert.match(source, /fetchDueReviews\(\)/);
  assert.match(source, /<StudentSections[\s\S]*?dueReviews=\{dueReviews\}/);
});

test('passes the existing due review response from StudentSections to both Home and Review', async () => {
  const source = await readSource('apps/web/src/features/student/StudentSections.tsx');

  assert.match(source, /import type \{ DueReviewsResponse \} from '..\/..\/api\/endpoints\/review';/);
  assert.match(source, /dueReviews\?: DueReviewsResponse \| null;/);
  assert.match(source, /const dueReviews = props\.dueReviews \?\? null;/);
  assert.match(source, /<StudentHome[\s\S]*?dueReviews=\{dueReviews\}/);
  assert.match(source, /<MistakeWorkspace[\s\S]*?dueReviews=\{dueReviews\}/);
});

test('passes the shared due review resource from StudentHome to TodayPlan', async () => {
  const source = await readSource('apps/web/src/features/student/home/StudentHome.tsx');

  assert.match(source, /import type \{ DueReviewsResponse \} from '..\/..\/..\/api\/endpoints\/review';/);
  assert.match(source, /dueReviews\?: DueReviewsResponse \| null;/);
  assert.match(source, /<TodayPlan[\s\S]*?dueReviews=\{dueReviews\}/);
});

test('uses the supplied due review resource in TodayPlan and only fetches as a compatibility fallback', async () => {
  const source = await readSource('apps/web/src/components/TodayPlan.tsx');

  assert.match(source, /dueReviews: suppliedDueReviews/);
  assert.match(source, /const usesSuppliedDueReviews = suppliedDueReviews !== undefined;/);
  assert.match(source, /const dueReviewItems = suppliedDueReviews\?\.items \?\? fallbackDueReviews;/);
  assert.match(source, /if \(usesSuppliedDueReviews\) \{\s*onRetryDueReviews\?\.\(\);/);
  assert.match(source, /if \(!usesSuppliedDueReviews\) \{\s*loadDueReviews\(\);/);
});

test('uses supplied due review items in MistakeWorkspace priority selection', async () => {
  const source = await readSource('apps/web/src/features/mistakes/MistakeWorkspace.tsx');

  assert.match(source, /MistakeWorkspace\(\{[\s\S]*?dueReviews,[\s\S]*?dueReviewsLoading[\s\S]*?dueReviewsError[\s\S]*?onRetryDueReviews,/);
  assert.match(source, /const effectiveDueReviews = dueReviews\?\.items \?\? \(dueReviews === null \? \[\] : localDueReviews\);/);
  assert.match(source, /buildReviewCenterViewModel\(\{[\s\S]*dueReviews: effectiveDueReviews,/);
  assert.match(source, /const retryDueReviews = dueReviews !== undefined \? \(onRetryDueReviews \?\? loadDueReviews\) : loadDueReviews;/);
  assert.match(source, /onClick=\{retryDueReviews\}/);
});

test('keeps protected practice, session, theme, shared, and backend files outside the action-spine boundary', async () => {
  const protectedPaths = [
    'apps/web/src/components/ExamSession.tsx',
    'apps/web/src/features/practice/PracticePanel.tsx',
    'apps/web/src/hooks/usePracticeSession.ts',
    'apps/web/src/styles.css',
    'apps/web/src/theme-optimizations.css',
    'apps/web/src/theme/themePreference.ts',
    'packages/shared/src/learning.ts',
    'apps/api/src/main.ts',
  ];

  for (const path of protectedPaths) {
    const source = await readSource(path);
    assert.doesNotMatch(source, /StudentAction|canonicalAction|actionCandidates|studentAction/, `${path} must remain outside the action-spine boundary`);
  }
});

test('keeps exact action context at the StudentSections command composition boundary', async () => {
  const source = await readSource('apps/web/src/features/student/StudentSections.tsx');

  assert.match(source, /const onSelectCanonicalAction = \(action: StudentAction\) => \{/);
  assert.match(source, /const command = toCommandDescriptor\(action\);[\s\S]*if \(!command\) \{[\s\S]*if \(action\.type === 'coach_explain'\) props\.onNavigate\('ai'\);[\s\S]*return;[\s\S]*\}/);
  assert.match(source, /case 'today_task':[\s\S]*action\.context\.taskId[\s\S]*props\.onLaunchTodayTask/);
  assert.match(source, /case 'review_due':[\s\S]*props\.onOpenReview\(action\.context\.questionId,\s*command\)/);
  assert.match(source, /case 'redo_wrong_question':[\s\S]*props\.onRedo\(action\.context\.questionId\)/);
  assert.match(source, /case 'practice_recommended':[\s\S]*action\.context\.(?:questionId|knowledgeNodeId|taskId)/);
  assert.match(source, /case 'knowledge_explore':[\s\S]*action\.context\.knowledgeNodeId/);
  assert.match(source, /case 'knowledge_quest':[\s\S]*action\.context\.questionIds/);
  assert.match(source, /case 'assessment_review':[\s\S]*action\.context\.assessmentId/);
  assert.match(source, /case 'assessment_wrong_questions':[\s\S]*action\.context\.assessmentId/);
  assert.match(source, /case 'assessment_practice':[\s\S]*action\.context\.assessmentId/);
  assert.match(source, /case 'open_report':[\s\S]*action\.context\.reportId/);
  assert.match(source, /case 'continue_session':[\s\S]*action\.context\.sessionId/);
});
