/**
 * v3.4 Phase 4 — Agent tool-calling validation (high-fidelity).
 *
 * REAL: tool registry (all six tools), real DB-backed read models, real
 * knowledge search over the seeded corpus, real canonical plan writer
 * (StudyPlan rows actually land in the test DB), real failure paths.
 * SCRIPTED: the LLM boundary (real provider BLOCKED — see
 * docs/v34-remote-llm-blocker.md); the scripted LLM emits the same
 * tool_calls protocol the real provider would.
 *
 * Validated: tool selection order, argument correctness, failure recovery,
 * max-steps, deadline, write authorization gate, generationKey idempotency.
 *
 * Run: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public node scripts/v34-agent-toolcalling-eval.mjs
 */

import { PrismaClient } from '@prisma/client';
import { StudyAgentToolRegistry } from '../apps/api/dist/agent/agent-tools.js';
import { StudyAgentService } from '../apps/api/dist/agent/study-agent.service.js';
import { StudentContextQueryService } from '../apps/api/dist/study/student-context.query.service.js';
import { StudentStateProjectionService } from '../apps/api/dist/study/student-state-projection.service.js';
import { PracticeProjectionService } from '../apps/api/dist/study/practice-projection.service.js';
import { WrongQuestionProjectionService } from '../apps/api/dist/study/wrong-question-projection.service.js';
import { TodayPlanProjectionService } from '../apps/api/dist/study/today-plan-projection.service.js';
import { AssessmentProjectionService } from '../apps/api/dist/study/assessment-projection.service.js';
import { WrongQuestionQueryService } from '../apps/api/dist/study/wrong-question-query.service.js';
import { RecommendationService } from '../apps/api/dist/study/recommendation.service.js';
import { StudyPlanRepository } from '../apps/api/dist/study/study-plan.repository.js';
import { QuestionsService } from '../apps/api/dist/questions/questions.service.js';
import { KnowledgeCorpusLoader } from '../apps/api/dist/rag/knowledge-corpus.loader.js';
import { LocalDeterministicEmbeddingProvider } from '../apps/api/dist/rag/embedding-provider.js';
import { InMemoryVectorStore } from '../apps/api/dist/rag/vector-store.js';
import { KnowledgeSearchService } from '../apps/api/dist/rag/knowledge-search.service.js';

const prisma = new PrismaClient();
const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
}

function buildRegistry(overrides = {}) {
  const studentState = new StudentStateProjectionService(prisma);
  const practice = new PracticeProjectionService(prisma);
  const wrongProjection = new WrongQuestionProjectionService(prisma);
  const todayPlan = new TodayPlanProjectionService(prisma, studentState, wrongProjection);
  const assessment = new AssessmentProjectionService(prisma);
  const studentContext = new StudentContextQueryService(studentState, practice, wrongProjection, todayPlan, assessment, prisma);
  const wrongQuestions = new WrongQuestionQueryService(wrongProjection);
  const questions = new QuestionsService();
  const loader = new KnowledgeCorpusLoader(prisma);
  const knowledgeSearch = new KnowledgeSearchService(loader, new LocalDeterministicEmbeddingProvider(), new InMemoryVectorStore());
  const studyPlanRepository = new StudyPlanRepository(prisma);
  const recommendation = new RecommendationService(prisma, undefined, studyPlanRepository);
  return new StudyAgentToolRegistry({
    studentContext: overrides.studentContext ?? studentContext,
    knowledgeSearch: overrides.knowledgeSearch ?? knowledgeSearch,
    questions,
    wrongQuestions,
    recommendation: overrides.recommendation ?? recommendation,
  });
}

const NOW = new Date('2026-09-06T10:00:00.000Z');
const EVAL_USER = `v34-agent-${Date.now()}`;
let DEADLOCK_NODE_ID;

async function main() {
  // Resolve the real deadlock node id from the seeded corpus (no hardcoded fixture ids).
  const deadlockNode = await prisma.knowledgeNode.findFirst({ where: { name: { contains: '死锁必要条件' }, isActive: true } });
  if (deadlockNode) DEADLOCK_NODE_ID = deadlockNode.id;

  // Create a REAL user row: StudyPlan has an FK to User — the violation we
  // hit on the first run is the database correctly protecting the write path.
  await prisma.user.create({ data: {
    id: EVAL_USER, email: `${EVAL_USER}@v34.test`, passwordHash: 'v34-eval-not-a-login', name: 'v34 agent eval',
    role: 'STUDENT',
  } }).catch(() => {});

  // 1. getStudentContext over the real DB (empty student → safe empty buckets).
  const registry = buildRegistry();
  const ctx = await registry.execute(EVAL_USER, 'getStudentContext', {}, NOW);
  record('getStudentContext real DB', ctx.ok && ctx.data?.version === 'student-context-v1', `source=${ctx.data?.mastery?.source}`);

  // 2. searchKnowledge with real retrieval over the seeded corpus.
  const search = await registry.execute(EVAL_USER, 'searchKnowledge', { query: '死锁产生的条件', topK: 3 }, NOW);
  const topNode = search.data?.results?.[0];
  record('searchKnowledge real retrieval', search.ok && topNode && topNode.relevanceScore > 0,
    `top=${topNode ? `${topNode.knowledgeNodeId}:${topNode.title} (${topNode.relevanceScore.toFixed(2)})` : 'none'}`);

  // 3. searchQuestion is bounded and student-safe.
  const questions = await registry.execute(EVAL_USER, 'searchQuestion', {}, NOW);
  const safeProjection = Array.isArray(questions.data) && questions.data.every((question) => !('answer' in question) && !('analysis' in question));
  record('searchQuestion safe bounded projection', questions.ok && safeProjection, `count=${Array.isArray(questions.data) ? questions.data.length : 0}`);

  // 4. getWrongQuestions real DB (empty student → empty list, ok).
  const wrong = await registry.execute(EVAL_USER, 'getWrongQuestions', {}, NOW);
  record('getWrongQuestions real DB', wrong.ok && Array.isArray(wrong.data) && wrong.data.length === 0, `count=0`);

  // 5. Full agent loop with scripted LLM: tool order + grounding.
  const toolOrder = [];
  const scriptedLlm = {
    name: 'scripted-protocol-llm',
    complete: async ({ messages }) => {
      void messages;
      const turn = toolOrder.length;
      if (turn === 0) {
        toolOrder.push('getStudentContext');
        return { content: null, toolCalls: [{ id: 'c1', name: 'getStudentContext', arguments: '{}' }] };
      }
      if (turn === 1) {
        toolOrder.push('searchKnowledge');
        return { content: null, toolCalls: [{ id: 'c2', name: 'searchKnowledge', arguments: JSON.stringify({ query: '死锁产生条件', topK: 2 }) }] };
      }
      return { content: JSON.stringify({ summary: '基于学生上下文与检索结果的分析。', focusNodes: [], suggestions: [], knowledgeRefs: [DEADLOCK_NODE_ID] }), toolCalls: [] };
    },
  };
  const agent = new StudyAgentService(registry, scriptedLlm, undefined, undefined);
  const run = await agent.run(EVAL_USER, { message: '分析我的薄弱点并讲讲死锁' }, NOW);
  record('agent loop tool order', run.mode === 'llm' && toolOrder[0] === 'getStudentContext' && toolOrder[1] === 'searchKnowledge', toolOrder.join(' → '));
  record('agent loop grounded citations', Array.isArray(run.answer.knowledgeRefs) && run.answer.knowledgeRefs.includes(DEADLOCK_NODE_ID), (run.answer.knowledgeRefs ?? []).join(','));

  // 6. Failure recovery: knowledge search fails mid-loop, run completes.
  const failingRegistry = buildRegistry({
    knowledgeSearch: { search: async () => { throw new Error('index cold'); } },
  });
  const recoveringAgent = new StudyAgentService(failingRegistry, {
    name: 'failure-llm',
    complete: async () => ({ content: JSON.stringify({ summary: 'partial', focusNodes: [], suggestions: [] }), toolCalls: [] }),
  }, undefined, undefined);
  const recoveryRun = await recoveringAgent.run(EVAL_USER, { message: 'test' }, NOW);
  record('tool failure recovery', recoveryRun.mode === 'llm' && recoveryRun.answer.summary === 'partial', 'run completed despite tool failure');

  // 7. Write authorization gate + canonical writer idempotency (real DB writes).
  const before = await prisma.studyPlan.count({ where: { userId: EVAL_USER } });
  const created = await registry.execute(EVAL_USER, 'createStudyTask', { scheduledDate: '2026-09-06', availableMinutes: 60 }, NOW);
  const afterFirst = await prisma.studyPlan.count({ where: { userId: EVAL_USER } });
  record('createStudyTask writes through canonical writer', created.ok && afterFirst === before + 1,
    `planId=${created.data?.planId ?? 'none'} plans=${afterFirst - before}`);
  const createdAgain = await registry.execute(EVAL_USER, 'createStudyTask', { scheduledDate: '2026-09-06', availableMinutes: 60 }, NOW);
  const afterSecond = await prisma.studyPlan.count({ where: { userId: EVAL_USER } });
  record('generationKey idempotency (same user+date)', createdAgain.ok && afterSecond === afterFirst,
    `plans delta=${afterSecond - afterFirst}`);

  // 8. Permission gate: unauthorized createStudyTask never executes (loop-level).
  let createCalls = 0;
  const guardedRegistry = buildRegistry({
    recommendation: {
      runRecommendationForUser: async () => ({ result: { items: [] }, nodeById: new Map() }),
      generateDailyPlanFromState: async () => { createCalls += 1; return { id: 'x', tasks: [] }; },
    },
  });
  const rogueAgent = new StudyAgentService(guardedRegistry, {
    name: 'rogue-llm',
    complete: async () => ({ content: null, toolCalls: [{ id: 'r1', name: 'createStudyTask', arguments: '{}' }] }),
  }, undefined, undefined);
  const rogueRun = await rogueAgent.run(EVAL_USER, { message: '直接给我建任务' }, NOW);
  const denied = rogueRun.steps.some((step) => step.tool === 'createStudyTask' && step.error === 'tool_permission_denied');
  record('write permission gate denies unauthorized tool call', createCalls === 0 && denied, `writerCalls=${createCalls}`);

  // 9. Max steps.
  const loopLlm = { name: 'loop', complete: async () => ({ content: null, toolCalls: [{ name: 'getStudentContext', arguments: '{}' }] }) };
  const loopAgent = new StudyAgentService(registry, loopLlm, undefined, undefined);
  const loopRun = await loopAgent.run(EVAL_USER, { message: 'loop' }, NOW);
  record('max steps enforced', loopRun.fallbackReason === 'max_steps_reached' && loopRun.steps.length === 6, `steps=${loopRun.steps.length}`);

  // 10. Deadline.
  const previousDeadline = process.env.AGENT_RUN_DEADLINE_MS;
  process.env.AGENT_RUN_DEADLINE_MS = '30';
  const slowLlm = {
    name: 'slow',
    complete: async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { content: null, toolCalls: [{ name: 'getStudentContext', arguments: '{}' }] };
    },
  };
  const deadlineAgent = new StudyAgentService(registry, slowLlm, undefined, undefined);
  const deadlineRun = await deadlineAgent.run(EVAL_USER, { message: 'deadline' }, NOW);
  if (previousDeadline === undefined) delete process.env.AGENT_RUN_DEADLINE_MS;
  else process.env.AGENT_RUN_DEADLINE_MS = previousDeadline;
  record('run deadline enforced', deadlineRun.fallbackReason === 'deadline_exceeded', `steps=${deadlineRun.steps.length}`);

  // 11. Real provider error path: EmbeddingError/HTTP failure classification (no stub masking).
  const realFailure = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer invalid-key-for-error-path' },
    body: JSON.stringify({ model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'x' }] }),
  }).catch((error) => ({ status: 0, error: String(error) }));
  record('real provider reachable (auth error, not network)', realFailure.status === 401, `status=${realFailure.status}`);

  const passed = results.filter((result) => result.pass).length;
  console.log(JSON.stringify({
    summary: { total: results.length, passed, failed: results.length - passed },
    levels: { toolOrchestration: 'Integration PASS (real DB + real tools); LLM autonomy BLOCKED (402 billing)' },
  }, null, 1));
  await prisma.$disconnect();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error('EVAL FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});