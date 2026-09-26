// V14-R4-B — real-exam paper (真题套卷) request contract.
//
// Task book: docs/v14-r4-presentation-design.md §3.2. The `year` field is
// ADDITIVE on POST /exam/papers/prepare: omitted → legacy behaviour byte-for-
// byte; provided → full-year composition (40 选择 + 7 综合). Validation rules
// pinned here; composition/grading evidence lives in the real PG+HTTP E2E.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://stub:stub@127.0.0.1:5432/stub';
require('ts-node/register');

const { resolveYearPaperRequest } = require('../apps/api/src/study/study.service.ts');

test('P0-PR no year → null (legacy prepare path, byte-for-byte unchanged)', () => {
  assert.equal(resolveYearPaperRequest({ paperType: '模拟卷', questionCount: 40 }), null);
  assert.equal(resolveYearPaperRequest({}), null);
  assert.equal(resolveYearPaperRequest({ paperType: '专项卷', subject: '数据结构' }), null);
});

test('P0-PR valid year → resolved request', () => {
  assert.deepEqual(resolveYearPaperRequest({ paperType: '模拟卷', year: 2026 }), { year: 2026 });
  assert.deepEqual(resolveYearPaperRequest({ year: 2009 }), { year: 2009 });
});

test('P0-PR invalid years are rejected with a reason', () => {
  for (const bad of [2008, 2101, 2026.5, NaN, 'abc']) {
    const result = resolveYearPaperRequest({ paperType: '模拟卷', year: bad });
    assert.ok(result && 'error' in result, `year ${String(bad)} must be rejected`);
  }
});

test('P0-PR 专项卷 + year conflicts (真题套卷是整卷)', () => {
  const result = resolveYearPaperRequest({ paperType: '专项卷', subject: '数据结构', year: 2026 });
  assert.ok(result && 'error' in result);
});
