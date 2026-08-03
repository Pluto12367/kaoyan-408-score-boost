import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { parseSelectedPageRanges } from '../apps/api/dist/questions/import/import-worker.service.js';

test('PDF page selection intersects requested ranges with document bounds and provider limit', () => {
  assert.deepEqual(parseSelectedPageRanges('2-4, 7, 9-12', 10, 2), [
    { pageStart: 2, pageEnd: 3 }, { pageStart: 4, pageEnd: 4 }, { pageStart: 7, pageEnd: 7 }, { pageStart: 9, pageEnd: 10 },
  ]);
  assert.throws(() => parseSelectedPageRanges('0-2', 10, 200), /pageRange/u);
  assert.throws(() => parseSelectedPageRanges('12-20', 10, 200), /pageRange/u);
});

test('corrective fingerprint migration covers the canonical SHA-256 payload', async () => {
  const sql = await readFile(new URL('../prisma/migrations/20260803090000_correct_question_fingerprints/migration.sql', import.meta.url), 'utf8');
  assert.match(sql, /digest\(/);
  assert.match(sql, /sha256/);
  for (const field of ['stem', 'options', 'answer', 'analysis', 'knowledgePointIds', 'difficulty', 'type', 'source', 'year', 'expectedTimeSec']) assert.match(sql, new RegExp(field));
});
