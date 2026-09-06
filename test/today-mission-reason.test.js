import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// V8 backlog #11 (frontend half) — the today-plan payload already carries a
// per-task free-text reason (spread from the StudyTask row); the mission list
// must show it so students see WHY before launching.

test('TodayMission surfaces the per-task recommendation reason', () => {
  const component = readFileSync('apps/web/src/features/student/home/components/TodayMission.tsx', 'utf8');
  assert.match(component, /task\.source\.reason/);
  assert.match(component, /dashboard-task-reason/);
});
