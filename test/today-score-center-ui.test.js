import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('reason copy covers every score-center reason, action and subject code', async () => {
  const copy = await source('apps/web/src/features/today-score-center/reason-copy.ts');
  for (const code of [
    'HIGH_RECENT_FREQUENCY',
    'LOW_MASTERY',
    'LOW_ACCURACY',
    'REPEATED_WRONG',
    'REVIEW_DUE',
    'RISING_TREND',
    'PREREQUISITE_GAP',
    'EXAM_NEAR',
    'LOW_EVIDENCE',
  ]) {
    assert.match(copy, new RegExp(`${code}:`), `reason copy should cover ${code}`);
  }
  for (const action of ['LEARN', 'REVIEW', 'PRACTICE', 'WRONG_QUESTION', 'MOCK']) {
    assert.match(copy, new RegExp(`${action}:`), `action copy should cover ${action}`);
  }
  for (const subject of ['DS', 'CO', 'OS', 'CN']) {
    assert.match(copy, new RegExp(`${subject}:`), `subject copy should cover ${subject}`);
  }
});

test('today score center page wires API, time controls, generate and stale banner', async () => {
  const page = await source('apps/web/src/features/today-score-center/TodaysScoreCenter.tsx');
  assert.match(page, /fetchTodayPlan/);
  assert.match(page, /generateScoreCenterPlan/);
  assert.match(page, /MINUTE_OPTIONS = \[30, 60, 120, 180\]/);
  assert.match(page, /generateScoreCenterPlan\(\{/);
  assert.match(page, /setMinutes\(nextMinutes\)/);
  assert.match(page, /stale/);
  assert.match(page, /RecommendationCard/);
  assert.match(page, /WhyRecommendedDrawer/);
});

test('recommendation card and explain drawer expose score, action, minutes and reasons', async () => {
  const card = await source('apps/web/src/features/today-score-center/RecommendationCard.tsx');
  assert.match(card, /score-center-card/);
  assert.match(card, /建议 \{item\.estimatedMinutes\} 分钟/);
  assert.match(card, /为什么推荐/);
  assert.match(card, /开始练习/);

  const drawer = await source('apps/web/src/features/today-score-center/WhyRecommendedDrawer.tsx');
  assert.match(drawer, /分数构成/);
  assert.match(drawer, /中性冷启动值/);
  assert.match(drawer, /examValue/);
});

test('score center remains compatible while the simplified homepage owns the CTA', async () => {
  const navigation = await source('apps/web/src/layouts/RoleNavigation.tsx');
  assert.match(navigation, /'score-center'/);
  assert.match(navigation, /if \(section === 'plan' \|\| section === 'score-center'\) return 'dashboard'/);

  // V3 收敛后首页 CTA 由 TodayMission + StudentActionCard 承载（TodaysScoreCenter
  // 组件保留，经 RoleNavigation 的 score-center 分区进入，兼容性由上方 navigation 检查）。
  const home = await source('apps/web/src/features/student/home/StudentHome.tsx');
  assert.match(home, /TodayMission/);
  assert.match(home, /StudentActionCard/);

  const launchpad = await source('apps/web/src/features/onboarding/StudentLaunchpad.tsx');
  assert.doesNotMatch(
    launchpad,
    /onNavigate\('score-center'\)|score-center/,
    'the homepage should not duplicate score center as a competing first-screen action',
  );
});

test('today plan API type carries the optional score center plan', async () => {
  const onboarding = await source('apps/web/src/api/endpoints/onboarding.ts');
  assert.match(onboarding, /scoreCenter\??: ScoreCenterPlan \| null/);
  const client = await source('apps/web/src/api/endpoints/score-center.ts');
  assert.match(client, /\/score-center\/generate/);
  assert.match(client, /\/knowledge\//);
});
