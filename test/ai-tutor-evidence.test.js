import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  buildTemplateFollowUp,
  buildTemplateTutorReply,
  buildTutorUserPrompt,
  buildFollowUpUserPrompt,
  buildKnowledgeEvidenceSummary,
} from '../packages/shared/dist/index.js';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const baseContext = {
  userId: 'u-1',
  questionId: 'q-1',
  stem: '在页式存储管理中，缺页中断发生后，CPU 应执行的操作是？',
  options: ['立即执行下一条指令', '转入操作系统调页程序', '直接访问外存', '结束当前进程'],
  answer: 'B',
  analysis: '缺页中断由操作系统调页程序处理。',
  knowledgePointTitle: '虚拟存储与缺页中断',
  subject: '操作系统',
  chapter: '内存管理',
  selectedAnswer: 'A',
  mistakeReason: '概念混淆',
  recentWrongQuestions: [
    { stem: '快表命中后仍需访问页表', knowledgePointTitle: '虚拟存储与缺页中断', mistakeReason: '概念混淆' },
  ],
  prompt: '请讲解这道题的考点和易错点。',
};

const evidenceSummary = buildKnowledgeEvidenceSummary({
  point: {
    id: 'os-virtual-memory',
    name: '虚拟存储与缺页中断',
    importance: 5,
    difficulty: 4,
    evidence: {
      recent3Frequency: 2,
      recent5Frequency: 4,
      allTimeEvidence: 6,
      primaryScore5y: 12,
      trendDirection: 'RISING',
      trendDelta: 2,
      evidenceConfidence: 'HIGH',
    },
  },
  mastery: {
    status: 'weak',
    mastery: 0.3,
    accuracy: 0.3,
    attempts: 4,
    correctCount: 1,
    wrongCount: 3,
    nextReviewAt: null,
  },
  examQuestions: [{ year: 2024, questionNo: 22, questionType: '选择题', score: 5, summary: '缺页中断常见考法' }],
  relatedQuestionsCount: 3,
  prerequisiteCount: 2,
  relatedCount: 4,
});

test('stage 7: tutor user prompt includes evidence cards when evidenceSummary is provided', () => {
  const prompt = buildTutorUserPrompt({ ...baseContext, evidenceSummary });
  assert.match(prompt, /知识证据卡/);
  assert.match(prompt, /为什么重要/);
  assert.match(prompt, /真题证据/);
  assert.match(prompt, /我的掌握度/);
  assert.match(prompt, /下一步怎么学/);
  assert.match(prompt, /题库支撑/);
  assert.match(prompt, /2024 年第 22 题/);
  assert.match(prompt, /前置 2 · 相关 4/);
});

test('stage 7: follow-up user prompt includes evidence cards when evidenceSummary is provided', () => {
  const prompt = buildFollowUpUserPrompt({ ...baseContext, evidenceSummary }, '为什么 A 不对？', 'option-error');
  assert.match(prompt, /知识证据卡/);
  assert.match(prompt, /为什么重要/);
  assert.match(prompt, /题库支撑/);
  assert.match(prompt, /追问类型要求/);
});

test('stage 7: tutor prompt falls back gracefully when no evidence summary is present', () => {
  const prompt = buildTutorUserPrompt(baseContext);
  assert.match(prompt, /知识证据卡：\n（无）/);
});

test('stage 7: study service builds an evidence summary and passes it into the tutor context', async () => {
  const service = await source('apps/api/src/study/study.service.ts');
  assert.match(service, /buildEvidenceSummary/);
  assert.match(service, /evidenceSummary\?.*KnowledgeEvidenceSummary/);
  assert.match(service, /evidenceSummary: evidenceSummary \?\? null/);
  assert.match(service, /buildKnowledgeEvidenceSummary\(/);
});

test('stage 7: template tutor reply still works with evidence summary attached', () => {
  const draft = buildTemplateTutorReply({ ...baseContext, evidenceSummary }, []);
  assert.ok(draft.hintLayers.length === 4);
  assert.ok(draft.nextActions.length >= 2);
});

test('stage 7: template follow-up still works with evidence summary attached', () => {
  const draft = buildTemplateFollowUp({ ...baseContext, evidenceSummary }, '请用更简单的方式解释');
  assert.ok(draft.replySteps.length >= 2);
  assert.ok(draft.reviewCards.length >= 1);
});
