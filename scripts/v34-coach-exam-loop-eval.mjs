/**
 * v3.4 Phase 7/8 — Coach & Exam closed-loop validation (real test DB).
 *
 * Phase 7: user question → StudentContext → RAG → coach context assembly.
 * The LLM narration is BLOCKED (billing); the VALIDATABLE parts are the
 * context pipeline: after practice changes mastery, the assembled coach
 * context MUST reflect the new state (mastery bucket / weakPoints move).
 *
 * Phase 8: exam generation from real nodes + real question tags → simulated
 * answering through ScoreCenter → mastery/recommendation shift → next
 * planner draft differs.
 *
 * Run: DATABASE_URL=... node scripts/v34-coach-exam-loop-eval.mjs
 */

import { PrismaClient } from '@prisma/client';
import { ScoreCenterService } from '../apps/api/dist/score-center/service.js';
import { RecommendationService } from '../apps/api/dist/study/recommendation.service.js';
import { StudyPlanRepository } from '../apps/api/dist/study/study-plan.repository.js';
import { StudyAgentToolRegistry } from '../apps/api/dist/agent/agent-tools.js';
import { StudyPlannerService } from '../apps/api/dist/agent/study-planner.service.js';
import { ExamSimulatorService } from '../apps/api/dist/agent/exam-simulator.service.js';
import { ExamQuestionRepository } from '../apps/api/dist/agent/exam-question.repository.js';
import { StudentContextQueryService } from '../apps/api/dist/study/student-context.query.service.js';
import { StudentStateProjectionService } from '../apps/api/dist/study/student-state-projection.service.js';
import { PracticeProjectionService } from '../apps/api/dist/study/practice-projection.service.js';
import { WrongQuestionProjectionService } from '../apps/api/dist/study/wrong-question-projection.service.js';
import { TodayPlanProjectionService } from '../apps/api/dist/study/today-plan-projection.service.js';
import { AssessmentProjectionService } from '../apps/api/dist/study/assessment-projection.service.js';
import { WrongQuestionQueryService } from '../apps/api/dist/study/wrong-question-query.service.js';
import { QuestionsService } from '../apps/api/dist/questions/questions.service.js';
import { ContextualCoachContextAssembler } from '../apps/api/dist/study/contextual-coach-context-assembler.service.js';
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

const NOW = new Date('2026-09-06T12:00:00.000Z');
const USER = `v34-loop7-${Date.now()}`;
const SUBJECT_ENUM = { DS: 'DATA_STRUCTURE', CO: 'COMPUTER_ORGANIZATION', OS: 'OPERATING_SYSTEM', CN: 'COMPUTER_NETWORK' };
const realNow = Date.now();

async function createQuestion(prisma, { id, stem, pointId, nodeId, subject, pointTitle }) {
  await prisma.knowledgePoint.create({ data: { id: pointId, subject: SUBJECT_ENUM[subject] ?? subject, chapter: '测试章节', title: pointTitle, importance: 5, frequency: 5, prerequisites: [] } }).catch(() => {});
  await prisma.questionFamily.create({ data: { id: `fam-${id}` } }).catch(() => {});
  await prisma.question.create({ data: {
    id, familyId: `fam-${id}`, versionNumber: 1, isCurrent: true, contentFingerprint: `fp-${id}`,
    stem, options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: '测试解析', difficulty: 'MEDIUM',
    type: 'SINGLE_CHOICE', source: 'v34-eval',
  } }).catch(() => {});
  await prisma.questionKnowledgePoint.create({ data: { questionId: id, knowledgePointId: pointId } }).catch(() => {});
  await prisma.questionKnowledgeNodeTag.create({ data: { questionId: id, knowledgeNodeId: nodeId, role: 'PRIMARY', confidence: 1 } }).catch(() => {});
  return { questionId: id, pointId };
}

async function main() {
  await prisma.user.create({ data: { id: USER, email: `${USER}@v34.test`, name: 'v34 loop7', role: 'STUDENT' } }).catch(() => {});
  const deadlockNode = await prisma.knowledgeNode.findFirst({ where: { name: { contains: '死锁必要条件' }, isActive: true } });
  const semaphoreNode = await prisma.knowledgeNode.findFirst({ where: { name: '信号量', isActive: true } });
  const q1 = await createQuestion(prisma, { id: `v34c1-${Date.now()}`, stem: 'PV信号量错题', pointId: `v34p7a-${Date.now()}`, nodeId: semaphoreNode.id, subject: 'OS', pointTitle: '信号量' });
  await createQuestion(prisma, { id: `v34c2-${Date.now()}`, stem: '死锁考试题', pointId: `v34p7b-${Date.now()}`, nodeId: deadlockNode.id, subject: 'OS', pointTitle: '死锁必要条件' });

  // ---- wiring ----
  const scoreCenter = new ScoreCenterService(prisma, new RecommendationService(prisma, undefined, new StudyPlanRepository(prisma)));
  const recommendation = new RecommendationService(prisma, undefined, new StudyPlanRepository(prisma));
  const studentState = new StudentStateProjectionService(prisma);
  const practiceProjection = new PracticeProjectionService(prisma);
  const wrongProjection = new WrongQuestionProjectionService(prisma);
  const studentContext = new StudentContextQueryService(
    studentState, practiceProjection, wrongProjection,
    new TodayPlanProjectionService(prisma, studentState, wrongProjection),
    new AssessmentProjectionService(prisma), prisma,
  );
  const wrongQuestions = new WrongQuestionQueryService(wrongProjection);
  const knowledgeSearch = new KnowledgeSearchService(new KnowledgeCorpusLoader(prisma), new LocalDeterministicEmbeddingProvider(), new InMemoryVectorStore());
  const registry = new StudyAgentToolRegistry({
    studentContext, knowledgeSearch,
    questions: new QuestionsService(), wrongQuestions,
    recommendation,
  });
  const assembler = new ContextualCoachContextAssembler(
    studentState, { findQuestionById: async () => null }, wrongProjection,
    { getSnapshot: async () => ({ items: [] }) },
    { listByUser: async () => [] },
    { getKnowledgeDetail: async () => null },
    studentContext, undefined,
  );
  // PX-1 retriever wiring (8th constructor param) — the coach knowledge context.
  const { KnowledgeRetriever } = await import('../apps/api/dist/rag/knowledge-retriever.service.js');
  const assemblerWithRag = new ContextualCoachContextAssembler(
    studentState, { findQuestionById: async () => null }, wrongProjection,
    { getSnapshot: async () => ({ items: [] }) },
    { listByUser: async () => [] },
    { getKnowledgeDetail: async () => null },
    studentContext, new KnowledgeRetriever(knowledgeSearch),
  );
  const planner = new StudyPlannerService(registry, undefined);
  const examSimulator = new ExamSimulatorService(registry, new ExamQuestionRepository(prisma), undefined);

  // ---- Phase 7: coach context loop ----
  // Step 1: student fails PV questions twice (outside cooldown window).
  // PracticeRecord rows are written here directly because the snapshot's
  // currentWrongItems derives from PracticeRecord groups; applyAttempts
  // only drives mastery/review state.
  const attempts = [
    { correct: false, at: new Date(realNow - 38 * 3600_000) },
    { correct: false, at: new Date(realNow - 37 * 3600_000) },
  ];
  for (const attempt of attempts) {
    await prisma.practiceRecord.create({ data: {
      userId: USER, questionId: q1.questionId, knowledgePointId: q1.pointId,
      correct: attempt.correct, timeSpentSec: 60, expectedTimeSec: 100, submittedAt: attempt.at,
    } });
  }
  await scoreCenter.applyAttempts(USER, attempts.map((attempt) => ({
    questionId: q1.questionId, correct: attempt.correct, timeSpentSec: 60, submittedAt: attempt.at,
  })));

  // Step 2: coach context assembly for "为什么PV操作总错？" — wrong_question scenario.
  const contextBefore = await assemblerWithRag.assemble(USER, {
    contextType: 'wrong_question', questionId: q1.questionId, message: '为什么PV操作总错？',
  });
  const retrievedBefore = contextBefore.knowledgeContext?.results?.[0];
  record('P7: coach context carries weak-node mastery from StudentContext',
    contextBefore.student.weakPoints.some((point) => String(point.title ?? '').includes('信号量') || point.knowledgeNodeId === semaphoreNode.id),
    `weakPoints=${JSON.stringify(contextBefore.student.weakPoints.map((point) => point.title ?? point.knowledgeNodeId))}`);
  record('P7: coach retrieval grounds the PV question on real nodes',
    !!retrievedBefore && retrievedBefore.relevanceScore > 0
      && (retrievedBefore.title.includes('信号量') || retrievedBefore.knowledgeNodeId === semaphoreNode.id
        || retrievedBefore.title.includes('生产者消费者') || retrievedBefore.title.includes('PV')
        || retrievedBefore.title.includes('同步')),
    retrievedBefore ? `${retrievedBefore.knowledgeNodeId}:${retrievedBefore.title} (${retrievedBefore.relevanceScore.toFixed(2)})` : 'none');

  // Step 3: student practices correctly → state changes → coach context reflects it.
  for (const attempt of [
    { correct: true, at: new Date(realNow - 36 * 3600_000) },
    { correct: true, at: new Date(realNow - 35 * 3600_000) },
  ]) {
    await prisma.practiceRecord.create({ data: {
      userId: USER, questionId: q1.questionId, knowledgePointId: q1.pointId,
      correct: attempt.correct, timeSpentSec: 40, expectedTimeSec: 100, submittedAt: attempt.at,
    } });
  }
  await scoreCenter.applyAttempts(USER, [
    { questionId: q1.questionId, correct: true, timeSpentSec: 40, submittedAt: new Date(realNow - 36 * 3600_000) },
    { questionId: q1.questionId, correct: true, timeSpentSec: 35, submittedAt: new Date(realNow - 35 * 3600_000) },
  ]);
  const contextAfter = await assemblerWithRag.assemble(USER, {
    contextType: 'wrong_question', questionId: q1.questionId, message: '为什么PV操作总错？',
  });
  const weakCountBefore = contextBefore.student.masterySummary.weakCount;
  const weakCountAfter = contextAfter.student.masterySummary.weakCount;
  record('P7: second coach assembly reflects the state change',
    JSON.stringify(contextBefore.student) !== JSON.stringify(contextAfter.student)
      && (weakCountAfter < weakCountBefore || contextAfter.student.masterySummary.averageMastery > contextBefore.student.masterySummary.averageMastery),
    `weak ${weakCountBefore} → ${weakCountAfter}, avgMastery ${contextBefore.student.masterySummary.averageMastery} → ${contextAfter.student.masterySummary.averageMastery}`);

  // ---- Phase 8: exam loop ----
  // Step 0: resolve the nodes the exam generator will retrieve (same query),
  // then attach REAL bank questions to them — papers only contain real
  // bank questions, so the fixture must live where retrieval looks.
  const probeSearch = await knowledgeSearch.search('OS 考试 重点 考点', { topK: 3, subject: 'OS' });
  const probeNodes = probeSearch.results.map((result) => result.knowledgeNodeId);
  if (probeNodes.length === 0) throw new Error('probe retrieval empty — cannot place exam fixture');
  for (const [index, nodeId] of probeNodes.entries()) {
    await createQuestion(prisma, {
      id: `v34e${index}-${Date.now()}`, stem: `OS真题风格题${index + 1}`,
      pointId: `v34p8-${index}-${Date.now()}`, nodeId, subject: 'OS', pointTitle: `节点${index}`,
    });
  }

  // Step 1: generate an OS exam from real nodes/tags.
  const exam = await examSimulator.generateExam(USER, { subject: 'OS', questionCount: 5 }, NOW);
  record('P8: exam generated from real nodes and real bank', exam.paper.questions.length >= 1 && exam.knowledgeContext.retrievedNodes.length >= 1,
    `questions=${exam.paper.questions.length} coverage=${exam.paper.coveragePoints.length} nodes=${exam.knowledgeContext.retrievedNodes.length}`);

  // Step 2: simulate answering — all wrong on the exam's covered nodes.
  const facts = [];
  for (const question of exam.paper.questions) {
    await scoreCenter.applyAttempts(USER, [{ questionId: question.id, correct: false, timeSpentSec: 60, submittedAt: NOW }]);
    facts.push({ questionId: question.id, knowledgePointIds: [...question.knowledgePointIds], correct: false });
  }
  const analysis = await examSimulator.analyzeExam(USER, { facts });
  record('P8: exam analysis computes weak points deterministically',
    analysis.analysis.answeredCount === facts.length && analysis.analysis.weakPoints.length >= 1,
    `accuracy=${analysis.analysis.accuracyPercent}% weak=${analysis.analysis.weakPoints.length}`);

  // Step 3: mastery + recommendation react → next planner draft differs.
  const masteryRowsAfterExam = await prisma.userKnowledgeMastery.count({ where: { userId: USER } });
  const draftBefore = await planner.generatePlan(USER, { availableMinutes: 60 }, NOW);
  const draftBeforeSig = JSON.stringify([draftBefore.focusNodes, draftBefore.validation.removed]);
  // Push one covered node deep into weak territory, then re-draft.
  const covered = exam.paper.questions[0];
  await scoreCenter.applyAttempts(USER, [{ questionId: covered.id, correct: false, timeSpentSec: 60, submittedAt: NOW }]);
  const draftAfter = await planner.generatePlan(USER, { availableMinutes: 60 }, NOW);
  const draftAfterSig = JSON.stringify([draftAfter.focusNodes, draftAfter.validation.removed]);
  record('P8: mastery rows accumulate from exam answering', masteryRowsAfterExam >= exam.paper.coveragePoints.length,
    `masteryRows=${masteryRowsAfterExam}`);
  record('P8: next planner draft reacts to exam outcomes',
    draftAfterSig !== draftBeforeSig || draftAfter.focusNodes.join() !== draftBefore.focusNodes.join(),
    `before=${draftBeforeSig.slice(0, 80)} after=${draftAfterSig.slice(0, 80)}`);

  const passed = results.filter((result) => result.pass).length;
  console.log(JSON.stringify({ summary: { total: results.length, passed, failed: results.length - passed }, evalUser: USER }, null, 1));
  await prisma.$disconnect();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error('EVAL FAILED:', error instanceof Error ? error.message : String(error).slice(0, 300));
  if (error instanceof Error && error.stack) console.error(error.stack.split(String.fromCharCode(10)).slice(1, 5).join(String.fromCharCode(10)));
  process.exit(1);
});