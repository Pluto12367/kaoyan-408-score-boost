/**
 * PX-1 Coach Productization Tests.
 *
 * - CoachConversationSession: bounded append + deterministic compression
 * - Conversation compression: long dialogues fold with goal/unresolved retention
 * - Personalized prompt V2: distinct output for strong / average / weak students
 * - Session repository: RuntimeState roundtrip + disabled degradation
 * - Service integration: session continuity without breaking the legacy contract
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

import {
  appendAndCompress,
  buildSessionBrief,
  buildPersonalizedPromptSections,
  MAX_SESSION_MESSAGES,
} from '../apps/api/dist/study/coach-session.js';

const NOW = '2026-09-06T08:00:00.000Z';

function longDialogue(turns) {
  let session = null;
  for (let index = 0; index < turns; index += 1) {
    const { session: updated } = appendAndCompress(
      session,
      'u-1',
      `第${index}轮：死锁必要条件我还是不懂？帮我安排计划学会它`,
      `教练解释第${index}轮的死锁概念与复习建议`,
      NOW,
    );
    session = updated;
  }
  return session;
}

test('session compression: 30-turn dialogue stays bounded and folds history', () => {
  const session = longDialogue(30);
  assert.ok(session);
  assert.ok(session.recentMessages.length <= MAX_SESSION_MESSAGES, `kept ${session.recentMessages.length}`);
  assert.equal(session.compressions >= 1, true);
  assert.equal(session.userId, 'u-1');
  // The two appended turns of the final call are the last entries
  assert.equal(session.recentMessages.at(-1)?.role, 'coach');
});

test('session compression: goals and unresolved issues survive folding', () => {
  const session = longDialogue(30);
  assert.ok(session);
  assert.ok(session.goals.length >= 1, 'goal keywords (安排/学会/计划) must be extracted');
  assert.ok(session.goals.some((goal) => goal.includes('安排计划学会')));
  assert.ok(session.unresolvedIssues.some((issue) => issue.includes('不懂')), 'confusion marker must persist');
  assert.ok(session.summary.length > 0, 'folded student turns become the summary');
});

test('session compression: estimated tokens stay bounded and shrink vs unfolded size', () => {
  // Reference: total raw characters of 30 turns
  const rawChars = 30 * 2 * 30; // ~30 chars per message
  const session = longDialogue(30);
  assert.ok(session);
  const { summary } = appendAndCompress(session, 'u-1', '再问一次', '好的', NOW);
  assert.ok(summary.estimatedTokens < rawChars / 4, `tokens=${summary.estimatedTokens} must be far below unfolded size`);
  assert.ok(summary.keptMessages.length <= MAX_SESSION_MESSAGES);
});

test('session brief: renders goals, unresolved issues and last student message', () => {
  const session = longDialogue(30);
  assert.ok(session);
  const brief = buildSessionBrief(session);
  assert.ok(brief.length <= 900);
  assert.ok(brief.includes('学生目标') || brief.includes('未解决') || brief.includes('此前对话要点'));
});

test('personalization V2: weak, average and strong students produce different sections', () => {
  const weak = buildPersonalizedPromptSections({
    studentProfile: { stage: '基础', weakestSubject: '操作系统', targetScore: 100 },
    learningMemory: { weakTitles: ['死锁必要条件', '信号量'], streakDays: 2 },
    recentBehavior: { recentAccuracyPercent: 45, dueReviews: 6, openTaskTitles: ['复习死锁'] },
  });
  const average = buildPersonalizedPromptSections({
    studentProfile: { stage: '强化', weakestSubject: '计算机网络', targetScore: 115 },
    learningMemory: { weakTitles: ['TCP拥塞控制'], streakDays: 5 },
    recentBehavior: { recentAccuracyPercent: 70, dueReviews: 2, openTaskTitles: ['练习IP'] },
  });
  const strong = buildPersonalizedPromptSections({
    studentProfile: { stage: '冲刺', weakestSubject: null, targetScore: 130 },
    learningMemory: { weakTitles: [], streakDays: 30 },
    recentBehavior: { recentAccuracyPercent: 92, dueReviews: 0, openTaskTitles: [] },
  });

  assert.ok(weak.includes('基础') && weak.includes('死锁必要条件') && weak.includes('45%'));
  assert.ok(average.includes('强化') && average.includes('70%'));
  assert.ok(strong.includes('冲刺') && strong.includes('92%'));
  assert.ok(!strong.includes('近期薄弱：'), 'strong student has no weak titles section content');
  // Guardrail intact in every variant
  for (const sections of [weak, average, strong]) {
    assert.ok(sections.includes('不得虚构'));
  }
});

// ---- Repository (RuntimeState-backed) ----

function stubPrisma() {
  const store = new Map();
  return {
    store,
    runtimeState: {
      findUnique: async ({ where }) => store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null,
      upsert: async ({ where, create, update }) => { store.set(where.key, update.value ?? create.value); },
    },
  };
}

async function loadRepositoryClass() {
  const path = 'apps/api/src/study/coach-session.repository.ts';
  const input = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(input, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: false },
  }).outputText;
  const module = { exports: {} };
  const stubs = {
    '@nestjs/common': { Injectable: () => (target) => target, Optional: () => () => {} },
  };
  Function('require', 'module', 'exports', output)((specifier) => {
    const stubKey = Object.keys(stubs).find((key) => specifier.includes(key));
    if (stubKey) return stubs[stubKey];
    if (specifier.includes('coach-session')) return { };
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports.CoachSessionRepository;
}

test('session repository roundtrips through RuntimeState', async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test';
  try {
    const Repository = await loadRepositoryClass();
    const prisma = stubPrisma();
    const repo = new Repository(prisma);
    assert.equal(await repo.load('u-1'), null);

    await repo.save({
      sessionId: 'coach-20260906', userId: 'u-1', createdAt: NOW, lastActiveAt: NOW,
      summary: '此前讨论死锁', goals: ['学会死锁'], unresolvedIssues: ['还是不懂PV'],
      recentMessages: [{ role: 'student', content: '死锁还是不懂', at: NOW }],
      compressions: 2,
    });
    const loaded = await repo.load('u-1');
    assert.ok(loaded);
    assert.equal(loaded.sessionId, 'coach-20260906');
    assert.equal(loaded.summary, '此前讨论死锁');
    assert.deepEqual(loaded.unresolvedIssues, ['还是不懂PV']);
    assert.equal(loaded.compressions, 2);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test('session repository is disabled without DATABASE_URL (explicit degradation)', async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const Repository = await loadRepositoryClass();
    const prisma = stubPrisma();
    const repo = new Repository(prisma);
    assert.equal(repo.enabled, false);
    await repo.save({ sessionId: 's', userId: 'u-1', createdAt: NOW, lastActiveAt: NOW, summary: '', goals: [], unresolvedIssues: [], recentMessages: [], compressions: 0 });
    assert.equal(prisma.store.size, 0, 'disabled repository must not write');
    assert.equal(await repo.load('u-1'), null);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

// ---- Service integration ----

async function loadCoachService() {
  const path = 'apps/api/src/study/contextual-coach.service.ts';
  const input = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(input, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: false },
  }).outputText;
  const module = { exports: {} };
  const stubs = {
    '@nestjs/common': {
      Injectable: () => (target) => target,
      Optional: () => () => {},
      BadRequestException: class BadRequestException extends Error {},
    },
  };
  Function('require', 'module', 'exports', output)((specifier) => {
    const stubKey = Object.keys(stubs).find((key) => specifier.includes(key));
    if (stubKey) return stubs[stubKey];
    if (specifier.includes('ai-tutor.service')) return { AiTutorService: class {} };
    if (specifier.includes('contextual-coach-context-assembler.service')) return { ContextualCoachContextAssembler: class {} };
    if (specifier.includes('coach-session.repository')) return { CoachSessionRepository: class {} };
    if (specifier.includes('coach-session')) return { appendAndCompress, buildPersonalizedPromptSections, buildSessionBrief };
    if (specifier.includes('learning-memory.service')) return { LearningMemoryService: class {} };
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports.ContextualCoachService;
}

async function serviceDeps(options = {}) {
  const saved = [];
  const assembler = { assemble: async (userId, request) => ({
    version: 'contextual-coach-v1',
    context: { type: request.contextType, id: request.questionId ?? request.knowledgeNodeId ?? null },
    student: { goal: { targetScore: 120, currentScore: 80, dailyHours: 3, remainingDays: 90, stage: '强化', weakestSubject: '操作系统' }, masterySummary: {}, weakPoints: [] },
    focus: {}, currentTasks: [{ title: '复习死锁' }], assembledAt: NOW,
    ...(options.knowledgeContext ? { knowledgeContext: options.knowledgeContext } : {}),
  }) };
  const tutor = {
    contextualCoach: async (userId, context, message, sessionBrief, personalization) => {
      if (options.capture) options.capture({ message, sessionBrief, personalization });
      return { draft: { summary: `已解释（收到消息：${(message ?? '').slice(0, 20)}）`, replySteps: [], misconceptionTips: [], reviewCards: [], nextActions: [] }, source: 'template', prompt: '', durationMs: 1 };
    },
  };
  const sessionRepo = options.sessionRepo === 'disabled' ? { enabled: false, load: async () => null, save: async () => {} } : {
    enabled: true,
    load: async (userId) => options.existingSession ?? null,
    save: async (session) => { saved.push(session); },
  };
  const memory = options.memory === null ? undefined : {
    getLearningMemory: async () => ({
      brief: '近期薄弱知识点：死锁必要条件',
      midTerm: { weakNodes: [{ title: '死锁必要条件' }], improvingNodes: [], highRiskQuestions: [], dueCount: 3, overdueCount: 1 },
      longTerm: { studyStreak: 4, recentAccuracy: { status: 'sufficient', value: 0.65 }, topSubjects: [], examGoal: {} },
      shortTerm: { openTasks: [], completedToday: 0, liveSession: null },
    }),
  };
  return { saved, service: new (await loadCoachService())(assembler, tutor, sessionRepo, memory) };
}

test('service: session continuity persists turns and response carries sessionId', async () => {
  const { saved, service } = await serviceDeps();
  const response = await service.contextualCoach('u-1', {
    contextType: 'wrong_question', questionId: 'w-1', message: '为什么PV操作总错？',
  });
  assert.equal(saved.length, 1);
  assert.ok(response.sessionId, 'response should carry sessionId when session tracking is active');
  assert.ok(response.session);
  assert.equal(response.session.goals.length >= 0, true);
  // The student message entered the persisted session
  assert.ok(saved[0].recentMessages.some((message) => message.role === 'student' && message.content.includes('PV')));
});

test('service: personalization sections reach the tutor prompt', async () => {
  const captured = [];
  const { service } = await serviceDeps({ capture: (value) => captured.push(value) });
  await service.contextualCoach('u-1', { contextType: 'wrong_question', questionId: 'w-1', message: '为什么总错' });
  assert.ok(captured[0].personalization);
  assert.ok(captured[0].personalization.includes('student_profile'));
  assert.ok(captured[0].personalization.includes('learning_memory'));
});

test('service: legacy contract intact when session repo is disabled', async () => {
  const { saved, service } = await serviceDeps({ sessionRepo: 'disabled' });
  const response = await service.contextualCoach('u-1', { contextType: 'wrong_question', questionId: 'w-1', message: '问题' });
  assert.equal(saved.length, 0);
  assert.equal(response.sessionId, undefined);
  assert.equal(response.session, undefined);
  assert.equal(response.source, 'template');
  assert.ok(response.summary.startsWith('已解释'));
});

test('service: mismatched sessionId starts a fresh session, not the stored one', async () => {
  const { saved, service } = await serviceDeps({
    existingSession: {
      sessionId: 'old-session', userId: 'u-1', createdAt: NOW, lastActiveAt: NOW,
      summary: '旧会话', goals: [], unresolvedIssues: [], recentMessages: [], compressions: 0,
    },
  });
  const response = await service.contextualCoach('u-1', {
    contextType: 'wrong_question', questionId: 'w-1', message: '新话题', sessionId: 'different-session',
  });
  // fresh session created and saved (old one not silently continued)
  assert.equal(saved.length, 1);
  assert.notEqual(response.sessionId, 'old-session');
});

test('controller still rejects body userId with sessionId accepted', async () => {
  const source = await readFile(new URL('../apps/api/src/study/study.controller.ts', import.meta.url), 'utf8');
  assert.match(source, /Post\('ai\/contextual-coach'\)/);
  assert.match(source, /userId is not allowed/);
  const types = await readFile(new URL('../apps/api/src/study/contextual-coach.types.ts', import.meta.url), 'utf8');
  assert.match(types, /sessionId\?: string/);
});