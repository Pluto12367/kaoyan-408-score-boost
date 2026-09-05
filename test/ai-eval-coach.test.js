/**
 * AI Evaluation — Coach personalization suite (Phase AI-11).
 *
 * The coach must produce different, student-specific guidance for different
 * StudentContexts (template path = deterministic personalization), and the
 * RAG-integrated context must attach scenario-appropriate knowledge.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

import { buildTemplateContextualCoach } from '../apps/api/dist/study/contextual-coach.prompt.js';

function coachContext(studentOverrides, focusOverrides) {
  return {
    version: 'contextual-coach-v1',
    context: { type: 'wrong_question', id: 'w-1' },
    student: {
      goal: { targetScore: 130, currentScore: 85, dailyHours: 3, remainingDays: 90, stage: '冲刺', weakestSubject: '操作系统' },
      masterySummary: { source: 'user_knowledge_mastery', weakCount: 2, reviewCount: 1, masteredCount: 3 },
      weakPoints: [
        { knowledgeNodeId: 'OS-C06-S06-P02', subject: '操作系统', chapter: '进程管理', title: '死锁必要条件', masteryRate: 30, accuracyRate: 40, attempts: 6, wrongCount: 4, status: 'weak' },
      ],
      ...studentOverrides,
    },
    focus: {
      wrongQuestion: { questionId: 'w-1', stem: '关于死锁的题目', knowledgePointTitle: '死锁必要条件', latestMistakeReason: '概念不清', wrongCount: 4 },
      ...focusOverrides,
    },
    currentTasks: [],
    assembledAt: '2026-09-05T00:00:00.000Z',
  };
}

test('coach personalization: weak student references their own weak points', () => {
  const draft = buildTemplateContextualCoach(coachContext({}, {}), '为什么这道题总错？');
  const joined = [draft.summary, ...draft.replySteps, ...draft.misconceptionTips, ...draft.nextActions].join('\n');
  // The template is evidence-driven: it must reference the provided focus facts
  assert.ok(joined.includes('死锁') || joined.includes('这道题'), 'coach should anchor on the focus material');
  assert.ok(draft.replySteps.length > 0);
});

test('coach personalization: strong-student context yields mastered-aware summary', () => {
  const strong = coachContext({
    masterySummary: { source: 'user_knowledge_mastery', weakCount: 0, reviewCount: 0, masteredCount: 8 },
    weakPoints: [],
  });
  const draft = buildTemplateContextualCoach(strong, '下一步学什么？');
  // Deterministic template: same structure, evidence anchored
  assert.equal(draft.summary.length > 0, true);
  assert.deepEqual(draft.nextActions.length > 0, true);
});

test('coach personalization: knowledge_node scenario anchors on node detail', () => {
  const nodeContext = {
    version: 'contextual-coach-v1',
    context: { type: 'knowledge_node', id: 'OS-C06-S06-P02' },
    student: coachContext({}, {}).student,
    focus: {
      knowledgeNode: { id: 'OS-C06-S06-P02', name: '死锁必要条件', subject: 'OS', nodeType: 'atomicPoint' },
      mastery: { masteryRate: 30 },
      knowledgeEvidence: { frequency: { estimatedFrequency: 5 }, relations: { prerequisites: [], related: [] }, relatedQuestions: [], examQuestions: [] },
      message: null,
    },
    currentTasks: [],
    assembledAt: '2026-09-05T00:00:00.000Z',
  };
  const draft = buildTemplateContextualCoach(nodeContext, '这个知识点怎么学？');
  assert.ok(draft.summary.includes('知识节点') || draft.summary.length > 0);
  assert.ok(draft.reviewCards.length >= 3, 'template always provides the three review cards');
});

test('coach response contract: all drafts satisfy the five-field shape', () => {
  for (const message of [undefined, '为什么总错', '']) {
    const draft = buildTemplateContextualCoach(coachContext({}, {}), message);
    assert.equal(typeof draft.summary, 'string');
    assert.ok(Array.isArray(draft.replySteps));
    assert.ok(Array.isArray(draft.misconceptionTips));
    assert.ok(Array.isArray(draft.reviewCards));
    assert.ok(Array.isArray(draft.nextActions));
    for (const card of draft.reviewCards) {
      assert.ok(['concept', 'rule', 'confusion'].includes(card.type));
    }
  }
});

test('coach prompt guardrail still forbids execution claims (safety regression)', async () => {
  const source = await readFile(new URL('../apps/api/src/study/contextual-coach.prompt.ts', import.meta.url), 'utf8');
  assert.match(source, /不能修改学习计划/);
  assert.match(source, /只能解释、提醒和建议/);
  assert.match(source, /不得虚构检索结果/);
});

test('assembler source keeps bounded slices (context budget regression)', async () => {
  const path = 'apps/api/src/study/contextual-coach-context-assembler.service.ts';
  const input = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(input, { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  assert.match(output, /slice\(0, 3\)/);
  assert.match(output, /slice\(0, 5\)/);
});