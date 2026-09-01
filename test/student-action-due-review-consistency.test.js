import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../apps/web/src/App.tsx', import.meta.url), 'utf8');

function blockBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return appSource.slice(start, end);
}

test('wrong-question review mutation refreshes the shared due review read model', () => {
  const block = blockBetween('async function handleReviewWrongQuestion', 'function handlePracticeQuestionFromCatalog');
  assert.match(block, /await refreshDueReviews\(\)/);
});

test('practice review submission refreshes the shared due review read model', () => {
  const block = blockBetween('onReported={(result) => {', '\n          }}');
  assert.match(block, /refreshDueReviews\(\)/);
});
