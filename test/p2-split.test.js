import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAssessmentHistorySummary } from '../packages/shared/dist/assessmentHistorySummary.js';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('P2-3: App navigation utilities live in their own module', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /import \{ useRoleSectionNavigation, withTimeout \} from '\.\/features\/navigation\/useRoleSectionNavigation';/, 'App should import the extracted navigation module');
  assert.doesNotMatch(app, /const SECTION_STORAGE_KEY = 'kaoyan408:last-section';/, 'App must not redefine the storage key');
  assert.doesNotMatch(app, /function withTimeout<T>/, 'App must not define withTimeout locally');
  assert.doesNotMatch(app, /function useRoleSectionNavigation/, 'App must not define the navigation hook locally');

  const navigation = await source('apps/web/src/features/navigation/useRoleSectionNavigation.ts');
  assert.match(navigation, /export function useRoleSectionNavigation\(role\?: UserRole\)/, 'navigation module should export the hook');
  assert.match(navigation, /export function readStoredSection\(role: UserRole\)/, 'navigation module should export readStoredSection');
  assert.match(navigation, /export function withTimeout<T>/, 'navigation module should export withTimeout');
});

test('P2-3: StudyService date helpers move to study-date and summary moves to shared', async () => {
  const service = await source('apps/api/src/study/study.service.ts');
  assert.match(service, /import \{ countByDate, lastNDates, nextNDates, studyDateKey, todayKey \} from '\.\/study-date';/, 'service should import date helpers from study-date');
  assert.match(service, /buildAssessmentHistorySummary,/, 'service should import the shared summary builder');
  assert.doesNotMatch(service, /function todayKey\(\)/, 'service must not define todayKey locally');
  assert.doesNotMatch(service, /function countByDate\(dates: string\[\]\)/, 'service must not define countByDate locally');
  assert.doesNotMatch(service, /private buildAssessmentHistorySummary\(items: AssessmentHistoryItem\[\]\)/, 'service must not define the summary builder locally');
  assert.match(service, /summary: buildAssessmentHistorySummary\(items\)/, 'call site should use the shared builder');

  const studyDate = await source('apps/api/src/study/study-date.ts');
  assert.match(studyDate, /export function todayKey\(\): string/, 'study-date should export todayKey');
  assert.match(studyDate, /export function lastNDates\(count: number\): string\[\]/, 'study-date should export lastNDates');
  assert.match(studyDate, /export function nextNDates\(count: number\): string\[\]/, 'study-date should export nextNDates');
  assert.match(studyDate, /export function countByDate\(dates: string\[\]\): Map<string, number>/, 'study-date should export countByDate');
});

test('P2-3: extracted assessment summary keeps its behavior', () => {
  const empty = buildAssessmentHistorySummary([]);
  assert.equal(empty.attemptCount, 0);
  assert.match(empty.improvementText, /还没有测评记录/);

  const baseline = buildAssessmentHistorySummary([{ score: 72, accuracyRate: 72 }]);
  assert.match(baseline.improvementText, /已建立第一次测评基线/);

  const improved = buildAssessmentHistorySummary([
    { score: 82, accuracyRate: 82 },
    { score: 72, accuracyRate: 72 },
  ]);
  assert.match(improved.improvementText, /较上次提升 10 分/);
  assert.equal(improved.bestScore, 82);
  assert.equal(improved.latestAccuracyRate, 82);
});
