import assert from 'node:assert/strict';
import test from 'node:test';

import { QuestionStructureService } from '../apps/api/dist/questions/import/question-structure.service.js';
import { splitPageRanges } from '../apps/api/dist/questions/import/pdf-document.service.js';

test('PDF page ranges preserve global page numbers at the 200 page boundary', () => {
  assert.deepEqual(splitPageRanges(401), [
    { pageStart: 1, pageEnd: 200 },
    { pageStart: 201, pageEnd: 400 },
    { pageStart: 401, pageEnd: 401 },
  ]);
});

test('structure service keeps cross-page analysis with its numbered question and preserves formulas', () => {
  const service = new QuestionStructureService();
  const candidates = service.structure({
    provider: 'mineru', model: 'test', pages: [
      { pageNumber: 20, width: 100, height: 100, quality: { score: 1, signals: [] }, blocks: [
        { kind: 'text', text: '1. What is 1 + 1?\nA. 1\nB. 2\nAnswer: B', region: { x: 0, y: 0, width: 1, height: 0.6 } },
        { kind: 'formula', latex: '1+1=2', region: { x: 0.1, y: 0.6, width: 0.2, height: 0.1 } },
      ] },
      { pageNumber: 21, width: 100, height: 100, quality: { score: 1, signals: [] }, blocks: [
        { kind: 'text', text: 'Analysis: addition gives two.\n2. Select the valid option.\nA. Yes\nB. No\nAnswer: A', region: { x: 0, y: 0, width: 1, height: 0.8 } },
      ] },
    ],
  });

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].pageNumber, 20);
  assert.match(candidates[0].analysis, /addition gives two/u);
  assert.deepEqual(candidates[0].formulas.map((formula) => formula.latex), ['1+1=2']);
  assert.ok(candidates[0].warnings.some((warning) => warning.code === 'CROSS_PAGE_OWNERSHIP_UNCERTAIN'));
  assert.equal(candidates[1].pageNumber, 21);
});
