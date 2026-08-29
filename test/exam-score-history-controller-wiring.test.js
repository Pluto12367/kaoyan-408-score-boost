import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('exam score history controller uses query service', async () => {
  const source = await readFile(new URL('../apps/api/src/study/study.controller.ts', import.meta.url), 'utf8');
  assert.match(source, /import \{ ExamScoreHistoryQueryService \} from '\.\/exam-score-history\.query\.service';/);
  assert.match(source, /private readonly examScoreHistoryQuery: ExamScoreHistoryQueryService/);
  assert.match(source, /return this\.examScoreHistoryQuery\.getExamScoreHistoryCompat\(user\.id\);/);
  assert.doesNotMatch(source, /this\.studyService\.getExamScoreHistory\(/);
});

test('exam score history route and auth metadata remain unchanged', async () => {
  const source = await readFile(new URL('../apps/api/src/study/study.controller.ts', import.meta.url), 'utf8');
  assert.match(source, /@Get\('exam\/score-history'\)/);
  assert.match(source, /@UseGuards\(RoleGuard\)/);
  assert.match(source, /@Roles\('student', 'teacher', 'admin'\)/);
  assert.match(source, /@CurrentUser\(\) user: UserProfile/);
});

test('module registers exam score history projection and query services', async () => {
  const source = await readFile(new URL('../apps/api/src/study/study.module.ts', import.meta.url), 'utf8');
  assert.match(source, /import \{ ExamScoreHistoryProjectionService \} from '\.\/exam-score-history\.projection\.service';/);
  assert.match(source, /import \{ ExamScoreHistoryQueryService \} from '\.\/exam-score-history\.query\.service';/);
  assert.match(source, /ExamScoreHistoryProjectionService/);
  assert.match(source, /ExamScoreHistoryQueryService/);
});

test('controller remains DTO pass-through and keeps user.id source', async () => {
  const source = await readFile(new URL('../apps/api/src/study/study.controller.ts', import.meta.url), 'utf8');
  assert.match(source, /getExamScoreHistory\(@CurrentUser\(\) user: UserProfile\)/);
  assert.match(source, /return this\.examScoreHistoryQuery\.getExamScoreHistoryCompat\(user\.id\);/);
});
