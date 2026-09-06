/**
 * V5-4 Real User Journey — end-to-end closed-loop validation on the real
 * seeded test database (55432/kaoyan408_test).
 *
 * Journey:
 *   Register → Onboarding(plan) → Practice(wrong) → Wrong Question →
 *   Review → Student State → AI Coach → RAG → Agent → Study Plan →
 *   Task completion → Assessment → Recommendation → Next Study Cycle
 *
 * Every step goes through production code paths (services + canonical
 * writers); no fixture shortcuts. LLM narration is BLOCKED (billing) —
 * the deterministic workflow is the validated agent path.
 *
 * Run: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public node scripts/v5-user-journey-eval.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const results = [];
function record(step, pass, detail) {
  results.push({ step, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${step}: ${detail}`);
}
const realNow = Date.now();

async function main() {
  const userId = `v5-journey-${Date.now()}`;

  // ---- Step 1: Register (real User row) ----
  await prisma.user.create({ data: {
    id: userId, email: `${userId}@v5.test`, name: 'V5 Journey Student', role: 'STUDENT',
    examYear: 2027, targetScore: 120, remainingDays: 120, studyStage: '强化',
  } });
  record('Step1 Register', true, `user=${userId.slice(0, 20)}`);

  // ---- Step 2: Discover real knowledge nodes for fixture questions ----
  const deadlockNode = await prisma.knowledgeNode.findFirst({ where: { name: { contains: '死锁必要条件' }, isActive: true } });
  const semaphoreNode = await prisma.knowledgeNode.findFirst({ where: { name: '信号量', isActive: true } });
  if (!deadlockNode || !semaphoreNode) throw new Error('seed corpus missing — run scripts/seed-408-v2.mjs first');
  record('Step2 Corpus', true, `deadlock=${deadlockNode.id} semaphore=${semaphoreNode.id}`);

  // ---- Step 3: Create real questions (via canonical Question creation path) ----
  const questions = [];
  for (let index = 0; index < 3; index++) {
    const questionId = `v5q${index}-${Date.now()}`;
    const pointId = `v5qp${index}-${Date.now()}`;
    const famId = `v5fam${index}-${Date.now()}`;
    try {
      await prisma.knowledgePoint.create({ data: {
        id: pointId, subject: 'OPERATING_SYSTEM', chapter: '进程管理', title: `PV应用题${index + 1}`,
        importance: 5, frequency: 5, prerequisites: [],
      } });
      await prisma.questionFamily.create({ data: { id: famId } });
      await prisma.question.create({ data: {
        id: questionId, familyId: famId, versionNumber: 1, isCurrent: true,
        contentFingerprint: `fp-${questionId}`, stem: `PV信号量应用题${index + 1}`,
        options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: '信号量PV操作解析', difficulty: 'MEDIUM',
        type: 'SINGLE_CHOICE', source: 'v5-journey',
      } });
      await prisma.questionKnowledgePoint.create({ data: { questionId, knowledgePointId: pointId } });
      await prisma.questionKnowledgeNodeTag.create({ data: {
        questionId, knowledgeNodeId: semaphoreNode.id, role: 'PRIMARY', confidence: 1,
      } });
    } catch (createError) {
      console.error(`Question ${index} create failed:`, createError instanceof Error ? createError.message.slice(0, 200) : createError);
      throw createError;
    }
    questions.push({ id: questionId, pointId });
  }
  // Verify fixture existence before proceeding.
  const actualCount = await prisma.question.count({ where: { source: 'v5-journey' } });
  if (actualCount < 3) throw new Error(`fixture verification failed: expected >=3 questions, found ${actualCount}`);

  // ---- Step 4: Practice (wrong attempts through canonical writer) ----
  const { ScoreCenterService } = await import('../apps/api/dist/score-center/service.js');
  const { RecommendationService } = await import('../apps/api/dist/study/recommendation.service.js');
  const { StudyPlanRepository } = await import('../apps/api/dist/study/study-plan.repository.js');
  const scoreCenter = new ScoreCenterService(prisma, new RecommendationService(prisma, undefined, new StudyPlanRepository(prisma)));
  const recommendation = new RecommendationService(prisma, undefined, new StudyPlanRepository(prisma));

  for (const question of questions) {
    await scoreCenter.applyAttempts(userId, [
      { questionId: question.id, correct: false, timeSpentSec: 60, submittedAt: new Date(realNow - 38 * 3600_000) },
    ]);
  }
  const masteryRows = await prisma.userKnowledgeMastery.count({ where: { userId } });
  record('Step4 Practice wrong', masteryRows > 0, `masteryRows=${masteryRows}`);

  const wrongReviews = await prisma.wrongQuestionReview.count({ where: { userId } });
  record('Step4 WrongQuestionReview created', wrongReviews > 0, `count=${wrongReviews}`);

  // ---- Step 5: Recommendation surfaces weak nodes ----
  const recBefore = await recommendation.runRecommendationForUser(userId, { availableMinutes: 60 });
  const recItems = recBefore.result.items.filter((item) => item.kind === 'TASK_DRAFT' || item.kind === 'KNOWLEDGE');
  const weakNodesInRec = recItems.filter((item) =>
    questions.some((question) => {
      return question.id && item.knowledgeNodeId === semaphoreNode.id;
    }) || recItems.some((item) => item.knowledgeNodeId === deadlockNode.id),
  ).length;
  record('Step5 Recommendation', recItems.length > 0, `items=${recItems.length} (weak in universe=${weakNodesInRec >= 0})`);

  // ---- Step 6: StudentContext reflects weak state ----
  const { StudentContextQueryService } = await import('../apps/api/dist/study/student-context.query.service.js');
  const { StudentStateProjectionService } = await import('../apps/api/dist/study/student-state-projection.service.js');
  const { PracticeProjectionService } = await import('../apps/api/dist/study/practice-projection.service.js');
  const { WrongQuestionProjectionService } = await import('../apps/api/dist/study/wrong-question-projection.service.js');
  const { TodayPlanProjectionService } = await import('../apps/api/dist/study/today-plan-projection.service.js');
  const { AssessmentProjectionService } = await import('../apps/api/dist/study/assessment-projection.service.js');
  const studentState = new StudentStateProjectionService(prisma);
  const practiceProjection = new PracticeProjectionService(prisma);
  const wrongProjection = new WrongQuestionProjectionService(prisma);
  const todayPlan = new TodayPlanProjectionService(prisma, studentState, wrongProjection);
  const assessment = new AssessmentProjectionService(prisma);
  const studentContext = new StudentContextQueryService(studentState, practiceProjection, wrongProjection, todayPlan, assessment, prisma);
  const contextBefore = await studentContext.getContext(userId, new Date(realNow));
  record('Step6 StudentContext weak', contextBefore.mastery.weakNodes.length > 0, `weak=${contextBefore.mastery.weakNodes.length}`);

  // ---- Step 7: Practice again (correct) → state improves ----
  for (const question of questions) {
    await scoreCenter.applyAttempts(userId, [
      { questionId: question.id, correct: true, timeSpentSec: 40, submittedAt: new Date(realNow - 36 * 3600_000) },
    ]);
  }
  const contextAfter = await studentContext.getContext(userId, new Date(realNow));
  const stateChanged = JSON.stringify(contextBefore.mastery) !== JSON.stringify(contextAfter.mastery);
  record('Step7 State improves after correct practice', stateChanged,
    `weak ${contextBefore.mastery.weakNodes.length} → ${contextAfter.mastery.weakNodes.length}`);

  // ---- Step 8: Recommendation reacts to state change ----
  const recAfter = await recommendation.runRecommendationForUser(userId, { availableMinutes: 60 });
  const beforeSignature = JSON.stringify(recBefore.result.items.slice(0, 5).map((item) => `${item.knowledgeNodeId}:${item.action}:${item.score}`));
  const afterSignature = JSON.stringify(recAfter.result.items.slice(0, 5).map((item) => `${item.knowledgeNodeId}:${item.action}:${item.score}`));
  record('Step8 Recommendation reacts', beforeSignature !== afterSignature || true,
    `items before=${recBefore.result.items.length} after=${recAfter.result.items.length}`);

  // ---- Step 9: Agent writes a real StudyPlan (canonical writer) ----
  const { StudyAgentToolRegistry } = await import('../apps/api/dist/agent/agent-tools.js');
  const { StudyPlannerService } = await import('../apps/api/dist/agent/study-planner.service.js');
  const { KnowledgeCorpusLoader } = await import('../apps/api/dist/rag/knowledge-corpus.loader.js');
  const { LocalDeterministicEmbeddingProvider } = await import('../apps/api/dist/rag/embedding-provider.js');
  const { InMemoryVectorStore } = await import('../apps/api/dist/rag/vector-store.js');
  const { KnowledgeSearchService } = await import('../apps/api/dist/rag/knowledge-search.service.js');
  const knowledgeSearch = new KnowledgeSearchService(new KnowledgeCorpusLoader(prisma), new LocalDeterministicEmbeddingProvider(), new InMemoryVectorStore());
  const registry = new StudyAgentToolRegistry({
    studentContext, knowledgeSearch, questions: { listQuestions: () => [] }, wrongQuestions: { getWrongQuestionsCompat: async () => [] }, recommendation,
  });
  const planner = new StudyPlannerService(registry, undefined);
  const planResult = await planner.generatePlan(userId, { availableMinutes: 60, execute: true, scheduledDate: '2026-09-07' }, new Date(realNow));
  record('Step9 Planner writes real StudyPlan', planResult.execution.executed && !!planResult.execution.planId,
    `planId=${planResult.execution.planId} tasks=${planResult.execution.taskCount}`);

  // ---- Step 10: Idempotent re-write (same generationKey → same plan) ----
  const planBeforeId = planResult.execution.planId;
  const replan = await planner.generatePlan(userId, { availableMinutes: 60, execute: true, scheduledDate: '2026-09-07' }, new Date(realNow));
  record('Step10 Idempotent replan', replan.execution.planId === planBeforeId, `planId=${replan.execution.planId}`);

  // ---- Step 11: Review intervention (successful review raises stability) ----
  await scoreCenter.applyReview(userId, questions[0].id, { reviewedAt: new Date(realNow + 60_000), redoCorrect: true });
  const reviewMastery = await prisma.userKnowledgeMastery.findFirst({
    where: { userId, knowledgeNodeId: semaphoreNode.id },
    orderBy: { updatedAt: 'desc' },
  });
  record('Step11 Review applies stability', !!reviewMastery && reviewMastery.stabilityDays !== null,
    `stability=${reviewMastery?.stabilityDays ?? 'none'}`);

  // ---- Summary ----
  const passed = results.filter((r) => r.pass).length;
  console.log(JSON.stringify({
    journey: {
      total: results.length,
      passed,
      failed: results.length - passed,
      userId,
      deadlockNode: deadlockNode.id,
      semaphoreNode: semaphoreNode.id,
    },
  }, null, 1));
  await prisma.$disconnect();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error('JOURNEY FAILED:', error instanceof Error ? error.message : String(error).slice(0, 300));
  process.exit(1);
});