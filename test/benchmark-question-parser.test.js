import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeBatch, validateManifest } from '../scripts/benchmark-question-parser.mjs';

test('benchmark manifest accepts only private PDF samples with positive expected questions', () => {
  assert.deepEqual(validateManifest({ samples: [{ kind: 'text', path: 'C:/private/text.pdf', expectedQuestions: 20 }] }), {
    samples: [{ kind: 'text', path: 'C:/private/text.pdf', expectedQuestions: 20, expectedFormulas: null, expectedImages: null }],
  });
  assert.deepEqual(validateManifest({ samples: [{ kind: 'complex', path: 'C:/private/complex.pdf', expectedQuestions: 20, expectedFormulas: 3, expectedImages: 2 }] }).samples[0], {
    kind: 'complex', path: 'C:/private/complex.pdf', expectedQuestions: 20, expectedFormulas: 3, expectedImages: 2,
  });
  assert.throws(() => validateManifest({ samples: [{ kind: 'text', path: 'text.txt', expectedQuestions: 20 }] }), /PDF/);
  assert.throws(() => validateManifest({ samples: [{ kind: 'unknown', path: 'text.pdf', expectedQuestions: 20 }] }), /kind/);
  assert.throws(() => validateManifest({ samples: [{ kind: 'text', path: 'text.pdf', expectedQuestions: 20, expectedImages: -1 }] }), /expectedImages/);
});

test('benchmark summary reports aggregate quality and never includes question text', () => {
  const result = summarizeBatch({
    kind: 'complex', expectedQuestions: 4, expectedFormulas: 2, expectedImages: 2, elapsedMs: 2_000, pageCount: 2,
    batch: { costSummary: { totalCost: 1.25 } },
    candidates: [
      { id: '1', stem: 'private stem', answer: 'A', analysis: 'private analysis', difficulty: '基础', type: '选择题', source: 'private', status: 'approved', formulas: [{ latex: 'x' }], assets: [{}], warnings: [] },
      { id: '2', stem: 'private stem', answer: '', analysis: '', status: 'needs_edit', formulas: [], assets: [], warnings: [{ code: 'LOW_CONFIDENCE' }] },
      { id: '3', stem: '', answer: 'B', analysis: 'private analysis', status: 'approved', formulas: [], assets: [], warnings: [] },
    ],
  });

  assert.equal(result.kind, 'complex');
  assert.equal(result.detectedQuestions, 3);
  assert.equal(result.metrics.precision, 1);
  assert.equal(result.metrics.recall, 0.75);
  assert.equal(result.metrics.requiredFieldCompleteness, 0.3333);
  assert.equal(result.metrics.answerAssociation, 0.6667);
  assert.equal(result.metrics.formulaRetention, 0.5);
  assert.equal(result.metrics.imageRetention, 0.5);
  assert.equal(result.metrics.manualWarningRate, 0.3333);
  assert.equal(result.costPer100Pages, 62.5);
  assert.doesNotMatch(JSON.stringify(result), /private stem|private analysis/);
});
