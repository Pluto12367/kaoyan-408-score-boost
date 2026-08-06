import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  AI_TUTOR_FOLLOW_UP_MODES,
  buildTemplateFollowUp,
  buildTemplateTutorReply,
  buildTutorUserPrompt,
  parseFollowUpJson,
  parseTutorReplyJson,
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

test('stage 7: follow-up modes match the five required quick questions', () => {
  assert.deepEqual(
    AI_TUTOR_FOLLOW_UP_MODES.map((item) => item.mode),
    ['simplify', 'option-error', 'similar-question', 'hint-only', 'concept-compare'],
  );
  assert.equal(AI_TUTOR_FOLLOW_UP_MODES[0].label, '用更简单的方式解释');
  assert.equal(AI_TUTOR_FOLLOW_UP_MODES[4].label, '对比两个易混概念');
});

test('stage 7: tutor user prompt carries question, answer, reason and recent wrong questions', () => {
  const prompt = buildTutorUserPrompt(baseContext);
  assert.match(prompt, /缺页中断/);
  assert.match(prompt, /A\. 立即执行下一条指令/);
  assert.match(prompt, /标准答案：B/);
  assert.match(prompt, /学生作答：A（错误）/);
  assert.match(prompt, /学生自报\/推断错因：概念混淆/);
  assert.match(prompt, /最近相关错题/);
  assert.match(prompt, /快表命中后仍需访问页表/);
  assert.match(prompt, /hintLayers/);
  assert.match(prompt, /期望的 JSON 结构/);
});

test('stage 7: parseTutorReplyJson returns four ordered hint layers and fills missing ones', () => {
  const draft = parseTutorReplyJson(JSON.stringify({
    answerCheck: '你选 A 错误，正确答案是 B。',
    explanationSteps: ['定位考点', '对照规则'],
    hintLayers: [
      { level: 4, title: '完整解析', content: '缺页中断后转入调页程序。' },
    ],
    similarQuestions: [{ id: 'x', stem: '类似题', difficulty: '中等', source: 'AI' }],
    nextActions: ['复述考点', '做变式题'],
  }));
  assert.equal(draft.answerCheck, '你选 A 错误，正确答案是 B。');
  assert.deepEqual(draft.hintLayers.map((layer) => layer.level), [1, 2, 3, 4]);
  assert.equal(draft.hintLayers[3].content, '缺页中断后转入调页程序。');
  assert.equal(draft.hintLayers[0].title, '先定位考点');
});

test('stage 7: parseTutorReplyJson rejects invalid JSON', () => {
  assert.throws(() => parseTutorReplyJson('not-json'), /not valid JSON/);
});

test('stage 7: template tutor reply keeps four hint layers and an answer check', () => {
  const draft = buildTemplateTutorReply(baseContext, []);
  assert.equal(draft.answerCheck, '你选择 A，正确答案是 B，本题需要重点复盘。');
  assert.deepEqual(draft.hintLayers.map((layer) => layer.level), [1, 2, 3, 4]);
  assert.match(draft.hintLayers[3].content, /缺页中断由操作系统调页程序处理/);
  assert.match(draft.hintLayers[3].content, /概念混淆/);
  assert.equal(draft.explanationSteps.length, 4);
  assert.equal(draft.nextActions.length, 3);
});

test('stage 7: template follow-up returns reply steps, tips and three review cards', () => {
  const draft = buildTemplateFollowUp(baseContext, '为什么 A 不对？');
  assert.ok(draft.replySteps.length >= 2);
  assert.ok(draft.misconceptionTips.length >= 2);
  assert.equal(draft.reviewCards.length, 3);
  assert.deepEqual(draft.reviewCards.map((card) => card.type), ['concept', 'rule', 'confusion']);
});

test('stage 7: parseFollowUpJson normalizes card types and arrays', () => {
  const draft = parseFollowUpJson(JSON.stringify({
    replySteps: ['步骤一'],
    misconceptionTips: ['易错一'],
    reviewCards: [
      { id: 'c1', type: 'rule', title: '规则', content: '内容', nextAction: '动作' },
      { id: 'c2', type: 'other', title: '兜底', content: '内容', nextAction: '动作' },
    ],
    nextActions: ['建议'],
  }));
  assert.equal(draft.replySteps.length, 1);
  assert.equal(draft.reviewCards[0].type, 'rule');
  assert.equal(draft.reviewCards[1].type, 'concept');
});

test('stage 7: study service delegates to AiTutorService and keeps template fallback', async () => {
  const service = await source('apps/api/src/study/study.service.ts');
  assert.match(service, /aiTutorService\.configured/);
  assert.match(service, /await this\.aiTutorService\.explain\(context, similarQuestions\)/);
  assert.match(service, /buildTemplateTutorReply\(context, similarQuestions\)/);
  assert.match(service, /ServiceUnavailableException\('AI 助教暂时不可用/);
  assert.match(service, /recentWrongQuestions/);
});

test('stage 7: AiTutorLog repository persists real calls', async () => {
  const repo = await source('apps/api/src/study/ai-tutor-log.repository.ts');
  assert.match(repo, /this\.prisma\.aiTutorLog\.create/);
  const service = await source('apps/api/src/study/ai-tutor.service.ts');
  assert.match(service, /logRepository\.create/);
  assert.match(service, /parseTutorReplyJson/);
});

test('stage 7: frontend passes the real selected answer and follow-up mode', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /selectedAnswer: practiceAnswerResult\?\.selectedAnswer/);
  assert.match(app, /async function handleAskFollowUp\(message: string, mode\?: string\)/);
  assert.match(app, /requestAiFollowUp\(\{/);
});

test('stage 7: TutorPanel renders four hint layers, five quick questions and a prompt input', async () => {
  const panel = await source('apps/web/src/features/tutor/TutorPanel.tsx');
  assert.match(panel, /AI_TUTOR_FOLLOW_UP_MODES\.map/);
  assert.match(panel, /hint-layer-toggle/);
  assert.match(panel, /tutor-prompt-input/);
  assert.match(panel, /aria-expanded/);
  assert.match(panel, /DeepSeek 助教讲解/);
});

test('stage 7: production compose exposes AI environment variables', async () => {
  const compose = await source('compose.production.yml');
  assert.match(compose, /AI_API_KEY: \$\{AI_API_KEY:-\}/);
  assert.match(compose, /AI_MODEL: \$\{AI_MODEL:-deepseek-v4-flash\}/);
  assert.match(compose, /AI_BASE_URL: \$\{AI_BASE_URL:-https:\/\/api\.deepseek\.com\}/);
});

test('stage 7: deepseek client disables thinking mode and falls back to reasoning_content', async () => {
  const client = await source('apps/api/src/study/deepseek-client.ts');
  assert.match(client, /thinking: \{ type: 'disabled' \}/);
  assert.match(client, /chat_template_kwargs: \{ thinking: false \}/);
  assert.match(client, /message\?\.content \|\| message\?\.reasoning_content/);
  assert.match(client, /DeepSeek returned an empty completion/);
});

test('stage 7: env examples document the AI tutor configuration', async () => {
  const example = await source('.env.development.example');
  assert.match(example, /AI_API_KEY=/);
  assert.match(example, /AI_MODEL=deepseek-v4-flash/);
});

test('stage 7: gitignore protects the local development env file', async () => {
  const gitignore = await source('.gitignore');
  assert.match(gitignore, /^\.env\.development$/m);
});
