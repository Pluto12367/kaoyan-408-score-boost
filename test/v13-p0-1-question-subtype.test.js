// V13-P0-1 Question Scoring & Question Type Foundation — shared contract tests.
//
// Owner Decision v1.1 (frozen): D2 additive nullable questionSubtype;
// D3 dictionary = 7 codes; D4 maxScore = highest score in the 408 exam;
// D5/D6 NULL = unpriced/unknown, NEVER 0; no guessing/derivation.
//
// RED = module absent / assertions unmet before implementation.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTION_SUBTYPE_CODES,
  QUESTION_SUBTYPE_LABELS,
  normalizeQuestionSubtype,
  resolveQuestionSubtypeInput,
  normalizeMaxScoreInput,
  normalizeCandidateDraft,
  buildErrorPatterns,
} from '../packages/shared/dist/index.js';

// ------------------------------------------------------------- dictionary

test('P0-1 vocabulary: exactly the Owner-approved 7 codes with unique Chinese labels', () => {
  assert.deepEqual([...QUESTION_SUBTYPE_CODES].sort(), [
    'ALGORITHM', 'CN_ROUTING', 'CO_COMPUTATION', 'COMPREHENSIVE_CHOICE',
    'JUDGEMENT', 'OS_PV', 'SINGLE_CHOICE',
  ].sort());
  for (const code of QUESTION_SUBTYPE_CODES) {
    assert.equal(typeof QUESTION_SUBTYPE_LABELS[code], 'string');
    assert.ok(QUESTION_SUBTYPE_LABELS[code].length > 0);
  }
  assert.equal(new Set(Object.values(QUESTION_SUBTYPE_LABELS)).size, QUESTION_SUBTYPE_CODES.length);
});

test('P0-1 normalization: codes and Chinese labels resolve; unknown/free text stays null (no guessing)', () => {
  assert.equal(normalizeQuestionSubtype('ALGORITHM'), 'ALGORITHM');
  assert.equal(normalizeQuestionSubtype('OS_PV'), 'OS_PV');
  assert.equal(normalizeQuestionSubtype('算法大题'), 'ALGORITHM');
  assert.equal(normalizeQuestionSubtype('OS PV 题'), 'OS_PV');
  assert.equal(normalizeQuestionSubtype('单选题'), 'SINGLE_CHOICE');
  // unknown is null — never silently mapped to a sibling subtype
  assert.equal(normalizeQuestionSubtype('PV 建模'), null);
  assert.equal(normalizeQuestionSubtype('BOGUS'), null);
  assert.equal(normalizeQuestionSubtype(''), null);
  assert.equal(normalizeQuestionSubtype(null), null);
  // strict input rejects unknowns
  assert.equal(resolveQuestionSubtypeInput('BOGUS'), null);
  assert.equal(resolveQuestionSubtypeInput('算法大题'), 'ALGORITHM');
});

test('P0-1 maxScore parsing: absent→null, valid number kept, invalid flagged; 0 is a REAL zero (never coerced)', () => {
  assert.deepEqual(normalizeMaxScoreInput(undefined), { value: null });
  assert.deepEqual(normalizeMaxScoreInput(''), { value: null });
  assert.deepEqual(normalizeMaxScoreInput('  '), { value: null });
  assert.deepEqual(normalizeMaxScoreInput('2'), { value: 2 });
  assert.deepEqual(normalizeMaxScoreInput(10), { value: 10 });
  assert.deepEqual(normalizeMaxScoreInput(0), { value: 0 }, '0 is a legitimate priced zero-point question');
  assert.equal(normalizeMaxScoreInput(-1).invalid, true);
  assert.equal(normalizeMaxScoreInput('abc').invalid, true);
  assert.equal(normalizeMaxScoreInput(NaN).invalid, true);
});

// --------------------------------------------- structured import mapping

test('P0-1 import mapping: optional 题型子类/分值 columns flow into the draft; invalid values are errors (never guessed)', () => {
  const ok = normalizeCandidateDraft({
    题干: 'PV 操作题', 题型: '综合题', 难度: '中等', 来源: 'integration',
    正确答案: 'semWait(S)', 答案解析: '标准 PV 序列', 知识点ID: 'kp-pv-1',
    题型子类: 'OS_PV', 分值: '7',
  });
  assert.equal(ok.issues.some((issue) => issue.severity === 'error'), false, JSON.stringify(ok.issues));
  assert.equal(ok.value.questionSubtype, 'OS_PV');
  assert.equal(ok.value.maxScore, 7);

  const byLabel = normalizeCandidateDraft({
    题干: '路由收敛计算', 题型: '综合题', 难度: '中等', 来源: 'integration',
    正确答案: '距离向量更新后的路由表', 答案解析: '逐步更新', 知识点ID: 'kp-cn-1',
    题型子类: 'CN 路由计算题', 分值: '9',
  });
  assert.equal(byLabel.value.questionSubtype, 'CN_ROUTING');
  assert.equal(byLabel.value.maxScore, 9);

  const absent = normalizeCandidateDraft({
    题干: '普通单选', 题型: '选择题', 难度: '基础', 来源: 'integration',
    正确答案: 'A', 答案解析: 'x', '选项 A': '1', '选项 B': '2', 知识点ID: 'kp-ds-1',
  });
  assert.equal(absent.value.questionSubtype, undefined, 'absent subtype stays absent (never guessed)');
  assert.equal(absent.value.maxScore, undefined, 'absent maxScore stays absent (never 0)');

  const badSubtype = normalizeCandidateDraft({
    题干: 'x', 题型: '综合题', 难度: '中等', 来源: 'integration',
    正确答案: 'y', 答案解析: 'x', 知识点ID: 'kp-pv-1', 题型子类: 'PV 建模',
  });
  assert.equal(badSubtype.issues.some((issue) => issue.code === 'INVALID_QUESTION_SUBTYPE' && issue.severity === 'error'), true);

  const badScore = normalizeCandidateDraft({
    题干: 'x', 题型: '综合题', 难度: '中等', 来源: 'integration',
    正确答案: 'y', 答案解析: 'x', 知识点ID: 'kp-pv-1', 分值: '-3',
  });
  assert.equal(badScore.issues.some((issue) => issue.code === 'INVALID_MAX_SCORE' && issue.severity === 'error'), true);
});

// -------------------------------------------- error-pattern subtype facts

test('P0-1 error patterns carry questionSubtype as a fact dimension (read-only projection)', () => {
  const base = 1_700_000_000_000;
  const result = buildErrorPatterns({
    now: new Date(base).toISOString(),
    windowDays: 7,
    attempts: [
      { source: 'auto', subject: 'OS', nodeId: 'node-pv', questionId: 'q-1', questionType: 'COMPREHENSIVE',
        questionSubtype: 'OS_PV', reasonRaw: '计算错误', occurredAt: new Date(base - DAY).toISOString() },
      { source: 'self_reported', subject: 'OS', nodeId: 'node-pv', questionId: 'q-2', questionType: 'COMPREHENSIVE',
        questionSubtype: 'OS_PV', reasonRaw: 'method_error', occurredAt: new Date(base - 2 * DAY).toISOString() },
      { source: 'auto', subject: 'DS', nodeId: 'node-ds', questionId: 'q-3', questionType: 'SINGLE_CHOICE',
        questionSubtype: null, reasonRaw: '审题错误', occurredAt: new Date(base - 3 * DAY).toISOString() },
    ],
  });
  const pv = result.patterns.find((row) => row.nodeId === 'node-pv' && row.reasonCode === 'calculation_error');
  assert.ok(pv, 'OS+OS_PV+calculation_error row exists');
  assert.equal(pv.questionSubtype, 'OS_PV', 'subtype fact attached to the row');
  assert.equal(pv.questionSubtypeLabel, 'OS PV 题');
  const unknownSubtype = result.patterns.find((row) => row.nodeId === 'node-ds');
  assert.equal(unknownSubtype.questionSubtype, 'unknown', 'null subtype stays an explicit unknown bucket (never guessed)');
  assert.equal(unknownSubtype.questionSubtypeLabel, '未知题型');
  assert.equal(result.totals.bySubtype.OS_PV, 2);
  assert.equal(result.totals.bySubtype.SINGLE_CHOICE, undefined, 'null subtype is never counted as a known subtype');
  assert.equal(result.totals.wrongCount, 3);
});

const DAY = 86_400_000;
