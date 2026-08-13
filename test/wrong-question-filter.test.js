import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  deriveMasteryStatus,
  filterWrongQuestions,
  nextReviewIntervalDays,
} from '../packages/shared/dist/learning.js';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const baseItems = [
  {
    questionId: 'q-1', stem: '题干一', subject: '数据结构', chapter: '树与二叉树',
    knowledgePointId: 'ds-tree', latestMistakeReason: '概念混淆', wrongCount: 2,
    masteryStatus: '未掌握', reviewedAt: '2026-08-05T00:00:00.000Z', importance: 5,
  },
  {
    questionId: 'q-2', stem: '题干二', subject: '计算机组成原理', chapter: '存储系统',
    knowledgePointId: 'co-cache', latestMistakeReason: '计算错误', wrongCount: 1,
    masteryStatus: '复习中', reviewedAt: '2026-08-06T00:00:00.000Z', importance: 4,
  },
  {
    questionId: 'q-3', stem: '题干三', subject: '操作系统', chapter: '进程管理',
    knowledgePointId: 'os-process', latestMistakeReason: null, wrongCount: 3,
    masteryStatus: '已掌握', reviewedAt: null, importance: 3,
  },
];

test('stage 4: deriveMasteryStatus maps stability to the three states', () => {
  assert.equal(deriveMasteryStatus({ stability: 'mastered', consecutiveCorrect: 3 }), '已掌握');
  assert.equal(deriveMasteryStatus({ stability: 'review', consecutiveCorrect: 1 }), '复习中');
  assert.equal(deriveMasteryStatus({ stability: 'learning', consecutiveCorrect: 0 }), '未掌握');
  assert.equal(deriveMasteryStatus({ stability: undefined, consecutiveCorrect: 1 }), '复习中');
  assert.equal(deriveMasteryStatus({}), '未掌握');
});

test('stage 4: nextReviewIntervalDays advances by consecutive correct and keeps short interval when slow', () => {
  assert.equal(nextReviewIntervalDays({ consecutiveCorrect: 0 }), 1);
  assert.equal(nextReviewIntervalDays({ consecutiveCorrect: 1 }), 3);
  assert.equal(nextReviewIntervalDays({ consecutiveCorrect: 2 }), 7);
  assert.equal(nextReviewIntervalDays({ consecutiveCorrect: 3 }), 14);
  assert.equal(nextReviewIntervalDays({ consecutiveCorrect: 5 }), 14);
  assert.equal(nextReviewIntervalDays({ consecutiveCorrect: 1, slowReview: true }), 1);
  assert.equal(nextReviewIntervalDays({ consecutiveCorrect: 2, slowReview: true }), 3);
  assert.equal(nextReviewIntervalDays({ consecutiveCorrect: 0, slowReview: true }), 1);
});

test('stage 4: filterWrongQuestions supports every documented dimension', () => {
  const now = Date.parse('2026-08-06T12:00:00.000Z');
  assert.deepEqual(filterWrongQuestions(baseItems, { subject: '数据结构' }, now).map((i) => i.questionId), ['q-1']);
  assert.deepEqual(filterWrongQuestions(baseItems, { chapter: '存储系统' }, now).map((i) => i.questionId), ['q-2']);
  assert.deepEqual(filterWrongQuestions(baseItems, { knowledgePointId: 'os-process' }, now).map((i) => i.questionId), ['q-3']);
  assert.deepEqual(filterWrongQuestions(baseItems, { mistakeReason: '概念混淆' }, now).map((i) => i.questionId), ['q-1']);
  assert.deepEqual(filterWrongQuestions(baseItems, { minWrongCount: 2 }, now).map((i) => i.questionId), ['q-1', 'q-3']);
  assert.deepEqual(filterWrongQuestions(baseItems, { masteryStatus: '复习中' }, now).map((i) => i.questionId), ['q-2']);
  assert.deepEqual(filterWrongQuestions(baseItems, { masteryStatus: '已掌握' }, now).map((i) => i.questionId), ['q-3']);
  assert.deepEqual(filterWrongQuestions(baseItems, { importance: 4 }, now).map((i) => i.questionId), ['q-1', 'q-2']);
  assert.deepEqual(filterWrongQuestions(baseItems, { reviewedWithinDays: 2 }, now).map((i) => i.questionId), ['q-1', 'q-2']);
  assert.deepEqual(filterWrongQuestions(baseItems, { reviewedWithinDays: 1 }, now).map((i) => i.questionId), ['q-2']);
  assert.deepEqual(
    filterWrongQuestions(baseItems, { subject: '操作系统', masteryStatus: '已掌握', minWrongCount: 3 }, now).map((i) => i.questionId),
    ['q-3'],
  );
});

test('stage 4: wrong-questions endpoint exposes the optional filter query params', async () => {
  const controller = await source('apps/api/src/study/study.controller.ts');
  for (const param of ['subject', 'chapter', 'knowledgePointId', 'mistakeReason', 'minWrongCount', 'masteryStatus', 'reviewedWithinDays', 'importance']) {
    assert.match(controller, new RegExp(`@Query\\('${param}'\\)`));
  }
  assert.match(controller, /parseWrongQuestionFilters/);
});

test('stage 4: practice-records DTO and Prisma schema carry the variant marker', async () => {
  const dto = await source('apps/api/src/study/dto/create-practice-record.dto.ts');
  assert.match(dto, /variantQuestionId\?: string;/);

  const schema = await source('prisma/schema.prisma');
  const block = schema.match(/model PracticeRecord \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(block, /variantQuestionId\s+String\?/);
});

test('stage 4: wrong-question workspace renders a filter bar and mastery badges', async () => {
  const workspace = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');
  assert.match(workspace, /wrong-filter-bar/);
  assert.match(workspace, /filterWrongQuestions/);
  assert.match(workspace, /mastery-badge/);
  assert.match(workspace, /masteryStatus/);
  assert.match(workspace, /onPracticeVariant/);
});

test('wrong-question workspace explains the review loop and next actions', async () => {
  const workspace = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');
  assert.match(workspace, /wrongReviewLoop/);
  assert.match(workspace, /复盘闭环/);
  assert.match(workspace, /为什么要复盘/);
  assert.match(workspace, /复盘后下一步/);
  assert.match(workspace, /先看错因/);
  assert.match(workspace, /再做修复/);
  assert.match(workspace, /最后复测/);
  assert.match(workspace, /继续复盘/);
  assert.match(workspace, /做同考点变式/);
  assert.match(workspace, /回到首页/);
  assert.match(workspace, /className="wrong-review-loop-card"/);
  assert.match(workspace, /className="wrong-row-reason"/);
  assert.match(workspace, /className="wrong-row-next-actions"/);
});

test('stage 4: wrong-question detail offers the four-layer review path', async () => {
  const detail = await source('apps/web/src/components/WrongQuestionDetail.tsx');
  assert.match(detail, /reviewLayers/);
  assert.match(detail, /变式题/);
  assert.match(detail, /易混辨析/);
  assert.match(detail, /综合应用/);
  assert.match(detail, /复测路径/);
  assert.match(detail, /onPracticeVariant/);
});

test('stage 4: App submits variant answers with the original question marker', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /variantOfQuestionId/);
  assert.match(app, /variantQuestionId: isVariant \? variantOfQuestionId : undefined/);
  assert.match(app, /onPracticeVariant/);
});

test('mistake workspace synchronizes an explicit initial knowledge-point filter', async () => {
  const workspace = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');
  assert.match(workspace, /initialKnowledgePointId\?: string \| null/);
  assert.match(workspace, /setKnowledgePointId\(initialKnowledgePointId \?\? ''\)/);
  assert.match(workspace, /\[initialKnowledgePointId\]/);
  assert.match(workspace, /isMockAllowed\(\)/);
});
