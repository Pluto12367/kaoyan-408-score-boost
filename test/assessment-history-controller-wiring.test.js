import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('assessment history controller uses AssessmentHistoryQueryService', async () => {
  const source = await readFile(new URL('../apps/api/src/study/study.controller.ts', import.meta.url), 'utf8');
  assert.match(source, /import \{ AssessmentHistoryQueryService \} from '\.\/assessment-history-query\.service';/);
  assert.match(source, /private readonly assessmentHistoryQuery: AssessmentHistoryQueryService/);
  assert.match(source, /return this\.assessmentHistoryQuery\.getAssessmentHistoryCompat\(this\.resolveUserId\(user, viewUserId\)\);/);
  assert.doesNotMatch(source, /this\.studyService\.getAssessmentHistory\(/);
});

test('assessment history route and auth metadata remain unchanged', async () => {
  const source = await readFile(new URL('../apps/api/src/study/study.controller.ts', import.meta.url), 'utf8');
  assert.match(source, /@Get\('assessment-history'\)/);
  assert.match(source, /@UseGuards\(RoleGuard\)/);
  assert.match(source, /@Roles\('student', 'teacher', 'admin'\)/);
  assert.match(source, /@CurrentUser\(\) user: UserProfile/);
  assert.match(source, /@Query\('userId'\) viewUserId\?: string/);
});

test('assessment history userId resolve and DTO pass-through remain intact', async () => {
  const source = await readFile(new URL('../apps/api/src/study/study.controller.ts', import.meta.url), 'utf8');
  assert.match(source, /getAssessmentHistoryCompat\(this\.resolveUserId\(user, viewUserId\)\)/);
  assert.equal(source.includes('summary ='), false);
  assert.equal(source.includes('items ='), false);
});

test('assessment history projection and query services are registered once', async () => {
  const source = await readFile(new URL('../apps/api/src/study/study.module.ts', import.meta.url), 'utf8');
  assert.match(source, /import \{ AssessmentHistoryProjectionService \} from '\.\/assessment-history-projection\.service';/);
  assert.match(source, /import \{ AssessmentHistoryQueryService \} from '\.\/assessment-history-query\.service';/);
  assert.equal((source.match(/AssessmentHistoryProjectionService/g) ?? []).length, 2);
  assert.equal((source.match(/AssessmentHistoryQueryService/g) ?? []).length, 2);
});
