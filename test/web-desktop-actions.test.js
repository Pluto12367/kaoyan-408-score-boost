import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('desktop fix: wrong-question filters cover chapter/knowledge point/wrong count/review recency', async () => {
  const workspace = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');
  for (const token of ['章节', '知识点', '错误次数', '最近复习', 'chapterOptions', 'knowledgePointOptions', 'minWrongCount', 'reviewedWithinDays']) {
    assert.match(workspace, new RegExp(token));
  }
  assert.match(workspace, /chapter: chapter \|\| undefined/);
  assert.match(workspace, /reviewedWithinDays: reviewedWithinDays \? Number\(reviewedWithinDays\) : undefined/);
});

test('desktop fix: wrong-question rows surface variant retest progress', async () => {
  const workspace = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');
  assert.match(workspace, /变式答对 \$\{item\.masteryCriteria\.variantCorrectCount\}\/3 次/);
});

test('desktop fix: detail panel opens with a scroll-into-view anchor', async () => {
  const detail = await source('apps/web/src/components/WrongQuestionDetail.tsx');
  assert.match(detail, /scrollIntoView/);
  assert.match(detail, /wrong-question-detail/);
  assert.match(detail, /useRef/);
});

test('desktop fix: report mastery actions navigate to wrong-book / question', async () => {
  const overview = await source('apps/web/src/features/dashboard/StudentProgressOverview.tsx');
  assert.match(overview, /onNavigate: \(section: RoleSection\) => void/);
  assert.match(overview, /onNavigate\(point\.actionAnchor === '#wrong-book' \? 'wrong-book' : 'question'\)/);
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /onNavigate=\{setActiveSection\}/);
});

test('desktop fix: dashboard route and lower insight cards expose their destinations', async () => {
  const launchpad = await source('apps/web/src/features/onboarding/StudentLaunchpad.tsx');
  assert.match(launchpad, /onOpenPlan=\{\(\) => onNavigate\('plan'\)\}/);
  assert.match(launchpad, /onOpenWrongBook=\{\(\) => onNavigate\('wrong-book'\)\}/);
  assert.match(launchpad, /onClick=\{\(\) => onNavigate\('question'\)\}/);
  assert.match(launchpad, /onOpenReview\(item\.questionId\)/);
  assert.match(launchpad, /onNavigate\('report'\)/);
});
