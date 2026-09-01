import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const detailPath = new URL('../apps/web/src/components/WrongQuestionDetail.tsx', import.meta.url);

test('WrongQuestionDetail keeps memo hooks before loading and error branches', async () => {
  const source = await readFile(detailPath, 'utf8');
  const memoIndex = source.indexOf('const evidenceSummary = useMemo');
  const errorGuardIndex = source.indexOf('if (error) return');
  const detailGuardIndex = source.indexOf('if (!detail) return');

  assert.notEqual(memoIndex, -1, 'the evidence summary memo should remain present');
  assert.ok(memoIndex < errorGuardIndex, 'memo hooks must be declared before the error guard');
  assert.ok(memoIndex < detailGuardIndex, 'memo hooks must be declared before the loading guard');
});
