import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// V3 Sprint 1 收尾接线：首页/测试中心页面层收敛的行为契约。

test('dashboard section renders StudentHome and keeps profile + launchpad content', () => {
  const source = readFileSync('apps/web/src/features/student/StudentSections.tsx', 'utf8');
  assert.match(source, /<StudentHome/);
  assert.match(source, /LearningProfileCard/);
  assert.match(source, /StudentLaunchpad/);
  // mock 模式下的七天计划总览保留在首页
  assert.match(source, /StudyPlanOverview plan=\{props\.plan\}/);
  assert.match(source, /isMockAllowed\(\)/);
});

test('test section renders TestSection with stage assessment entry and full report workspace', () => {
  const sections = readFileSync('apps/web/src/features/student/StudentSections.tsx', 'utf8');
  const testSection = readFileSync('apps/web/src/features/test/TestSection.tsx', 'utf8');
  assert.match(sections, /<TestSection/);
  assert.match(sections, /stageAssessment=\{props\.stageAssessment\}/);
  assert.match(sections, /onSubmitAssessment=\{props\.onSubmitAssessment\}/);
  // 测试中心顶部是阶段能力诊断入口（验收 A6-24）
  assert.match(testSection, /StageAssessmentPanel/);
  assert.match(testSection, /阶段能力诊断/);
  // 报告工作台必须收到真实资源，不允许 stub 降级
  assert.match(testSection, /trialProgress=\{props\.trialProgress\}/);
  assert.match(testSection, /sprintPlan=\{props\.sprintPlan\}/);
  assert.match(testSection, /learningProfile=\{props\.learningProfile\}/);
  assert.match(testSection, /onSubmitFeedback=\{props\.onSubmitFeedback\}/);
});

test('legacy plan and score-center sections are merged into the v3 home', () => {
  const app = readFileSync('apps/web/src/App.tsx', 'utf8');
  assert.equal(app.includes("visibleSection === 'plan'"), false, 'plan branch should be merged into the home');
  assert.equal(app.includes("visibleSection === 'score-center'"), false, 'score-center branch should be merged into the home');
  const navigation = readFileSync('apps/web/src/layouts/RoleNavigation.tsx', 'utf8');
  assert.match(navigation, /if \(section === 'plan' \|\| section === 'score-center'\) return 'dashboard';/);
  assert.match(navigation, /if \(section === 'report'\) return 'test';/);
});

test('student home carries the learning calendar and focused today task', () => {
  const home = readFileSync('apps/web/src/features/student/home/StudentHome.tsx', 'utf8');
  assert.match(home, /学习日历/);
  assert.match(home, /calendar-strip/);
  assert.match(home, /focusTaskId=\{planFocusTaskId\}/);
});
