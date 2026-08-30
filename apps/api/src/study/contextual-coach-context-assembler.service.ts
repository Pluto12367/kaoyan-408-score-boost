import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { QuestionsService } from '../questions/questions.service';
import { ScoreCenterService } from '../score-center/service';
import { PracticeRecordRepository } from './practice-record.repository';
import { AssessmentHistoryProjectionService } from './assessment-history-projection.service';
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
  ) {}

  async assemble(userId: string, request: ContextualCoachRequest): Promise<ContextualCoachContext> {
    const studentState = await this.studentState.getSnapshot(userId);
    const focus = await this.buildFocus(userId, request);
    const contextId = this.contextId(request, focus);
    const currentTasks = studentState.studyTasks.today.slice(0, 5).map((task) => ({
      id: task.id, title: task.title, status: task.status, scheduledDate: task.scheduledDate,
      completed: task.completed, mode: task.mode, questionCount: task.questionCount,
    }));
    return {
      version: 'contextual-coach-v1',
      context: { type: request.contextType, id: contextId },
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
      focus: focus,
      currentTasks: currentTasks,
      assembledAt: new Date().toISOString(),
    };
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
