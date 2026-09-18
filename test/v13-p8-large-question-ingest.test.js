// PHASE 8 (content toolchain) — large-question rubric INGEST contract tests.
//
// Until now Question.rubric had NO write path: teachers/reviewers could author
// rubrics but nothing in the API or import pipeline could carry them into the
// system. This slice adds the ingest, validated by the SAME shared validators
// the scoring path uses (single source of truth for rubric shape).
//
// Invariants pinned here:
//   • valid object / JSON string → parsed + validated rubric
//   • malformed JSON, non-object, or semantically invalid rubric → explicit
//     invalid result with reasons (never silently stored, never guessed)
//   • absent / empty → null (no rubric authored ≠ invalid rubric)
//   • import column 判分标准 rides the draft exactly like questionSubtype /
//     maxScore, with the same error-severity policy on invalid input

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRubricInput,
  normalizeCandidateDraft,
} from '../packages/shared/dist/index.js';

const VALID_RUBRIC = {
  version: 1,
  totalPoints: 6,
  criteria: [
    { id: 'c1', description: '写出信号量定义', points: 2, evidenceHint: '出现 signal(S) 之类的定义', matchAny: ['信号量', 'semaphore'] },
    { id: 'c2', description: '给出 P/V 顺序', points: 4, evidenceHint: '两次 P 一次 V 的次序正确', matchAny: ['P(', 'V('] },
  ],
};

test('P8 rubric ingest: valid object and JSON string both parse and validate', () => {
  const fromObject = parseRubricInput(VALID_RUBRIC);
  assert.ok('value' in fromObject && fromObject.value, 'object accepted');
  assert.equal(fromObject.value.totalPoints, 6);

  const fromString = parseRubricInput(JSON.stringify(VALID_RUBRIC));
  assert.ok('value' in fromString && fromString.value, 'JSON string accepted');
  assert.deepEqual(fromString.value, fromObject.value);

  const absent = parseRubricInput(undefined);
  assert.deepEqual(absent, { value: null }, 'absent → null (nothing authored)');
  const empty = parseRubricInput('  ');
  assert.deepEqual(empty, { value: null }, 'blank → null');
});

test('P8 rubric ingest: malformed JSON and non-objects are rejected with reasons', () => {
  const badJson = parseRubricInput('{not json');
  assert.ok('invalid' in badJson && badJson.invalid === true);
  assert.ok(badJson.errors.length > 0);

  const numberValue = parseRubricInput(42);
  assert.ok('invalid' in numberValue && numberValue.invalid === true);

  const arrayValue = parseRubricInput('[1,2]');
  assert.ok('invalid' in arrayValue && arrayValue.invalid === true, 'arrays are not rubrics');
});

test('P8 rubric ingest: semantically invalid rubrics are rejected with the shared validator errors', () => {
  const sumMismatch = parseRubricInput({ ...VALID_RUBRIC, totalPoints: 99 });
  assert.ok('invalid' in sumMismatch && sumMismatch.invalid === true);
  assert.ok(sumMismatch.errors.some((error) => error.includes('totalPoints')), `errors=${sumMismatch.errors}`);

  const noCriteria = parseRubricInput({ version: 1, totalPoints: 0, criteria: [] });
  assert.ok('invalid' in noCriteria && noCriteria.invalid === true);

  const duplicate = parseRubricInput({
    version: 1,
    totalPoints: 4,
    criteria: [
      { id: 'dup', description: 'a', points: 2, evidenceHint: 'x', matchAny: ['a'] },
      { id: 'dup', description: 'b', points: 2, evidenceHint: 'y', matchAny: ['b'] },
    ],
  });
  assert.ok('invalid' in duplicate && duplicate.invalid === true);
});

test('P8 rubric ingest: import column 判分标准 rides the draft like subtype/maxScore; invalid → error', () => {
  const ok = normalizeCandidateDraft({
    题干: 'PV 大题', 题型: '综合题', 难度: '中等', 来源: 'integration',
    正确答案: 'semWait(S) 序列', 答案解析: '标准 PV', 知识点ID: 'kp-pv-1',
    题型子类: 'OS_PV', 分值: '6', 判分标准: JSON.stringify(VALID_RUBRIC),
  });
  assert.equal(ok.issues.some((issue) => issue.severity === 'error'), false, JSON.stringify(ok.issues));
  assert.equal(ok.value.questionSubtype, 'OS_PV');
  assert.equal(ok.value.maxScore, 6);
  assert.equal(ok.value.rubric.totalPoints, 6);
  assert.equal(ok.value.rubric.criteria.length, 2);

  const absent = normalizeCandidateDraft({
    题干: '普通单选', 题型: '选择题', 难度: '基础', 来源: 'integration',
    正确答案: 'A', 答案解析: 'x', '选项 A': '1', '选项 B': '2', 知识点ID: 'kp-ds-1',
  });
  assert.equal(absent.value.rubric, undefined, 'absent rubric stays absent (never invented)');

  const badJson = normalizeCandidateDraft({
    题干: 'x', 题型: '综合题', 难度: '中等', 来源: 'integration',
    正确答案: 'y', 答案解析: 'x', 知识点ID: 'kp-pv-1', 判分标准: '{broken',
  });
  assert.equal(badJson.issues.some((issue) => issue.code === 'INVALID_RUBRIC' && issue.severity === 'error'), true);

  const badSemantics = normalizeCandidateDraft({
    题干: 'x', 题型: '综合题', 难度: '中等', 来源: 'integration',
    正确答案: 'y', 答案解析: 'x', 知识点ID: 'kp-pv-1',
    判分标准: JSON.stringify({ version: 1, totalPoints: 7, criteria: [{ id: 'c1', description: 'a', points: 2, evidenceHint: 'h', matchAny: ['a'] }] }),
  });
  assert.equal(badSemantics.issues.some((issue) => issue.code === 'INVALID_RUBRIC' && issue.severity === 'error'), true);
});
