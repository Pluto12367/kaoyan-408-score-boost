// V14-R4-A — frontend wiring contract for the real-exam presentation surfaces.
// Task book: docs/v14-r4-presentation-design.md §3.1/§3.3 + D-R4-1 (new nav
// section 「真题」). Behavioural evidence lives in the real PG+HTTP E2E.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('P0-FE nav: 「真题」 is a first-class student section (D-R4-1)', async () => {
  const nav = await read('apps/web/src/layouts/RoleNavigation.tsx');
  assert.match(nav, /'real-exam'/, 'RoleSection union includes real-exam');
  assert.match(nav, /id: 'real-exam', label: '真题'/, 'nav item registered');
  assert.match(nav, /studentCompatSections/, 'compat list present');
  const compat = nav.slice(nav.indexOf('studentCompatSections'), nav.indexOf('studentCompatSections') + 400);
  assert.match(compat, /'real-exam'/, 'real-exam allowed for student role');
});

test('P0-FE dispatch: StudentSections renders the workspace on the real-exam section', async () => {
  const sections = await read('apps/web/src/features/student/StudentSections.tsx');
  assert.match(sections, /RealExamWorkspace/);
  assert.match(sections, /visibleSection === 'real-exam'/);
});

test('P0-FE components: board derives tone from projection only; no demo fallback', async () => {
  const view = await read('apps/web/src/features/real-exam/realExamView.ts');
  assert.match(view, /slotTone/, 'tone derivation helper exists');
  assert.match(view, /'empty'/, 'absent slots stay an honest tone');
  const board = await read('apps/web/src/features/real-exam/YearBoard.tsx');
  assert.match(board, /加载失败/, 'fetch failures render explicitly (no silent fallback)');
  assert.match(board, /尚未收录/, 'uncovered years stay an honest empty state');
  const screens = await read('apps/web/src/features/real-exam/ExamDataScreens.tsx');
  assert.match(screens, /加载失败/, 'data-screen failures render explicitly');
  const workspace = await read('apps/web/src/features/real-exam/RealExamWorkspace.tsx');
  assert.match(workspace, /作战板/);
  assert.match(workspace, /数据屏/);
});

test('P0-FE R4-B: 套卷 tab wires the year-paper flow without demo fallback', async () => {
  const workspace = await read('apps/web/src/features/real-exam/RealExamWorkspace.tsx');
  assert.match(workspace, /套卷/, 'third tab registered');
  assert.match(workspace, /onStartYearPaper/, 'year-paper callback wired');
  const papers = await read('apps/web/src/features/real-exam/YearPapers.tsx');
  assert.match(papers, /未收录/, 'unindexed years stay an explicit empty state');
  assert.match(papers, /150 分/, 'the 150-point paper structure is stated');
  const app = await read('apps/web/src/App.tsx');
  assert.match(app, /handleStartYearExamPaper/);
  assert.match(app, /真题套卷需要连接后端使用/, 'demo mode rejects honestly (真题内容不可伪造)');
  assert.match(app, /onStartYearExamPaper=\{handleStartYearExamPaper\}/);
});

test('P0-FE R4-C: enhanced screens wired into the data screen with honest empty states', async () => {
  const data = await read('apps/web/src/features/real-exam/ExamDataScreens.tsx');
  assert.match(data, /ExamEnhancedScreens/, 'enhanced block mounted inside 数据屏');
  const enhanced = await read('apps/web/src/features/real-exam/ExamEnhancedScreens.tsx');
  assert.match(enhanced, /章节命题图谱/);
  assert.match(enhanced, /命题轨迹/);
  assert.match(enhanced, /难题榜/);
  assert.match(enhanced, /样本不足/, 'sample floor stated honestly');
  assert.match(enhanced, /自动点亮/, 'trajectory empty state explains why');
  assert.match(enhanced, /加载失败/, 'fetch failures render explicitly');
  const api = await read('apps/web/src/api/endpoints/realExam.ts');
  assert.match(api, /fetchRealExamChapters/);
  assert.match(api, /fetchRealExamTrajectory/);
  assert.match(api, /fetchRealExamHardQuestions/);
});
