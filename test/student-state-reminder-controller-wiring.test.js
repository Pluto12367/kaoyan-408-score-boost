import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('study-reminders controller route delegates to StudentStateReminderQueryService', () => {
  const controller = readFileSync('apps/api/src/study/study.controller.ts', 'utf8');
  const routeStart = controller.indexOf("@Get('study-reminders')");
  const nextRouteStart = controller.indexOf("@Get('sprint-plan')", routeStart);
  const routeBlock = controller.slice(routeStart, nextRouteStart);

  assert.match(controller, /StudentStateReminderQueryService/);
  assert.match(controller, /private readonly studentStateReminderQuery/);
  assert.match(
    routeBlock,
    /return this\.studentStateReminderQuery\.getStudyRemindersCompat\(this\.resolveUserId\(user, viewUserId\)\)/,
  );
  assert.doesNotMatch(routeBlock, /studyService\.getStudyReminders/);
});

test('StudyModule registers StudentStateReminderQueryService as a provider', () => {
  const moduleSource = readFileSync('apps/api/src/study/study.module.ts', 'utf8');

  assert.match(moduleSource, /StudentStateReminderQueryService/);
  assert.match(moduleSource, /providers:\s*\[[\s\S]*StudentStateReminderQueryService/);
});
