import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('post-exam review tasks come from the exam itself, not the global fallback point', async () => {
  const source = await readFile(new URL('../apps/api/src/study/study.service.ts', import.meta.url), 'utf8');
  const block = source.slice(
    source.indexOf('generatePostExamReviewTasksUnlocked'),
    source.indexOf('private collectExamCoveredPoints'),
  );

  assert.match(block, /collectExamCoveredPoints\(session\)/, 'perfect exams should reuse covered exam points');
  assert.match(block, /const sourcePoints = lossPoints\.length > 0 \? lossPoints : coveredPoints;/, 'losses take priority, covered points are the perfect-score source');
  assert.match(block, /const isPerfect = report\.knowledgePointLosses\.length === 0;/, 'perfect score must be detectable');
  assert.doesNotMatch(
    block,
    /knowledgePointLosses\[index\] \?\? report\.knowledgePointLosses\[0\]/,
    'legacy global-fallback-on-empty-losses behavior must be gone',
  );
});

test('perfect-score review tasks are framed as consolidation of covered points', async () => {
  const source = await readFile(new URL('../apps/api/src/study/study.service.ts', import.meta.url), 'utf8');
  const block = source.slice(
    source.indexOf('generatePostExamReviewTasksUnlocked'),
    source.indexOf('getExamScoreHistory'),
  );

  assert.match(block, /限时复练 \$?\{point\.title\}/, 'perfect-score tasks should be timed consolidation practice');
  assert.match(block, /全部答对[\s\S]*限时巩固/, 'recommendation should explain the all-correct case');
  assert.match(block, /来源\$?\{isPerfect \? '本场考试覆盖考点（全对巩固）'/, 'task reason should state the source explicitly');
  assert.match(block, /weakPointTitles: sourcePoints\.length > 0/, 'weak point titles should come from exam-derived points');
});

test('collectExamCoveredPoints is implemented as a deduplicated exam-scoped scan', async () => {
  const source = await readFile(new URL('../apps/api/src/study/study.service.ts', import.meta.url), 'utf8');
  const helper = source.slice(source.indexOf('private collectExamCoveredPoints'), source.indexOf('getExamScoreHistory'));
  assert.match(helper, /const seen = new Set<string>\(\)/, 'covered points should be deduplicated');
  assert.match(helper, /session\.questionSnapshot/, 'helper should scan the exam question snapshot');
  assert.match(helper, /if \(point\) covered\.push\(point\);/, 'only catalog knowledge points should be collected');
});
