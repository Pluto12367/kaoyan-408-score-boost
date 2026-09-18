import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// PHASE 11 (justified assertion update, RULE-02): the two literal-match
// assertions below originally required the handler to be a bare `return
// this.examScoreHistoryQuery.getExamScoreHistoryCompat(user.id);`. PHASE 11
// composes the loss-trend increment at the controller so the query service can
// keep its own architectural contract (no database client, no shared module).
// The handler is still pure delegation — it awaits the query service and merges
// one extra read-only field, with no calculation, no Prisma and no studyService
// call — so the test now pins THAT contract instead of one literal line.
const DELEGATION = /const history = await this\.examScoreHistoryQuery\.getExamScoreHistoryCompat\(user\.id\);/;
const COMPOSE = /return \{ \.\.\.history, lossTrend \};/;

test('exam score history controller uses query service', async () => {
  const source = await readFile(new URL('../apps/api/src/study/study.controller.ts', import.meta.url), 'utf8');
  assert.match(source, /import \{ ExamScoreHistoryQueryService \} from '\.\/exam-score-history\.query\.service';/);
  assert.match(source, /private readonly examScoreHistoryQuery: ExamScoreHistoryQueryService/);
  assert.match(source, DELEGATION);
  assert.match(source, COMPOSE);
  assert.doesNotMatch(source, /this\.studyService\.getExamScoreHistory\(/);
  // Still pure delegation: no database client or arithmetic in the handler.
  const handler = source.slice(source.indexOf('getExamScoreHistory(@CurrentUser()'), source.indexOf('getExamDiagnosis('));
  assert.doesNotMatch(handler, /prisma|\*|\+/, 'the handler must not calculate');
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
  assert.match(source, DELEGATION);
  assert.match(source, COMPOSE);
});
