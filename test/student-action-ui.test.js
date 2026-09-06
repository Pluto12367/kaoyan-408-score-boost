import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('ActionCard renders the canonical action title and source', async () => {
  const card = await source('apps/web/src/features/student/actions/StudentActionCard.tsx');

  assert.match(card, /action\.title/);
  assert.match(card, /action\.source/);
  assert.match(card, /onClick=\{\(\) => onSelect\(action\)\}/);
});

test('ActionCard treats a missing reason as optional display data', async () => {
  const card = await source('apps/web/src/features/student/actions/StudentActionCard.tsx');

  assert.match(card, /action\.reason \? \(/);
  assert.match(card, /action\.reason/);
});

test('Student Home stylesheet defines the canonical action card presentation', async () => {
  const styles = await source('apps/web/src/features/student/home/components/dashboard-home.css');

  assert.match(styles, /\.dashboard-home \.student-action-card\s*\{/);
  assert.match(styles, /\.dashboard-home \.student-action-card__source\s*\{/);
  assert.match(styles, /\.dashboard-home \.student-action-card__reason\s*\{/);
  assert.match(styles, /\.dashboard-home \.student-action-card\s+button\s*\{/);
});

test('Home accepts one canonical action and its selection callback', async () => {
  const home = await source('apps/web/src/features/student/home/StudentHome.tsx');

  assert.match(home, /canonicalAction: StudentAction \| null;/);
  assert.match(home, /onSelectCanonicalAction: \(action: StudentAction\) => void;/);
  assert.match(home, /<StudentActionCard[\s\S]*?action=\{canonicalAction\}[\s\S]*?onSelect=\{onSelectCanonicalAction\}/);
});

test('Home renders no primary action when the canonical action is null', async () => {
  const home = await source('apps/web/src/features/student/home/StudentHome.tsx');

  assert.match(home, /canonicalAction \? \([\s\S]*?<StudentActionCard/);
  assert.doesNotMatch(home, /canonicalActions/);
});

test('Home exposes exactly one named canonical action region', async () => {
  const home = await source('apps/web/src/features/student/home/StudentHome.tsx');

  assert.equal((home.match(/dashboard-canonical-action-region/g) ?? []).length, 1);
  assert.match(
    home,
    /<section className="dashboard-canonical-action-region" aria-label="首页核心行动">[\s\S]*?<StudentActionCard[\s\S]*?onSelect=\{onSelectCanonicalAction\}/,
  );
});

test('QuickActions stays explicitly secondary to the canonical home action', async () => {
  const home = await source('apps/web/src/features/student/home/StudentHome.tsx');

  assert.match(
    home,
    /<aside className="dashboard-secondary-actions" aria-label="次要快捷入口">[\s\S]*?<QuickActions onNavigate=\{onNavigate\} \/>[\s\S]*?<\/aside>/,
  );
});

test('Home preserves the existing Today and Review callback names while grouping actions', async () => {
  const home = await source('apps/web/src/features/student/home/StudentHome.tsx');

  assert.match(home, /dashboard-canonical-action-region/);
  assert.match(home, /onLaunch=\{onLaunchTodayTask\}/);
  assert.match(home, /onRefresh=\{onRefreshTodayPlan\}/);
  assert.match(home, /onRetryDueReviews=\{onRetryDueReviews\}/);
  assert.match(home, /onOpenReview=\{onOpenReview\}/);
});

test('Home keeps the legacy home components and imports available', async () => {
  const home = await source('apps/web/src/features/student/home/StudentHome.tsx');
  const sections = await source('apps/web/src/features/student/StudentSections.tsx');
  const launchpad = await source('apps/web/src/features/onboarding/StudentLaunchpad.tsx');
  const nextStep = await source('apps/web/src/features/student/NextLearningStepCard.tsx');

  assert.match(home, /dashboard-canonical-action-region/);
  for (const marker of ['DashboardHero', 'StudentStateCard', 'TodayMission', 'AIInsightCard', 'LearningTrend', 'QuickActions']) {
    assert.match(home, new RegExp(marker), `${marker} must remain in StudentHome`);
  }
  assert.match(sections, /StudentLaunchpad/);
  assert.match(sections, /StudyPlanOverview/);
  assert.match(sections, /LearningProfileCard/);
  assert.match(launchpad, /export function StudentLaunchpad/);
  assert.match(nextStep, /export function NextLearningStepCard/);
});

test('ActionCard stays free of fetches, submission, recommendation, state writes, and providers', async () => {
  const card = await source('apps/web/src/features/student/actions/StudentActionCard.tsx');

  for (const forbidden of ['fetch(', 'submit', 'RecommendationService', 'StudentState', 'Provider', 'useState', 'useEffect', 'localStorage']) {
    assert.equal(card.includes(forbidden), false, `${forbidden} must not appear in StudentActionCard`);
  }
});

test('Review priority card consumes the review center priority item', async () => {
  const card = await source('apps/web/src/features/mistakes/components/PriorityReviewCard.tsx');

  assert.match(card, /item: ReviewCenterPriorityItem \| null/);
  assert.match(card, /\{item\.reason\}/);
  assert.match(card, /下一步：\{item\.suggestedAction\}/);
  assert.match(card, /sourceLabel\(item\?\.source\)/);
  assert.match(card, /EmptyState/, 'a null priority item must render the honest empty state');
});

test('Review workspace ranks displayed questions and feeds the review center view model', async () => {
  const workspace = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');

  assert.match(workspace, /rankWrongReviewItems\(displayQuestions\)/);
  assert.match(workspace, /const todayReviewTask = prioritizedQuestions\[0\] \?\? null;/);
  assert.match(workspace, /buildWrongReviewPriority\(todayReviewTask\)/);
  assert.match(
    workspace,
    /buildReviewCenterViewModel\(\{[\s\S]*dueReviews: effectiveDueReviews,[\s\S]*priorityRedoItems: summaryData\?\.priorityRedoItems \?\? \[\],[\s\S]*displayFallbackItem: todayReviewTask,/,
  );
});

test('Review workspace derives the today task from the displayed question list', async () => {
  const workspace = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');

  assert.match(
    workspace,
    /const prioritizedQuestions = useMemo\(\(\) => rankWrongReviewItems\(displayQuestions\), \[displayQuestions\]\);/,
  );
  assert.match(workspace, /const todayReviewTask = prioritizedQuestions\[0\] \?\? null;/);
});

test('Review queue keeps question identity per row and honest bucket empty states', async () => {
  const queue = await source('apps/web/src/features/mistakes/components/ReviewQueue.tsx');

  assert.match(queue, /const items = queue\[activeTab\];/);
  assert.match(queue, /onOpenReview\(group\.questionIds\[0\]\)/);
  assert.match(queue, /等 \$\{group\.count\} 道题/, 'multi-question groups must show their count');
  for (const bucket of ['today', 'overdue']) {
    assert.match(queue, new RegExp(`'${bucket}'`), `${bucket} bucket should remain a distinct queue`);
  }
  assert.doesNotMatch(queue, /即将到期/, 'the permanently-empty upcoming tab was removed (V8 #30)');
  assert.match(queue, /重新加载/);
});

test('Priority review keeps explicit question context on both actions', async () => {
  const card = await source('apps/web/src/features/mistakes/components/PriorityReviewCard.tsx');

  assert.match(card, /onClick=\{\(\) => onOpenReview\(item\.questionId\)\}/);
  assert.match(card, /onClick=\{\(\) => onRedo\(item\.questionId, item\.knowledgePointTitle\)\}/);
});

test('Review redo carries the matching displayed item title', async () => {
  const workspace = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');
  const vm = await source('apps/web/src/features/mistakes/reviewCenterViewModel.ts');

  assert.match(workspace, /onRedo\(todayReviewTask\.questionId, todayReviewTask\.knowledgePointTitle\)/);
  assert.match(vm, /knowledgePointTitle: item\.knowledgePointTitle/);
});

test('Review fallback states stay honest about their basis', async () => {
  const vm = await source('apps/web/src/features/mistakes/reviewCenterViewModel.ts');
  const card = await source('apps/web/src/features/mistakes/components/PriorityReviewCard.tsx');
  const workspace = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');

  assert.match(vm, /当前没有到期或服务端优先项/);
  assert.match(card, /if \(source === 'display-fallback'\) return '错题展示'/);
  assert.match(workspace, /buildWrongReviewPriority\(todayReviewTask\)/, 'priority wording comes from the shared priority model');
});

test('Review actions carry explicit question context at callback boundaries', async () => {
  const workspace = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');
  const card = await source('apps/web/src/features/mistakes/components/PriorityReviewCard.tsx');
  const queue = await source('apps/web/src/features/mistakes/components/ReviewQueue.tsx');

  assert.match(workspace, /onReview\(todayReviewTask\.questionId\)/);
  assert.match(workspace, /onOpenDetail\(todayReviewTask\.questionId\)/);
  assert.match(workspace, /<PriorityReviewCard item=\{reviewCenter\.priorityItem\} onOpenReview=\{onOpenDetail\} onRedo=\{onRedo\} \/>/);
  for (const callback of ['onOpenDetail', 'onReview', 'onRedo', 'onPracticeVariant', 'onNavigate']) {
    assert.match(workspace, new RegExp(callback));
  }
  assert.match(card, /onOpenReview\(item\.questionId\)/);
  assert.match(queue, /onOpenReview\(group\.questionIds\[0\]\)/);
});

test('Review convergence keeps filters, detail, redo, variant, evidence, and AI Coach capabilities', async () => {
  const workspace = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');
  const detail = await source('apps/web/src/components/WrongQuestionDetail.tsx');

  for (const marker of [
    'buildReviewCenterViewModel',
    'rankWrongReviewItems',
    'chapterOptions',
    'knowledgePointOptions',
    'reviewedWithinDays',
    'WrongQuestionDetailView',
    'onRedo',
    'onPracticeVariant',
    'RecommendationEvidence',
  ]) {
    assert.match(workspace, new RegExp(marker), `${marker} must remain available`);
  }
  assert.match(detail, /ContextualCoach/);
});

test('Review workspace keeps the filtered-data lifecycle explicit (reset, cancel guard, fallback)', async () => {
  const workspace = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');

  assert.match(workspace, /setListError\(''\);[\s\S]{0,80}fetchWrongQuestions\(filters\)/, 'each filter run must start from a clean error state');
  assert.match(workspace, /let cancelled = false;/);
  assert.match(workspace, /if \(!cancelled\) setServerQuestions\(items\);/, 'late filter responses must not overwrite newer state');
  assert.match(workspace, /const displayQuestions = listError && isMockAllowed\(\)\s*\?\s*clientFiltered\s*:\s*\(serverQuestions \?\? wrongQuestions\);/);
});

test('Knowledge node action exposes its knowledge node ID at the catalog boundary', async () => {
  const catalog = await source('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx');

  assert.match(catalog, /buildKnowledgeActions/);
  assert.match(catalog, /const nodeAction = knowledgeActions\.find\(\(action\) => action\.type === 'knowledge_explore'\)/);
  assert.match(catalog, /nodeAction\?\.type === 'knowledge_explore' \? nodeAction\.context\.knowledgeNodeId/);
});

test('Knowledge related practice action keeps both its question ID and node ID', async () => {
  const catalog = await source('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx');

  assert.match(catalog, /relatedQuestionIds: detail\?\.relatedQuestions\.map\(\(question\) => question\.id\)/);
  assert.match(catalog, /candidate\.type === 'practice_recommended' && candidate\.context\.questionId === questionId/);
  assert.match(catalog, /action\.context\.knowledgeNodeId/);
  assert.match(catalog, /onPracticeQuestion\?\.\(action\.context\.questionId, action\.title/);
});

test('Knowledge quest action keeps its node ID and exact question ID list', async () => {
  const catalog = await source('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx');

  assert.match(catalog, /const questAction = knowledgeActions\.find\(\(action\) => action\.type === 'knowledge_quest'\)/);
  assert.match(catalog, /onStartQuest\?\.\([\s\S]*questAction\.context\.knowledgeNodeId,[\s\S]*questAction\.title,[\s\S]*questAction\.context\.questionIds/);
});

test('Knowledge catalog preserves focus and existing catalog callbacks while using action context', async () => {
  const catalog = await source('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx');

  for (const marker of ['focusNodeId', 'onPracticeQuestion', 'onStartQuest', 'onCompleteQuest', 'onNavigate']) {
    assert.match(catalog, new RegExp(marker), `${marker} must remain available`);
  }
  assert.match(
    catalog,
    /onSelectPoint=\{\(point\) => \{[\s\S]*setSelectedActionType\(null\)[\s\S]*setSelectedPointId\(point\.id\)/,
  );
  assert.match(catalog, /focusNodeId/);
});

test('Knowledge catalog keeps one mastery request and does not add a second fetch path', async () => {
  const catalog = await source('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx');

  assert.match(catalog, /buildKnowledgeActions/);
  assert.equal((catalog.match(/fetchMyMastery\(/g) ?? []).length, 1);
  assert.doesNotMatch(catalog, /fetchKnowledgeDetail\([\s\S]*fetchMyMastery\(/);
});

test('Assessment and report results consume structured action context without changing legacy edges', async () => {
  const testSection = await source('apps/web/src/features/test/TestSection.tsx');
  const reportPanel = await source('apps/web/src/features/report/ReportSummaryPanel.tsx');

  assert.match(testSection, /const assessmentActions = buildAssessmentActions\(props\.stageResult\);[\s\S]*assessmentAction\?\.context\.assessmentId/);
  assert.match(reportPanel, /const reportActions = buildReportActions\(\{[\s\S]*scopeKey: 'summary',[\s\S]*insights: visibleLearningInsights/);
  assert.match(reportPanel, /const mistakeAction = reportActions\.find\(\(action\) => action\.type === 'assessment_wrong_questions'\);[\s\S]*toRoleSection\(mistakeAction\?\.destination \?\? 'review'\)/);
  assert.match(reportPanel, /const practiceAction = reportActions\.find\(\(action\) => action\.type === 'assessment_practice'\);[\s\S]*toRoleSection\(practiceAction\?\.destination \?\? 'practice'\)/);
  assert.match(testSection, /request=\{\{ contextType: 'assessment', assessmentId: assessmentAction\?\.context\.assessmentId \?\? props\.stageResult\.id \}\}/);
});

test('Stage assessment results render distinct shared review, wrong-question, practice, and report semantics', async () => {
  const panel = await source('apps/web/src/features/assessment/StageAssessmentPanel.tsx');

  assert.match(panel, /const assessmentActions = result \? buildAssessmentActions\(result\) : \[\];/);
  for (const type of ['assessment_review', 'assessment_wrong_questions', 'assessment_practice', 'open_report']) {
    assert.match(panel, new RegExp(`'${type}'`), `${type} should remain a distinct assessment semantic`);
  }
});

test('Stage assessment actions retain the exact result ID as assessment context', async () => {
  const panel = await source('apps/web/src/features/assessment/StageAssessmentPanel.tsx');

  assert.match(panel, /const assessmentId = assessmentReviewAction\?\.context\.assessmentId \?\? result\?\.id \?\? null;/);
});

test('Stage assessment keeps legacy plan and report aliases on the existing navigation edge', async () => {
  const panel = await source('apps/web/src/features/assessment/StageAssessmentPanel.tsx');

  assert.match(panel, /data-action-type=\{mappedAction\?\.type\}/);
  assert.match(panel, /target: 'plan'/);
  assert.match(panel, /target: 'report'/);
  assert.match(panel, /onNavigate\?\.\(action\.target, mappedAction \? toCommandDescriptor\(mappedAction\) \?\? undefined : undefined\)/);
});

test('Stage assessment shared action descriptors stay free of React callbacks', async () => {
  const panel = await source('apps/web/src/features/assessment/StageAssessmentPanel.tsx');

  assert.match(panel, /studentActionType\?: AssessmentActionType/);
  assert.doesNotMatch(panel, /studentActionType[\s\S]{0,300}onClick/);
});

test('Training summary renders an explicit structured Training action', async () => {
  const summary = await source('apps/web/src/features/practice/training-room/TrainingSummary.tsx');

  assert.match(
    summary,
    /<StudentActionCard[\s\S]*?action=\{action\}[\s\S]*?onSelect=\{onSelectAction\}/,
    'explicit Training actions should use the canonical action card',
  );
});

test('Training summary keeps string-only next actions as text', async () => {
  const summary = await source('apps/web/src/features/practice/training-room/TrainingSummary.tsx');

  assert.match(
    summary,
    /const structuredActions = result\.actions \?\? \[\];[\s\S]*structuredActions\.map\(\(action\) => \([\s\S]*?<StudentActionCard[\s\S]*result\.nextActions\.map\(\(action\) => <li key=\{action\}>\{action\}<\/li>\)/,
    'structured actions must not replace legacy string-only next-action text',
  );
});

test('TrainingSummary stays presentation-only while rendering structured actions', async () => {
  const summary = await source('apps/web/src/features/practice/training-room/TrainingSummary.tsx');

  assert.match(summary, /StudentActionCard/, 'structured actions should be rendered by the summary');
  for (const forbidden of ['fetch(', 'submit', 'useState', 'useEffect', 'localStorage', 'setState']) {
    assert.equal(summary.includes(forbidden), false, `${forbidden} must not appear in TrainingSummary`);
  }
});

test('Session resume keeps the exact session ID and existing StudentSections callback wiring', async () => {
  const sessionAdapter = await source('apps/web/src/features/student/actions/adapters/sessionActionAdapter.ts');
  const sections = await source('apps/web/src/features/student/StudentSections.tsx');

  assert.match(sessionAdapter, /context: \{ sessionId: session\.id \}/);
  assert.match(sections, /<StudentLaunchpad[\s\S]*onResumeSession=\{props\.onResumeSession\}/);
});

test('student entry surfaces converge on canonical CTA markers while preserving each action context', async () => {
  const home = await source('apps/web/src/features/student/home/StudentHome.tsx');
  const review = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');
  const knowledge = await source('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx');
  const assessment = await source('apps/web/src/features/assessment/StageAssessmentPanel.tsx');
  const training = await source('apps/web/src/features/practice/training-room/TrainingSummary.tsx');
  const session = await source('apps/web/src/features/student/actions/adapters/sessionActionAdapter.ts');

  assert.match(home, /canonicalAction: StudentAction \| null;[\s\S]*onSelectCanonicalAction: \(action: StudentAction\) => void;/);
  assert.match(home, /<StudentActionCard[\s\S]*action=\{canonicalAction\}[\s\S]*onSelect=\{onSelectCanonicalAction\}/);
  assert.match(review, /buildReviewCenterViewModel\(\{/);
  assert.match(review, /<ReviewQueue queue=\{reviewCenter\.queue\}[\s\S]*onOpenReview=\{onOpenDetail\} \/>/);
  assert.match(knowledge, /buildKnowledgeActions\([\s\S]*knowledgeNodeId/);
  assert.match(knowledge, /onStartQuest\?\.\([\s\S]*questAction\.context\.knowledgeNodeId[\s\S]*questAction\.context\.questionIds/);
  assert.match(assessment, /data-assessment-id=\{assessmentId\}[\s\S]*data-assessment-action-types=\{assessmentActions\.map/);
  assert.match(training, /<StudentActionCard[\s\S]*action=\{action\}[\s\S]*onSelect=\{onSelectAction\}/);
  assert.match(session, /context: \{ sessionId: session\.id \}/);
});
