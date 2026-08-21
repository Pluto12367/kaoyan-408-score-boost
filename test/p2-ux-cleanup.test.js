import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('P2-02: mobile tabs match the simplified student learning flow', async () => {
  const navigation = await source('apps/web/src/layouts/RoleNavigation.tsx');
  const bottomItems = navigation.match(/const studentBottomItems: NavigationItem\[\] = \[([\s\S]*?)\];/)?.[1] ?? '';
  assert.match(bottomItems, /\{ id: 'question', label: '题库', icon: BookOpenCheck \}/, 'question section should be labelled 题库');
  assert.match(bottomItems, /\{ id: 'knowledge-catalog', label: '知识', icon: Network \}/, 'knowledge catalog should be labelled 知识');
  assert.match(bottomItems, /\{ id: 'test', label: '测试', icon: ClipboardCheck \}/, 'test section should be labelled 测试');
  assert.match(navigation, /if \(section === 'report'\) return 'test'/, 'old report links should remain compatible');
  assert.doesNotMatch(bottomItems, /label: '学习'/, 'mobile must not reuse the ambiguous 学习 label');
  assert.doesNotMatch(bottomItems, /label: '我的'/, 'mobile must not reuse the ambiguous 我的 label');
});

test('P2-07: weekly rhythm shows each day its own focus task', async () => {
  const service = await source('apps/api/src/study/study.service.ts');
  const summary = service.slice(service.indexOf('private getSevenDayPlanSummary'), service.indexOf('private findScheduledTask'));
  assert.match(summary, /focusTitle: topTask\?\.title/, 'week summary should carry the day focus title');
  assert.match(summary, /priorityRank\(left\.priority\)/, 'focus task should be the highest-priority task of the day');

  const launchpad = await source('apps/web/src/features/onboarding/StudentLaunchpad.tsx');
  assert.match(launchpad, /subjectName: day\.focusTitle \|\|/, 'launchpad should render the day focus title');

  const typeSource = await source('apps/web/src/api/endpoints/onboarding.ts');
  assert.match(typeSource, /focusTitle\?: string;/, 'TodayPlan type should carry the focus title');
});

test('P2-04: status text is mutually exclusive with the answer result panel', async () => {
  const panel = await source('apps/web/src/features/practice/PracticePanel.tsx');
  assert.match(
    panel,
    /\{!answerResult \? <p className="practice-status">\{status\}<\/p> : null\}/,
    'status line should not render while the answer result panel is shown',
  );
  assert.doesNotMatch(
    panel,
    /<p className="practice-status">\{status\}<\/p>\s*\{answerResult \?/,
    'the two state texts must not stack',
  );
});
