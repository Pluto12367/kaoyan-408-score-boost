import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { QuestionsService } from '../questions/questions.service';
import { ScoreCenterService } from '../score-center/service';
import type { KnowledgeRetriever } from '../rag/knowledge-retriever.service';
import { PracticeRecordRepository } from './practice-record.repository';
import { AssessmentHistoryProjectionService } from './assessment-history-projection.service';
import { StudentContextQueryService } from './student-context.query.service';
import { StudentStateProjectionService } from './student-state-projection.service';
import { WrongQuestionProjectionService } from './wrong-question-projection.service';
import type { ContextualCoachContext, ContextualCoachRequest } from './contextual-coach.types';

@Injectable()
export class ContextualCoachContextAssembler {
  constructor(
    private readonly studentState: StudentStateProjectionService,
    private readonly questions: QuestionsService,
    private readonly wrongQuestions: WrongQuestionProjectionService,
    private readonly assessments: AssessmentHistoryProjectionService,
    private readonly records: PracticeRecordRepository,
    private readonly scoreCenter: ScoreCenterService,
    // Base student state bridge (Step 1). Appended last to keep positional
    // constructor tests stable; @Optional keeps the legacy StudentState base
    // when the query service is not wired (e.g. legacy DI compositions).
    @Optional() private readonly studentContext?: StudentContextQueryService,
    // Knowledge retrieval bridge (Phase AI-2). Appended after studentContext
    // for the same positional-stability reason; @Optional keeps the coach
    // prompt shape unchanged when RAG is not wired.
    @Optional() private readonly knowledgeRetriever?: KnowledgeRetriever,
  ) {}

  async assemble(userId: string, request: ContextualCoachRequest): Promise<ContextualCoachContext> {
    const [studentState, studentContext] = await Promise.all([
      this.studentState.getSnapshot(userId),
      this.studentContext ? this.studentContext.getContext(userId) : Promise.resolve(null),
    ]);
    const focus = await this.buildFocus(userId, request);
    const contextId = this.contextId(request, focus);
    const base = studentContext
      ? toStudentContextBase(studentContext, studentState)
      : toLegacyBase(studentState);
    const knowledgeContext = await this.retrieveKnowledgeContext(request, focus);
    return {
      version: 'contextual-coach-v1',
      context: { type: request.contextType, id: contextId },
      student: base.student,
      focus: focus,
      currentTasks: base.currentTasks,
      assembledAt: new Date().toISOString(),
      ...(knowledgeContext ? { knowledgeContext } : {}),
    };
  }

  /**
   * Phase AI-2: best-effort knowledge retrieval for the coach prompt.
   * Query priority: learner message → scenario focus text. Retrieval is
   * failure-isolated in KnowledgeRetriever; this method only omits the
   * field when there is nothing usable to retrieve from.
   */
  private async retrieveKnowledgeContext(
    request: ContextualCoachRequest,
    focus: Record<string, unknown>,
  ): Promise<ContextualCoachContext['knowledgeContext'] | null> {
    if (!this.knowledgeRetriever) return null;
    const message = request.message?.trim();
    if (message) return this.knowledgeRetriever.retrieve(message);
    return this.knowledgeRetriever.retrieve(deriveFocusQuery(request, focus));
  }

  private async buildFocus(userId: string, request: ContextualCoachRequest): Promise<Record<string, unknown>> {
    if (request.contextType === 'question') {
      const question = await this.questions.findQuestionById(request.questionId);
      if (!question) throw new NotFoundException('Question not found');
      const records = (await this.records.listByUser(userId)).filter((record) => record.questionId === request.questionId).slice(-5);
      return {
        question: { id: question.id, stem: question.stem, options: question.options, answer: question.answer, analysis: question.analysis, knowledgePointIds: question.knowledgePointIds.slice(0, 3) },
        selectedAnswer: request.selectedAnswer ?? null,
        practiceHistory: records.map((record) => ({ correct: record.correct, selectedAnswer: record.selectedAnswer, mistakeReason: record.mistakeReason, submittedAt: record.submittedAt })),
        message: request.message?.trim().slice(0, 1000) ?? null,
      };
    }
    if (request.contextType === 'wrong_question') {
      const snapshot = await this.wrongQuestions.getSnapshot(userId);
      const item = snapshot.currentWrongItems.find((candidate) => candidate.questionId === request.questionId)
        ?? snapshot.resolvedItems.find((candidate) => candidate.questionId === request.questionId);
      if (!item) throw new NotFoundException('Wrong question not found');
      return {
        wrongQuestion: { questionId: item.questionId, stem: item.stem, answer: item.answer, analysis: item.analysis, knowledgePointId: item.knowledgePointId, knowledgePointTitle: item.knowledgePointTitle, latestCorrect: item.latestCorrect, latestMistakeReason: item.latestMistakeReason, wrongCount: item.wrongCount, attemptCount: item.attemptCount },
        practiceHistory: item.attemptHistory.slice(-5),
        reviewHistory: item.reviewHistory.slice(-3),
        message: request.message?.trim().slice(0, 1000) ?? null,
      };
    }
    if (request.contextType === 'knowledge_node') {
      // getKnowledgeDetail's parameter is named knowledgePointId but queries
      // KnowledgeNode by id — request.knowledgeNodeId (Node) is the correct
      // argument; do not reinterpret it as a Point ID.
      const detail = await this.scoreCenter.getKnowledgeDetail(userId, request.knowledgeNodeId);
      if (!detail) throw new NotFoundException('Knowledge node not found');
      return {
        knowledgeNode: detail.knowledgePoint,
        mastery: detail.userState,
        knowledgeEvidence: {
          frequency: detail.frequency,
          relations: { prerequisites: detail.relations.prerequisites.slice(0, 3), related: detail.relations.related.slice(0, 3) },
          relatedQuestions: detail.relatedQuestions.slice(0, 3).map((question) => ({ id: question.id, stem: question.stem })),
          examQuestions: detail.examQuestions.slice(0, 3).map((question) => ({ id: question.id, summary: question.summary, year: question.year })),
        },
        message: request.message?.trim().slice(0, 1000) ?? null,
      };
    }
    const snapshot = await this.assessments.getSnapshot(userId);
    const item = request.assessmentId ? snapshot.items.find((candidate) => candidate.id === request.assessmentId) : snapshot.items[0];
    return {
      assessment: item ? { ...item } : null,
      available: Boolean(item),
      message: request.message?.trim().slice(0, 1000) ?? null,
    };
  }

  private contextId(request: ContextualCoachRequest, focus: Record<string, unknown>): string | null {
    if (request.contextType === 'question' || request.contextType === 'wrong_question') return request.questionId;
    if (request.contextType === 'knowledge_node') return request.knowledgeNodeId;
    const assessment = focus.assessment as { id?: string } | null;
    return assessment?.id ?? request.assessmentId ?? null;
  }
}

/**
 * Base student state from the canonical StudentContext read model.
 *
 * StudentContext is the canonical summary source; StudentState is read here
 * ONLY for the two fields the contract intentionally does not carry
 * (goal.dailyHours and task.mode) — they must not be added to StudentContext.
 * Scenario focus data (question/wrong-question/knowledge-node/assessment
 * details) stays with the dedicated loaders in buildFocus.
 *
 * Bucket semantics: StudentContext.mastery exposes weak/improving/mastered
 * node buckets; the improving bucket maps to the legacy "review" stage count.
 */
function toStudentContextBase(
  context: Awaited<ReturnType<StudentContextQueryService['getContext']>>,
  studentState: Awaited<ReturnType<StudentStateProjectionService['getSnapshot']>>,
) {
  const nodes = [...context.mastery.weakNodes, ...context.mastery.improvingPoints, ...context.mastery.masteredPoints];
  const averageMastery = nodes.length
    ? Math.round(nodes.reduce((sum, node) => sum + node.mastery, 0) / nodes.length * 100)
    : 0;
  const modeByTaskId = new Map(studentState.studyTasks.today.map((task) => [task.id, task.mode]));
  return {
    student: {
      goal: {
        targetScore: context.exam.targetScore,
        currentScore: context.exam.currentScore,
        dailyHours: studentState.goal.dailyHours,
        remainingDays: context.exam.remainingDays,
        stage: context.exam.studyStage,
        weakestSubject: context.profile.weakestSubject,
      },
      masterySummary: {
        source: context.mastery.source,
        averageMastery,
        weakCount: context.mastery.weakNodes.length,
        reviewCount: context.mastery.improvingPoints.length,
        masteredCount: context.mastery.masteredPoints.length,
        lastUpdatedAt: context.mastery.lastUpdatedAt,
      },
      weakPoints: context.mastery.weakNodes.slice(0, 3).map((node) => ({
        knowledgeNodeId: node.knowledgeNodeId,
        subject: node.subject,
        chapter: node.chapter,
        title: node.title,
        masteryRate: Math.round(node.mastery * 100),
        accuracyRate: node.accuracy == null ? null : Math.round(node.accuracy * 100),
        attempts: node.attempts,
        wrongCount: node.wrongCount,
        status: node.status,
      })),
    },
    currentTasks: context.plan.todayTasks.slice(0, 5).map((task) => ({
      id: task.studyTaskId,
      title: task.title,
      status: task.status,
      scheduledDate: task.scheduledDate,
      completed: task.completed,
      mode: modeByTaskId.get(task.studyTaskId) ?? null,
      questionCount: task.questionCount,
    })),
  };
}

/** Legacy base: derived from the StudentState projection snapshot (pre-bridge behavior). */
function toLegacyBase(studentState: Awaited<ReturnType<StudentStateProjectionService['getSnapshot']>>) {
  return {
    student: {
      goal: {
        targetScore: studentState.goal.targetScore,
        currentScore: studentState.goal.currentScore,
        dailyHours: studentState.goal.dailyHours,
        remainingDays: studentState.goal.remainingDays,
        stage: studentState.goal.stage,
        weakestSubject: studentState.goal.weakestSubject,
      },
      masterySummary: { ...studentState.mastery },
      weakPoints: studentState.weakPoints.slice(0, 3).map((point) => ({ ...point })),
    },
    currentTasks: studentState.studyTasks.today.slice(0, 5).map((task) => ({
      id: task.id, title: task.title, status: task.status, scheduledDate: task.scheduledDate,
      completed: task.completed, mode: task.mode, questionCount: task.questionCount,
    })),
  };
}

/**
 * Fallback retrieval query derived from the scenario focus when the learner
 * did not send a message. Knowledge detail exposes `name`; test fixtures may
 * use `title` — both are accepted.
 */
function deriveFocusQuery(request: ContextualCoachRequest, focus: Record<string, unknown>): string {
  if (request.contextType === 'question') {
    const question = focus.question as { stem?: string } | undefined;
    return (question?.stem ?? '').slice(0, 120);
  }
  if (request.contextType === 'wrong_question') {
    const wrong = focus.wrongQuestion as { stem?: string } | undefined;
    return (wrong?.stem ?? '').slice(0, 120);
  }
  if (request.contextType === 'knowledge_node') {
    const node = focus.knowledgeNode as { name?: string; title?: string } | undefined;
    return (node?.name ?? node?.title ?? '').slice(0, 120);
  }
  return '';
}
