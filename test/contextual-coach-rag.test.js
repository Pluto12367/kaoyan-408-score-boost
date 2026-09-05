/**
 * Contextual Coach RAG Integration Tests (Phase AI-2).
 *
 * Verifies:
 * - KnowledgeRetriever bounds results and degrades explicitly on failure.
 * - ContextAssembler attaches optional knowledgeContext when a retriever is
 *   wired (message-first, focus-derived fallback query).
 * - Without a retriever the context shape is unchanged (legacy DI compatible).
 * - Prompt builders carry retrieved knowledge without breaking guardrails.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

import { KnowledgeRetriever } from '../apps/api/dist/rag/knowledge-retriever.service.js';
import {
  buildContextualCoachSystemPrompt,
  buildContextualCoachUserPrompt,
} from '../apps/api/dist/study/contextual-coach.prompt.js';

// ---- KnowledgeRetriever unit tests ----

function searchStub(behavior) {
  return { search: async (...args) => behavior(...args) };
}

test('KnowledgeRetriever returns null for empty or whitespace query', async () => {
  const retriever = new KnowledgeRetriever(searchStub(() => { throw new Error('should not be called'); }));
  assert.equal(await retriever.retrieve(''), null);
  assert.equal(await retriever.retrieve('   '), null);
  assert.equal(await retriever.retrieve(undefined), null);
});

test('KnowledgeRetriever bounds results to 3 nodes and 3 related nodes each', async () => {
  const retriever = new KnowledgeRetriever(searchStub(async (query, options) => {
    assert.equal(query, '死锁产生条件');
    assert.equal(options.topK, 3);
    return {
      query,
      source: 'local-deterministic-v1',
      indexSize: 10,
      available: true,
      results: Array.from({ length: 5 }, (_, i) => ({
        knowledgeNodeId: `node-${i}`,
        subject: 'OS',
        nodeType: 'atomicPoint',
        title: `节点${i}`,
        chapterPath: ['进程管理', '死锁'],
        relevanceScore: 0.9 - i * 0.1,
        matchedChunks: [],
        relatedNodes: Array.from({ length: 6 }, (_, j) => ({
          knowledgeNodeId: `rel-${i}-${j}`,
          title: `相关${j}`,
          relationType: 'RELATED',
        })),
      })),
    };
  }));
  const context = await retriever.retrieve('死锁产生条件');
  assert.ok(context);
  assert.equal(context.available, true);
  assert.equal(context.source, 'local-deterministic-v1');
  // Bounded: retriever asked search for topK=3, but results are bounded here too
  assert.ok(context.results.length <= 3);
  for (const result of context.results) {
    assert.ok(result.relatedNodes.length <= 3);
    assert.ok(result.knowledgeNodeId);
    assert.ok(result.title);
    assert.ok(typeof result.relevanceScore === 'number');
  }
});

test('KnowledgeRetriever degrades to explicit unavailable context on search failure', async () => {
  const retriever = new KnowledgeRetriever(searchStub(async () => {
    throw new Error('boom');
  }));
  const context = await retriever.retrieve('PV操作');
  assert.ok(context);
  assert.equal(context.available, false);
  assert.equal(context.reason, 'retrieval_error');
  assert.deepEqual(context.results, []);
  assert.equal(context.source, 'unavailable');
});

// ---- Assembler integration (sandbox loader, mirrors base-context test) ----

function loadAssembler() {
  const path = 'apps/api/src/study/contextual-coach-context-assembler.service.ts';
  const input = readFileSync(path, 'utf8');
  const output = ts.transpileModule(input, {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true,
      emitDecoratorMetadata: false,
    },
  }).outputText;
  const module = { exports: {} };
  const stubs = {
    '@nestjs/common': {
      Injectable: () => (target) => target,
      Optional: () => (target, _key, _index) => undefined,
      BadRequestException: class BadRequestException extends Error {},
      NotFoundException: class NotFoundException extends Error {},
    },
  };
  Function('require', 'module', 'exports', output)((specifier) => {
    const stubKey = Object.keys(stubs).find((key) => specifier.includes(key));
    if (stubKey) return stubs[stubKey];
    if (specifier.includes('questions.service')) return { QuestionsService: class {} };
    if (specifier.includes('score-center/service')) return { ScoreCenterService: class {} };
    if (specifier.includes('practice-record.repository')) return { PracticeRecordRepository: class {} };
    if (specifier.includes('assessment-history-projection.service')) return { AssessmentHistoryProjectionService: class {} };
    if (specifier.includes('student-state-projection.service')) return { StudentStateProjectionService: class {} };
    if (specifier.includes('wrong-question-projection.service')) return { WrongQuestionProjectionService: class {} };
    if (specifier.includes('knowledge-retriever.service')) return { KnowledgeRetriever: class {} };
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

function baseDependencies() {
  return {
    studentState: {
      getSnapshot: async () => ({
        goal: { targetScore: 120, currentScore: 80, dailyHours: 3, remainingDays: 100, stage: '强化', weakestSubject: '操作系统' },
        mastery: { source: 'user_knowledge_mastery', averageMastery: 62, weakCount: 1, reviewCount: 1, masteredCount: 2, lastUpdatedAt: null },
        weakPoints: [],
        studyTasks: { today: [] },
      }),
    },
    studentContext: {
      getContext: async () => null,
    },
    questions: {
      findQuestionById: async (questionId) => ({
        id: questionId, stem: 'PV操作中信号量的P操作应该先做什么？', options: ['A', 'B'],
        answer: 'A', analysis: '解析', knowledgePointIds: ['node-1'],
      }),
    },
    wrongQuestions: {
      getSnapshot: async () => ({
        currentWrongItems: [{
          questionId: 'wrong-1', stem: '进程同步PV错题', answer: 'A', analysis: '解析',
          knowledgePointId: 'point-1', knowledgePointTitle: '信号量', latestCorrect: false,
          latestMistakeReason: '概念不清', wrongCount: 2, attemptCount: 3, attemptHistory: [], reviewHistory: [],
        }],
        resolvedItems: [],
      }),
    },
    assessments: { getSnapshot: async () => ({ items: [] }) },
    records: { listByUser: async () => [] },
    scoreCenter: {
      getKnowledgeDetail: async (_userId, nodeId) => ({
        knowledgePoint: { id: nodeId, title: '信号量', name: '信号量', subject: 'OS', nodeType: 'atomicPoint' },
        userState: { masteryRate: 42 },
        frequency: {},
        relations: { prerequisites: [], related: [] },
        relatedQuestions: [],
        examQuestions: [],
      }),
    },
  };
}

function retrievedContextFixture(query) {
  return {
    source: 'local-deterministic-v1',
    query,
    available: true,
    results: [{
      knowledgeNodeId: 'OS-C02-S04-P20',
      subject: 'OS',
      nodeType: 'atomicPoint',
      title: '信号量',
      chapterPath: ['进程同步', '信号量'],
      relevanceScore: 0.82,
      relatedNodes: [{ knowledgeNodeId: 'OS-C02-S04-P21', title: '整型信号量', relationType: 'PREREQUISITE' }],
    }],
  };
}

function createAssembler(options = {}) {
  const deps = baseDependencies();
  const retrieverCalls = [];
  // Retriever modes: 'fixture' (default) | 'none' (not wired) | null (returns null) | function
  const retrieverMode = 'retriever' in options ? options.retriever : 'fixture';
  const retriever = retrieverMode === 'none' ? undefined : {
    retrieve: async (query) => {
      retrieverCalls.push(query);
      if (retrieverMode === null) return null;
      if (typeof retrieverMode === 'function') return retrieverMode(query);
      return retrievedContextFixture(query);
    },
  };
  const assembler = new (loadAssembler().ContextualCoachContextAssembler)(
    deps.studentState,
    deps.questions,
    deps.wrongQuestions,
    deps.assessments,
    deps.records,
    deps.scoreCenter,
    deps.studentContext,
    retriever,
  );
  return { assembler, retrieverCalls };
}

test('assembler attaches knowledgeContext from the learner message', async () => {
  const { assembler, retrieverCalls } = createAssembler();
  const context = await assembler.assemble('u-1', {
    contextType: 'question',
    questionId: 'question-1',
    message: '为什么PV操作总错？',
  });
  assert.deepEqual(retrieverCalls, ['为什么PV操作总错？']);
  assert.ok(context.knowledgeContext, 'knowledgeContext should be attached');
  assert.equal(context.knowledgeContext.query, '为什么PV操作总错？');
  assert.equal(context.knowledgeContext.available, true);
  assert.equal(context.knowledgeContext.results[0].knowledgeNodeId, 'OS-C02-S04-P20');
  assert.equal(context.knowledgeContext.results[0].title, '信号量');
});

test('assembler derives retrieval query from focus when no message is present', async () => {
  const { assembler, retrieverCalls } = createAssembler();
  await assembler.assemble('u-1', { contextType: 'knowledge_node', knowledgeNodeId: 'OS-C02-S04-P20' });
  assert.equal(retrieverCalls.length, 1);
  assert.equal(retrieverCalls[0], '信号量');
});

test('assembler derives retrieval query from question stem for question context without message', async () => {
  const { assembler, retrieverCalls } = createAssembler();
  await assembler.assemble('u-1', { contextType: 'question', questionId: 'question-1' });
  assert.equal(retrieverCalls.length, 1);
  assert.ok(retrieverCalls[0].includes('PV操作'));
});

test('assembler omits knowledgeContext when no retriever is wired (legacy DI compatible)', async () => {
  const { assembler } = createAssembler({ retriever: 'none' });
  const context = await assembler.assemble('u-1', {
    contextType: 'question',
    questionId: 'question-1',
    message: '为什么PV操作总错？',
  });
  assert.equal('knowledgeContext' in context, false);
});

test('assembler omits knowledgeContext when retriever returns null (no usable query)', async () => {
  const { assembler } = createAssembler({ retriever: null });
  const context = await assembler.assemble('u-1', {
    contextType: 'assessment',
    message: '   ',
  });
  assert.equal('knowledgeContext' in context, false);
});

test('assembler keeps degraded knowledgeContext explicit when retrieval errors', async () => {
  const { assembler } = createAssembler({
    retriever: () => ({
      source: 'unavailable', query: '为什么PV操作总错？', available: false, results: [], reason: 'retrieval_error',
    }),
  });
  const context = await assembler.assemble('u-1', {
    contextType: 'question',
    questionId: 'question-1',
    message: '为什么PV操作总错？',
  });
  assert.ok(context.knowledgeContext);
  assert.equal(context.knowledgeContext.available, false);
  assert.equal(context.knowledgeContext.reason, 'retrieval_error');
});

// ---- Prompt compatibility ----

test('user prompt carries retrieved knowledge inside the same JSON envelope', () => {
  const context = {
    version: 'contextual-coach-v1',
    context: { type: 'question', id: 'q-1' },
    student: { goal: {}, masterySummary: {}, weakPoints: [] },
    focus: {},
    currentTasks: [],
    assembledAt: '2026-09-05T00:00:00.000Z',
    knowledgeContext: retrievedContextFixture('为什么PV操作总错？'),
  };
  const prompt = buildContextualCoachUserPrompt(context, '为什么PV操作总错？');
  const parsed = JSON.parse(prompt);
  assert.ok(prompt.includes('knowledgeContext'));
  assert.ok(prompt.includes('信号量'));
  assert.equal(parsed.context.context.type, 'question');
  assert.equal(parsed.context.knowledgeContext.results[0].knowledgeNodeId, 'OS-C02-S04-P20');
});

test('user prompt shape is unchanged when knowledgeContext is absent', () => {
  const context = {
    version: 'contextual-coach-v1',
    context: { type: 'question', id: 'q-1' },
    student: { goal: {}, masterySummary: {}, weakPoints: [] },
    focus: {},
    currentTasks: [],
    assembledAt: '2026-09-05T00:00:00.000Z',
  };
  const prompt = buildContextualCoachUserPrompt(context, '消息');
  assert.ok(!prompt.includes('knowledgeContext'));
  const parsed = JSON.parse(prompt);
  assert.equal(parsed.context.version, 'contextual-coach-v1');
});

test('system prompt mentions retrieved knowledge usage boundary without breaking guardrails', () => {
  const prompt = buildContextualCoachSystemPrompt();
  assert.match(prompt, /不能修改学习计划/);
  assert.match(prompt, /只能解释、提醒和建议/);
  assert.match(prompt, /knowledgeContext/);
  assert.match(prompt, /不得虚构/);
});