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

test('ActionCard stays free of fetches, submission, recommendation, state writes, and providers', async () => {
  const card = await source('apps/web/src/features/student/actions/StudentActionCard.tsx');

  for (const forbidden of ['fetch(', 'submit', 'RecommendationService', 'StudentState', 'Provider', 'useState', 'useEffect', 'localStorage']) {
    assert.equal(card.includes(forbidden), false, `${forbidden} must not appear in StudentActionCard`);
  }
});

test('Review priority card consumes canonical action presentation data', async () => {
  const card = await source('apps/web/src/features/mistakes/components/PriorityReviewCard.tsx');

  assert.match(card, /action: StudentAction/);
  assert.match(card, /action\.source/);
  assert.match(card, /action\.title/);
  assert.match(card, /const displayReason = isFallback\s*\?/);
  assert.match(card, /const displayHint = isFallback\s*\?/);
});

test('Review workspace preserves due, priority redo, and fallback action order', async () => {
  const workspace = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');

  assert.match(workspace, /buildReviewActions\(\{[\s\S]*dueReviews:[\s\S]*priorityRedoItems:[\s\S]*displayFallbackItems:/);
  assert.match(workspace, /const priorityReviewAction = reviewActions\[0\] \?\? null;/);
  assert.match(workspace, /actions=\{reviewActions\.slice\(1\)\}/);
  assert.doesNotMatch(workspace, /rankWrongReviewItems/);
  assert.doesNotMatch(workspace, /todayReviewTask/);
});

test('Review workspace filters canonical review inputs to displayed questions', async () => {
  const workspace = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');

  assert.match(workspace, /const allowedQuestionIds = useMemo\(\(\) => new Set\(displayQuestions\.map\(\(item\) => item\.questionId\)\), \[displayQuestions\]\);/);
  assert.match(workspace, /dueReviews: \(dueReviews\?\.items \?\? \[\]\)\.filter\(\(item\) => allowedQuestionIds\.has\(item\.questionId\)\)/);
  assert.match(workspace, /priorityRedoItems: \(summaryData\?\.priorityRedoItems \?\? \[\]\)\.filter\(\(item\) => allowedQuestionIds\.has\(item\.questionId\)\)/);
});

test('Review queue keeps canonical action identity and neutral fallback metadata', async () => {
  const queue = await source('apps/web/src/features/mistakes/components/ReviewQueue.tsx');

  assert.match(queue, /key=\{action\.id\}/);
  assert.match(queue, /type ReviewAction = Extract<StudentAction, \{ type: 'review_due' \| 'redo_wrong_question' \}>/);
  assert.match(queue, /onOpenReview\(action\)/);
  assert.match(queue, /const displayReason = isFallback\s*\?/);
  assert.match(queue, /当前没有可用的到期复习或优先重做依据，先处理这道错题。/);
  assert.doesNotMatch(queue, /action\.reason \? \(/);
  assert.doesNotMatch(queue, /风险/);
});

test('Priority review keeps the legacy review callback for every canonical review action', async () => {
  const card = await source('apps/web/src/features/mistakes/components/PriorityReviewCard.tsx');

  assert.match(card, /onClick=\{\(\) => onReview\(action\)\}>先复盘这题<\/button>/);
  assert.match(card, /onClick=\{\(\) => onRedo\(action\)\}>重做这题<\/button>/);
  assert.doesNotMatch(card, /action\.type === 'review_due' \? \(\s*<button/);
});

test('Review workspace derives redo title from the matching displayed item', async () => {
  const workspace = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');

  assert.match(workspace, /const displayItemByQuestionId = useMemo\(\(\) => new Map\(displayQuestions\.map\(\(item\) => \[item\.questionId, item\]\)\), \[displayQuestions\]\);/);
  assert.match(workspace, /const redoFromReviewAction = \(action: ReviewAction\) => \{[\s\S]*const displayItem = displayItemByQuestionId\.get\(action\.context\.questionId\);[\s\S]*onRedo\(action\.context\.questionId, displayItem\?\.knowledgePointTitle\);/);
  assert.match(workspace, /onRedo=\{redoFromReviewAction\}/);
  assert.doesNotMatch(workspace, /redoKnowledgePointTitleByQuestionId/);
});

test('Review fallback never derives risk metadata from priority logic', async () => {
  const workspace = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');
  const card = await source('apps/web/src/features/mistakes/components/PriorityReviewCard.tsx');

  assert.match(workspace, /priorityReviewAction\.source !== 'wrong-summary-fallback'[\s\S]*buildWrongReviewPriority/);
  assert.match(card, /isFallback \? '展示兜底'/);
  assert.match(card, /当前没有可用的到期复习或优先重做依据，先处理这道错题。/);
  assert.match(card, /完成这道展示兜底错题后，再用变式题验证。/);
});

test('Review actions preserve their own redo and detail context at callback boundaries', async () => {
  const workspace = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');
  const card = await source('apps/web/src/features/mistakes/components/PriorityReviewCard.tsx');
  const queue = await source('apps/web/src/features/mistakes/components/ReviewQueue.tsx');

  assert.match(workspace, /const redoFromReviewAction = \(action: ReviewAction\) => \{[\s\S]*displayItemByQuestionId\.get\(action\.context\.questionId\)[\s\S]*onRedo\(action\.context\.questionId, displayItem\?\.knowledgePointTitle\);/);
  assert.match(workspace, /onRedo=\{redoFromReviewAction\}/);
  assert.match(workspace, /onOpenDetail=\{\(action\) => onOpenDetail\(action\.context\.questionId\)\}/);
  assert.doesNotMatch(workspace, /todayReviewTask\?\.knowledgePointTitle/);
  assert.match(card, /onRedo\(action\)/);
  assert.match(card, /onOpenDetail\(action\)/);
  assert.match(queue, /onRedo\(action\)/);
  assert.match(queue, /onOpenDetail\(action\)/);
  for (const callback of ['onOpenDetail', 'onReview', 'onRedo', 'onPracticeVariant', 'onNavigate']) {
    assert.match(workspace, new RegExp(callback));
  }
});

test('Review convergence keeps filters, detail, redo, variant, evidence, and AI Coach capabilities', async () => {
  const workspace = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');
  const detail = await source('apps/web/src/components/WrongQuestionDetail.tsx');

  for (const marker of [
    'reviewActions',
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

test('Review workspace keeps non-mock canonical actions empty until filtered data is loaded', async () => {
  const workspace = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');

  assert.match(workspace, /setServerQuestions\(null\);\s*setListError\(''\);/);
  assert.match(workspace, /const displayQuestions = isMockAllowed\(\) && \(listLoading \|\| listError\)\s*\?\s*clientFiltered\s*:\s*listLoading \|\| listError\s*\?\s*\[\]\s*:\s*\(serverQuestions \?\? \(isMockAllowed\(\) \? wrongQuestions : \[\]\)\);/);
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
  assert.match(reportPanel, /const reportActions = buildReportActions\([\s\S]*scopeKey:[\s\S]*learningInsights/);
  assert.match(reportPanel, /const mistakeAction = reportActions\.find\(\(action\) => action\.type === 'assessment_wrong_questions'\);[\s\S]*toRoleSection\(mistakeAction\?\.destination \?\? 'review'\)/);
  assert.match(reportPanel, /const practiceAction = reportActions\.find\(\(action\) => action\.type === 'assessment_practice'\);[\s\S]*toRoleSection\(practiceAction\?\.destination \?\? 'practice'\)/);
  assert.match(testSection, /request=\{\{ contextType: 'assessment', assessmentId: assessmentAction\?\.context\.assessmentId \?\? props\.stageResult\.id \}\}/);
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
