import test from 'node:test';
import assert from 'node:assert/strict';
import { QUERY_VIEW_VERSION, buildQueryViews } from '../core/queryViews.js';

const SYNTHETIC_STEM = '  TCP   HANDSHAKE  ';

test('V2-4: version is locked', () => {
  assert.equal(QUERY_VIEW_VERSION, 'query-views-v2');
});

test('V2-4: Q1 stem-only returns exactly one stem view', () => {
  assert.deepEqual(buildQueryViews({ stem: SYNTHETIC_STEM, analysis: null }), {
    views: [{ type: 'stem', content: 'tcp handshake' }],
    availability: 'stem',
  });
});

test('V2-4: Q2 returns stem and analysis views', () => {
  assert.deepEqual(buildQueryViews({ stem: SYNTHETIC_STEM, analysis: '  SYN then ACK  ' }), {
    views: [
      { type: 'stem', content: 'tcp handshake' },
      { type: 'analysis', content: 'syn then ack' },
    ],
    availability: 'stem+analysis',
  });
});

for (const [label, analysis] of [
  ['null', null],
  ['undefined', undefined],
  ['empty string', ''],
  ['whitespace-only', ' \t\r\n '],
]) {
  test(`V2-4: ${label} analysis falls back to stem-only`, () => {
    const result = buildQueryViews({ stem: 'synthetic stem', analysis });
    assert.equal(result.availability, 'stem');
    assert.deepEqual(result.views, [{ type: 'stem', content: 'synthetic stem' }]);
  });
}

test('V2-4: any non-empty normalized analysis is a valid analysis view', () => {
  const result = buildQueryViews({ stem: 'synthetic stem', analysis: ' x ' });
  assert.equal(result.availability, 'stem+analysis');
  assert.deepEqual(result.views[1], { type: 'analysis', content: 'x' });
});

test('V2-4: analysis normalization is deterministic', () => {
  const question = { stem: 'ＳＴＥＭ', analysis: '  ＡＮＡＬＹＳＩＳ   VALUE  ' };
  const first = buildQueryViews(question);
  const second = buildQueryViews({ ...question });
  assert.deepEqual(first, second);
  assert.equal(first.views[0].content, 'stem');
  assert.equal(first.views[1].content, 'analysis value');
});

test('V2-4: same input yields same availability', () => {
  const question = { stem: 'synthetic stem', analysis: 'short' };
  assert.equal(buildQueryViews(question).availability, buildQueryViews(question).availability);
});

test('V2-4: query never contains gold, split, or retriever data', () => {
  const forbidden = 'FORBIDDEN-DATA-SENTINEL';
  const result = buildQueryViews({
    stem: 'synthetic stem',
    analysis: 'synthetic analysis',
    gold: forbidden,
    split: forbidden,
    retriever: forbidden,
  });
  assert.deepEqual(result.views.map((view) => view.content), ['synthetic stem', 'synthetic analysis']);
  assert.equal(JSON.stringify(result).includes(forbidden), false);
});
