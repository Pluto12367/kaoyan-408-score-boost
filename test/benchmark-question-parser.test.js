import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeBatch, validateManifest } from '../scripts/benchmark-question-parser.mjs';

test('benchmark manifest accepts private PDF samples and candidate-level ground truth', () => {
  const manifest = validateManifest({ samples: [{
    kind: 'complex', path: 'C:/private/complex.pdf', expectedQuestions: 2,
    groundTruth: [{ key: 'q1', pageNumber: 1, answer: 'A', hasFormula: true, hasImage: true }, { key: 'q2', pageNumber: 2, answer: 'B' }],
  }] });
  assert.equal(manifest.samples[0].groundTruth.length, 2);
  assert.throws(() => validateManifest({ samples: [{ kind: 'text', path: 'text.txt', expectedQuestions: 1 }] }), /PDF/);
  assert.throws(() => validateManifest({ samples: [{ kind: 'text', path: 'text.pdf', expectedQuestions: 2, groundTruth: [{ key: 'q1', pageNumber: 1 }] }] }), /groundTruth/);
});

test('benchmark without candidate-level ground truth reports matching metrics as unavailable', () => {
  const result = summarizeBatch({ kind: 'text', expectedQuestions: 2, elapsedMs: 100, pageCount: 1, batch: {}, candidates: [{ id: '1', answer: 'A', assetIds: [], formulas: [], warnings: [] }] });
  assert.equal(result.metrics.precision, null);
  assert.equal(result.metrics.recall, null);
  assert.equal(result.metrics.answerAssociation, null);
  assert.equal(result.cost, null);
});

test('benchmark uses page-level ground truth, assetIds, and does not expose private text', () => {
  const result = summarizeBatch({
    kind: 'complex', expectedQuestions: 4, elapsedMs: 2_000, pageCount: 2,
    groundTruth: [
      { key: 'q1', pageNumber: 1, answer: 'A', hasFormula: true, hasImage: true },
      { key: 'q2', pageNumber: 2, answer: 'B', hasFormula: true, hasImage: true },
      { key: 'q3', pageNumber: 3, answer: 'C', hasFormula: false, hasImage: false },
      { key: 'q4', pageNumber: 4, answer: 'D', hasFormula: false, hasImage: false },
    ],
    batch: { costSummary: { totalCost: 1.25 } },
    candidates: [
      { id: '1', sourcePageNumber: 1, stem: 'private stem', answer: 'A', analysis: 'private analysis', difficulty: 'BASIC', type: 'SINGLE_CHOICE', source: 'private', formulas: [{ latex: 'x' }], assetIds: ['asset-1'], warnings: [] },
      { id: '2', sourcePageNumber: 2, stem: 'private stem', answer: '', analysis: '', formulas: [], assetIds: [], warnings: [{ code: 'LOW_CONFIDENCE' }] },
      { id: '3', sourcePageNumber: 9, stem: '', answer: 'B', analysis: 'private analysis', formulas: [], assetIds: [], warnings: [] },
    ],
  });
  assert.equal(result.metrics.precision, 0.6667);
  assert.equal(result.metrics.recall, 0.5);
  assert.equal(result.metrics.answerAssociation, 0.5);
  assert.equal(result.metrics.imageRetention, 0.5);
  assert.equal(result.costPer100Pages, 62.5);
  assert.doesNotMatch(JSON.stringify(result), /private stem|private analysis/);
});
