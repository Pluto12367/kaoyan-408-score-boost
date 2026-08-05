import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('stage 1: dashboard hero main action points to 继续今日学习', async () => {
  const launchpad = await source('apps/web/src/features/onboarding/StudentLaunchpad.tsx');
  assert.match(launchpad, /继续今日学习/);
  assert.doesNotMatch(launchpad, /继续刷题/);
  assert.match(launchpad, /onContinueToday/);
});

test('stage 3: PracticeRecord schema persists answer metadata', async () => {
  const schema = await source('prisma/schema.prisma');
  const block = schema.match(/model PracticeRecord \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(block, /confidence\s+String\?/);
  assert.match(block, /usedHint\s+Boolean\s+@default\(false\)/);
  assert.match(block, /answerModified\s+Boolean\s+@default\(false\)/);
});

test('stage 3: API DTOs accept confidence/usedHint/answerModified', async () => {
  const practiceDto = await source('apps/api/src/study/dto/create-practice-record.dto.ts');
  assert.match(practiceDto, /confidence\?: '确定' \| '不确定' \| '完全不会';/);
  assert.match(practiceDto, /usedHint\?: boolean;/);
  assert.match(practiceDto, /answerModified\?: boolean;/);

  const sessionDto = await source('apps/api/src/study/dto/learning-session.dto.ts');
  assert.match(sessionDto, /confidence\?: '确定' \| '不确定' \| '完全不会';/);
  assert.match(sessionDto, /usedHint\?: boolean;/);
  assert.match(sessionDto, /answerModified\?: boolean;/);
});

test('stage 3: ExamSession supports learning mode and per-answer metadata', async () => {
  const session = await source('apps/web/src/components/ExamSession.tsx');
  assert.match(session, /learningMode\?: boolean/);
  assert.match(session, /onCheckAnswer/);
  assert.match(session, /完全不会/);
  assert.match(session, /查看提示/);
  assert.match(session, /answerModified/);
  assert.match(session, /学习模式/);
});

test('stage 3: shared MistakeReason expanded to 8 classes with legacy normalization', async () => {
  const domain = await source('packages/shared/src/domain.ts');
  for (const label of ['知识点没学过', '概念混淆', '公式记错', '计算错误', '审题错误', '推理过程错误', '时间不足', '蒙题']) {
    assert.match(domain, new RegExp(`'${label}'`));
  }
  const learning = await source('packages/shared/src/learning.ts');
  assert.match(learning, /export function normalizeMistakeReason/);
});

test('stage 3: error reason selector offers the 8-class taxonomy', async () => {
  const selector = await source('apps/web/src/components/ErrorReasonSelector.tsx');
  for (const label of ['知识点没学过', '概念混淆', '公式记错', '计算错误', '审题错误', '推理过程错误', '时间不足', '蒙题']) {
    assert.match(selector, new RegExp(`value: '${label}'`));
  }
  assert.match(selector, /normalizeMistakeReason/);
});
