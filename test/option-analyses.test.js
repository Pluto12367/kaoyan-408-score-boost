// V14-P0 real-exam foundation — per-wrong-option trap analyses contract tests.
//
// Design: docs/v14-p0-real-exam-bank-design.md §5 (parseOptionAnalyses is the
// SINGLE shape source — same pattern as parseRubricInput in PHASE 8).
// Owner-approved 2026-09-25 (D-2/D-4): additive nullable JSONB, NULL = not
// authored (≠ empty, ≠ "no traps"); wrong-option keys only; the correct-answer
// key is a validation error; traps exist only for SINGLE_CHOICE.
//
// RED = module absent from packages/shared/dist (import failure) before
// implementation.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPTION_ANALYSES_SCHEMA_VERSION,
  parseOptionAnalyses,
} from '../packages/shared/dist/index.js';

const CTX = { optionsCount: 4, answer: 'A', questionType: '选择题' };

// ------------------------------------------------------------- schema version

test('P0-EX option analyses schema version is frozen at 1', () => {
  assert.equal(OPTION_ANALYSES_SCHEMA_VERSION, 1);
});

// ------------------------------------------------------------- absent → null

test('P0-EX absent/blank input stays null — 未撰写 ≠ 非法, ≠ 0 条 (NULL≠0 parity with maxScore)', () => {
  assert.deepEqual(parseOptionAnalyses(undefined, CTX), { value: null });
  assert.deepEqual(parseOptionAnalyses(null, CTX), { value: null });
  assert.deepEqual(parseOptionAnalyses('', CTX), { value: null });
  assert.deepEqual(parseOptionAnalyses('   ', CTX), { value: null });
});

// ------------------------------------------------------------- happy paths

test('P0-EX valid JSON string parses to {version:1, traps} with trimmed values', () => {
  const parsed = parseOptionAnalyses(
    '{"version":1,"traps":{"B":"  把表尾插入也算上了  ","C":"把删除等同于移动"}}',
    CTX,
  );
  assert.equal(parsed.invalid, undefined);
  assert.deepEqual(parsed.value, {
    version: 1,
    traps: { B: '把表尾插入也算上了', C: '把删除等同于移动' },
  });
});

test('P0-EX valid object input (API parity with rubric parser) parses the same way', () => {
  const parsed = parseOptionAnalyses({ version: 1, traps: { D: '混淆了查找与移动' } }, CTX);
  assert.equal(parsed.invalid, undefined);
  assert.deepEqual(parsed.value, { version: 1, traps: { D: '混淆了查找与移动' } });
});

test('P0-EX one trap is enough; covering every wrong option is NOT required', () => {
  const parsed = parseOptionAnalyses({ version: 1, traps: { C: '单一陷阱' } }, CTX);
  assert.equal(parsed.invalid, undefined);
  assert.deepEqual(parsed.value, { version: 1, traps: { C: '单一陷阱' } });
});

test('P0-EX traps output is deterministic: keys sorted alphabetically', () => {
  const parsed = parseOptionAnalyses({ version: 1, traps: { C: 'c', B: 'b' } }, CTX);
  assert.equal(parsed.invalid, undefined);
  assert.deepEqual(Object.keys(parsed.value.traps), ['B', 'C']);
});

// ------------------------------------------------------------- shape rejections

test('P0-EX unparseable JSON string → invalid with a reason', () => {
  const parsed = parseOptionAnalyses('{"version":1,', CTX);
  assert.equal(parsed.value, null);
  assert.equal(parsed.invalid, true);
  assert.ok(parsed.errors.length > 0);
});

test('P0-EX non-object top level (array / string / number) → invalid', () => {
  for (const bad of ['[]', '"text"', '42', []]) {
    const parsed = parseOptionAnalyses(bad, CTX);
    assert.equal(parsed.value, null, `input ${JSON.stringify(bad)} must be rejected`);
    assert.equal(parsed.invalid, true);
  }
});

test('P0-EX version must be exactly 1 — missing or future versions are invalid (no silent upgrade)', () => {
  for (const bad of ['{}', '{"traps":{"B":"x"}}', '{"version":2,"traps":{"B":"x"}}', '{"version":"1","traps":{"B":"x"}}']) {
    const parsed = parseOptionAnalyses(bad, CTX);
    assert.equal(parsed.value, null, `input ${bad} must be rejected`);
    assert.equal(parsed.invalid, true);
  }
});

test('P0-EX traps missing / non-object / empty object → invalid (authored-but-empty is an authoring accident, never swallowed)', () => {
  for (const bad of ['{"version":1}', '{"version":1,"traps":[]}', '{"version":1,"traps":"B"}', '{"version":1,"traps":{}}']) {
    const parsed = parseOptionAnalyses(bad, CTX);
    assert.equal(parsed.value, null, `input ${bad} must be rejected`);
    assert.equal(parsed.invalid, true);
  }
});

// ------------------------------------------------------------- key rules

test('P0-EX trap keys must be uppercase letters within the option range (optionsCount=4 → A..D)', () => {
  for (const key of ['E', 'b', 'A1', '1', '__proto__', '']) {
    const parsed = parseOptionAnalyses(JSON.stringify({ version: 1, traps: { [key]: 'x' } }), CTX);
    assert.equal(parsed.value, null, `key ${JSON.stringify(key)} must be rejected`);
    assert.equal(parsed.invalid, true);
  }
});

test('P0-EX a trap on the CORRECT answer option is a validation error, never stored', () => {
  const parsed = parseOptionAnalyses({ version: 1, traps: { A: '正确选项不可能是陷阱' } }, CTX);
  assert.equal(parsed.value, null);
  assert.equal(parsed.invalid, true);
  assert.ok(parsed.errors.join(' ').includes('正确'));
});

// ------------------------------------------------------------- value rules

test('P0-EX trap text must be a non-empty string of 1..500 chars after trimming', () => {
  assert.equal(parseOptionAnalyses({ version: 1, traps: { B: '   ' } }, CTX).invalid, true);
  assert.equal(parseOptionAnalyses({ version: 1, traps: { B: 42 } }, CTX).invalid, true);
  assert.equal(parseOptionAnalyses({ version: 1, traps: { B: null } }, CTX).invalid, true);
  const long = 'x'.repeat(501);
  assert.equal(parseOptionAnalyses({ version: 1, traps: { B: long } }, CTX).invalid, true);
  const ok = parseOptionAnalyses({ version: 1, traps: { B: 'x'.repeat(500) } }, CTX);
  assert.equal(ok.invalid, undefined);
});

// ------------------------------------------------------------- question-type scope

test('P0-EX only SINGLE_CHOICE questions may carry traps — 综合题/判断题/unknown type → invalid', () => {
  for (const questionType of ['综合题', '判断题', 'SINGLE_CHOICE-LOOKALIKE', '']) {
    const parsed = parseOptionAnalyses({ version: 1, traps: { B: 'x' } }, { ...CTX, questionType });
    assert.equal(parsed.value, null, `questionType ${questionType} must be rejected`);
    assert.equal(parsed.invalid, true);
  }
  const byCode = parseOptionAnalyses({ version: 1, traps: { B: 'x' } }, { ...CTX, questionType: 'SINGLE_CHOICE' });
  assert.equal(byCode.invalid, undefined);
});

// ------------------------------------------------------------- context validation

test('P0-EX context itself is validated: answer letter must be inside the option range', () => {
  const parsed = parseOptionAnalyses({ version: 1, traps: { B: 'x' } }, { optionsCount: 4, answer: 'E', questionType: '选择题' });
  assert.equal(parsed.value, null);
  assert.equal(parsed.invalid, true);
  const missingAnswer = parseOptionAnalyses({ version: 1, traps: { B: 'x' } }, { optionsCount: 4, answer: '', questionType: '选择题' });
  assert.equal(missingAnswer.invalid, true);
});

test('P0-EX context optionsCount must be an integer ≥ 2 (a single choice has at least two options)', () => {
  for (const optionsCount of [1, 0, -3, 2.5, NaN, undefined]) {
    const parsed = parseOptionAnalyses({ version: 1, traps: { B: 'x' } }, { optionsCount, answer: 'A', questionType: '选择题' });
    assert.equal(parsed.value, null, `optionsCount ${optionsCount} must be rejected`);
    assert.equal(parsed.invalid, true);
  }
});

test('P0-EX a 2-option question accepts keys A..B only (judgement-style banks stay out of scope but the parser is honest)', () => {
  const twoOptionCtx = { optionsCount: 2, answer: 'A', questionType: '选择题' };
  assert.equal(parseOptionAnalyses({ version: 1, traps: { B: 'x' } }, twoOptionCtx).invalid, undefined);
  assert.equal(parseOptionAnalyses({ version: 1, traps: { C: 'x' } }, twoOptionCtx).invalid, true);
});
