import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Sprint 2：掌握度地图数据源切换的行为契约。

test('frontend no longer calls the legacy /mastery-map endpoint', () => {
  const endpoints = readFileSync('apps/web/src/api/endpoints/dashboard.ts', 'utf8');
  assert.equal(endpoints.includes('/mastery-map'), false, 'mastery map must read from the student state source');
  assert.match(endpoints, /fetchMyMastery\(\)/, 'mastery map must read GET /knowledge/mastery');
  assert.match(endpoints, /buildNodeMasteryMap\(/, 'display layer must reuse the shared node mastery builder');
  assert.match(endpoints, /getKnowledgeCatalog\(\)/, 'node grouping must reuse the bundled 408 catalog');
});

test('student progress hook wires the authenticated user into the mastery map fetch', () => {
  const hook = readFileSync('apps/web/src/hooks/useStudentProgressData.ts', 'utf8');
  assert.match(hook, /fetchMasteryMap\(userId\)/);
});

test('mastery map consumers keep their existing DTO contract', () => {
  const types = readFileSync('apps/web/src/api/types.ts', 'utf8');
  assert.match(types, /interface MasteryMap \{[\s\S]*weakestPoints: Array<MasteryPoint & \{ subject: string \}>;/);
  // 消费方只做展示级读取（subjects[].averageMastery / points / weakestPoints），
  // 不按 knowledgePointId 与后端数据做联结——ID 空间切换（knowledgePointId 字段
  // 承载 knowledgeNodeId）不影响渲染契约。
  const consoleSource = readFileSync('apps/web/src/features/student/StudentLearningConsole.tsx', 'utf8');
  assert.doesNotMatch(consoleSource, /knowledgePointId ===/);
  const stageReport = readFileSync('packages/shared/src/stageReport.ts', 'utf8');
  assert.doesNotMatch(stageReport, /knowledgePointId ===/);
});
