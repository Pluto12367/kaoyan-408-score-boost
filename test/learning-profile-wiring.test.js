import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const typesPath = 'apps/web/src/api/types.ts';
const mockPath = 'apps/web/src/api/mocks/dashboard.ts';
const hookPath = 'apps/web/src/hooks/useStudentProgressData.ts';
const studentSectionsPath = 'apps/web/src/features/student/StudentSections.tsx';
const cardPath = 'apps/web/src/features/dashboard/LearningProfileCard.tsx';
const panelPath = 'apps/web/src/features/report/LearningProfilePanel.tsx';

test('learning profile api contract exposes the richer insight model', () => {
  const source = readFileSync(typesPath, 'utf8');
  assert.match(source, /insights: \{/);
  assert.match(source, /learningState: 'stable' \| 'rising' \| 'risky'/);
  assert.match(source, /focusHints: string\[]/);
  assert.match(source, /weakPoints: Array<\{/);
  assert.match(source, /speedRisks: Array<\{/);
});

test('mock learning profile includes the new insight fields', () => {
  const source = readFileSync(mockPath, 'utf8');
  assert.match(source, /createMockLearningProfile/);
  assert.match(source, /insights: \{/);
  assert.match(source, /learningState: 'stable'/);
  assert.match(source, /focusHints: \['优先补强：Cache 映射与替换', '保持错题复盘闭环'\]/);
});

test('student progress hook still loads learning profile data', () => {
  const source = readFileSync(hookPath, 'utf8');
  assert.match(source, /fetchLearningProfile/);
  assert.match(source, /refreshLearningProfile/);
  assert.match(source, /setLearningProfile/);
  assert.match(source, /learningProfile/);
});

test('student section now renders the learning profile card alongside the console', () => {
  const source = readFileSync(studentSectionsPath, 'utf8');
  assert.match(source, /LearningProfileCard/);
  assert.match(source, /profile=\{props\.learningProfile\}/);
  assert.match(source, /onRetry=\{props\.onRetryLearningProfile\}/);
});

test('learning profile card surfaces weak-point, risk, and state copy', () => {
  const source = readFileSync(cardPath, 'utf8');
  assert.match(source, /profile-state/);
  assert.match(source, /最弱点/);
  assert.match(source, /速度风险/);
  assert.match(source, /主要错因/);
  assert.match(source, /focusHints/);
});

test('learning profile panel keeps the report summary but now includes insight state', () => {
  const source = readFileSync(panelPath, 'utf8');
  assert.match(source, /学习状态/);
  assert.match(source, /stateReason/);
  assert.match(source, /最弱点/);
  assert.match(source, /速度风险/);
});
