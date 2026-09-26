// V14-P0 — real-exam importer pure-function contract tests.
//
// Covers scripts/import-real-exams.mjs row validation (design §6/§7.3) and
// per-year structure validation incl. the two-sided score cross-check against
// verified exam-mapping bundles (design §7.3 rule 5). DB-dependent existence
// checks are deliberately NOT covered here — they run in the real PG+HTTP E2E
// (scripts/integration-real-exam-import.mjs).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REAL_EXAM_HEADERS,
  NODE_TAG_SOURCE,
  validateRealExamRows,
  validateYearStructure,
} from '../scripts/import-real-exams.mjs';

function mcqRow(overrides = {}) {
  const answer = overrides.answer ?? 'A';
  // Trap text sits on a WRONG option by default: shift it off the answer.
  const traps = { B: '把表尾插入也算上了：表尾插入只写 a[length]。', C: '', D: '' };
  if (answer === 'B') { traps.B = ''; traps.C = '把删除等同于移动。'; }
  return {
    stem: '顺序表表头插入必然移动元素，还有哪些操作必然移动？',
    options: 'A.表头删除|B.表尾插入|C.表尾删除|D.以上都不',
    answer,
    analysis: '表头删除需整体前移一格。',
    knowledgePointIds: 'ds-list',
    difficulty: '中等',
    type: '选择题',
    source: '2026-408-真题',
    year: '2026',
    expectedTimeSec: '100',
    questionSubtype: 'SINGLE_CHOICE',
    maxScore: '2',
    判分标准: '',
    examNo: '1',
    knowledgeNodeIds: 'DS-C02-S02-P04|DS-C02-S02-P05',
    陷阱解析A: '',
    陷阱解析B: traps.B,
    陷阱解析C: traps.C,
    陷阱解析D: traps.D,
    录入参考摘要: '顺序表表头插入/删除与元素移动次数',
    ...overrides,
  };
}

function essayRow(overrides = {}) {
  return {
    stem: '设计算法求链表倒数第 k 个结点。',
    options: '',
    answer: '',
    analysis: '双指针一次遍历。',
    knowledgePointIds: 'ds-list',
    difficulty: '困难',
    type: '综合题',
    source: '2026-408-真题',
    year: '2026',
    expectedTimeSec: '600',
    questionSubtype: '',
    maxScore: '13',
    判分标准: JSON.stringify({
      version: 1, totalPoints: 13,
      criteria: [{
        id: 'c1', description: '双指针思想', points: 13,
        evidenceHint: '答案中出现"双指针"或两次遍历的描述',
        matchAny: ['双指针', '两次遍历'],
      }],
    }),
    examNo: '41',
    knowledgeNodeIds: 'DS-C02-S02-P04',
    陷阱解析A: '',
    陷阱解析B: '',
    陷阱解析C: '',
    陷阱解析D: '',
    录入参考摘要: '',
    ...overrides,
  };
}

// ------------------------------------------------------------- headers

test('P0-RE importer headers: the 13 starter columns + 7 real-exam columns in the documented order', () => {
  assert.deepEqual(REAL_EXAM_HEADERS, [
    'stem', 'options', 'answer', 'analysis', 'knowledgePointIds', 'difficulty', 'type', 'source',
    'year', 'expectedTimeSec', 'questionSubtype', 'maxScore', '判分标准',
    'examNo', 'knowledgeNodeIds', '陷阱解析A', '陷阱解析B', '陷阱解析C', '陷阱解析D', '录入参考摘要',
  ]);
  assert.equal(NODE_TAG_SOURCE, 'real-exam-import');
});

// ------------------------------------------------------------- happy paths

test('P0-RE valid MCQ row parses: traps through the single shape source, examNo, priced', () => {
  const { questions, warnings, errors } = validateRealExamRows([mcqRow()]);
  assert.deepEqual(errors, []);
  assert.equal(questions.length, 1);
  const question = questions[0];
  assert.equal(question.type, '选择题');
  assert.equal(question.examNo, 1);
  assert.equal(question.maxScore, 2);
  assert.equal(question.questionSubtype, 'SINGLE_CHOICE');
  assert.deepEqual(question.options, ['A.表头删除', 'B.表尾插入', 'C.表尾删除', 'D.以上都不']);
  assert.deepEqual(question.optionAnalyses, { version: 1, traps: { B: '把表尾插入也算上了：表尾插入只写 a[length]。' } });
  assert.deepEqual(question.knowledgeNodeIds, ['DS-C02-S02-P04', 'DS-C02-S02-P05']);
  // 录入参考摘要 is scaffold-only → warned and ignored, never imported.
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes('录入参考摘要'));
});

test('P0-RE valid essay row parses: 作答区 placeholder, rubric via shared parser, subtype NULL (D-3 deferral)', () => {
  const { questions, errors } = validateRealExamRows([essayRow()]);
  assert.deepEqual(errors, []);
  const question = questions[0];
  assert.equal(question.type, '综合题');
  assert.deepEqual(question.options, ['作答区']);
  assert.equal(question.answer, '');
  assert.equal(question.examNo, 41);
  assert.equal(question.maxScore, 13);
  assert.equal(question.questionSubtype, null, 'no dictionary code guessed for essays (Owner D-3)');
  assert.equal(question.rubric.version, 1);
  assert.equal(question.rubric.totalPoints, 13);
  assert.equal(question.optionAnalyses, null);
});

// ------------------------------------------------------------- row rejections

test('P0-RE real-exam-only hard rejections carry the CSV line number', () => {
  const cases = [
    [mcqRow({ examNo: '' }), 'examNo'],
    [mcqRow({ examNo: '45' }), '选择题 examNo must be 1..40'],
    [essayRow({ examNo: '20' }), '综合题 examNo must be 41..47'],
    [mcqRow({ source: '王道题库' }), 'source must match'],
    [mcqRow({ source: '2025-408-真题' }), 'source year 2025 must equal row year 2026'],
    [mcqRow({ year: '2008' }), 'year must be an integer ≥ 2009'],
    [mcqRow({ options: 'A.甲|B.乙|C.丙' }), 'exactly 4 options'],
    [mcqRow({ answer: 'E' }), 'answer must be a letter A..D'],
    [mcqRow({ questionSubtype: '' }), 'requires questionSubtype SINGLE_CHOICE'],
    [mcqRow({ questionSubtype: 'ALGORITHM' }), 'requires questionSubtype SINGLE_CHOICE'],
    [mcqRow({ maxScore: '' }), 'missing required field "maxScore"'],
    [mcqRow({ maxScore: '-1' }), 'maxScore must be a non-negative number'],
    [mcqRow({ 判分标准: JSON.stringify({
      version: 1, totalPoints: 2,
      criteria: [{ id: 'c1', description: '不需要的采分点', points: 2, evidenceHint: 'n/a', matchAny: ['x'] }],
    }) }), '选择题 must not carry a rubric'],
    [essayRow({ 陷阱解析B: '大题没有陷阱列' }), '综合题 must not carry 陷阱解析'],
    [mcqRow({ knowledgeNodeIds: '' }), 'knowledgeNodeIds is required'],
    [mcqRow({ knowledgeNodeIds: 'N1|N1' }), 'duplicates'],
    [mcqRow({ type: '判断题' }), 'unsupported question type'],
  ];
  for (const [row, expectedFragment] of cases) {
    const { errors } = validateRealExamRows([row]);
    assert.equal(errors.length, 1, `expected one error for: ${expectedFragment}`);
    assert.equal(errors[0].line, 2);
    assert.ok(errors[0].message.includes(expectedFragment), `error "${errors[0].message}" should mention "${expectedFragment}"`);
  }
});

test('P0-RE a trap on the CORRECT option is rejected through parseOptionAnalyses (never stored)', () => {
  const { errors } = validateRealExamRows([mcqRow({ 陷阱解析A: '正确选项不可能是陷阱' })]);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].message.includes('正确'));
});

// ------------------------------------------------------------- structure validation

function buildCompleteYear2026({ essayScores = { 41: 13, 42: 10, 43: 10, 44: 13, 45: 7, 46: 8, 47: 9 } } = {}) {
  const rows = [];
  for (let examNo = 1; examNo <= 40; examNo += 1) {
    rows.push(mcqRow({ examNo: String(examNo), stem: `2026 单选 ${examNo}`, answer: examNo % 2 === 0 ? 'B' : 'A' }));
  }
  for (const [examNo, score] of Object.entries(essayScores)) {
    rows.push(essayRow({ examNo, maxScore: String(score), stem: `2026 综合 ${examNo}` }));
  }
  return rows;
}

test('P0-RE complete year structure: 40×2=80 + essays 70 = 150, slots exact, no errors', () => {
  const { questions, errors } = validateRealExamRows(buildCompleteYear2026());
  assert.deepEqual(errors, []);
  const { reports, errors: structureErrors } = validateYearStructure(questions);
  assert.deepEqual(structureErrors, []);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].complete, true);
  assert.equal(reports[0].sumMcq, 80);
  assert.equal(reports[0].sumEssay, 70);
});

test('P0-RE structure errors: wrong essay sum and duplicate examNo are rejected', () => {
  const badSum = validateRealExamRows(buildCompleteYear2026({ essayScores: { 41: 13, 42: 10, 43: 10, 44: 13, 45: 7, 46: 8, 47: 8 } }));
  assert.deepEqual(badSum.errors, []);
  let result = validateYearStructure(badSum.questions);
  assert.ok(result.errors.some((message) => message.includes('综合题分值合计 69 ≠ 70')));

  const duped = validateRealExamRows(buildCompleteYear2026().map((row, index) => (index === 5 ? { ...row, examNo: '1' } : row)));
  result = validateYearStructure(duped.questions);
  assert.ok(result.errors.some((message) => message.includes('duplicate examNo')));
});

test('P0-RE two-sided evidence: verified exam-mapping scores cross-check per question', () => {
  const bundle = {
    questions: [
      ...Array.from({ length: 40 }, (_, index) => ({ questionNo: index + 1, score: 2 })),
      { questionNo: 41, score: 13 }, { questionNo: 42, score: 10 }, { questionNo: 43, score: 10 },
      { questionNo: 44, score: 13 }, { questionNo: 45, score: 7 }, { questionNo: 46, score: 8 },
      { questionNo: 47, score: 9 },
    ],
  };
  const good = validateRealExamRows(buildCompleteYear2026());
  let result = validateYearStructure(good.questions, new Map([[2026, bundle]]));
  assert.deepEqual(result.errors, []);
  assert.equal(result.reports[0].mappingChecked, true);
  assert.equal(result.reports[0].mappingMatch, '47/47');

  const drifted = JSON.parse(JSON.stringify(bundle));
  drifted.questions[40].score = 12; // Q41 verified 13, content says 13 — drift the UPSTREAM side
  const mismatch = validateYearStructure(good.questions, new Map([[2026, drifted]]));
  assert.ok(mismatch.errors.some((message) => message.includes('题 41') && message.includes('13')));

  // Content side drift: one essay mispriced → mismatch error names both values.
  const badContent = validateRealExamRows(buildCompleteYear2026({ essayScores: { 41: 12, 42: 10, 43: 10, 44: 13, 45: 7, 46: 8, 47: 9 } }));
  assert.deepEqual(badContent.errors, []);
  result = validateYearStructure(badContent.questions, new Map([[2026, bundle]]));
  assert.ok(result.errors.some((message) => message.includes('maxScore 12 ≠ verified exam-mapping score 13')));
});

test('P0-RE partial year imports are allowed and reported as partial (phased batches)', () => {
  const { questions, errors } = validateRealExamRows([mcqRow(), mcqRow({ examNo: '2', stem: '第二题' })]);
  assert.deepEqual(errors, []);
  const { reports, errors: structureErrors } = validateYearStructure(questions);
  assert.deepEqual(structureErrors, []);
  assert.equal(reports[0].complete, false);
  assert.equal(reports[0].total, 2);
});

// ------------------------------------------------------------- unpriced essays (2009-2021)

test('P0-RE essay without maxScore imports UNPRICED with a row warning (NULL ≠ 0)', () => {
  const noScore = essayRow({ maxScore: '' });
  const { questions, warnings, errors } = validateRealExamRows([noScore]);
  assert.deepEqual(errors, []);
  assert.equal(questions[0].maxScore, null, 'essay maxScore NULL = unpriced (D5/D6)');
  assert.ok(warnings.some((w) => w.includes('UNPRICED')), 'row warning names the unpriced state');
});

test('P0-RE complete year all-unpriced essays → allowed with essaysUnpriced report note', () => {
  const rows = [];
  for (let examNo = 1; examNo <= 40; examNo += 1) {
    rows.push(mcqRow({ examNo: String(examNo), stem: `单选 ${examNo}`, answer: examNo % 2 === 0 ? 'B' : 'A' }));
  }
  const essayScores = { 41: 13, 42: 10, 43: 10, 44: 13, 45: 7, 46: 8, 47: 9 };
  for (const [examNo, score] of Object.entries(essayScores)) {
    rows.push(essayRow({ examNo, maxScore: '', stem: `综合 ${examNo}` }));
  }
  const { questions, errors } = validateRealExamRows(rows);
  assert.deepEqual(errors, []);
  const result = validateYearStructure(questions);
  assert.deepEqual(result.errors, []);
  assert.equal(result.reports[0].complete, true);
  assert.equal(result.reports[0].unpricedEssayCount, 7, 'all 7 essays tracked as unpriced');
});

test('P0-RE mixed essay pricing in a complete year → rejected (partial entry = accident)', () => {
  const rows = [];
  for (let examNo = 1; examNo <= 40; examNo += 1) {
    rows.push(mcqRow({ examNo: String(examNo), stem: `单选 ${examNo}`, answer: examNo % 2 === 0 ? 'B' : 'A' }));
  }
  const essayScores = { 41: 13, 42: 10, 43: 10, 44: 13, 45: 7, 46: 8, 47: 9 };
  for (const [examNo, score] of Object.entries(essayScores)) {
    rows.push(essayRow({ examNo, maxScore: examNo === '41' ? String(score) : '', stem: `综合 ${examNo}` }));
  }
  const { questions } = validateRealExamRows(rows);
  const result = validateYearStructure(questions);
  assert.ok(result.errors.some((message) => message.includes('定价状态混合')), 'mixed pricing must be rejected');
});
