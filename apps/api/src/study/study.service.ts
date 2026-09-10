import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, Logger, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  accumulateTaskProgress,
  applyDiagnosticProfile as buildDiagnosticProfile,
  buildAssessmentHistorySummary,
  buildNodeDrivenDailyTasks,
  buildNodeMasteryMap,
  toLegacyMasteryMap,
  buildStudyPlan,
  buildTemplateFollowUp,
  buildTemplateTutorReply,
  buildKnowledgeEvidenceSummary,
  classifyMistake,
  computeMasteryReport,
  computeWeaknessReport,
  dedupeQuestionsByStem,
  deriveMasteryStatus,
  deriveNodeMasteryStatus,
  deriveNodeWeakPoints,
  filterWrongQuestions,
  nextReviewIntervalDays,
  stagePhase,
  postExamTaskId,
  rebalanceTaskLoad,
  resolveKnowledgePointDisplay,
  type AiFollowUpDraft,
  type AiTutorContext,
  type AiTutorFollowUpMode,
  type AiTutorReplyDraft,
  type AiTutorSimilarQuestion,
  type DiagnosticProfile,
  type KnowledgeEvidenceSummary,
  type KnowledgePoint,
  type MasteryPointExtras,
  type NodePlanEvidenceNode,
  type NodeMasteryRow,
  type PracticeRecord,
  type Question,
  type StudyStage,
  type StudyPlan,
  type Subject,
  type TaskProgress,
  type TaskRebalanceMode,
  type UserProfile,
  type WrongQuestionFilter,
  type WrongQuestionMasteryStatus,
  type WeakPoint,
  type WeaknessReport,
} from '@kaoyan408/shared';
import { CreatePracticeRecordDto } from './dto/create-practice-record.dto';
import { QuestionsService, type ReviewItem } from '../questions/questions.service';
import { toStudentQuestion, toStudentQuestions } from '../questions/question-view';
import { PracticeRecordRepository } from './practice-record.repository';
import { AiTutorService } from './ai-tutor.service';
import { LearningProgressRepository, type StudyTaskProgressMetric, type TaskCompletionMetric } from './learning-progress.repository';
import { LearningSessionRepository } from './learning-session.repository';
import { resolvePracticeActionId } from './practice-action-attribution';
import { resolveReviewActionId } from './review-action-attribution';
import { RecommendationActionService } from './recommendation-action.service';
import { LearningProfileRepository } from './learning-profile.repository';
import { KnowledgePointRepository } from './knowledge-point.repository';
import { AssessmentHistoryRepository, type PersistedAssessmentHistoryItem } from './assessment-history.repository';
import type { RecommendationItem } from '@kaoyan408/shared';
import { RecommendationService } from './recommendation.service';
import { buildCanonicalPracticeSetIdentity, buildPracticeSetCopy } from './practice-set-recommendation.adapter';
import { buildReviewResourcesDto } from './review-resources-recommendation.adapter';
import { PaperRepository } from './paper.repository';
import { SystemConfigRepository } from './system-config.repository';
import { ReviewScheduleRepository, scheduleKey, type ReviewAttemptState } from './review-schedule.repository';
import { ExamReviewPlanRepository, type ExamReviewPlanState } from './exam-review-plan.repository';
import {
  nearestAvailableStudyDate,
  OnboardingPlanRepository,
  type OnboardingProfileState,
  type ScheduledStudyTaskState,
  type SevenDayPlanState,
  type TaskRebalanceAdjustment,
} from './onboarding-plan.repository';
import { applyCarryOver, harvestCarryOverTasks } from './missed-day-recovery';
import { questionCountForMinutes } from './quick-session';
import { deriveTaskReasonCodes } from './task-reason-codes';
import { applyWeeklyIntensity, deriveWeeklyAdjustment } from './weekly-adjustment';
import type { EffectivenessService } from '../effectiveness/effectiveness.service';
import { ExamAlignmentService } from './exam-alignment.service';
import { LearningEvidenceService } from './learning-evidence.service';
import { BetaMetricsService } from './beta-metrics.service';
import { AuthenticatedUserRegistry } from '../auth/authenticated-user.registry';
import { TeacherStudentAuthorizationRepository } from './teacher-student-authorization.repository';
import { AdminUserRepository, type ManagedUserRecord, type TrialStatus } from './admin-user.repository';
import { FEEDBACK_SCENES, FeedbackRepository, type FeedbackRecord, type FeedbackScene } from './feedback.repository';
import { countByDate, lastNDates, nextNDates, studyDateKey, todayKey } from './study-date';
import { UserEventRepository } from './user-event.repository';
import { AnswerReceiptRepository, isPrismaUniqueError, type AnswerReceiptState } from './answer-receipt.repository';
import {
  MasterySummaryProjectionService,
  toReportMasteryDto,
} from './mastery-summary-projection.service';
import { computePracticeRecordRequestHash, PRACTICE_RECORD_HASH_VERSION } from './answer-request-hash';
import { ScoreCenterService } from '../score-center/service';
import { PrismaService } from '../prisma/prisma.service';
import { LearningLoopTriggerService } from './learning-loop-trigger.service';
import { ActionFeedbackTriggerService } from './action-feedback-trigger.service';
import { isReservedCanonicalEventType, isTelemetryEventType } from './canonical-event-writer.service';
import {
  loadActiveAtomicNodeCatalog,
  loadLatestFrequencySnapshots,
  resolveWrongQuestion,
  type DbClient,
} from '../score-center/repository';

const OFFICIAL_FEEDBACK_SURVEY_URL = 'https://wj.qq.com/s2/27160624/40fe/';
const ANSWER_RECEIPT_STALE_MS = 60_000;

interface NodeCatalogEntry {
  subject: NodeMasteryRow['subject'];
  chapter: string;
  title: string;
  importance: number;
  frequency: number;
  difficulty: number;
  recent3Frequency: number;
  recent5Frequency: number;
  allTimeEvidence: number;
  primaryScore5y: number;
  trendDirection: 'RISING' | 'STABLE' | 'FALLING' | 'COLD';
  trendDelta: number;
  evidenceConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

@Injectable()
export class StudyService implements OnModuleInit {
  private readonly logger = new Logger(StudyService.name);

  constructor(
    private readonly questionsService: QuestionsService,
    private readonly aiTutorService: AiTutorService,
    private readonly practiceRecordRepository: PracticeRecordRepository,
    private readonly learningProgressRepository: LearningProgressRepository,
    private readonly learningSessionRepository: LearningSessionRepository,
    private readonly learningProfileRepository: LearningProfileRepository,
    private readonly knowledgePointRepository: KnowledgePointRepository,
    private readonly assessmentHistoryRepository: AssessmentHistoryRepository,
    private readonly paperRepository: PaperRepository,
    private readonly systemConfigRepository: SystemConfigRepository,
    private readonly reviewScheduleRepository: ReviewScheduleRepository,
    private readonly examReviewPlanRepository: ExamReviewPlanRepository,
    private readonly onboardingPlanRepository: OnboardingPlanRepository,
    private readonly betaMetricsService: BetaMetricsService,
    private readonly authenticatedUsers: AuthenticatedUserRegistry,
    private readonly teacherStudentAuthorizations: TeacherStudentAuthorizationRepository,
    private readonly adminUsers: AdminUserRepository,
    private readonly feedbackRepository: FeedbackRepository,
    private readonly userEventRepository: UserEventRepository,
    private readonly scoreCenterService?: ScoreCenterService,
    private readonly prisma?: PrismaService,
    @Optional() private readonly answerReceipts?: AnswerReceiptRepository,
    @Optional() private readonly masterySummaryProjection?: MasterySummaryProjectionService,
    @Optional() private readonly recommendation?: RecommendationService,
    @Optional() private readonly learningLoopTrigger?: LearningLoopTriggerService,
    @Optional() private readonly recommendationActionService?: RecommendationActionService,
    @Optional() private readonly actionFeedbackTrigger?: ActionFeedbackTriggerService,
    @Optional() private readonly effectiveness?: EffectivenessService,
    @Optional() private readonly examAlignment?: ExamAlignmentService,
    @Optional() private readonly learningEvidence?: LearningEvidenceService,
  ) {}

  private async trackUserEvent(userId: string, type: string, payload?: Record<string, unknown>) {
    try {
      await this.userEventRepository.record(userId, type, payload);
    } catch (error) {
      this.logger.warn(
        `User event ${type} recording failed`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * V12-M1: record learning evidence for an action that previously produced
   * none (EB-1 / EB-2). Evidence is supplementary to the write path, so a
   * failure here is logged and never blocks the student's action; the absence
   * stays visible as "no evidence" rather than being papered over.
   */
  private async recordLearningEvidence(
    label: string,
    write: () => Promise<unknown>,
  ): Promise<void> {
    if (!this.learningEvidence) return;
    try {
      await write();
    } catch (error) {
      this.logger.warn(
        `Learning evidence ${label} recording failed`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async triggerLearningLoop(userId: string, input: Parameters<LearningLoopTriggerService['maybeGenerateLearningLoopPlan']>[1]) {
    try {
      return await this.learningLoopTrigger?.maybeGenerateLearningLoopPlan(userId, input);
    } catch (error) {
      this.logger.warn(
        `Learning loop trigger failed for ${userId}`,
        error instanceof Error ? error.message : String(error),
      );
      return undefined;
    }
  }

  private triggerActionFeedback(userId: string, actionId: string | null | undefined) {
    if (!actionId || !this.actionFeedbackTrigger) return;
    void this.actionFeedbackTrigger.trigger(userId, actionId).catch((error) => {
      this.logger.warn(
        `Action feedback trigger failed for ${userId}/${actionId}`,
        error instanceof Error ? error.message : String(error),
      );
    });
  }

  async recordUserEvent(userId: string, type: string, payload?: Record<string, unknown>) {
    if (isReservedCanonicalEventType(type)) {
      throw new ForbiddenException('Canonical events are server-only');
    }
    if (!isTelemetryEventType(type)) {
      throw new BadRequestException('Unsupported telemetry event type');
    }
    await this.userEventRepository.recordTelemetry(userId, type, payload);
    return { userId, type, recordedAt: new Date().toISOString() };
  }

  private readonly student: UserProfile = {
    id: 'u-001',
    name: '林同学',
    role: 'student',
    targetSchool: '北京邮电大学',
    targetScore: 115,
    currentScore: 72,
    dailyHours: 3.5,
    stage: '强化',
    remainingDays: 96,
    weakestSubject: '计算机组成原理',
  };

  private readonly diagnosticProfilesByUser = new Map<string, DiagnosticProfile>();

  private readonly knowledgePoints: KnowledgePoint[] = [
    { id: 'ds-tree', subject: '数据结构', chapter: '树与二叉树', title: '树的遍历应用', importance: 5, frequency: 5, prerequisites: ['线性表'] },
    { id: 'co-cache', subject: '计算机组成原理', chapter: '存储系统', title: 'Cache 映射与替换', importance: 5, frequency: 5, prerequisites: ['存储层次'] },
    { id: 'os-sync', subject: '操作系统', chapter: '进程管理', title: '进程同步与互斥', importance: 5, frequency: 5, prerequisites: ['进程状态'] },
    { id: 'net-tcp', subject: '计算机网络', chapter: '传输层', title: 'TCP 可靠传输', importance: 4, frequency: 5, prerequisites: ['滑动窗口'] },
  ];

  private knowledgePointDisplay = new Map<string, { title: string; chapter: string }>();

  private get questions(): Question[] {
    return this.questionsService.listQuestions();
  }

  private readonly records: PracticeRecord[] = [
    { id: 'r-001', userId: 'u-001', questionId: 'q-001', knowledgePointId: 'co-cache', correct: false, timeSpentSec: 180, expectedTimeSec: 100, mistakeReason: '概念混淆', submittedAt: '2026-06-21' },
    { id: 'r-002', userId: 'u-001', questionId: 'q-001', knowledgePointId: 'co-cache', correct: false, timeSpentSec: 120, expectedTimeSec: 100, mistakeReason: '概念混淆', submittedAt: '2026-06-22' },
    { id: 'r-003', userId: 'u-001', questionId: 'q-002', knowledgePointId: 'net-tcp', correct: true, timeSpentSec: 180, expectedTimeSec: 100, mistakeReason: null, submittedAt: '2026-06-24' },
  ];

  async onModuleInit() {
    const records = await this.practiceRecordRepository.initialize({
      user: this.student,
      knowledgePoints: this.knowledgePoints,
      questions: this.questions,
      seedRecords: this.records,
    });
    this.records.splice(0, this.records.length, ...records);
    // Hydrate the knowledge point catalog from PostgreSQL so imported points
    // participate in mastery, weakness, recommendation and planning. When the
    // database is unavailable or still empty, the built-in catalog stays.
    const persistedKnowledgePoints = await this.knowledgePointRepository.list();
    if (persistedKnowledgePoints.length > 0) {
      this.knowledgePoints.splice(0, this.knowledgePoints.length, ...persistedKnowledgePoints);
    }
    this.knowledgePointDisplay = await this.knowledgePointRepository.listNodeMaps();
    await this.loadNodeMasteryReadCache();
    if (this.useNodeMastery) {
      this.logger.warn(
        '[score-center] USE_KNODE_MASTERY=true: legacy mastery read path frozen; mastery map, weak report and recommendations read UserKnowledgeMastery.',
      );
    }
    await this.teacherStudentAuthorizations.initialize();
    const progress = await this.learningProgressRepository.load();
    replaceNestedMap(this.completedTaskDatesByUser, progress.completedTasks);
    replaceNestedMap(this.taskCompletionMetricsByUser, progress.taskCompletionMetrics);
    replaceNestedMap(this.wrongQuestionReviewDatesByUser, progress.wrongQuestionReviews);
    const sessions = await this.learningSessionRepository.loadAll();
    this.practiceSessions.clear();
    for (const session of sessions) this.practiceSessions.set(session.id, session);
    const profiles = await this.learningProfileRepository.load();
    this.diagnosticProfilesByUser.clear();
    for (const [userId, profile] of profiles) this.diagnosticProfilesByUser.set(userId, profile);
    const onboarding = await this.onboardingPlanRepository.load();
    this.onboardingProfiles.clear();
    this.sevenDayPlansByUser.clear();
    for (const [userId, profile] of onboarding.profiles) this.onboardingProfiles.set(userId, profile);
    for (const [userId, plan] of onboarding.plans) this.sevenDayPlansByUser.set(userId, plan);
    const persistedPapers = await this.paperRepository.loadAll();
    if (persistedPapers.length > 0) this.papers.splice(0, this.papers.length, ...persistedPapers);
    const persistedAssessmentHistory = await this.assessmentHistoryRepository.loadAll();
    if (persistedAssessmentHistory.length > 0) {
      this.assessmentHistoryItems.splice(0, this.assessmentHistoryItems.length, ...persistedAssessmentHistory);
    }
    replaceFeedbackItems(this.feedbackItems, await this.feedbackRepository.list());
    const savedSystemConfig = await this.systemConfigRepository.load();
    if (savedSystemConfig) {
      this.systemConfig = { ...this.systemConfig, ...savedSystemConfig };
    }
    const savedReviewSchedules = await this.reviewScheduleRepository.loadAll();
    this.reviewSchedules.clear();
    this.reviewAttemptsByKey.clear();
    for (const [key, state] of savedReviewSchedules) {
      this.reviewSchedules.set(key, state.schedule);
      this.reviewAttemptsByKey.set(key, state.attempts);
    }
    const latestWrongRecordByQuestion = new Map<string, PracticeRecord>();
    for (const record of this.records) {
      if (record.correct) continue;
      const key = scheduleKey(record.userId, record.questionId);
      const current = latestWrongRecordByQuestion.get(key);
      if (!current || comparePracticeRecordOrder(record, current) > 0) latestWrongRecordByQuestion.set(key, record);
    }
    for (const record of latestWrongRecordByQuestion.values()) {
      const schedule = this.reviewSchedules.get(scheduleKey(record.userId, record.questionId));
      if (schedule?.lastWrongRecordId !== record.id) await this.ensureReviewSchedule(record);
    }
    const examReviewPlans = await this.examReviewPlanRepository.loadAll();
    this.examReviewPlans.clear();
    for (const [sessionId, plan] of examReviewPlans) this.examReviewPlans.set(sessionId, plan);
  }

  private get dataSource(): 'memory-api' | 'postgresql' {
    return this.practiceRecordRepository.enabled ? 'postgresql' : 'memory-api';
  }

  private get useNodeMastery(): boolean {
    return process.env.USE_KNODE_MASTERY === 'true' && this.nodeMasteryCacheLoaded && Boolean(this.prisma);
  }

  private readonly nodeMasteryByUser = new Map<string, NodeMasteryRow[]>();
  private readonly nodeCatalogById = new Map<string, NodeCatalogEntry>();
  private readonly nodeQuestionIdsByNode = new Map<string, string[]>();
  private nodeMasteryCacheLoaded = false;
  private nodeMasteryCacheRefreshedAt = 0;
  private nodeMasteryRefreshPromise: Promise<void> | null = null;

  private async loadNodeMasteryReadCache() {
    if (!this.prisma || !process.env.DATABASE_URL) return;
    const db: DbClient = this.prisma;
    const [nodes, snapshots, directTags, fallbackLinks] = await Promise.all([
      loadActiveAtomicNodeCatalog(db),
      loadLatestFrequencySnapshots(db),
      db.questionKnowledgeNodeTag.findMany({
        select: { questionId: true, knowledgeNodeId: true },
      }),
      db.questionKnowledgePoint.findMany({
        select: {
          questionId: true,
          knowledgePoint: {
            select: {
              nodeMaps: {
                where: { mappingType: 'PRIMARY' },
                select: { knowledgeNodeId: true },
              },
            },
          },
        },
      }),
    ]);

    const snapshotByNode = new Map(snapshots.map((snapshot) => [snapshot.knowledgeNodeId, snapshot]));
    this.nodeCatalogById.clear();
    for (const node of nodes) {
      const snapshot = snapshotByNode.get(node.id);
      this.nodeCatalogById.set(node.id, {
        subject: subjectNameFromCode(node.subject),
        chapter: node.parent?.parent?.name ?? node.parent?.name ?? '',
        title: node.name,
        importance: node.importance,
        frequency: snapshot?.recent3Frequency ?? node.importance,
        difficulty: node.difficulty,
        recent3Frequency: snapshot?.recent3Frequency ?? node.importance,
        recent5Frequency: snapshot?.recent5Frequency ?? node.importance,
        allTimeEvidence: snapshot?.allTimeEvidence ?? node.importance,
        primaryScore5y: snapshot?.primaryScore5y ?? 0,
        trendDirection: snapshot?.trendDirection ?? 'STABLE',
        trendDelta: snapshot?.trendDelta ?? 0,
        evidenceConfidence: snapshot?.evidenceConfidence ?? 'MEDIUM',
      });
    }

    const nodeIdsByQuestion = new Map<string, string[]>();
    for (const tag of directTags) {
      const list = nodeIdsByQuestion.get(tag.questionId) ?? [];
      list.push(tag.knowledgeNodeId);
      nodeIdsByQuestion.set(tag.questionId, list);
    }
    const taggedQuestionIds = new Set(directTags.map((tag) => tag.questionId));
    for (const link of fallbackLinks) {
      if (taggedQuestionIds.has(link.questionId)) continue;
      const nodeId = link.knowledgePoint.nodeMaps[0]?.knowledgeNodeId;
      if (!nodeId) continue;
      const list = nodeIdsByQuestion.get(link.questionId) ?? [];
      list.push(nodeId);
      nodeIdsByQuestion.set(link.questionId, list);
    }
    const questionIdsByNode = new Map<string, string[]>();
    for (const [questionId, nodeIds] of nodeIdsByQuestion) {
      for (const nodeId of nodeIds) {
        const list = questionIdsByNode.get(nodeId) ?? [];
        list.push(questionId);
        questionIdsByNode.set(nodeId, list);
      }
    }
    this.nodeQuestionIdsByNode.clear();
    for (const [nodeId, questionIds] of questionIdsByNode) {
      this.nodeQuestionIdsByNode.set(nodeId, questionIds);
    }

    await this.reloadNodeMasteries();
    this.nodeMasteryCacheLoaded = true;
    this.nodeMasteryCacheRefreshedAt = Date.now();
  }

  private async reloadNodeMasteries() {
    if (!this.prisma || !process.env.DATABASE_URL) return;
    const masteries = await this.prisma.userKnowledgeMastery.findMany();
    const rowsByUser = new Map<string, NodeMasteryRow[]>();
    for (const mastery of masteries) {
      const node = this.nodeCatalogById.get(mastery.knowledgeNodeId);
      if (!node) continue;
      const rows = rowsByUser.get(mastery.userId) ?? [];
      rows.push(this.toNodeMasteryRow(mastery, node));
      rowsByUser.set(mastery.userId, rows);
    }
    this.nodeMasteryByUser.clear();
    for (const [userId, rows] of rowsByUser) this.nodeMasteryByUser.set(userId, rows);
  }

  private ensureNodeMasteryFresh() {
    if (!this.prisma || !process.env.DATABASE_URL || !this.nodeMasteryCacheLoaded) return;
    if (Date.now() - this.nodeMasteryCacheRefreshedAt < 60_000) return;
    if (this.nodeMasteryRefreshPromise) return;
    this.nodeMasteryRefreshPromise = this.reloadNodeMasteries()
      .catch((error) => {
        this.logger.error(
          'Node mastery cache refresh failed',
          error instanceof Error ? error.stack : String(error),
        );
      })
      .finally(() => {
        this.nodeMasteryRefreshPromise = null;
        this.nodeMasteryCacheRefreshedAt = Date.now();
      });
  }

  private async refreshNodeMasteryCache(userId: string) {
    if (!this.prisma || !process.env.DATABASE_URL || !this.nodeMasteryCacheLoaded) return;
    const rows = (await this.prisma.userKnowledgeMastery.findMany({ where: { userId } }))
      .map((mastery) => {
        const node = this.nodeCatalogById.get(mastery.knowledgeNodeId);
        return node ? this.toNodeMasteryRow(mastery, node) : null;
      })
      .filter((row): row is NodeMasteryRow => row !== null);
    this.nodeMasteryByUser.set(userId, rows);
  }

  private toNodeMasteryRow(
    mastery: {
      knowledgeNodeId: string;
      mastery: number;
      attempts: number;
      correctCount: number;
      wrongCount: number;
    },
    node: NodeCatalogEntry,
  ): NodeMasteryRow {
    return {
      knowledgeNodeId: mastery.knowledgeNodeId,
      subject: node.subject,
      chapter: node.chapter,
      title: node.title,
      importance: node.importance,
      frequency: node.frequency,
      mastery: mastery.mastery,
      attempts: mastery.attempts,
      correctCount: mastery.correctCount,
      wrongCount: mastery.wrongCount,
      status: deriveNodeMasteryStatus({ mastery: mastery.mastery, attempts: mastery.attempts }),
    };
  }

  private readonly completedTaskDatesByUser = new Map<string, Map<string, string>>();

  private readonly taskCompletionMetricsByUser = new Map<string, Map<string, TaskCompletionMetric>>();

  private readonly wrongQuestionReviewDatesByUser = new Map<string, Map<string, string>>();

  private readonly trialStatusByUserId = new Map<string, TrialStatus>([
    ['u-001', 'active'],
    ['teacher-001', 'active'],
    ['admin-001', 'active'],
  ]);

  private readonly aiReviewItems: ReviewItem[] = [];

  private readonly papers: GeneratedPaper[] = [];

  private readonly assessmentHistoryItems: AssessmentHistoryItem[] = [
    {
      id: 'assessment-history-seed-001',
      paperId: 'seed-paper-001',
      userId: 'u-001',
      title: '408 基础诊断卷',
      submittedAt: '2026-06-25T09:30:00.000Z',
      score: 62,
      totalScore: 100,
      accuracyRate: 62,
      elapsedSec: 42 * 60,
      unansweredCount: 1,
      weakPointTitle: 'Cache 映射与替换',
      reviewSuggestion: '先复盘 Cache 映射与替换错题，再补 1 组同考点基础题。',
    },
  ];

  private readonly stageAssessmentResults: Array<Record<string, unknown>> = [];

  private readonly practiceSetResults: Array<Record<string, unknown>> = [];

  private readonly feedbackItems: FeedbackItem[] = [];

  private systemConfig = {
    source: 'memory-api' as const,
    recommendation: {
      stageAssessmentQuestionLimit: 6,
      dailyTargetQuestionCount: 30,
      speedRiskMultiplier: 1.4,
    },
    updatedBy: 'system',
    updatedAt: new Date().toISOString(),
  };

  listKnowledgePoints() {
    return this.knowledgePoints;
  }

  async createKnowledgePoint(input: Partial<KnowledgePoint>) {
    const id = input.id?.trim();
    const subject = parseSubject(input.subject);
    const chapter = input.chapter?.trim();
    const title = input.title?.trim();

    if (!id || !subject || !chapter || !title) {
      throw new BadRequestException('Knowledge point id, subject, chapter and title are required');
    }

    if (this.knowledgePoints.some((point) => point.id === id)) {
      throw new BadRequestException(`Knowledge point ${id} already exists`);
    }

    const point: KnowledgePoint = {
      id,
      subject,
      chapter,
      title,
      importance: clampNumber(input.importance ?? 3, 1, 5),
      frequency: clampNumber(input.frequency ?? 3, 1, 5),
      prerequisites: input.prerequisites ?? [],
    };

    try {
      await this.knowledgePointRepository.save(point);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new BadRequestException(`Knowledge point ${id} already exists`);
      }
      throw error;
    }
    this.knowledgePoints.push(point);
    this.questionsService.registerKnowledgePoint(point);
    return point;
  }

  private applyCatalogDisplay(report: WeaknessReport): WeaknessReport {
    const mapPoint = (point: WeakPoint) => {
      const display = resolveKnowledgePointDisplay(
        { id: point.knowledgePointId, title: point.title, chapter: point.chapter },
        this.knowledgePointDisplay,
      );
      return { ...point, title: display.title, chapter: display.chapter };
    };
    return {
      ...report,
      weakPoints: report.weakPoints.map(mapPoint),
      speedRisks: report.speedRisks.map(mapPoint),
    };
  }

  getOverviewReport(userId?: string) {
    const uid = userId ?? this.student.id;
    const student = this.getStudent(uid);
    this.ensureNodeMasteryFresh();
    const report = this.applyCatalogDisplay(computeWeaknessReport({
      knowledgePoints: this.knowledgePoints,
      records: this.records.filter((r) => r.userId === uid),
      targetScore: student.targetScore ?? 115,
    }));
    if (this.masterySummaryProjection) {
      const projection = this.masterySummaryProjection.getProjectionFromRows(
        uid,
        this.nodeMasteryByUser.get(uid) ?? [],
      );
      return toReportMasteryDto(projection, report);
    }
    if (this.useNodeMastery) {
      return {
        ...report,
        weakPoints: deriveNodeWeakPoints(this.nodeMasteryByUser.get(uid) ?? []),
      };
    }
    return report;
  }

  getDashboardOverview(userId?: string) {
    const uid = userId ?? this.student.id;
    return {
      source: this.dataSource,
      student: this.getStudent(uid),
      knowledgePoints: this.knowledgePoints,
      questions: toStudentQuestions(this.questions),
      practiceRecords: this.records.filter((r) => r.userId === uid),
      wrongQuestions: this.listWrongQuestions(uid),
      learningCalendar: this.getLearningCalendar(uid),
      stageAssessment: this.getStageAssessment(uid),
      report: this.getOverviewReport(uid),
      plan: this.generatePlan(uid),
    };
  }

  async getTrialProgress(userId = this.student.id) {
    const completedTasks = this.completedTaskDatesByUser.get(userId) ?? new Map<string, string>();
    const reviewedWrongQuestions = this.wrongQuestionReviewDatesByUser.get(userId) ?? new Map<string, string>();
    const userPracticeSetResults = this.practiceSetResults.filter((item) => item.userId === userId);
    const hasFeedback = await this.feedbackRepository.hasForUser(userId);
    const items = [
      {
        id: 'diagnostic',
        title: '提交入学诊断',
        description: '生成目标分、当前阶段和第一版学习计划。',
        completed: this.diagnosticProfilesByUser.has(userId),
        actionAnchor: '#dashboard',
      },
      {
        id: 'daily-task',
        title: '完成一个今日任务',
        description: '体验每日计划如何记录完成度和下一步建议。',
        completed: completedTasks.size > 0,
        actionAnchor: '#plan',
      },
      {
        id: 'practice-set',
        title: '提交推荐题组',
        description: '体验系统按薄弱点生成题组并同步报告。',
        completed: userPracticeSetResults.length > 0,
        actionAnchor: '#question',
      },
      {
        id: 'wrong-review',
        title: '标记一次错题复盘',
        description: '体验错题状态、相似题和复盘建议。',
        completed: reviewedWrongQuestions.size > 0,
        actionAnchor: '#wrong-book',
      },
      {
        id: 'feedback',
        title: '提交体验反馈',
        description: '提交站内反馈或打开问卷补充建议。',
        completed: hasFeedback,
        actionAnchor: '#feedback',
      },
    ];
    const completedCount = items.filter((item) => item.completed).length;

    return {
      userId,
      title: '15 分钟体验任务',
      completedCount,
      totalCount: items.length,
      completionRate: Math.round((completedCount / items.length) * 100),
      items,
      nextAction: items.find((item) => !item.completed)?.title ?? '已完成全部体验任务，可以邀请同学填写问卷。',
    };
  }

  async getStudyReminders(userId = this.student.id) {
    const report = this.getOverviewReport(userId);
    const plan = this.generatePlan(userId);
    const wrongQuestions = this.listWrongQuestions(userId);
    const trialProgress = await this.getTrialProgress(userId);
    const calendar = this.getLearningCalendar(userId);
    const reminders: StudyReminder[] = [];
    const topWeakPoint = report.weakPoints[0];
    const pendingWrongQuestion = wrongQuestions.find((item) => item.reviewStatus === 'pending') ?? wrongQuestions[0];
    const nextTask = plan.dailyTasks.find((task) => !task.completed) ?? plan.dailyTasks[0];

    if (topWeakPoint) {
      reminders.push({
        id: `weakness-${topWeakPoint.knowledgePointId}`,
        type: 'weakness',
        priority: 'high',
        title: `优先补强 ${topWeakPoint.title}`,
        reason: `当前正确率 ${topWeakPoint.accuracyRate}%，提分空间较大。`,
        actionText: '去练推荐题组',
        actionAnchor: '#question',
      });
    }

    if (pendingWrongQuestion) {
      reminders.push({
        id: `wrong-${pendingWrongQuestion.questionId}`,
        type: 'wrong-question',
        priority: pendingWrongQuestion.reviewStatus === 'pending' ? 'high' : 'medium',
        title: pendingWrongQuestion.reviewStatus === 'pending' ? '先复盘一道错题' : '重新检查已复盘错题',
        reason: `${pendingWrongQuestion.knowledgePointTitle} 已累计 ${pendingWrongQuestion.wrongCount} 次错误记录。`,
        actionText: pendingWrongQuestion.reviewStatus === 'pending' ? '去复盘' : '去错题本',
        actionAnchor: '#wrong-book',
      });
    }

    if (nextTask) {
      reminders.push({
        id: `task-${nextTask.id}`,
        type: 'daily-task',
        priority: nextTask.completed ? 'low' : 'medium',
        title: nextTask.completed ? '今日任务已有进度' : `完成今日任务：${nextTask.title}`,
        reason: nextTask.reason ?? '根据当前阶段和薄弱点推荐。',
        actionText: '去看计划',
        actionAnchor: '#plan',
      });
    }

    if (calendar.streakDays === 0 || calendar.today.practiceCount === 0) {
      reminders.push({
        id: 'calendar-activity',
        type: 'habit',
        priority: 'medium',
        title: '今天还需要一次有效练习',
        reason: '学习日历会记录任务和练习，帮助你保持复习节奏。',
        actionText: '去刷题',
        actionAnchor: '#question',
      });
    }

    if (trialProgress.completedCount < trialProgress.totalCount) {
      reminders.push({
        id: 'trial-progress',
        type: 'trial',
        priority: 'medium',
        title: '完成剩余体验任务',
        reason: `还有 ${trialProgress.totalCount - trialProgress.completedCount} 个核心流程待体验，便于后续填问卷。`,
        actionText: '去体验',
        actionAnchor: '#trial',
      });
    } else {
      reminders.push({
        id: 'feedback-followup',
        type: 'feedback',
        priority: 'low',
        title: '试用完成后记得补充建议',
        reason: '你已走完核心流程，可以将真实备考需求写入问卷。',
        actionText: '去反馈',
        actionAnchor: '#feedback',
      });
    }

    const priorityOrder: Record<StudyReminder['priority'], number> = { high: 0, medium: 1, low: 2 };
    const items = reminders
      .sort((left, right) => priorityOrder[left.priority] - priorityOrder[right.priority])
      .slice(0, 5);

    return {
      userId,
      title: '今日提分提醒',
      generatedAt: new Date().toISOString(),
      items,
    };
  }

  getSprintPlan(userId = this.student.id) {
    const student = this.getStudent(userId);
    const report = this.getOverviewReport(userId);
    const plan = this.generatePlan(userId);
    const wrongQuestions = this.listWrongQuestions(userId);
    const calendar = this.getLearningCalendar(userId);
    const scoreGap = Math.max(0, (student.targetScore ?? 0) - (student.currentScore ?? 0));
    const weakPointTitles = (report.weakPoints.length ? report.weakPoints : report.speedRisks)
      .map((point) => point.title)
      .slice(0, 4);
    const fallbackFocus = plan.dailyTasks.map((task) => task.title).slice(0, 3);
    const focusPool = weakPointTitles.length ? weakPointTitles : fallbackFocus;
    const baseQuestionTarget = clampNumber(
      this.systemConfig.recommendation.dailyTargetQuestionCount,
      10,
      student.stage === '冲刺' ? 80 : 60,
    );
    const reviewBase = wrongQuestions.length > 0 ? Math.min(6, wrongQuestions.length + 1) : 1;
    const dates = nextNDates(7);

    const days = dates.map((date, index) => {
      const focus = focusPool[index % Math.max(1, focusPool.length)] ?? '408 高频基础考点';
      const isReviewDay = index % 3 === 2;
      const isAssessmentDay = index === 6;
      const questionTarget = Math.max(8, baseQuestionTarget - (isReviewDay ? 8 : 0) + (isAssessmentDay ? 10 : 0));
      const reviewTarget = isAssessmentDay ? reviewBase + 2 : isReviewDay ? reviewBase + 1 : reviewBase;

      return {
        dayIndex: index + 1,
        date,
        focus: isAssessmentDay ? '阶段小测与错题回看' : focus,
        minutes: Math.max(45, Math.round((student.dailyHours ?? 3) * 60)),
        questionTarget,
        reviewTarget,
        reason: isAssessmentDay
          ? '第 7 天用小测校验本周补弱效果，并回看仍未稳定的错题。'
          : isReviewDay
            ? '每 3 天安排一次错题回看，避免只刷题不消化。'
            : `围绕 ${focus} 做短周期补强，和当前薄弱点保持一致。`,
      };
    });

    const risks = [
      ...((student.remainingDays ?? 0) < 60 ? ['剩余时间偏紧，需要优先保证高频考点和真题回看。'] : []),
      ...(wrongQuestions.length > 0 ? [`错题本仍有 ${wrongQuestions.length} 道待处理，建议每天至少复盘 ${reviewBase} 道。`] : []),
      ...(report.accuracyRate < 60 ? [`当前正确率 ${report.accuracyRate}%，本周先稳住基础题正确率。`] : []),
      ...(calendar.today.practiceCount === 0 ? ['今天还没有练习记录，建议先完成一组短题。'] : []),
    ];

    return {
      userId,
      title: '7 天冲刺计划',
      currentStage: student.stage,
      scoreGap,
      targetScore: student.targetScore,
      currentScore: student.currentScore,
      remainingDays: student.remainingDays,
      weeklyQuestionTarget: days.reduce((sum, day) => sum + day.questionTarget, 0),
      weeklyReviewTarget: days.reduce((sum, day) => sum + day.reviewTarget, 0),
      risks: risks.length ? risks : ['当前节奏稳定，本周重点保持练习连续性和错题复盘质量。'],
      days,
      generatedAt: new Date().toISOString(),
    };
  }

  getMasteryMap(userId = this.student.id) {
    this.ensureNodeMasteryFresh();
    if (this.useNodeMastery) {
      const canonical = buildNodeMasteryMap({
        userId,
        rows: this.nodeMasteryByUser.get(userId) ?? [],
        subjects: ['数据结构', '计算机组成原理', '操作系统', '计算机网络'],
        generatedAt: new Date().toISOString(),
      });
      return toLegacyMasteryMap(canonical);
    }
    const subjects: Subject[] = ['数据结构', '计算机组成原理', '操作系统', '计算机网络'];
    const wrongQuestions = this.listWrongQuestions(userId);
    const wrongByPoint = new Map<string, number>();
    for (const item of wrongQuestions) {
      wrongByPoint.set(item.knowledgePointId, (wrongByPoint.get(item.knowledgePointId) ?? 0) + item.wrongCount);
    }

    const extrasByPoint = new Map<string, MasteryPointExtras>();
    for (const point of this.knowledgePoints) {
      const taskIds = new Set(this.sevenDayPlansByUser.get(userId)?.tasks
        .filter((task) => task.knowledgePointId === point.id)
        .map((task) => task.id) ?? []);
      const taskMetrics = [...(this.taskCompletionMetricsByUser.get(userId)?.entries() ?? [])]
        .filter(([taskId]) => taskIds.has(taskId))
        .map(([, metric]) => metric);
      const taskQuestionCount = taskMetrics.reduce((sum, metric) => sum + metric.completedQuestionCount, 0);
      const taskCorrectCount = taskMetrics.reduce((sum, metric) => sum + metric.correctCount, 0);
      extrasByPoint.set(point.id, {
        practiceCount: taskQuestionCount,
        correctCount: taskCorrectCount,
        wrongCount: Math.max(0, taskQuestionCount - taskCorrectCount) + (wrongByPoint.get(point.id) ?? 0),
      });
    }

    const model = computeMasteryReport({
      knowledgePoints: this.knowledgePoints,
      records: this.records.filter((record) => record.userId === userId),
      targetScore: this.getStudent(userId).targetScore ?? 115,
      extrasByPoint,
    });

    const subjectMaps = subjects.map((subject) => {
      const points = model.points
        .filter((point) => point.subject === subject)
        .map((point) => {
          const display = resolveKnowledgePointDisplay(
            { id: point.knowledgePointId, title: point.title, chapter: point.chapter },
            this.knowledgePointDisplay,
          );
          return {
          knowledgePointId: point.knowledgePointId,
          title: display.title,
          chapter: display.chapter,
          importance: point.importance,
          frequency: point.frequency,
          masteryRate: point.masteryRate,
          accuracyRate: point.accuracyRate,
          practiceCount: point.attempts,
          wrongCount: point.wrongCount,
          status: point.status,
          nextAction: point.nextAction,
          actionAnchor: point.status === 'weak' ? '#wrong-book' : '#question',
          };
        });
      const averageMastery = points.length
        ? Math.round(points.reduce((sum, point) => sum + point.masteryRate, 0) / points.length)
        : 0;

      return {
        subject,
        averageMastery,
        weakCount: points.filter((point) => point.status === 'weak').length,
        reviewCount: points.filter((point) => point.status === 'review').length,
        masteredCount: points.filter((point) => point.status === 'mastered').length,
        points,
      };
    });

    return {
      userId,
      title: '408 掌握度地图',
      generatedAt: new Date().toISOString(),
      subjects: subjectMaps,
      weakestPoints: subjectMaps
        .flatMap((subject) => subject.points.map((point) => ({ ...point, subject: subject.subject })))
        .sort((left, right) => left.masteryRate - right.masteryRate)
        .slice(0, 3),
    };
  }

  getStudentLearningProfile(userId = this.student.id) {
    const student = this.getStudent(userId);
    const report = this.getOverviewReport(userId);
    const calendar = this.getLearningCalendar(userId);
    const reviewedWrongQuestions = this.wrongQuestionReviewDatesByUser.get(userId) ?? new Map<string, string>();
    const userPracticeSetResults = this.practiceSetResults.filter((item) => item.userId === userId);
    const userStageResults = this.stageAssessmentResults.filter((item) => item.userId === userId);
    const timeline = [
      ...(this.diagnosticProfilesByUser.get(userId) ? [{
        id: 'timeline-diagnostic',
        type: 'diagnostic',
        title: '入学诊断完成',
        date: todayKey(),
        summary: this.diagnosticProfilesByUser.get(userId)!.diagnosis,
      }] : []),
      ...userPracticeSetResults.map((item) => ({
        id: `timeline-${item.id}`,
        type: 'practice_set',
        title: '推荐题组练习',
        date: studyDateKey(String(item.submittedAt)),
        summary: `完成 ${item.totalQuestions} 题，正确率 ${item.accuracyRate}%。`,
      })),
      ...userStageResults.map((item) => ({
        id: `timeline-${item.id}`,
        type: 'stage_assessment',
        title: '阶段测评',
        date: studyDateKey(String(item.submittedAt)),
        summary: `得分 ${item.score}，计划调整为 ${(item.adjustment as { planPhase?: string })?.planPhase ?? this.generatePlan(userId).phase}。`,
      })),
      ...[...reviewedWrongQuestions.entries()].map(([questionId, reviewedAt]) => ({
        id: `timeline-review-${questionId}`,
        type: 'wrong_review',
        title: '错题复盘',
        date: studyDateKey(reviewedAt),
        summary: `已复盘错题 ${questionId}，并获得同考点练习建议。`,
      })),
    ].sort((left, right) => right.date.localeCompare(left.date));

    return {
      userId,
      summary: {
        name: student.name,
        currentStage: student.stage,
        targetScore: student.targetScore,
        currentScore: student.currentScore,
        weakestSubject: student.weakestSubject,
        accuracyRate: report.accuracyRate,
        streakDays: calendar.streakDays,
      },
      loopStats: {
        diagnosticCompleted: this.diagnosticProfilesByUser.has(userId),
        practiceSetCount: userPracticeSetResults.length,
        stageAssessmentCount: userStageResults.length,
        reviewedWrongQuestionCount: reviewedWrongQuestions.size,
        wrongQuestionCount: this.listWrongQuestions(userId).length,
      },
      timeline,
      nextMilestone: report.weakPoints[0]
        ? `继续处理 ${report.weakPoints[0].title}，完成一组推荐题并复盘错因。`
        : '保持当前节奏，进入限时真题训练。',
      insights: {
        learningState:
          !this.diagnosticProfilesByUser.has(userId) || report.weakPoints.length >= 3 || this.listWrongQuestions(userId).length >= 3
            ? 'risky'
            : report.accuracyRate >= 75 && calendar.streakDays >= 3 && reviewedWrongQuestions.size > 0
              ? 'rising'
              : 'stable',
        stateReason: !this.diagnosticProfilesByUser.has(userId)
          ? '尚未完成完整诊断，建议先补齐入学诊断和首轮练习。'
          : report.weakPoints.length >= 3 || this.listWrongQuestions(userId).length >= 3
            ? `当前仍有 ${Math.max(this.listWrongQuestions(userId).length, report.weakPoints.length)} 个薄弱信号，优先处理高频错点。`
            : report.speedRisks.length > 0
              ? '正确率尚可，但部分知识点仍存在速度风险，需要加入限时训练。'
              : report.accuracyRate >= 75 && calendar.streakDays >= 3
                ? '当前学习节奏稳定，适合进入强化巩固和真题提升。'
                : reviewedWrongQuestions.size > 0
                  ? '已开始形成复盘闭环，继续保持错题回收和变式练习。'
                  : '当前学习状态平稳，建议继续按计划完成训练与复盘。',
        weakPoints: report.weakPoints.slice(0, 5).map((point) => ({
          knowledgePointId: point.knowledgePointId,
          subject: point.subject,
          chapter: point.chapter,
          title: point.title,
          wrongCount: point.wrongCount,
          accuracyRate: point.accuracyRate,
          weaknessScore: point.weaknessScore,
          topReason: point.topReason,
          suggestion: point.suggestion,
        })),
        speedRisks: report.speedRisks.slice(0, 5).map((point) => ({
          knowledgePointId: point.knowledgePointId,
          subject: point.subject,
          chapter: point.chapter,
          title: point.title,
          wrongCount: point.wrongCount,
          accuracyRate: point.accuracyRate,
          weaknessScore: point.weaknessScore,
          topReason: point.topReason,
          suggestion: point.suggestion,
        })),
        mistakeReasons: Object.entries(report.mistakeReasons)
          .filter(([, count]) => count > 0)
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
          .map(([reason, count]) => ({ reason, count })),
        focusHints: [
          ...report.weakPoints.slice(0, 3).map((point) => `优先补强：${point.title}`),
          ...report.speedRisks.slice(0, 2).map((point) => `限时训练：${point.title}`),
          ...(Object.entries(report.mistakeReasons).sort((left, right) => right[1] - left[1])[0] ? [`主要错因：${Object.entries(report.mistakeReasons).sort((left, right) => right[1] - left[1])[0][0]}`] : []),
          ...(reviewedWrongQuestions.size > 0 ? ['保持错题复盘闭环'] : []),
        ].slice(0, 4),
      },
    };
  }

  async applyDiagnosticProfile(userId: string, input: {
    targetScore: number;
    currentScore: number;
    remainingDays: number;
    dailyHours: number;
    weakestSubject: Subject;
  }) {
    const profile = buildDiagnosticProfile(input);
    await this.learningProfileRepository.save(userId, profile);
    this.diagnosticProfilesByUser.set(userId, profile);
    return profile;
  }

  assertTeacherAuthorizedForStudent(teacherId: string, studentId: string) {
    if (!this.teacherStudentAuthorizations.has(teacherId, studentId)) {
      throw new ForbiddenException(`Student ${studentId} is not in your class`);
    }
  }

  listTeacherStudentAuthorizations(teacherId?: string) {
    return {
      source: this.dataSource,
      items: this.teacherStudentAuthorizations.list(teacherId),
      generatedAt: new Date().toISOString(),
    };
  }

  grantTeacherStudentAuthorization(teacherId?: string, studentId?: string) {
    return this.teacherStudentAuthorizations.grant(teacherId?.trim() ?? '', studentId?.trim() ?? '');
  }

  revokeTeacherStudentAuthorization(teacherId: string, studentId: string) {
    return this.teacherStudentAuthorizations.revoke(teacherId, studentId);
  }

  // ---- Phase 3: Onboarding & Today's Plan ----

  private readonly onboardingProfiles = new Map<string, OnboardingProfileState>();
  private readonly sevenDayPlansByUser = new Map<string, SevenDayPlanState>();
  private readonly planMutationTails = new Map<string, Promise<void>>();
  private readonly postponedTasks = new Map<string, { userId: string; postponeCount: number; nextAvailableAt: string }>();
  private readonly startedTasks = new Set<string>();
  private readonly taskProgressByUser = new Map<string, Map<string, TaskProgress>>();

  getOnboardingStatus(userId: string) {
    const profile = this.onboardingProfiles.get(userId);
    return {
      completed: Boolean(profile),
      profile: profile ?? null,
      nextStep: !profile
        ? 'complete_onboarding'
        : !this.diagnosticProfilesByUser.has(userId)
          ? 'submit_diagnostic'
          : 'start_training',
    };
  }

  async completeOnboarding(userId: string, input: {
    examYear?: number;
    targetScore: number;
    currentScore: number;
    remainingDays: number;
    dailyHours: number;
    weakestSubject: Subject;
  }) {
    return this.withPlanMutation(userId, () => this.completeOnboardingUnlocked(userId, input));
  }

  private async completeOnboardingUnlocked(userId: string, input: {
    examYear?: number;
    targetScore: number;
    currentScore: number;
    remainingDays: number;
    dailyHours: number;
    weakestSubject: Subject;
  }) {
    validateOnboardingInput(input);
    const profile = {
      examYear: input.examYear,
      targetScore: Number(input.targetScore),
      currentScore: Number(input.currentScore),
      remainingDays: Number(input.remainingDays),
      dailyHours: Number(input.dailyHours),
      weakestSubject: input.weakestSubject,
      completedAt: new Date().toISOString(),
    };
    const diagnostic = await this.applyDiagnosticProfile(userId, profile);
    const initialPlan = this.buildSevenDayPlan(userId);
    const persistedPlan = await this.onboardingPlanRepository.saveOnboarding(userId, profile, initialPlan);
    this.onboardingProfiles.set(userId, profile);
    this.sevenDayPlansByUser.set(userId, persistedPlan);

    return {
      ...profile,
      stage: diagnostic.stage,
      sevenDayPlan: this.getSevenDayPlanSummary(persistedPlan),
      todayPlan: await this.getTodayPlan(userId),
    };
  }

  async getTodayPlan(userId: string) {
    const today = todayKey();
    let scheduledPlan = this.sevenDayPlansByUser.get(userId);
    if (scheduledPlan) {
      const scheduledDates = scheduledPlan.tasks.map((task) => task.scheduledDate).sort();
      const lastScheduledDate = scheduledDates[scheduledDates.length - 1];
      const hasCurrentWindow = lastScheduledDate ? lastScheduledDate >= today : false;
      if (!hasCurrentWindow) {
        const profile = this.onboardingProfiles.get(userId);
        // V8 #13 missed-day recovery: open overdue tasks ride into the fresh
        // window instead of vanishing with the old plan.
        const carryOver = harvestCarryOverTasks(scheduledPlan.tasks, today);
        // V9 Phase 2: last week's evidence (if any) adjusts this week's load.
        let weeklyAdjustment;
        try {
          const outcomes = this.effectiveness ? await this.effectiveness.getOutcomes(userId, 7) : null;
          weeklyAdjustment = deriveWeeklyAdjustment({
            outcomes: (outcomes?.outcomes ?? []).map((view) => ({
              attemptsInWindow: view.attemptsInWindow,
              masteryGain: view.masteryGain,
              gatePassed: view.evidenceGate.passed,
            })),
            openDebt: carryOver.length,
          });
        } catch {
          weeklyAdjustment = undefined;
        }
        this.sevenDayPlansByUser.delete(userId);
        const freshPlan = this.buildSevenDayPlan(userId);
        if (freshPlan.tasks.length > 0) {
          let augmented = applyCarryOver(applyWeeklyIntensity(freshPlan, weeklyAdjustment ?? { factor: 1, verdict: 'maintain' }), carryOver, today);
          if (weeklyAdjustment) augmented = { ...augmented, weeklyAdjustment };
          scheduledPlan = profile
            ? await this.onboardingPlanRepository.saveOnboarding(userId, profile, augmented)
            : augmented;
          this.sevenDayPlansByUser.set(userId, scheduledPlan);
        } else {
          this.sevenDayPlansByUser.set(userId, scheduledPlan);
        }
      }
    }
    const plan = this.generatePlan(userId);
    const report = this.getOverviewReport(userId);
    const calendar = this.getLearningCalendar(userId);
    const wrongQuestions = this.listWrongQuestions(userId);
    const scoreCenter = (await this.scoreCenterService?.getTodayScoreCenterPlan(userId)) ?? null;
    const persistedTaskProgress = this.learningProgressRepository.enabled
      ? await this.learningProgressRepository.loadStudyTaskProgress(userId)
      : undefined;

    if (scheduledPlan) {
      const dayTasks = scheduledPlan.tasks.filter((task) => task.scheduledDate === today);
      const completedTasks = dayTasks.filter((task) => task.status === 'completed').length;
      // V8 #58: classic tasks carry no structured codes — derive them from the
      // weakness report and exam proximity at read time. Score-center tasks
      // keep their engine-populated codes untouched.
      const reasonContext = {
        weakPoints: report.weakPoints.map((point) => ({
          knowledgePointId: point.knowledgePointId,
          accuracyRate: point.accuracyRate,
          wrongCount: point.wrongCount,
        })),
        remainingDays: this.getStudent(userId).remainingDays ?? null,
      };
      const priorityTasks = dayTasks.map((task) => ({
        ...task,
        completed: task.status === 'completed',
        progress: this.getTaskProgressView(userId, task, persistedTaskProgress),
        questionIds: this.nodeQuestionIdsByNode.get(task.knowledgePointId) ?? undefined,
        reasonCodes: task.reasonCodes ?? deriveTaskReasonCodes(task, reasonContext),
      }));

      return {
        userId,
        phase: scheduledPlan.phase,
        generatedAt: new Date().toISOString(),
        summary: {
          completedTasks,
          totalTasks: dayTasks.length,
          completionRate: dayTasks.length ? Math.round((completedTasks / dayTasks.length) * 100) : 0,
          todayAccuracyRate: report.accuracyRate,
          streakDays: calendar.streakDays,
        },
        priorityTasks,
        weekProgress: this.getSevenDayPlanSummary(scheduledPlan).days,
        reviewDue: this.getDueReviews(userId).dueCount,
        checkpoint: scheduledPlan.checkpoint,
        recoveredFromGap: scheduledPlan.recoveredFromGap ?? null,
        weeklyAdjustment: scheduledPlan.weeklyAdjustment ?? null,
        scoreCenter,
      };
    }

    // Filter out postponed tasks
    const availableTasks = plan.dailyTasks.filter((task) => {
      const key = `${userId}@${task.id}`;
      const postponed = this.postponedTasks.get(key);
      if (!postponed) return true;
      return new Date(postponed.nextAvailableAt) <= new Date();
    });

    return {
      userId,
      phase: plan.phase,
      generatedAt: new Date().toISOString(),
      summary: {
        completedTasks: plan.completedTaskCount ?? 0,
        totalTasks: plan.totalTaskCount ?? availableTasks.length,
        completionRate: plan.completionRate ?? 0,
        todayAccuracyRate: report.accuracyRate,
        streakDays: calendar.streakDays,
      },
      priorityTasks: availableTasks.slice(0, 3).map((task) => ({
        ...task,
        progress: this.getTaskProgressView(userId, {
          id: task.id,
          questionCount: task.questionCount,
          minutes: task.minutes,
          completed: task.completed,
        }, persistedTaskProgress),
        status: task.completed
          ? 'completed' as const
          : this.startedTasks.has(`${userId}@${task.id}`)
            ? 'in_progress' as const
            : 'pending' as const,
        postponeCount: 0,
        scheduledDate: today,
        priority: task.priority as '高' | '中' | '低',
        reason: task.reason,
        nextAction: task.nextAction,
        questionIds: this.nodeQuestionIdsByNode.get(task.knowledgePointId) ?? undefined,
      })),
      reviewDue: this.getDueReviews(userId).dueCount,
      checkpoint: plan.checkpoint,
      weekProgress: [],
      scoreCenter,
    };
  }

  private getTaskProgressView(userId: string, task: {
    id: string;
    questionCount: number;
    minutes: number;
    status?: string;
    completed?: boolean;
  }, persistedTaskProgress?: ReadonlyMap<string, StudyTaskProgressMetric>): TaskProgress & { reachedTarget: boolean } {
    if (task.status === 'completed' || task.completed) {
      const metrics = this.taskCompletionMetricsByUser.get(userId)?.get(task.id);
      return {
        completedQuestionCount: metrics?.completedQuestionCount ?? task.questionCount,
        correctCount: metrics?.correctCount ?? task.questionCount,
        minutesSpent: metrics?.minutesSpent ?? task.minutes,
        reachedTarget: true,
      };
    }
    const persisted = persistedTaskProgress?.get(task.id);
    if (persisted) {
      return {
        ...persisted,
        reachedTarget: persisted.completedQuestionCount >= task.questionCount,
      };
    }
    if (this.learningProgressRepository.enabled) {
      return { completedQuestionCount: 0, correctCount: 0, minutesSpent: 0, reachedTarget: false };
    }
    const current = this.taskProgressByUser.get(userId)?.get(task.id);
    return current
      ? { ...current, reachedTarget: current.completedQuestionCount >= task.questionCount }
      : { completedQuestionCount: 0, correctCount: 0, minutesSpent: 0, reachedTarget: false };
  }

  private findTodayPracticeTask(userId: string, knowledgePointId: string): { id: string; questionCount: number } | null {
    const today = todayKey();
    const scheduled = this.sevenDayPlansByUser.get(userId)?.tasks.find((task) =>
      task.scheduledDate === today
      && task.knowledgePointId === knowledgePointId
      && task.status !== 'completed'
      && task.mode !== '考后复盘'
      && !task.id.startsWith('exam-review-'),
    );
    if (scheduled) return { id: scheduled.id, questionCount: scheduled.questionCount };
    const fallback = this.generatePlan(userId).dailyTasks.find((task) =>
      task.knowledgePointId === knowledgePointId && !task.completed,
    );
    return fallback ? { id: fallback.id, questionCount: fallback.questionCount } : null;
  }

  // P1-02: 练习记录按知识点自动累计到今日任务；达到计划题数即自动完成（补录表单降级为差额补登）。
  private async applyPracticeProgressToTasks(userId: string, record: PracticeRecord) {
    const task = this.findTodayPracticeTask(userId, record.knowledgePointId);
    if (!task) return;
    if (this.learningProgressRepository.enabled) {
      // PracticeRecord does not carry taskId yet, so attribution still uses today's
      // task + knowledgePointId + task state. Precise taskId attribution is deferred.
      const progress = await this.learningProgressRepository.incrementStudyTaskProgress({
        userId,
        taskId: task.id,
        completedQuestionIncrement: 1,
        correctIncrement: record.correct ? 1 : 0,
        minutesIncrement: Math.max(1, Math.round(record.timeSpentSec / 60)),
      });
      if (progress.completedQuestionCount >= task.questionCount) {
        try {
          await this.completeStudyTask(task.id, {
            userId,
            completedQuestionCount: progress.completedQuestionCount,
            correctCount: progress.correctCount,
            minutesSpent: progress.minutesSpent,
            selfRating: 3,
          });
        } catch (error) {
          this.logger.warn(
            `Auto-complete task ${task.id} failed after practice`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      return;
    }
    const byUser = this.taskProgressByUser.get(userId) ?? new Map<string, TaskProgress>();
    const current = byUser.get(task.id) ?? { completedQuestionCount: 0, correctCount: 0, minutesSpent: 0 };
    const next = accumulateTaskProgress({
      current,
      correct: record.correct,
      timeSpentSec: record.timeSpentSec,
      questionTarget: task.questionCount,
    });
    byUser.set(task.id, next.progress);
    this.taskProgressByUser.set(userId, byUser);

    if (next.reachedTarget) {
      try {
        await this.completeStudyTask(task.id, {
          userId,
          completedQuestionCount: next.progress.completedQuestionCount,
          correctCount: next.progress.correctCount,
          minutesSpent: next.progress.minutesSpent,
          selfRating: 3,
        });
      } catch (error) {
        this.logger.warn(
          `Auto-complete task ${task.id} failed after practice`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  async startTask(userId: string, taskId: string) {
    return this.withPlanMutation(userId, () => this.startTaskUnlocked(userId, taskId));
  }

  private async startTaskUnlocked(userId: string, taskId: string) {
    const scheduled = this.findScheduledTask(userId, taskId);
    if (!scheduled) {
      const fallback = this.generatePlan(userId).dailyTasks.find((task) => task.id === taskId);
      if (!fallback) throw new BadRequestException(`Study task ${taskId} was not found`);
      this.startedTasks.add(`${userId}@${taskId}`);
      return { taskId, status: 'in_progress', startedAt: new Date().toISOString(), message: `已开始 ${fallback.title}。` };
    }
    if (scheduled.status === 'completed') throw new BadRequestException('Completed task cannot be started again');
    if (this.onboardingPlanRepository.enabled) {
      const persisted = await this.onboardingPlanRepository.startTask(
        userId,
        taskId,
        scheduled.startedAt ?? new Date().toISOString(),
      );
      if (!persisted) throw new BadRequestException(`Study task ${taskId} was not found`);
      Object.assign(scheduled, persisted);
      return { taskId, status: persisted.status, startedAt: persisted.startedAt, message: `已开始 ${persisted.title}。` };
    }
    scheduled.status = 'in_progress';
    scheduled.startedAt = scheduled.startedAt ?? new Date().toISOString();
    scheduled.nextAvailableAt = undefined;
    return { taskId, status: scheduled.status, startedAt: scheduled.startedAt, message: `已开始 ${scheduled.title}。` };
  }

  async postponeTask(userId: string, taskId: string) {
    return this.withPlanMutation(userId, () => this.postponeTaskUnlocked(userId, taskId));
  }

  private async postponeTaskUnlocked(userId: string, taskId: string) {
    const scheduled = this.findScheduledTask(userId, taskId);
    if (scheduled) {
      if (scheduled.status === 'completed') throw new BadRequestException('Completed task cannot be postponed');
      if (this.onboardingPlanRepository.enabled) {
        const persisted = await this.onboardingPlanRepository.postponeTask(userId, taskId);
        if (!persisted) throw new BadRequestException(`Study task ${taskId} was not found`);
        Object.assign(scheduled, persisted);
        return {
          taskId,
          postponeCount: persisted.postponeCount,
          nextAvailableAt: persisted.nextAvailableAt,
          rescheduledDate: persisted.scheduledDate,
          message: `任务已重新安排到 ${persisted.scheduledDate}，今日计划已自动重排。`,
        };
      }
      const plan = this.sevenDayPlansByUser.get(userId)!;
      const targetDate = nearestAvailableStudyDate(plan.tasks, scheduled.scheduledDate);
      scheduled.postponeCount += 1;
      scheduled.status = 'postponed';
      scheduled.scheduledDate = targetDate;
      scheduled.nextAvailableAt = `${targetDate}T00:00:00.000Z`;
      return {
        taskId,
        postponeCount: scheduled.postponeCount,
        nextAvailableAt: scheduled.nextAvailableAt,
        rescheduledDate: targetDate,
        message: `任务已重新安排到 ${targetDate}，今日计划已自动重排。`,
      };
    }

    const key = `${userId}@${taskId}`;
    const existing = this.postponedTasks.get(key);
    const postponeCount = (existing?.postponeCount ?? 0) + 1;

    // Exponential backoff: 1st = 2h, 2nd = 4h, 3rd+ = tomorrow
    const delayHours = postponeCount <= 1 ? 2 : postponeCount === 2 ? 4 : 24;
    const nextAvailableAt = new Date(Date.now() + delayHours * 60 * 60 * 1000).toISOString();

    this.postponedTasks.set(key, { userId, postponeCount, nextAvailableAt });

    return {
      taskId,
      postponeCount,
      nextAvailableAt,
      message: postponeCount >= 3
        ? '已多次延后，建议优先完成或标记为已完成。'
        : `任务已延后，${delayHours} 小时后重新出现在今日计划。`,
    };
  }

  async rescheduleTask(userId: string, taskId: string, scheduledDate: string) {
    return this.withPlanMutation(userId, () => this.rescheduleTaskUnlocked(userId, taskId, scheduledDate));
  }

  private async rescheduleTaskUnlocked(userId: string, taskId: string, scheduledDate: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
      throw new BadRequestException('scheduledDate must be in YYYY-MM-DD format');
    }
    const scheduled = this.findScheduledTask(userId, taskId);
    if (!scheduled) throw new BadRequestException(`Study task ${taskId} was not found`);
    if (scheduled.status === 'completed') throw new BadRequestException('Completed task cannot be rescheduled');
    if (this.onboardingPlanRepository.enabled) {
      const persisted = await this.onboardingPlanRepository.rescheduleTask(userId, taskId, scheduledDate);
      if (!persisted) throw new BadRequestException(`Study task ${taskId} was not found`);
      Object.assign(scheduled, persisted);
    } else {
      scheduled.scheduledDate = scheduledDate;
      scheduled.status = 'pending';
      scheduled.nextAvailableAt = undefined;
    }
    return { taskId, scheduledDate, message: `任务已重新安排到 ${scheduledDate}。` };
  }

  async rebalanceTasks(userId: string, mode: TaskRebalanceMode) {
    return this.withPlanMutation(userId, () => this.rebalanceTasksUnlocked(userId, mode));
  }

  private async rebalanceTasksUnlocked(userId: string, mode: TaskRebalanceMode) {
    const plan = this.sevenDayPlansByUser.get(userId);
    if (!plan) throw new BadRequestException('No scheduled plan is available for rebalancing');
    const today = todayKey();
    const horizon = new Date();
    horizon.setUTCDate(horizon.getUTCDate() + 7);
    const horizonKey = horizon.toISOString().slice(0, 10);
    const affected = plan.tasks.filter((task) =>
      task.scheduledDate >= today
      && task.scheduledDate <= horizonKey
      && task.status !== 'completed'
      && task.mode !== '考后复盘'
      && !task.id.startsWith('exam-review-'),
    );
    const adjustments = rebalanceTaskLoad({ tasks: affected, mode });
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowKey = tomorrow.toISOString().slice(0, 10);
    const repoAdjustments: TaskRebalanceAdjustment[] = adjustments.map((item) => ({
      ...item,
      ...(item.status === 'postponed'
        ? { scheduledDate: tomorrowKey, nextAvailableAt: new Date(`${tomorrowKey}T00:00:00.000Z`) }
        : {}),
    }));

    if (this.onboardingPlanRepository.enabled) {
      const persisted = await this.onboardingPlanRepository.rebalanceTasks(userId, repoAdjustments);
      if (!persisted) throw new BadRequestException('Rebalance failed: study plan was not found');
      for (const task of persisted) {
        const cached = this.findScheduledTask(userId, task.id);
        if (cached) Object.assign(cached, task);
      }
    } else {
      for (const item of repoAdjustments) {
        const task = plan.tasks.find((candidate) => candidate.id === item.id);
        if (!task) continue;
        if (item.questionCount != null) task.questionCount = item.questionCount;
        if (item.minutes != null) task.minutes = item.minutes;
        if (item.status === 'postponed') {
          task.status = 'postponed';
          task.postponeCount += 1;
          task.scheduledDate = item.scheduledDate ?? task.scheduledDate;
          task.nextAvailableAt = item.nextAvailableAt?.toISOString();
        }
      }
    }

    const postponedCount = repoAdjustments.filter((item) => item.status === 'postponed').length;
    return {
      userId,
      mode,
      adjustedTaskCount: repoAdjustments.length,
      postponedCount,
      message: mode === 'reduce'
        ? '已降低本周任务量（题量与时长约降 30%），优先保证完成质量。'
        : `已只保留高优先级任务，${postponedCount} 个非高优先级任务顺延到明日。`,
    };
  }

  async getAdminMetrics() {
    if (this.betaMetricsService.enabled) {
      return this.betaMetricsService.calculate(this.getReviewQueue().pendingCount);
    }
    return this.getMemoryAdminMetrics();
  }

  private getMemoryAdminMetrics() {
    const report = this.getOverviewReport();
    const calendar = this.getLearningCalendar(this.student.id);
    const wrongQuestions = this.listWrongQuestions(this.student.id);
    const completedTaskCount = this.generatePlan().completedTaskCount ?? 0;
    const activeDates = new Set(this.records.map((record) => studyDateKey(record.submittedAt)));

    return {
      source: this.dataSource,
      activeStudentCount: 1,
      questionCount: this.questions.length,
      knowledgePointCount: this.knowledgePoints.length,
      practiceRecordCount: this.records.length,
      todayPracticeCount: calendar.today.practiceCount,
      todayCompletedTaskCount: calendar.today.completedTaskCount,
      completedTaskCount,
      accuracyRate: report.accuracyRate,
      weakPointCount: report.weakPoints.length,
      pendingWrongQuestionCount: wrongQuestions.length,
      pendingReviewCount: this.getReviewQueue().pendingCount,
      averagePracticeTimeSec: this.records.length
        ? Math.round(this.records.reduce((sum, record) => sum + record.timeSpentSec, 0) / this.records.length)
        : 0,
      retentionDays: activeDates.size,
      topWeakPoint: report.weakPoints[0]?.title ?? null,
      core: emptyCoreMetrics(),
      generatedAt: new Date().toISOString(),
    };
  }

  async getAdminUsers() {
    const users = this.adminUsers.enabled
      ? (await this.adminUsers.list()).map((user) => this.toAdminManagedUser(user))
      : await this.buildAdminUsers();
    const studentCount = users.filter((user) => user.role === 'student').length;
    const activeTrialCount = users.filter((user) => user.trialStatus === 'active').length;
    const followUpCount = users.filter((user) => user.trialStatus === 'follow_up').length;

    return {
      source: this.dataSource,
      generatedAt: new Date().toISOString(),
      summary: {
        totalUsers: users.length,
        studentCount,
        activeTrialCount,
        followUpCount,
      },
      users,
    };
  }

  async updateAdminUserTrialStatus(userId: string, trialStatus: string | undefined) {
    if (!isTrialStatus(trialStatus)) {
      throw new BadRequestException('Trial status must be invited, active, completed or follow_up');
    }

    if (this.adminUsers.enabled) {
      const updated = await this.adminUsers.updateTrialStatus(userId, trialStatus);
      return updated ? this.toAdminManagedUser(updated) : null;
    }

    const users = await this.buildAdminUsers();
    if (!users.some((user) => user.id === userId)) {
      throw new BadRequestException(`User ${userId} was not found`);
    }

    this.trialStatusByUserId.set(userId, trialStatus);
    return (await this.buildAdminUsers()).find((user) => user.id === userId);
  }

  getTeacherClassAnalytics(teacherId?: string) {
    const authorizedIds = teacherId
      ? this.teacherStudentAuthorizations.studentIds(teacherId)
      : [...new Set(this.teacherStudentAuthorizations.list().map((item) => item.studentId))];
    // A teacher without authorized students gets an empty class view instead of
    // an error, so the workspace does not surface a normal state as a failure.
    // The demo-student fallback is reserved for the admin's global overview.
    const studentIds = teacherId ? authorizedIds : (authorizedIds.length ? authorizedIds : [this.student.id]);
    const students = studentIds.map((userId) => {
      const report = this.getOverviewReport(userId);
      const plan = this.generatePlan(userId);
      const wrongQuestions = this.listWrongQuestions(userId);
      const masteryMap = this.getMasteryMap(userId);
      const latestAssessment = this.getAssessmentHistory(userId).items[0];
      return {
        user: this.getStudent(userId),
        report,
        plan,
        wrongQuestions,
        masteryMap,
        latestAssessment,
        active: this.getLearningCalendar(userId).today.isActive,
      };
    });

    const subjectWeakness = this.knowledgePoints
      .map((point) => point.subject)
      .filter((subject, index, all) => all.indexOf(subject) === index)
      .map((subject) => {
        const entries = students.map((student) => student.masteryMap.subjects.find((item) => item.subject === subject));
        const weakPointCount = entries.reduce((sum, item) => sum + (item?.weakCount ?? 0), 0);
        return {
          subject,
          weakPointCount,
          averageMastery: average(entries.map((item) => item?.averageMastery ?? 0)),
          recommendation: weakPointCount > 0
            ? `安排 ${subject} 薄弱点讲解，并配 1 组同考点训练。`
            : `${subject} 当前以保持训练和真题巩固为主。`,
        };
      });

    const weakPointStats = new Map<string, { title: string; accuracyRates: number[]; wrongCount: number }>();
    for (const student of students) {
      const points = student.report.weakPoints.length ? student.report.weakPoints : student.masteryMap.weakestPoints;
      for (const point of points) {
        const current = weakPointStats.get(point.knowledgePointId) ?? { title: point.title, accuracyRates: [], wrongCount: 0 };
        current.accuracyRates.push('accuracyRate' in point ? point.accuracyRate : 0);
        current.wrongCount += student.wrongQuestions
          .filter((item) => item.knowledgePointId === point.knowledgePointId)
          .reduce((sum, item) => sum + item.wrongCount, 0);
        weakPointStats.set(point.knowledgePointId, current);
      }
    }
    const weakKnowledgePoints = [...weakPointStats.entries()]
      .map(([knowledgePointId, value]) => ({
        knowledgePointId,
        title: value.title,
        subject: this.knowledgePoints.find((item) => item.id === knowledgePointId)?.subject ?? '408',
        accuracyRate: average(value.accuracyRates),
        wrongCount: value.wrongCount,
        recommendedAction: `围绕 ${value.title} 做 15 分钟概念串讲，再布置 5 道变式题。`,
      }))
      .sort((left, right) => right.wrongCount - left.wrongCount || left.accuracyRate - right.accuracyRate)
      .slice(0, 4);

    const atRiskStudents = students.map((student) => {
      const completionRate = student.plan.completionRate ?? 0;
      const reasons = [
        ...(student.report.accuracyRate < 65 ? [`正确率 ${student.report.accuracyRate}%，基础题稳定性不足。`] : []),
        ...(completionRate < 60 ? [`任务完成率 ${completionRate}%，需要提醒补齐计划任务。`] : []),
        ...(student.wrongQuestions.length > 0 ? [`仍有 ${student.wrongQuestions.length} 道错题未完成闭环复盘。`] : []),
        ...(student.latestAssessment && student.latestAssessment.accuracyRate < 70
          ? [`最近测评正确率 ${student.latestAssessment.accuracyRate}%，测评后复盘优先级较高。`]
          : []),
      ];
      return {
        userId: student.user.id,
        name: student.user.name,
        riskType: student.report.accuracyRate < 65 ? '正确率偏低' : completionRate < 60 ? '任务完成不足' : '错题复盘待加强',
        reason: reasons[0] ?? `${student.user.name} 需要继续保持错题复盘和限时训练节奏。`,
        nextAction: student.report.weakPoints[0]
          ? `本周优先跟进 ${student.report.weakPoints[0].title}，要求完成错题复盘和同考点训练。`
          : '保持每日任务完成，并安排一次阶段测评观察趋势。',
      };
    });

    const pendingWrongQuestionCount = students.reduce((sum, student) => sum + student.wrongQuestions.length, 0);
    const unansweredCount = students.reduce((sum, student) => sum + (student.latestAssessment?.unansweredCount ?? 0), 0);
    const topWeakPoint = weakKnowledgePoints[0];
    return {
      source: this.dataSource,
      className: teacherId ? '我的授权班级' : '全局教学概览',
      generatedAt: new Date().toISOString(),
      overview: {
        studentCount: students.length,
        activeStudentCount: students.filter((student) => student.active).length,
        averageAccuracyRate: average(students.map((student) => student.report.accuracyRate)),
        averageCompletionRate: average(students.map((student) => student.plan.completionRate ?? 0)),
        pendingWrongQuestionCount,
      },
      subjectWeakness,
      weakKnowledgePoints,
      atRiskStudents,
      teachingActions: [
        topWeakPoint
          ? `本周小课优先讲 ${topWeakPoint.title}，讲完立即做变式题检验。`
          : '先收集更多练习记录，再判断下一轮共性薄弱点。',
        pendingWrongQuestionCount > 0
          ? '安排一次错题复盘课，要求学生写出错因而不是只看答案。'
          : '错题闭环压力较低，可以增加整卷限时训练。',
        unansweredCount > 0
          ? `最近测评共 ${unansweredCount} 题未答，加入审题速度训练。`
          : '保持测评后复盘节奏，用历史记录观察连续两次趋势。',
      ],
    };
  }

  getReviewQueue() {
    const items = [...this.questionsService.listReviewItems(), ...this.aiReviewItems]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    return {
      source: this.dataSource,
      pendingCount: items.filter((item) => item.status === 'pending').length,
      approvedCount: items.filter((item) => item.status === 'approved').length,
      items,
      generatedAt: new Date().toISOString(),
    };
  }

  getSystemConfig() {
    return { ...this.systemConfig, source: this.dataSource };
  }

  async submitFeedback(input: {
    userId: string;
    rating?: number;
    scene?: string;
    message?: string;
  }) {
    if (!Number.isInteger(input.rating) || input.rating! < 1 || input.rating! > 5) {
      throw new BadRequestException('Feedback rating must be an integer from 1 to 5');
    }
    if (!FEEDBACK_SCENES.includes(input.scene as FeedbackScene)) {
      throw new BadRequestException('Feedback scene is not supported');
    }
    if (typeof input.message !== 'string') {
      throw new BadRequestException('Feedback message must be a string');
    }
    const message = input.message.trim();
    const messageLength = Array.from(message).length;
    if (messageLength < 10 || messageLength > 1000) {
      throw new BadRequestException('Feedback message must contain 10 to 1000 characters');
    }

    const record = await this.feedbackRepository.create({
      userId: input.userId,
      rating: input.rating!,
      scene: input.scene as FeedbackScene,
      message,
    });
    const feedback = toFeedbackItem(record);

    this.feedbackItems.push(feedback);
    return feedback;
  }

  async getFeedbackList() {
    replaceFeedbackItems(this.feedbackItems, await this.feedbackRepository.list());
    const items = [...this.feedbackItems].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const averageRating = items.length
      ? Math.round((items.reduce((sum, item) => sum + item.rating, 0) / items.length) * 10) / 10
      : 0;

    return {
      totalCount: items.length,
      averageRating,
      surveyUrl: OFFICIAL_FEEDBACK_SURVEY_URL,
      items,
    };
  }

  listPapers(forStudent = false) {
    return forStudent
      ? this.papers.map((paper) => ({ ...paper, questions: toStudentQuestions(paper.questions) }))
      : this.papers;
  }

  getAssessmentHistory(userId = this.student.id) {
    const items = this.assessmentHistoryItems
      .filter((item) => item.userId === userId)
      .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));

    return {
      userId,
      items,
      summary: buildAssessmentHistorySummary(items),
    };
  }

  async importAssessmentHistory(userId: string, input: {
    title: string;
    score: number;
    totalScore: number;
    occurredAt?: string;
  }): Promise<PersistedAssessmentHistoryItem> {
    const title = input.title?.trim();
    if (!title || title.length > 100) {
      throw new BadRequestException('title must contain 1 to 100 characters');
    }
    if (!Number.isFinite(input.totalScore) || input.totalScore <= 0) {
      throw new BadRequestException('totalScore must be a positive number');
    }
    if (!Number.isFinite(input.score) || input.score < 0 || input.score > input.totalScore) {
      throw new BadRequestException('score must be between 0 and totalScore');
    }
    const item: PersistedAssessmentHistoryItem = {
      id: `imported-${randomUUID()}`,
      userId,
      title,
      submittedAt: input.occurredAt ?? new Date().toISOString(),
      score: input.score,
      totalScore: input.totalScore,
      accuracyRate: Math.round((input.score / input.totalScore) * 100),
      elapsedSec: 0,
      unansweredCount: 0,
      weakPointTitle: '',
      reviewSuggestion: '历史成绩导入，用于对比当前备考水平。',
    };
    this.assessmentHistoryItems.push(item);
    await this.assessmentHistoryRepository.save(item);
    await this.trackUserEvent(userId, 'assessment.import', { title: item.title, score: item.score, totalScore: item.totalScore });
    return item;
  }

  async generatePaper(input: {
    title?: string;
    paperType?: PaperType;
    knowledgePointIds?: string[];
    questionCount?: number;
    createdBy?: string;
  }) {
    const questionCount = clampNumber(input.questionCount ?? 6, 1, 50);
    const requestedPointIds = new Set(input.knowledgePointIds ?? []);
    const selectedQuestions = this.questions
      .filter((question) => {
        if (requestedPointIds.size === 0) return true;
        return question.knowledgePointIds.some((id) => requestedPointIds.has(id));
      })
      .slice(0, questionCount);

    if (selectedQuestions.length === 0) {
      throw new BadRequestException('No questions matched the paper generation criteria');
    }

    const paper: GeneratedPaper = {
      id: `paper-${Date.now()}`,
      title: input.title?.trim() || `${input.paperType ?? '阶段卷'}-${todayKey()}`,
      paperType: input.paperType ?? '阶段卷',
      questionCount: selectedQuestions.length,
      knowledgePointIds: [...new Set(selectedQuestions.flatMap((question) => question.knowledgePointIds))],
      questions: selectedQuestions,
      estimatedMinutes: Math.max(10, Math.round(selectedQuestions.reduce((sum, question) => sum + question.expectedTimeSec, 0) / 60)),
      createdBy: input.createdBy ?? 'teacher-001',
      createdAt: new Date().toISOString(),
    };

    this.papers.push(paper);
    await this.paperRepository.save(paper);
    return paper;
  }

  async prepareExamPaper(userId: string, input: {
    paperType?: '模拟卷' | '专项卷';
    subject?: Subject;
    questionCount?: number;
  }) {
    const paperType = input.paperType ?? '模拟卷';
    if (paperType !== '模拟卷' && paperType !== '专项卷') {
      throw new BadRequestException('试卷类型无效，请选择完整模拟卷或科目专项卷');
    }
    const requestedQuestionCount = input.questionCount ?? (paperType === '模拟卷' ? 40 : 15);
    if (!Number.isInteger(requestedQuestionCount) || requestedQuestionCount < 1 || requestedQuestionCount > 50) {
      throw new BadRequestException('题目数量必须是 1 至 50 之间的整数');
    }
    const questionCount = requestedQuestionCount;
    if (paperType === '专项卷' && !input.subject) {
      throw new BadRequestException('生成科目专项卷前请选择训练科目');
    }

    const knowledgePointIds = paperType === '专项卷'
      ? this.knowledgePoints.filter((point) => point.subject === input.subject).map((point) => point.id)
      : [];
    if (paperType === '专项卷' && knowledgePointIds.length === 0) {
      throw new BadRequestException(`暂未配置${input.subject}的知识点，无法生成专项卷`);
    }

    const paper = await this.generatePaper({
      title: paperType === '专项卷' ? `${input.subject}专项卷` : `408 模拟卷-${todayKey()}`,
      paperType,
      knowledgePointIds,
      questionCount,
      createdBy: userId,
    });
    return {
      ...paper,
      questions: toStudentQuestions(paper.questions),
    };
  }

  async submitPaper(paperId: string, input: {
    userId?: string;
    answers?: Array<{
      questionId: string;
      selectedAnswer: string;
      timeSpentSec: number;
      selfScore?: number;
      maxScore?: number;
    }>;
  }) {
    const paper = this.papers.find((item) => item.id === paperId);
    if (!paper) {
      throw new BadRequestException(`Paper ${paperId} was not found`);
    }

    const userId = input.userId ?? this.student.id;
    const answers = input.answers ?? [];
    if (answers.length === 0) {
      throw new BadRequestException('Paper answers are required');
    }

    const records = await Promise.all(answers.map((answer) => this.createPracticeRecord({
      userId,
      questionId: answer.questionId,
      knowledgePointId: '',
      selectedAnswer: answer.selectedAnswer,
      timeSpentSec: answer.timeSpentSec,
      selfScore: answer.selfScore,
      maxScore: answer.maxScore,
    })));
    const correctCount = records.filter((record) => record.correct).length;
    const accuracyRate = Math.round((correctCount / records.length) * 100);
    const subjectStats = new Map<string, { total: number; correct: number }>();
    const reviewItems = records
      .filter((record) => !record.correct || record.mistakeReason !== null)
      .map((record) => {
        const question = this.questions.find((item) => item.id === record.questionId);
        const point = this.knowledgePoints.find((item) => item.id === record.knowledgePointId);
        const subject = point?.subject ?? '未分类';
        const current = subjectStats.get(subject) ?? { total: 0, correct: 0 };
        current.total += 1;
        if (record.correct) current.correct += 1;
        subjectStats.set(subject, current);

        return {
          questionId: record.questionId,
          stem: question?.stem ?? record.questionId,
          selectedAnswer: record.selectedAnswer,
          correctAnswer: question?.answer,
          correct: record.correct,
          knowledgePointId: record.knowledgePointId,
          knowledgePointTitle: point?.title ?? record.knowledgePointId,
          subject,
          mistakeReason: record.mistakeReason,
        };
      });

    for (const record of records.filter((item) => item.correct)) {
      const point = this.knowledgePoints.find((item) => item.id === record.knowledgePointId);
      const subject = point?.subject ?? '未分类';
      const current = subjectStats.get(subject) ?? { total: 0, correct: 0 };
      if (!reviewItems.some((item) => item.questionId === record.questionId)) {
        current.total += 1;
        current.correct += 1;
        subjectStats.set(subject, current);
      }
    }

    const subjectBreakdown = [...subjectStats.entries()].map(([subject, stats]) => ({
      subject,
      totalQuestions: stats.total,
      correctCount: stats.correct,
      accuracyRate: stats.total ? Math.round((stats.correct / stats.total) * 100) : 0,
    }));
    const weakKnowledgePoints = [...new Set(reviewItems.map((item) => item.knowledgePointTitle))].slice(0, 4);
    const answeredCount = answers.length;
    const timeLimitSec = Math.max(1, paper.estimatedMinutes * 60);
    const elapsedSec = answers.reduce((sum, answer) => sum + Math.max(0, answer.timeSpentSec), 0);

    const result = {
      id: `paper-result-${Date.now()}`,
      paperId,
      userId,
      submittedAt: new Date().toISOString(),
      totalQuestions: records.length,
      correctCount,
      score: accuracyRate,
      accuracyRate,
      subjectBreakdown,
      reviewItems,
      weakKnowledgePoints,
      syncedPracticeRecordCount: records.length,
      examSession: {
        answeredCount,
        unansweredCount: Math.max(0, paper.questionCount - answeredCount),
        totalQuestions: paper.questionCount,
        elapsedSec,
        timeLimitSec,
        overtime: elapsedSec > timeLimitSec,
        progressRate: paper.questionCount ? Math.round((answeredCount / paper.questionCount) * 100) : 0,
      },
      nextActions: [
        accuracyRate >= 80 ? '本套卷表现较好，建议进入限时真题训练。' : '先复盘本套卷错题，再按薄弱知识点补一组专项题。',
        reviewItems.length ? `已同步 ${reviewItems.length} 道需要复盘的题目到错题闭环。` : '本套卷暂无错题，建议提高限时要求。',
        weakKnowledgePoints.length ? `优先处理：${weakKnowledgePoints.join('、')}。` : '保持当前节奏，继续做整卷训练。',
      ],
    };

    const historyItem: AssessmentHistoryItem = {
      id: `assessment-history-${Date.now()}`,
      paperId,
      userId,
      title: paper.title,
      submittedAt: result.submittedAt,
      score: result.score,
      totalScore: 100,
      accuracyRate: result.accuracyRate,
      elapsedSec,
      unansweredCount: result.examSession.unansweredCount,
      weakPointTitle: weakKnowledgePoints[0] ?? '限时整卷训练',
      reviewSuggestion: this.createAssessmentReviewSuggestion(result.accuracyRate, weakKnowledgePoints[0], result.examSession.overtime),
    };
    this.assessmentHistoryItems.push(historyItem);
    await this.assessmentHistoryRepository.save(historyItem);

    return result;
  }

  async updateSystemConfig(input: {
    recommendation?: Partial<{
      stageAssessmentQuestionLimit: number;
      dailyTargetQuestionCount: number;
      speedRiskMultiplier: number;
    }>;
    updatedBy?: string;
  }) {
    const nextRecommendation = {
      ...this.systemConfig.recommendation,
      ...input.recommendation,
    };

    this.systemConfig = {
      ...this.systemConfig,
      recommendation: {
        stageAssessmentQuestionLimit: clampNumber(nextRecommendation.stageAssessmentQuestionLimit, 2, 20),
        dailyTargetQuestionCount: clampNumber(nextRecommendation.dailyTargetQuestionCount, 5, 120),
        speedRiskMultiplier: clampNumber(nextRecommendation.speedRiskMultiplier, 1, 3),
      },
      updatedBy: input.updatedBy ?? 'admin-001',
      updatedAt: new Date().toISOString(),
    };
    await this.systemConfigRepository.save(this.systemConfig);

    return { ...this.systemConfig, source: this.dataSource };
  }

  async approveReviewItem(reviewItemId: string, reviewerId = 'admin-001') {
    const questionReviewItem = await this.questionsService.approveReviewItem(reviewItemId, reviewerId);
    if (questionReviewItem) return questionReviewItem;

    const aiReviewItem = this.aiReviewItems.find((item) => item.id === reviewItemId);
    if (!aiReviewItem) {
      throw new BadRequestException(`Review item ${reviewItemId} was not found`);
    }

    aiReviewItem.status = 'approved';
    aiReviewItem.reviewerId = reviewerId;
    aiReviewItem.reviewedAt = new Date().toISOString();
    return aiReviewItem;
  }

  async markReviewItemNeedsRecheck(reviewItemId: string, reviewerId = 'admin-001') {
    const questionReviewItem = await this.questionsService.markReviewItemNeedsRecheck(reviewItemId, reviewerId);
    if (questionReviewItem) return questionReviewItem;

    const aiReviewItem = this.aiReviewItems.find((item) => item.id === reviewItemId);
    if (!aiReviewItem) {
      throw new BadRequestException(`Review item ${reviewItemId} was not found`);
    }

    aiReviewItem.status = 'needs_recheck';
    aiReviewItem.reviewerId = reviewerId;
    aiReviewItem.reviewedAt = new Date().toISOString();
    return aiReviewItem;
  }

  listWrongQuestions(userId = this.student.id, filters: WrongQuestionFilter = {}) {
    const grouped = new Map<string, PracticeRecord[]>();
    const reviewedQuestions = this.wrongQuestionReviewDatesByUser.get(userId) ?? new Map<string, string>();
    for (const record of this.records.filter((item) => item.userId === userId)) {
      const bucket = grouped.get(record.questionId) ?? [];
      bucket.push(record);
      grouped.set(record.questionId, bucket);
    }

    const items = [...grouped.entries()].flatMap(([questionId, records]) => {
      const latestRecord = records[records.length - 1];
      if (latestRecord.correct) {
        return [];
      }

      const question = this.questions.find((item) => item.id === questionId);
      const knowledgePoint = this.knowledgePoints.find((item) => item.id === latestRecord.knowledgePointId);
      const knowledgePointDisplay = knowledgePoint
        ? resolveKnowledgePointDisplay(knowledgePoint, this.knowledgePointDisplay)
        : null;
      const wrongCount = records.filter((record) => !record.correct).length;
      const mastery = this.getMasteryState(userId, questionId);

      return [{
        questionId,
        stem: question?.stem ?? questionId,
        answer: question?.answer,
        analysis: question?.analysis,
        knowledgePointId: latestRecord.knowledgePointId,
        knowledgePointTitle: knowledgePointDisplay?.title ?? latestRecord.knowledgePointId,
        subject: knowledgePoint?.subject ?? '未分类',
        chapter: knowledgePointDisplay?.chapter ?? '未分类',
        wrongCount,
        latestMistakeReason: latestRecord.mistakeReason,
        latestSubmittedAt: latestRecord.submittedAt,
        reviewStatus: reviewedQuestions.has(questionId) ? 'reviewed' : 'pending',
        reviewedAt: reviewedQuestions.get(questionId) ?? null,
        masteryStatus: mastery.masteryStatus,
        masteryCriteria: mastery.masteryCriteria,
        importance: knowledgePoint?.importance ?? 0,
      }];
    });

    return filterWrongQuestions(items, filters);
  }

  async reviewWrongQuestion(questionId: string, userId = this.student.id) {
    const wrongQuestion = this.listWrongQuestions(userId).find((item) => item.questionId === questionId);
    if (!wrongQuestion) {
      throw new BadRequestException(`Wrong question ${questionId} was not found`);
    }

    const reviewed = this.wrongQuestionReviewDatesByUser.get(userId) ?? new Map<string, string>();
    const reviewedAt = new Date().toISOString();
    await this.learningProgressRepository.saveWrongQuestionReview(userId, questionId, reviewedAt);
    reviewed.set(questionId, reviewedAt);
    this.wrongQuestionReviewDatesByUser.set(userId, reviewed);
    await this.trackUserEvent(userId, 'wrong.review', { questionId });
    // V12-M1 (EB-2): the "reviewed" tick is now recorded and auditable. It is
    // activity evidence only — no recall was observed, so it may not be used to
    // claim ability. Unifying it with the mastery write path is V12-M3 and
    // requires owner approval because it changes production write semantics.
    await this.recordLearningEvidence('review.marked', () =>
      this.learningEvidence!.recordReviewMarked(userId, { questionId, reviewedAt }),
    );

    return {
      ...wrongQuestion,
      reviewStatus: 'reviewed',
      reviewedAt,
      nextAction: `先复述 ${wrongQuestion.knowledgePointTitle} 的核心规则，再完成 2 道同考点题。`,
      similarQuestions: this.findSimilarQuestions(questionId, wrongQuestion.knowledgePointId),
    };
  }

  // ---- Phase 5: Spaced Repetition (wrong question review scheduling) ----

  private readonly reviewSchedules = new Map<string, ReviewSchedule>();
  private readonly reviewAttemptsByKey = new Map<string, ReviewAttemptState[]>();

  async reportWrongReason(questionId: string, userId: string, input: {
    selfReportedReason: string;
    redoCorrect: boolean;
    timeSpentSec: number;
    isReview?: boolean;
    actionId?: string;
    idempotencyKey?: string;
  }) {
    const selfReportedReason = input.selfReportedReason?.trim();
    if (!selfReportedReason || selfReportedReason.length > 100) {
      throw new BadRequestException('Self-reported reason must contain 1 to 100 characters');
    }
    if (typeof input.redoCorrect !== 'boolean') {
      throw new BadRequestException('Redo result must be a boolean');
    }
    if (!Number.isFinite(input.timeSpentSec) || input.timeSpentSec < 0 || input.timeSpentSec > 86_400) {
      throw new BadRequestException('Review time must be between 0 and 86400 seconds');
    }
    const key = scheduleKey(userId, questionId);
    const action = input.actionId
      ? await this.recommendationActionService?.getAction(userId, input.actionId)
      : null;
    const actionId = resolveReviewActionId(action, userId, input.actionId);
    if (input.idempotencyKey && this.reviewAttemptsByKey.get(key)?.some((attempt) => attempt.idempotencyKey === input.idempotencyKey)) {
      return this.reviewAttemptsByKey.get(key)!.find((attempt) => attempt.idempotencyKey === input.idempotencyKey);
    }
    if (input.idempotencyKey) {
      const persisted = await this.reviewScheduleRepository.findAttemptByIdempotencyKey(userId, questionId, input.idempotencyKey);
      if (persisted) return persisted;
    }
    const existing = this.reviewSchedules.get(key);
    const now = new Date();
    const questionRecords = this.records.filter((record) => record.userId === userId && record.questionId === questionId);
    if (questionRecords.length === 0) {
      throw new BadRequestException(`Question ${questionId} has no practice history for this user`);
    }
    const inferredReason = inferReviewReason(selfReportedReason, questionRecords);
    const lastWrongRecordId = existing?.lastWrongRecordId
      ?? [...questionRecords].reverse().find((record) => !record.correct)?.id;

    if (input.isReview === false) {
      const nextReviewAt = existing?.nextReviewAt ?? new Date(now.getTime() + 86_400_000).toISOString();
      const schedule: ReviewSchedule = {
        questionId,
        userId,
        inferredReason,
        selfReportedReason,
        note: existing?.note,
        lastWrongRecordId,
        redoCorrect: false,
        timeSpentSec: input.timeSpentSec,
        consecutiveCorrect: existing?.consecutiveCorrect ?? 0,
        stability: existing?.stability ?? 'learning',
        nextReviewAt,
        reviewCount: existing?.reviewCount ?? 0,
        lastReviewedAt: existing?.lastReviewedAt,
      };
      await this.reviewScheduleRepository.saveSchedule(schedule);
      this.reviewSchedules.set(key, schedule);
      return {
        ...schedule,
        nextReviewInDays: Math.max(1, Math.ceil((new Date(nextReviewAt).getTime() - now.getTime()) / 86_400_000)),
        message: '已记录本次错因，并安排到次日复习。',
      };
    }

    // Determine mastery: consecutive correct redos → advance interval
    const consecutiveCorrect = input.redoCorrect
      ? (existing?.consecutiveCorrect ?? 0) + 1
      : 0;

    const stability: ReviewSchedule['stability'] =
      consecutiveCorrect >= 3 ? 'mastered'
      : consecutiveCorrect >= 1 ? 'review'
      : 'learning';

    // Spaced repetition intervals; a correct-but-slow review keeps a shorter interval
    const latestRecord = questionRecords[questionRecords.length - 1];
    const slowReview = input.redoCorrect && input.timeSpentSec > (latestRecord?.expectedTimeSec ?? 60) * 1.45;
    const nextIntervalDays = nextReviewIntervalDays({ consecutiveCorrect, slowReview });

    const nextReviewAt = new Date(now);
    nextReviewAt.setUTCDate(nextReviewAt.getUTCDate() + nextIntervalDays);

    const schedule: ReviewSchedule = {
      questionId,
      userId,
      inferredReason,
      selfReportedReason,
      note: existing?.note,
      lastWrongRecordId,
      redoCorrect: input.redoCorrect,
      timeSpentSec: input.timeSpentSec,
      consecutiveCorrect,
      stability,
      nextReviewAt: nextReviewAt.toISOString(),
      reviewCount: (existing?.reviewCount ?? 0) + 1,
      lastReviewedAt: now.toISOString(),
    };
    const attempt: ReviewAttemptState = {
      actionId,
      idempotencyKey: input.idempotencyKey ?? null,
      redoCorrect: input.redoCorrect,
      timeSpentSec: input.timeSpentSec,
      reportedReason: selfReportedReason,
      inferredReason,
      nextIntervalDays,
      reviewedAt: now.toISOString(),
    };
    const persistReview = async (tx?: Prisma.TransactionClient) => {
      if (tx) await this.reviewScheduleRepository.saveReview(schedule, attempt, tx);
      else await this.reviewScheduleRepository.saveReview(schedule, attempt);
      await this.learningProgressRepository.saveWrongQuestionReview(userId, questionId, now.toISOString(), tx);
      if (stability === 'mastered' && this.prisma) {
        await resolveWrongQuestion(tx ?? this.prisma, userId, questionId, now);
      }
      if (input.isReview === true) {
        await this.scoreCenterService?.applyReview(userId, questionId, {
          reviewedAt: now,
          redoCorrect: input.redoCorrect,
        }, tx);
      }
    };
    if (this.prisma && this.reviewScheduleRepository.enabled && typeof this.prisma.$transaction === 'function') {
      await this.prisma.$transaction((tx) => persistReview(tx));
    } else {
      await persistReview();
    }
    // Only committed attempts may become visible to reads or idempotent retries.
    this.reviewSchedules.set(key, schedule);
    const attempts = this.reviewAttemptsByKey.get(key) ?? [];
    this.reviewAttemptsByKey.set(key, [...attempts, attempt]);
    this.triggerActionFeedback(userId, actionId);
    // V12-M1: recorded after commit so evidence never describes a rolled-back
    // attempt. An observed redo outcome is strong evidence; applyReview above
    // remains the only mastery writer.
    await this.recordLearningEvidence('review.recalled', () =>
      this.learningEvidence!.recordReviewRecall(userId, {
        questionId,
        redoCorrect: input.redoCorrect,
        timeSpentSec: input.timeSpentSec,
        recordedAt: now.toISOString(),
        actionId,
      }),
    );

    // Also mark as reviewed in the existing tracking
    const reviewed = this.wrongQuestionReviewDatesByUser.get(userId) ?? new Map<string, string>();
    reviewed.set(questionId, now.toISOString());
    this.wrongQuestionReviewDatesByUser.set(userId, reviewed);
    if (input.isReview === true) {
      await this.refreshNodeMasteryCache(userId);
    }

    return {
      ...schedule,
      nextReviewInDays: nextIntervalDays,
      message: stability === 'mastered'
        ? '连续正确已达 3 次，标记为稳定掌握！'
        : consecutiveCorrect > 0
          ? `连续正确 ${consecutiveCorrect} 次，${nextIntervalDays} 天后复习。`
          : '重做仍有错误，建议先复述考点再进入下一次。',
    };
  }

  async updateWrongQuestionNote(questionId: string, userId: string, noteInput?: string) {
    const note = noteInput?.trim() ?? '';
    if (note.length > 2000) {
      throw new BadRequestException('Wrong-question note must not exceed 2000 characters');
    }
    const key = scheduleKey(userId, questionId);
    let schedule = this.reviewSchedules.get(key);
    if (!schedule) {
      const latestWrong = [...this.records]
        .reverse()
        .find((record) => record.userId === userId && record.questionId === questionId && !record.correct);
      if (!latestWrong) throw new BadRequestException(`Wrong question ${questionId} was not found`);
      await this.ensureReviewSchedule(latestWrong);
      schedule = this.reviewSchedules.get(key)!;
    }
    schedule.note = note;
    this.reviewSchedules.set(key, schedule);
    await this.reviewScheduleRepository.saveNote(userId, questionId, note);
    return { questionId, userId, note, updatedAt: new Date().toISOString() };
  }

  getDueReviews(userId: string) {
    const now = new Date();
    const due: Array<ReviewSchedule & { stem: string; knowledgePointTitle: string; subject: string }> = [];

    for (const [, schedule] of this.reviewSchedules) {
      if (schedule.userId !== userId) continue;
      if (schedule.stability === 'mastered') continue;
      if (new Date(schedule.nextReviewAt) > now) continue;

      const question = this.questions.find((q) => q.id === schedule.questionId);
      const point = this.knowledgePoints.find((k) => k.id === question?.knowledgePointIds[0]);
      due.push({
        ...schedule,
        stem: question?.stem ?? schedule.questionId,
        knowledgePointTitle: point?.title ?? '未知考点',
        subject: point?.subject ?? '未分类',
      });
    }

    return {
      userId,
      dueCount: due.length,
      items: due.sort((a, b) => a.nextReviewAt.localeCompare(b.nextReviewAt)),
      nextAction: due.length > 0
        ? `今天有 ${due.length} 道错题需要复习，优先从最早到期的开始。`
        : '暂无到期复习任务，可以开始新的练习。',
    };
  }

  getWrongQuestionDetail(questionId: string, userId: string) {
    const records = this.records
      .filter((r) => r.userId === userId && r.questionId === questionId)
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));

    const question = this.questions.find((q) => q.id === questionId);
    const latestRecord = records[records.length - 1];
    const knowledgePointId = latestRecord?.knowledgePointId ?? question?.knowledgePointIds[0];
    const point = knowledgePointId
      ? this.knowledgePoints.find((k) => k.id === knowledgePointId)
      : undefined;
    const display = knowledgePointId
      ? resolveKnowledgePointDisplay(
          { id: knowledgePointId, title: point?.title ?? '', chapter: point?.chapter ?? '' },
          this.knowledgePointDisplay,
        )
      : null;

    const key = scheduleKey(userId, questionId);
    const schedule = this.reviewSchedules.get(key);
    const reviewHistory = this.reviewAttemptsByKey.get(key) ?? [];
    const similar = this.findSimilarQuestions(questionId, point?.id ?? '');
    const mastery = this.getMasteryState(userId, questionId);

    return {
      questionId,
      stem: question?.stem ?? questionId,
      answer: question?.answer,
      analysis: question?.analysis,
      knowledgePointTitle: display?.title || point?.title || '未知考点',
      subject: point?.subject ?? '未分类',
      chapter: display?.chapter || point?.chapter || '未分类',
      attemptHistory: records.map((r) => ({
        date: r.submittedAt,
        selectedAnswer: r.selectedAnswer,
        correct: r.correct,
        mistakeReason: r.mistakeReason,
        timeSpentSec: r.timeSpentSec,
      })),
      reviewSchedule: schedule ? {
        stability: schedule.stability,
        consecutiveCorrect: schedule.consecutiveCorrect,
        nextReviewAt: schedule.nextReviewAt,
        reviewCount: schedule.reviewCount,
        selfReportedReason: schedule.selfReportedReason,
        inferredReason: schedule.inferredReason,
      } : null,
      note: schedule?.note ?? '',
      reviewHistory,
      similarQuestions: similar,
      reviewLayers: this.buildReviewLayers(questionId, question, point),
      masteryStatus: mastery.masteryStatus,
      masteryCriteria: mastery.masteryCriteria,
      recommendation: schedule?.stability === 'mastered'
        ? '已稳定掌握，保持定期限时训练。'
        : schedule?.stability === 'review'
          ? '在巩固阶段，继续按间隔复习并记录易错条件。'
          : '仍在学习阶段，建议先重读概念再重做。',
    };
  }

  private buildReviewLayers(questionId: string, question: Question | undefined, point: KnowledgePoint | undefined) {
    const toItem = (item: Question) => {
      const itemPoint = this.knowledgePoints.find((p) => item.knowledgePointIds.includes(p.id));
      return {
        questionId: item.id,
        stem: item.stem,
        difficulty: item.difficulty,
        source: item.source,
        type: item.type,
        knowledgePointId: itemPoint?.id,
        knowledgePointTitle: itemPoint?.title,
      };
    };
    const samePoint = this.questions.filter(
      (item) => item.id !== questionId && point && item.knowledgePointIds.includes(point.id),
    );
    const confusing = this.questions.filter((item) => {
      if (item.id === questionId || !point) return false;
      const itemPoint = this.knowledgePoints.find((p) => item.knowledgePointIds.includes(p.id));
      return Boolean(itemPoint && itemPoint.subject === point.subject && itemPoint.id !== point.id
        && (!point.chapter || itemPoint.chapter === point.chapter));
    });
    const comprehensive = this.questions.filter(
      (item) => item.id !== questionId && (item.type === '综合题' || item.difficulty === '困难'),
    );
    return {
      original: question ? {
        questionId: question.id,
        stem: question.stem,
        answer: question.answer,
        analysis: question.analysis,
        difficulty: question.difficulty,
        source: question.source,
      } : null,
      variants: samePoint.slice(0, 3).map(toItem),
      confusingConcepts: confusing.slice(0, 3).map(toItem),
      comprehensive: comprehensive.slice(0, 3).map(toItem),
    };
  }
  getWrongQuestionSummary(userId = this.student.id) {
    const wrongQuestions = this.listWrongQuestions(userId);
    const reviewedQuestions = this.wrongQuestionReviewDatesByUser.get(userId) ?? new Map<string, string>();
    const userRecords = this.records.filter((record) => record.userId === userId);
    const groupedRecords = new Map<string, PracticeRecord[]>();

    for (const record of userRecords) {
      const bucket = groupedRecords.get(record.questionId) ?? [];
      bucket.push(record);
      groupedRecords.set(record.questionId, bucket);
    }

    const resolvedQuestions = [...groupedRecords.entries()].filter(([, records]) => {
      const hadWrong = records.some((record) => !record.correct);
      const latestRecord = records[records.length - 1];
      return hadWrong && latestRecord?.correct;
    });
    const mistakeReasonCounts = new Map<string, number>();
    for (const record of userRecords.filter((item) => !item.correct)) {
      const reason = record.mistakeReason ?? '待归因';
      mistakeReasonCounts.set(reason, (mistakeReasonCounts.get(reason) ?? 0) + 1);
    }

    const priorityRedoItems = [...wrongQuestions]
      .sort((left, right) => right.wrongCount - left.wrongCount)
      .slice(0, 3)
      .map((item) => ({
        questionId: item.questionId,
        stem: item.stem,
        knowledgePointTitle: item.knowledgePointTitle,
        wrongCount: item.wrongCount,
        latestMistakeReason: item.latestMistakeReason,
        reviewStatus: item.reviewStatus,
        nextAction: item.reviewStatus === 'pending'
          ? '先标记复盘，写出错误原因后再重做。'
          : '进入重做模式，确认是否已经真正解决。',
      }));
    const pendingCount = wrongQuestions.filter((item) => item.reviewStatus === 'pending').length;
    const reviewedCount = wrongQuestions.filter((item) => item.reviewStatus === 'reviewed').length;
    const resolvedCount = resolvedQuestions.length;
    const nextReviewActions = [
      pendingCount > 0 ? `先复盘 ${pendingCount} 道待处理错题，补全错因。` : '待复盘错题已清空，可以进入重做验证。',
      priorityRedoItems.length > 0 ? `优先重做 ${priorityRedoItems[0].knowledgePointTitle}，它的错误次数最高。` : '当前没有待重做错题，建议进入限时训练。',
      resolvedCount > 0 ? `已有 ${resolvedCount} 道错题通过重做解决，继续保持闭环。` : '完成一次正确重做后，系统会将该题从错题本移除。',
    ];

    return {
      userId,
      pendingCount,
      reviewedCount,
      resolvedCount,
      totalWrongCount: wrongQuestions.length,
      masteryStats: (['未掌握', '复习中', '已掌握'] as const).map((status) => ({
        status,
        count: wrongQuestions.filter((item) => item.masteryStatus === status).length,
      })),
      mistakeReasonStats: [...mistakeReasonCounts.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((left, right) => right.count - left.count),
      priorityRedoItems,
      nextReviewActions,
      generatedAt: new Date().toISOString(),
    };
  }

  async getRecommendedPracticeSet(userId = this.student.id, minutesBudget?: number | null, mode?: string) {
    // Sprint 3.3：DB 模式走 Adapter → RecommendationService → Student State SoT；内存演示模式保留 legacy 计算。
    // V8 #12：minutesBudget 缩小题量（15 分钟 → 5 题），不放大基准档。
    // LE-V10 F1 M2：mode=exam_aligned 时由 ExamAlignmentService 附加只读真题对齐投影（排序投影不改引擎选题）。
    let base;
    if (!process.env.DATABASE_URL) {
      base = this.getRecommendedPracticeSetLegacy(userId, minutesBudget);
    } else if (!this.recommendation) {
      base = this.getRecommendedPracticeSetLegacy(userId, minutesBudget);
    } else {
      base = await this.getRecommendedPracticeSetFromState(userId, minutesBudget);
    }
    if (!this.examAlignment) return base;
    return this.examAlignment.attachToPracticeSet(userId, base, mode, this.recentPracticeRefs(userId));
  }

  /** 近 7 日该用户的已练题目（F1 排序降权输入；读内存镜像，有界窗口）。 */
  private recentPracticeRefs(userId: string) {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return this.records
      .filter((record) => record.userId === userId && new Date(record.submittedAt).getTime() >= cutoff)
      .map((record) => ({
        questionId: record.questionId,
        lastPracticedAt: new Date(record.submittedAt).toISOString(),
      }));
  }

  private getRecommendedPracticeSetLegacy(userId = this.student.id, minutesBudget?: number | null) {

    this.ensureNodeMasteryFresh();
    const report = this.getOverviewReport(userId);
    const stage = this.getStudent(userId).stage ?? '强化';
    const weakPointIds = report.weakPoints.map((point) => point.knowledgePointId);
    const fallbackPointIds = this.generatePlan(userId).dailyTasks.map((task) => task.knowledgePointId);
    const knowledgePointIds = [...new Set(weakPointIds)].slice(0, 4);
    let matchingQuestions: Question[] = [];
    if (this.useNodeMastery && weakPointIds.length > 0) {
      const nodeQuestionIds = new Set(
        weakPointIds.flatMap((nodeId) => this.nodeQuestionIdsByNode.get(nodeId) ?? []),
      );
      matchingQuestions = this.questions.filter((question) => nodeQuestionIds.has(question.id));
    }
    if (matchingQuestions.length === 0) {
      const sourceIds = weakPointIds.length ? weakPointIds : fallbackPointIds;
      knowledgePointIds.splice(0, knowledgePointIds.length, ...sourceIds.slice(0, 4));
      if (this.useNodeMastery) {
        const nodeQuestionIds = new Set(
          knowledgePointIds.flatMap((nodeId) => this.nodeQuestionIdsByNode.get(nodeId) ?? []),
        );
        matchingQuestions = this.questions.filter((question) => nodeQuestionIds.has(question.id));
      } else {
        matchingQuestions = this.questions.filter((question) =>
          question.knowledgePointIds.some((id) => knowledgePointIds.includes(id)),
        );
      }
    }
    if (matchingQuestions.length === 0) {
      knowledgePointIds.push(...this.questions.flatMap((question) => question.knowledgePointIds).slice(0, 2));
      matchingQuestions = this.questions.filter((question) =>
        question.knowledgePointIds.some((id) => knowledgePointIds.includes(id)),
      );
    }
    const baseCount = stage === '冲刺' ? 20 : report.accuracyRate < 55 ? 16 : 12;
    const questionCount = minutesBudget ? questionCountForMinutes(minutesBudget, baseCount) : baseCount;
    const questions = dedupeQuestionsByStem(matchingQuestions).slice(0, Math.min(questionCount, matchingQuestions.length));

    return {
      id: `practice-set-${todayKey()}`,
      userId,
      title: stage === '冲刺'
        ? '真题错题回炉训练'
        : report.accuracyRate < 55
          ? '高频基础考点补强'
          : '薄弱专题突破',
      stage,
      focus: stage === '冲刺'
        ? '近年真题、错题重做、限时复盘'
        : report.accuracyRate < 55
          ? '例题理解、概念复述、基础题组'
          : '相似考点辨析、变式题组、错因复盘',
      reason: report.weakPoints[0]
        ? `优先覆盖 ${report.weakPoints[0].title}，当前正确率 ${report.weakPoints[0].accuracyRate}%。`
        : '当前薄弱点较少，按今日计划和高频考点生成练习题组。',
      knowledgePointIds,
      questionCount: questions.length,
      estimatedMinutes: Math.max(10, Math.round(questions.reduce((sum, question) => sum + question.expectedTimeSec, 0) / 60)),
      questions: toStudentQuestions(questions),
    };

  }

  private async getRecommendedPracticeSetFromState(userId: string, minutesBudget?: number | null) {
    if (!this.recommendation) {
      return this.getRecommendedPracticeSetLegacy(userId, minutesBudget);
    }
    this.ensureNodeMasteryFresh();
    // The engine's capacity hint only accepts the four standard tiers; a
    // smaller budget snaps UP for capacity while the question count shrinks.
    const engineMinutes: 30 | 60 | 120 | 180 = !minutesBudget
      ? 60
      : ([30, 60, 120, 180] as const).find((tier) => tier >= minutesBudget) ?? 180;
    const { result, nodeById, accuracyRateByNode, overallAccuracyRate } = await this.recommendation.runRecommendationForUser(userId, { availableMinutes: engineMinutes });
    const stage = this.getStudent(userId).stage ?? '强化';
    const knowledgeItems = result.items.filter((item) => item.kind === 'KNOWLEDGE');
    const weakKnowledgeItems = knowledgeItems.filter((item) => item.facts.mastery < 0.45);
    const questionSet = result.items.find((item): item is Extract<RecommendationItem, { kind: 'QUESTION_SET' }> => item.kind === 'QUESTION_SET');
    const weakNodeIds = weakKnowledgeItems.map((item) => item.knowledgeNodeId);
    const fallbackNodeIds = this.generatePlan(userId).dailyTasks.map((task) => task.knowledgePointId);
    const selectedNodeIds = [...new Set(weakNodeIds.length ? weakNodeIds : fallbackNodeIds)].slice(0, 4);
    const identity = buildCanonicalPracticeSetIdentity({
      nodeIds: selectedNodeIds,
      kpIdsByNodeId: await this.getKpIdsByNodeId(selectedNodeIds),
    });
    const knowledgeNodeIds = identity.knowledgeNodeIds;
    const knowledgePointIds = identity.knowledgePointIds;
    let matchingQuestions: Question[] = [];
    const nodeQuestionIds = new Set(knowledgeNodeIds.flatMap((nodeId) => this.nodeQuestionIdsByNode.get(nodeId) ?? []));
    matchingQuestions = this.questions.filter((question) => nodeQuestionIds.has(question.id));
    if (matchingQuestions.length === 0) {
      const sourceNodeIds = weakNodeIds.length ? weakNodeIds : fallbackNodeIds.slice(0, 4);
      const fallbackNodeQuestionIds = new Set(sourceNodeIds.flatMap((nodeId) => this.nodeQuestionIdsByNode.get(nodeId) ?? []));
      matchingQuestions = this.questions.filter((question) => fallbackNodeQuestionIds.has(question.id));
      if (matchingQuestions.length === 0) {
        matchingQuestions = this.questions.filter((question) =>
          question.knowledgePointIds.some((id) => knowledgePointIds.includes(id)),
        );
      }
    }
    if (matchingQuestions.length === 0) {
      for (const pointId of this.questions.flatMap((question) => question.knowledgePointIds).slice(0, 2)) {
        if (!knowledgePointIds.includes(pointId)) knowledgePointIds.push(pointId);
      }
      matchingQuestions = this.questions.filter((question) =>
        question.knowledgePointIds.some((id) => knowledgePointIds.includes(id)),
      );
    }
    const baseCount = stage === '冲刺' ? 20 : questionSet?.questionCount ?? 12;
    const questionCount = minutesBudget ? questionCountForMinutes(minutesBudget, baseCount) : baseCount;
    const questions = dedupeQuestionsByStem(matchingQuestions).slice(0, Math.min(questionCount, matchingQuestions.length));
    // A legacy Point list may include only real question bindings; it never
    // receives a Node ID merely because a selected Node had no map row.
    for (const pointId of questions.flatMap((question) => question.knowledgePointIds)) {
      if (!knowledgePointIds.includes(pointId)) knowledgePointIds.push(pointId);
    }
    const topWeak = weakKnowledgeItems[0];
    const topWeakPoint = topWeak ? {
      title: nodeById.get(topWeak.knowledgeNodeId)?.name ?? topWeak.knowledgeNodeId,
      accuracyRate: accuracyRateByNode[topWeak.knowledgeNodeId] ?? 0,
    } : null;
    const copy = buildPracticeSetCopy({ stage, overallAccuracyRate, questionSetFocus: questionSet?.focus ?? null, topWeakPoint });

    return {
      id: `practice-set-${todayKey()}`,
      userId,
      title: copy.title,
      stage,
      focus: copy.focus,
      reason: copy.reason,
      knowledgeNodeIds,
      knowledgePointIds,
      questionCount: questions.length,
      estimatedMinutes: Math.max(10, Math.round(questions.reduce((sum, question) => sum + question.expectedTimeSec, 0) / 60)),
      questions: toStudentQuestions(questions),
    };
  }

  private async getKpIdsByNodeId(nodeIds: string[]): Promise<Record<string, string[]>> {
    if (!this.prisma || nodeIds.length === 0) return {};
    const rows = await this.prisma.knowledgePointNodeMap.findMany({
      where: { knowledgeNodeId: { in: nodeIds }, mappingType: 'PRIMARY' },
      select: { knowledgePointId: true, knowledgeNodeId: true },
    });
    const map: Record<string, string[]> = {};
    for (const row of rows) {
      (map[row.knowledgeNodeId] ??= []).push(row.knowledgePointId);
    }
    return map;
  }

  async getRecommendedReviewResources(userId = this.student.id): Promise<ReviewResourceRecommendation> {
    // Sprint 3.3：DB 模式走 Adapter → RecommendationService → Student State SoT；内存演示模式保留 legacy 计算。
    if (!process.env.DATABASE_URL) {
      return this.getRecommendedReviewResourcesLegacy(userId);
    }
    if (!this.recommendation) {
      return this.getRecommendedReviewResourcesLegacy(userId);
    }
    return this.getRecommendedReviewResourcesFromState(userId);
  }

  private getRecommendedReviewResourcesLegacy(userId = this.student.id): ReviewResourceRecommendation {

    const report = this.getOverviewReport(userId);
    const masteryMap = this.getMasteryMap(userId);
    const wrongQuestions = this.listWrongQuestions(userId);
    const weakPointCandidates = report.weakPoints.length
      ? report.weakPoints.map((point) => ({
        knowledgePointId: point.knowledgePointId,
        title: point.title,
        subject: point.subject,
        accuracyRate: point.accuracyRate,
      }))
      : masteryMap.weakestPoints.map((point) => ({
        knowledgePointId: point.knowledgePointId,
        title: point.title,
        subject: point.subject,
        accuracyRate: point.accuracyRate,
      }));
    const selectedPoints = weakPointCandidates.slice(0, 3);
    const fallbackPoint = this.knowledgePoints[0];
    const resourcePoints = selectedPoints.length
      ? selectedPoints
      : [{
        knowledgePointId: fallbackPoint.id,
        title: fallbackPoint.title,
        subject: fallbackPoint.subject,
        accuracyRate: 70,
      }];
    const items = resourcePoints.flatMap((point, index) => {
      const wrongQuestion = wrongQuestions.find((item) => item.knowledgePointId === point.knowledgePointId);
      const knowledgePoint = this.knowledgePoints.find((item) => item.id === point.knowledgePointId);
      const title = knowledgePoint?.title ?? point.title;
      const subject = knowledgePoint?.subject ?? point.subject ?? '408';
      const chapter = knowledgePoint?.chapter ?? '高频章节';
      const baseMinutes = point.accuracyRate < 50 ? 18 : 12;

      return [
        {
          id: `resource-${point.knowledgePointId}-concept`,
          knowledgePointId: point.knowledgePointId,
          knowledgePointTitle: title,
          subject,
          resourceType: 'concept_card' as const,
          title: `${title} 核心概念卡`,
          summary: `先复述 ${chapter} 中 ${title} 的定义、适用条件和常见题干关键词。`,
          estimatedMinutes: baseMinutes,
          difficulty: index === 0 ? '基础' as const : '中等' as const,
          actionText: '看完后做一组同考点题',
          actionAnchor: '#question',
        },
        {
          id: `resource-${point.knowledgePointId}-mistake`,
          knowledgePointId: point.knowledgePointId,
          knowledgePointTitle: title,
          subject,
          resourceType: 'mistake_checklist' as const,
          title: `${title} 错因检查清单`,
          summary: wrongQuestion
            ? `该考点已有 ${wrongQuestion.wrongCount} 次错误，优先检查：${wrongQuestion.latestMistakeReason ?? '概念混淆'}。`
            : '按知识点没学过、概念混淆、公式记错、计算错误、审题错误、推理过程错误、时间不足、蒙题八类检查最近错因。',
          estimatedMinutes: 8,
          difficulty: '基础' as const,
          actionText: '去错题本复盘',
          actionAnchor: '#wrong-book',
        },
        {
          id: `resource-${point.knowledgePointId}-practice`,
          knowledgePointId: point.knowledgePointId,
          knowledgePointTitle: title,
          subject,
          resourceType: 'practice_set' as const,
          title: `${title} 专项验证训练`,
          summary: '完成 3 到 5 道同知识点题目，用正确率和耗时判断是否已经补上。',
          estimatedMinutes: 15,
          difficulty: point.accuracyRate < 60 ? '中等' as const : '提高' as const,
          actionText: '进入专项训练',
          actionAnchor: '#question',
        },
      ];
    }).slice(0, 6);

    return {
      source: this.dataSource,
      userId,
      generatedAt: new Date().toISOString(),
      weakPointCount: report.weakPoints.length,
      items,
    };

  }

  private async getRecommendedReviewResourcesFromState(userId: string): Promise<ReviewResourceRecommendation> {
    if (!this.recommendation) {
      return this.getRecommendedReviewResourcesLegacy(userId);
    }
    const { result, nodeById, accuracyRateByNode } = await this.recommendation.runRecommendationForUser(userId, { availableMinutes: 60 });
    const knowledgeItems = result.items.filter((item) => item.kind === 'KNOWLEDGE');
    const weakKnowledgeItems = knowledgeItems.filter((item) => item.facts.mastery < 0.45);
    const nodeIds = weakKnowledgeItems.map((item) => item.knowledgeNodeId);
    const kpIdsByNodeId = await this.getKpIdsByNodeId(nodeIds);

    const resourcePoints = weakKnowledgeItems.slice(0, 3).flatMap((item) => {
      const node = nodeById.get(item.knowledgeNodeId);
      const pointIds = kpIdsByNodeId[item.knowledgeNodeId] ?? [];
      return pointIds.map((knowledgePointId) => {
        const point = this.knowledgePoints.find((candidate) => candidate.id === knowledgePointId);
        const pointRecords = this.records.filter((record) => record.knowledgePointId === knowledgePointId);
        return {
          knowledgePointId,
          title: point?.title ?? node?.name ?? knowledgePointId,
          subject: point?.subject ?? node?.subject ?? '408',
          chapter: point?.chapter ?? '高频章节',
          accuracyRate: pointRecords.length
            ? Math.round(pointRecords.filter((record) => record.correct).length / pointRecords.length * 100)
            : 70,
        };
      });
    });
    const wrongQuestions = this.listWrongQuestions(userId).map((item) => ({
      knowledgePointId: item.knowledgePointId,
      wrongCount: item.wrongCount,
      latestMistakeReason: item.latestMistakeReason ?? null,
    }));
    const fallbackKp = this.knowledgePoints[0];
    return buildReviewResourcesDto({
      userId,
      source: 'postgresql',
      generatedAt: new Date().toISOString(),
      weakPointCount: weakKnowledgeItems.length,
      resourcePoints,
      wrongQuestions,
      fallbackPoint: fallbackKp ? { knowledgePointId: fallbackKp.id, title: fallbackKp.title, subject: fallbackKp.subject, chapter: fallbackKp.chapter, accuracyRate: 70 } : null,
    });
  }

  async submitPracticeSet(practiceSetId: string, input: {
    userId?: string;
    answers?: Array<{
      questionId: string;
      selectedAnswer: string;
      timeSpentSec: number;
    }>;
  }) {
    const userId = input.userId ?? this.student.id;
    const answers = input.answers ?? [];
    if (answers.length === 0) {
      throw new BadRequestException('Practice set answers are required');
    }

    const records = await Promise.all(answers.map((answer) => this.createPracticeRecord({
      userId,
      questionId: answer.questionId,
      knowledgePointId: '',
      selectedAnswer: answer.selectedAnswer,
      timeSpentSec: answer.timeSpentSec,
    })));
    return this.createPracticeSetResult(practiceSetId, userId, records);
  }

  private createPracticeSetResult(practiceSetId: string, userId: string, records: PracticeRecord[]) {
    const correctCount = records.filter((record) => record.correct).length;
    const accuracyRate = Math.round((correctCount / records.length) * 100);

    const result = {
      id: `practice-set-result-${Date.now()}`,
      practiceSetId,
      userId,
      submittedAt: new Date().toISOString(),
      totalQuestions: records.length,
      correctCount,
      accuracyRate,
      results: records.map((record) => {
        const question = this.questions.find((item) => item.id === record.questionId);
        return {
          questionId: record.questionId,
          stem: question?.stem ?? record.questionId,
          selectedAnswer: record.selectedAnswer,
          correctAnswer: question?.answer,
          correct: record.correct,
          mistakeReason: record.mistakeReason,
        };
      }),
      nextActions: [
        accuracyRate >= 80 ? '本组正确率较高，建议进入限时训练或真题套卷。' : '本组仍有失分，建议先复盘错题再重做同知识点题。',
        `已同步 ${records.length} 条练习记录，提分报告和错题本会自动更新。`,
      ],
    };

    this.practiceSetResults.push(result);
    return result;
  }

  async createPracticeRecord(
    input: CreatePracticeRecordDto & { userId: string; questionSnapshot?: Question },
    options: { idempotencyKey?: string } = {},
  ) {
    const attributedInput = { ...input, actionId: await this.resolvePracticeActionId(input.userId, input.sessionId) };
    const idempotencyKey = options.idempotencyKey?.trim();
    if (!idempotencyKey) return this.createPracticeRecordLegacy(attributedInput);
    if (idempotencyKey.length > 255) throw new BadRequestException('Idempotency-Key is too long');
    if (!this.prisma || !this.answerReceipts?.enabled) return this.createPracticeRecordLegacy(attributedInput);
    return this.createPracticeRecordWithReceipt(attributedInput, idempotencyKey);
  }

  private async resolvePracticeActionId(userId: string, sessionId?: string) {
    if (!sessionId) return null;
    const session = this.practiceSessions.get(sessionId);
    if (session?.userId === userId) return resolvePracticeActionId(session);
    const persisted = await this.learningSessionRepository.loadOne(sessionId, userId);
    return resolvePracticeActionId(persisted);
  }

  private async createPracticeRecordLegacy(input: CreatePracticeRecordDto & { userId: string; questionSnapshot?: Question }) {
    const questionSnapshot = input.questionSnapshot
      ?? await this.questionsService.findQuestionById(input.questionId)
      ?? undefined;
    const record = this.buildPracticeRecord({ ...input, questionSnapshot });
    const savedRecord = this.prisma
      ? await this.prisma.$transaction(async (tx) => {
          const saved = await this.practiceRecordRepository.save(record, tx);
          await this.scoreCenterService?.applyAttempts(input.userId, [saved], tx);
          return saved;
        })
      : await this.practiceRecordRepository.save(record);
    this.triggerActionFeedback(input.userId, savedRecord.actionId);
    if (this.prisma) await this.refreshNodeMasteryCache(input.userId);
    this.records.push(savedRecord);
    if (!savedRecord.correct) {
      await this.ensureReviewSchedule(savedRecord);
    }
    await this.applyPracticeProgressToTasks(input.userId, savedRecord);
    await this.trackUserEvent(input.userId, 'practice.submit', {
      questionId: savedRecord.questionId,
      correct: savedRecord.correct,
    });
    const variantProgress = input.variantQuestionId
      ? await this.applyVariantRetest(savedRecord, input.variantQuestionId)
      : null;
    return variantProgress ? { ...savedRecord, variantProgress } : savedRecord;
  }

  private async createPracticeRecordWithReceipt(
    input: CreatePracticeRecordDto & { userId: string; questionSnapshot?: Question },
    idempotencyKey: string,
  ): Promise<PracticeRecord & Record<string, unknown>> {
    const requestHash = computePracticeRecordRequestHash(input);
    const existing = await this.answerReceipts!.findByKey(input.userId, idempotencyKey);
    if (existing) return this.resolveExistingAnswerReceipt(existing, input, idempotencyKey, requestHash);

    let receipt: AnswerReceiptState;
    try {
      receipt = await this.answerReceipts!.createPending({
        userId: input.userId,
        idempotencyKey,
        requestHash,
        hashVersion: PRACTICE_RECORD_HASH_VERSION,
      });
    } catch (error) {
      if (!isPrismaUniqueError(error)) throw error;
      const raced = await this.answerReceipts!.findByKey(input.userId, idempotencyKey);
      if (raced) return this.resolveExistingAnswerReceipt(raced, input, idempotencyKey, requestHash);
      throw error;
    }

    let result: {
      response: PracticeRecord & Record<string, unknown>;
      savedRecord: PracticeRecord;
      reviewSchedule: ReviewSchedule | null;
    };
    try {
      result = await this.prisma!.$transaction(async (tx) => {
        const questionSnapshot = input.questionSnapshot
          ?? await this.questionsService.findQuestionById(input.questionId)
          ?? undefined;
        const record = this.buildPracticeRecord({ ...input, questionSnapshot });
        const savedRecord = await this.practiceRecordRepository.save(record, tx);
        await this.scoreCenterService?.applyAttempts(input.userId, [savedRecord], tx);
        const reviewSchedule = !savedRecord.correct
          ? await this.persistReviewScheduleForWrongRecord(savedRecord, tx)
          : null;
        const variantProgress = input.variantQuestionId
          ? await this.applyVariantRetest(savedRecord, input.variantQuestionId, tx)
          : null;
        const response = await this.buildPracticeRecordResponse(savedRecord, variantProgress);
        const responseSnapshot = toJsonSnapshot(response);
        await this.answerReceipts!.markSucceeded(tx, {
          id: receipt.id,
          responseSnapshot,
          practiceRecordIds: [savedRecord.id],
        });
        return { response: responseSnapshot as PracticeRecord & Record<string, unknown>, savedRecord, reviewSchedule };
      });
    } catch (error) {
      await this.markAnswerReceiptFailed(receipt, error);
      throw error;
    }

    this.triggerActionFeedback(input.userId, result.savedRecord.actionId);
    if (this.prisma) await this.refreshNodeMasteryCache(input.userId);
    this.records.push(result.savedRecord);
    if (result.reviewSchedule) this.commitReviewScheduleMemory(result.reviewSchedule);
    await this.applyPracticeProgressToTasks(input.userId, result.savedRecord);
    await this.trackUserEvent(input.userId, 'practice.submit', {
      questionId: result.savedRecord.questionId,
      correct: result.savedRecord.correct,
    });
    return result.response;
  }

  private async resolveExistingAnswerReceipt(
    receipt: AnswerReceiptState,
    input: CreatePracticeRecordDto & { userId: string; questionSnapshot?: Question },
    idempotencyKey: string,
    requestHash: string,
  ): Promise<PracticeRecord & Record<string, unknown>> {
    if (receipt.requestHash !== requestHash) {
      throw new ConflictException('Idempotency-Key was already used with a different request');
    }
    if (receipt.status === 'SUCCEEDED') return receipt.responseSnapshot as PracticeRecord & Record<string, unknown>;
    if (receipt.status === 'FAILED') {
      throw replayFailedReceipt(receipt.responseSnapshot);
    }
    const now = new Date();
    if (receipt.updatedAt.getTime() > now.getTime() - ANSWER_RECEIPT_STALE_MS) {
      throw new HttpException('Answer submission is still being processed', 425);
    }
    const taken = await this.answerReceipts!.takeOverPending({
      userId: input.userId,
      idempotencyKey,
      requestHash,
      staleBefore: new Date(now.getTime() - ANSWER_RECEIPT_STALE_MS),
      updatedAt: now,
    });
    if (!taken) {
      const refreshed = await this.answerReceipts!.findByKey(input.userId, idempotencyKey);
      if (refreshed) return this.resolveExistingAnswerReceipt(refreshed, input, idempotencyKey, requestHash);
      throw new HttpException('Answer submission is still being processed', 425);
    }
    return this.createPracticeRecordFromExistingPending(input, receipt);
  }

  private async createPracticeRecordFromExistingPending(
    input: CreatePracticeRecordDto & { userId: string; questionSnapshot?: Question },
    receipt: AnswerReceiptState,
  ): Promise<PracticeRecord & Record<string, unknown>> {
    let result: {
      response: PracticeRecord & Record<string, unknown>;
      savedRecord: PracticeRecord;
      reviewSchedule: ReviewSchedule | null;
    };
    try {
      result = await this.prisma!.$transaction(async (tx) => {
        const questionSnapshot = input.questionSnapshot
          ?? await this.questionsService.findQuestionById(input.questionId)
          ?? undefined;
        const record = this.buildPracticeRecord({ ...input, questionSnapshot });
        const savedRecord = await this.practiceRecordRepository.save(record, tx);
        await this.scoreCenterService?.applyAttempts(input.userId, [savedRecord], tx);
        const reviewSchedule = !savedRecord.correct
          ? await this.persistReviewScheduleForWrongRecord(savedRecord, tx)
          : null;
        const variantProgress = input.variantQuestionId
          ? await this.applyVariantRetest(savedRecord, input.variantQuestionId, tx)
          : null;
        const response = await this.buildPracticeRecordResponse(savedRecord, variantProgress);
        const responseSnapshot = toJsonSnapshot(response);
        await this.answerReceipts!.markSucceeded(tx, {
          id: receipt.id,
          responseSnapshot,
          practiceRecordIds: [savedRecord.id],
        });
        return { response: responseSnapshot as PracticeRecord & Record<string, unknown>, savedRecord, reviewSchedule };
      });
    } catch (error) {
      await this.markAnswerReceiptFailed(receipt, error);
      throw error;
    }

    this.triggerActionFeedback(input.userId, result.savedRecord.actionId);
    if (this.prisma) await this.refreshNodeMasteryCache(input.userId);
    this.records.push(result.savedRecord);
    if (result.reviewSchedule) this.commitReviewScheduleMemory(result.reviewSchedule);
    await this.applyPracticeProgressToTasks(input.userId, result.savedRecord);
    await this.trackUserEvent(input.userId, 'practice.submit', {
      questionId: result.savedRecord.questionId,
      correct: result.savedRecord.correct,
    });
    return result.response;
  }

  async getPracticeFeedback(questionId: string) {
    const question = await this.questionsService.findQuestionById(questionId);
    if (!question) {
      return { analysis: '', correctAnswer: '', knowledgePointTitle: '' };
    }
    const knowledgePointId = question.knowledgePointIds[0];
    const knowledgePoint = knowledgePointId
      ? this.knowledgePoints.find((point) => point.id === knowledgePointId)
      : undefined;
    const display = knowledgePointId
      ? resolveKnowledgePointDisplay(
          { id: knowledgePointId, title: knowledgePoint?.title ?? '', chapter: knowledgePoint?.chapter ?? '' },
          this.knowledgePointDisplay,
        )
      : null;
    return {
      analysis: question.analysis,
      correctAnswer: question.answer,
      knowledgePointTitle: display?.title || knowledgePoint?.title || '',
    };
  }

  private async buildPracticeRecordResponse(record: PracticeRecord, variantProgress: unknown) {
    const feedback = await this.getPracticeFeedback(record.questionId);
    return variantProgress
      ? {
          ...record,
          analysis: feedback.analysis,
          correctAnswer: feedback.correctAnswer,
          knowledgePointTitle: feedback.knowledgePointTitle,
          variantProgress,
        }
      : {
          ...record,
          analysis: feedback.analysis,
          correctAnswer: feedback.correctAnswer,
          knowledgePointTitle: feedback.knowledgePointTitle,
        };
  }

  private async markAnswerReceiptFailed(receipt: AnswerReceiptState, error: unknown) {
    try {
      await this.answerReceipts?.markFailed({
        id: receipt.id,
        responseSnapshot: serializeFailure(error),
      });
    } catch (receiptError) {
      this.logger.warn(
        `Answer receipt ${receipt.id} failed-state update failed`,
        receiptError instanceof Error ? receiptError.message : String(receiptError),
      );
    }
  }

  private buildPracticeRecord(input: CreatePracticeRecordDto & { userId: string; questionSnapshot?: Question; actionId?: string | null }): PracticeRecord {
    const question = input.questionSnapshot ?? this.questions.find((item) => item.id === input.questionId);
    if (!question) {
      throw new BadRequestException(`Question ${input.questionId} was not found`);
    }

    const expectedTimeSec = input.expectedTimeSec ?? question.expectedTimeSec;
    const isSubjective = question.type === '综合题';
    if (isSubjective && (input.selfScore === undefined || input.maxScore === undefined || input.selfScore > input.maxScore)) {
      throw new BadRequestException('Comprehensive questions require a valid self score and maximum score');
    }
    const correct = isSubjective
      ? (input.selfScore ?? 0) / (input.maxScore ?? 1) >= 0.6
      : input.selectedAnswer === question.answer;
    const mistakeReason = classifyMistake({
      correct,
      selectedAnswer: input.selectedAnswer,
      correctAnswer: question.answer,
      timeSpentSec: input.timeSpentSec,
      expectedTimeSec,
      confidence: input.confidence,
      usedHint: input.usedHint,
    });

    return {
      id: `r-${randomUUID()}`,
      userId: input.userId,
      questionId: input.questionId,
      knowledgePointId: question.knowledgePointIds[0] ?? input.knowledgePointId,
      selectedAnswer: input.selectedAnswer,
      correct,
      timeSpentSec: input.timeSpentSec,
      expectedTimeSec,
      mistakeReason,
      submittedAt: new Date().toISOString(),
      sessionId: input.sessionId,
      actionId: input.actionId ?? null,
      gradingMode: isSubjective ? 'self_assessed' : 'objective',
      selfScore: input.selfScore,
      maxScore: input.maxScore,
      confidence: input.confidence,
      usedHint: input.usedHint,
      answerModified: input.answerModified,
      variantQuestionId: input.variantQuestionId,
      knowledgePointIds: [...question.knowledgePointIds],
    };
  }

  private async applyVariantRetest(record: PracticeRecord, originalQuestionId: string, tx?: Prisma.TransactionClient) {
    if (originalQuestionId === record.questionId) return null;
    const key = scheduleKey(record.userId, originalQuestionId);
    const existing = this.reviewSchedules.get(key);
    if (!existing) return null;

    const now = new Date();
    const consecutiveCorrect = record.correct ? existing.consecutiveCorrect + 1 : 0;
    const stability: ReviewSchedule['stability'] =
      consecutiveCorrect >= 3 ? 'mastered'
      : consecutiveCorrect >= 1 ? 'review'
      : 'learning';
    const slowReview = record.correct && record.timeSpentSec > record.expectedTimeSec * 1.45;
    const nextIntervalDays = nextReviewIntervalDays({ consecutiveCorrect, slowReview });
    const nextReviewAt = new Date(now.getTime() + nextIntervalDays * 86_400_000).toISOString();

    const schedule: ReviewSchedule = {
      ...existing,
      redoCorrect: record.correct,
      timeSpentSec: record.timeSpentSec,
      consecutiveCorrect,
      stability,
      nextReviewAt,
      reviewCount: existing.reviewCount + 1,
      lastReviewedAt: now.toISOString(),
    };
    this.reviewSchedules.set(key, schedule);
    const attempt: ReviewAttemptState = {
      redoCorrect: record.correct,
      timeSpentSec: record.timeSpentSec,
      inferredReason: '变式题复测',
      nextIntervalDays,
      reviewedAt: now.toISOString(),
    };
    const attempts = this.reviewAttemptsByKey.get(key) ?? [];
    attempts.push(attempt);
    this.reviewAttemptsByKey.set(key, attempts);
    await this.reviewScheduleRepository.saveReview(schedule, attempt, tx);

    const reviewed = this.wrongQuestionReviewDatesByUser.get(record.userId) ?? new Map<string, string>();
    reviewed.set(originalQuestionId, now.toISOString());
    this.wrongQuestionReviewDatesByUser.set(record.userId, reviewed);
    await this.learningProgressRepository.saveWrongQuestionReview(record.userId, originalQuestionId, now.toISOString(), tx);
    const db = tx ?? this.prisma;
    if (stability === 'mastered' && db) {
      await resolveWrongQuestion(db, record.userId, originalQuestionId, now);
    }

    return {
      originalQuestionId,
      consecutiveCorrect,
      stability,
      nextReviewInDays: nextIntervalDays,
      message: record.correct
        ? stability === 'mastered'
          ? '变式题连续答对 3 次，已标记为已掌握。'
          : `变式题答对，连续正确 ${consecutiveCorrect} 次。`
        : '变式题仍答错，原错题连续正确已清零，建议先回顾解析。',
    };
  }

  private getMasteryState(userId: string, questionId: string) {
    const schedule = this.reviewSchedules.get(scheduleKey(userId, questionId));
    const stability = schedule?.stability ?? 'learning';
    const consecutiveCorrect = schedule?.consecutiveCorrect ?? 0;
    const variantCorrectCount = this.records.filter(
      (record) => record.userId === userId && record.variantQuestionId === questionId && record.correct,
    ).length;
    return {
      masteryStatus: deriveMasteryStatus({ stability, consecutiveCorrect }),
      masteryCriteria: { stability, consecutiveCorrect, variantCorrectCount },
    };
  }

  private buildReviewScheduleForWrongRecord(record: PracticeRecord): ReviewSchedule {
    const key = scheduleKey(record.userId, record.questionId);
    const existing = this.reviewSchedules.get(key);
    const nextReviewAt = new Date();
    nextReviewAt.setUTCDate(nextReviewAt.getUTCDate() + 1);
    return {
      questionId: record.questionId,
      userId: record.userId,
      inferredReason: record.mistakeReason ?? '待归因',
      note: existing?.note,
      lastWrongRecordId: record.id,
      redoCorrect: false,
      timeSpentSec: record.timeSpentSec,
      consecutiveCorrect: 0,
      stability: 'learning',
      nextReviewAt: nextReviewAt.toISOString(),
      reviewCount: existing?.reviewCount ?? 0,
      lastReviewedAt: existing?.lastReviewedAt,
    };
  }

  private commitReviewScheduleMemory(schedule: ReviewSchedule) {
    const key = scheduleKey(schedule.userId, schedule.questionId);
    this.reviewSchedules.set(key, schedule);
    if (!this.reviewAttemptsByKey.has(key)) this.reviewAttemptsByKey.set(key, []);
  }

  private async persistReviewScheduleForWrongRecord(record: PracticeRecord, tx: Prisma.TransactionClient) {
    const schedule = this.buildReviewScheduleForWrongRecord(record);
    await this.reviewScheduleRepository.saveSchedule(schedule, tx);
    return schedule;
  }

  private async ensureReviewSchedule(record: PracticeRecord) {
    const schedule = this.buildReviewScheduleForWrongRecord(record);
    this.commitReviewScheduleMemory(schedule);
    await this.reviewScheduleRepository.saveSchedule(schedule);
  }

  async completeStudyTask(taskId: string, input: {
    userId?: string;
    completedQuestionCount?: number;
    correctCount?: number;
    minutesSpent?: number;
    selfRating?: number;
  } = {}) {
    const userId = input.userId ?? this.student.id;
    return this.withPlanMutation(userId, () => this.completeStudyTaskUnlocked(taskId, input, userId));
  }

  private async completeStudyTaskUnlocked(taskId: string, input: {
    userId?: string;
    completedQuestionCount?: number;
    correctCount?: number;
    minutesSpent?: number;
    selfRating?: number;
  }, userId: string) {
    const plan = this.generatePlan(userId);
    const scheduledTask = this.findScheduledTask(userId, taskId);
    const task = scheduledTask ?? plan.dailyTasks.find((item) => item.id === taskId);
    if (!task) {
      const scoreCenterCompleted = await this.scoreCenterService?.completeTask(taskId, userId, input);
      if (scoreCenterCompleted) {
        // V12-M1 (EB-1): recommendation-generated tasks complete through this
        // branch, so evidence must be recorded here too — otherwise the very
        // tasks the engine chose would remain evidence-free.
        await this.recordLearningEvidence('task.completed.score-center', () =>
          this.learningEvidence!.recordTaskCompletionEvidence(userId, {
            taskId,
            completedDate: todayKey(),
            completedAt: new Date().toISOString(),
            completedQuestionCount: input.completedQuestionCount ?? null,
            correctCount: input.correctCount ?? null,
            minutesSpent: input.minutesSpent ?? null,
            selfRating: input.selfRating ?? null,
          }),
        );
        await this.triggerLearningLoop(userId, {
          triggerType: 'task.complete', sourceId: taskId,
        });
        return scoreCenterCompleted;
      }
      throw new BadRequestException(`Study task ${taskId} was not found`);
    }
    if (scheduledTask?.status === 'completed') {
      throw new BadRequestException(`Study task ${taskId} has already been completed`);
    }
    validateTaskCompletionInput(input, Boolean(scheduledTask));

    const completed = this.completedTaskDatesByUser.get(userId) ?? new Map<string, string>();
    const completedAt = new Date().toISOString();
    const completedDate = todayKey();
    await this.learningProgressRepository.saveTaskCompletion({
      userId,
      taskId,
      completedAt,
      completedDate,
      completedQuestionCount: input.completedQuestionCount,
      correctCount: input.correctCount,
      minutesSpent: input.minutesSpent,
      selfRating: input.selfRating,
    });
    completed.set(taskCompletionKey(taskId, completedDate), completedDate);
    this.completedTaskDatesByUser.set(userId, completed);
    this.startedTasks.delete(`${userId}@${taskId}`);
    const taskMetrics = this.taskCompletionMetricsByUser.get(userId) ?? new Map<string, TaskCompletionMetric>();
    taskMetrics.set(taskId, {
      completedQuestionCount: input.completedQuestionCount ?? task.questionCount,
      correctCount: input.correctCount ?? Math.round((input.completedQuestionCount ?? task.questionCount) * 0.75),
      minutesSpent: input.minutesSpent ?? task.minutes,
      selfRating: input.selfRating ?? 3,
      completedAt,
    });
    this.taskCompletionMetricsByUser.set(userId, taskMetrics);
    await this.trackUserEvent(userId, 'task.complete', {
      taskId,
      scheduledDate: (task as { scheduledDate?: string }).scheduledDate,
    });
    // V12-M1 (EB-1): the completion marker alone is activity, not evidence. We
    // persist whatever the student actually reported — never a synthesised
    // accuracy — so the evidence layer can stay honest about its strength.
    await this.recordLearningEvidence('task.completed', () =>
      this.learningEvidence!.recordTaskCompletionEvidence(userId, {
        taskId,
        completedDate,
        completedAt,
        completedQuestionCount: input.completedQuestionCount ?? null,
        correctCount: input.correctCount ?? null,
        minutesSpent: input.minutesSpent ?? null,
        selfRating: input.selfRating ?? null,
      }),
    );
    const adjustment = this.createTaskCompletionAdjustment(task, {
      completedQuestionCount: input.completedQuestionCount,
      correctCount: input.correctCount,
      minutesSpent: input.minutesSpent,
      selfRating: input.selfRating,
    });

    let nextDayAdjustment: { taskId: string; scheduledDate: string; questionCount: number; mode: string } | null = null;
    if (scheduledTask) {
      if (this.onboardingPlanRepository.enabled) {
        const persisted = await this.onboardingPlanRepository.completeTask(userId, taskId, completedAt, {
          questionCount: adjustment.tomorrowQuestionTarget,
          intensity: adjustment.intensity,
          reason: adjustment.reasons.join(' '),
          nextAction: adjustment.nextActions[0],
        });
        if (!persisted) throw new BadRequestException(`Study task ${taskId} was not found`);
        Object.assign(scheduledTask, persisted.task);
        const cachedFuture = persisted.futureTask
          ? this.findScheduledTask(userId, persisted.futureTask.id)
          : undefined;
        if (cachedFuture && persisted.futureTask) Object.assign(cachedFuture, persisted.futureTask);
        if (persisted.futureTask) {
          nextDayAdjustment = {
            taskId: persisted.futureTask.id,
            scheduledDate: persisted.futureTask.scheduledDate,
            questionCount: persisted.futureTask.questionCount,
            mode: persisted.futureTask.mode,
          };
        }
      } else {
        scheduledTask.status = 'completed';
        scheduledTask.completedAt = completedAt;
        scheduledTask.nextAvailableAt = undefined;
        const futureTask = this.sevenDayPlansByUser.get(userId)?.tasks
          .filter((item) =>
            item.knowledgePointId === task.knowledgePointId
            && item.scheduledDate > scheduledTask.scheduledDate
            && item.status !== 'completed'
            && item.mode !== '考后复盘'
            && !item.id.startsWith('exam-review-'),
          )
          .sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate))[0];
        if (!futureTask) {
          nextDayAdjustment = null;
        } else {
          futureTask.questionCount = adjustment.tomorrowQuestionTarget;
          futureTask.mode = adjustment.intensity === 'increase' ? '进阶训练' : adjustment.intensity === 'decrease' ? '概念复盘' : futureTask.mode;
          futureTask.reason = adjustment.reasons.join(' ');
          futureTask.nextAction = adjustment.nextActions[0];
          nextDayAdjustment = {
            taskId: futureTask.id,
            scheduledDate: futureTask.scheduledDate,
            questionCount: futureTask.questionCount,
            mode: futureTask.mode,
          };
        }
      }
    }

    await this.triggerLearningLoop(userId, {
      triggerType: 'task.complete',
      sourceId: taskId,
      scheduledDate: (task as { scheduledDate?: string }).scheduledDate,
    });

    return {
      ...task,
      completed: true,
      status: 'completed',
      adjustment,
      nextDayAdjustment,
      weekProgress: this.sevenDayPlansByUser.get(userId)
        ? this.getSevenDayPlanSummary(this.sevenDayPlansByUser.get(userId)!).days
        : [],
      feedback: {
        message: `已完成 ${task.title}，今日计划进度已更新。`,
        nextAction: task.nextAction,
      },
    };
  }

  getLearningCalendar(userId = this.student.id) {
    const dates = lastNDates(7);
    const completedTaskDates = this.completedTaskDatesByUser.get(userId) ?? new Map<string, string>();
    const completedTaskCounts = countByDate([...completedTaskDates.values()]);
    const practiceCounts = countByDate(
      this.records
        .filter((record) => record.userId === userId)
        .map((record) => record.submittedAt),
    );

    const days = dates.map((date) => {
      const completedTaskCount = completedTaskCounts.get(date) ?? 0;
      const practiceCount = practiceCounts.get(date) ?? 0;

      return {
        date,
        completedTaskCount,
        practiceCount,
        isActive: completedTaskCount + practiceCount > 0,
      };
    });

    let streakDays = 0;
    for (const day of [...days].reverse()) {
      if (!day.isActive) break;
      streakDays += 1;
    }

    return {
      days,
      today: days[days.length - 1],
      streakDays,
    };
  }

  getStageAssessment(userId = this.student.id) {
    const report = this.getOverviewReport(userId);
    const student = this.getStudent(userId);
    const focusKnowledgePointIds = new Set(
      (report.weakPoints.length ? report.weakPoints : report.speedRisks)
        .map((point) => point.knowledgePointId),
    );
    const focusQuestions = this.questions.filter((question) =>
      question.knowledgePointIds.some((id) => focusKnowledgePointIds.has(id)),
    );
    const fallbackQuestions = this.questions.filter((question) => !focusQuestions.includes(question));
    const questionLimit = this.systemConfig.recommendation.stageAssessmentQuestionLimit;
    const selectedQuestions = [...focusQuestions, ...fallbackQuestions].slice(0, Math.min(questionLimit, this.questions.length));
    const focusKnowledgePoints = [...new Set(selectedQuestions.flatMap((question) => question.knowledgePointIds))]
      .map((id) => this.knowledgePoints.find((point) => point.id === id))
      .filter(Boolean);

    return {
      id: `stage-${todayKey()}`,
      title: `${student.stage ?? '强化'}阶段测评`,
      userId,
      description: '根据当前薄弱点生成的小测，用于判断本阶段是否需要继续专项突破。',
      estimatedMinutes: Math.max(10, Math.round(selectedQuestions.reduce((sum, question) => sum + question.expectedTimeSec, 0) / 60)),
      focusKnowledgePoints,
      questions: toStudentQuestions(selectedQuestions),
    };
  }

  async submitStageAssessment(input: {
    userId?: string;
    answers?: Array<{
      questionId: string;
      selectedAnswer: string;
      timeSpentSec: number;
    }>;
  }) {
    const userId = input.userId ?? this.student.id;
    const answers = input.answers ?? [];
    if (answers.length === 0) {
      throw new BadRequestException('Stage assessment answers are required');
    }

    const records = await Promise.all(answers.map((answer) => this.createPracticeRecord({
      userId,
      questionId: answer.questionId,
      knowledgePointId: '',
      selectedAnswer: answer.selectedAnswer,
      timeSpentSec: answer.timeSpentSec,
    })));
    const result = await this.createStageAssessmentResult(userId, records);
    await this.triggerLearningLoop(userId, {
      triggerType: 'stage_assessment',
      sourceId: result.id,
    });
    return result;
  }

  private async createStageAssessmentResult(userId: string, records: PracticeRecord[]) {
    const correctCount = records.filter((record) => record.correct).length;
    const score = Math.round((correctCount / records.length) * 100);
    const reviewItems = records
      .filter((record) => !record.correct || record.mistakeReason !== null)
      .map((record) => {
        const question = this.questions.find((item) => item.id === record.questionId);
        const point = this.knowledgePoints.find((item) => item.id === record.knowledgePointId);
        return {
          questionId: record.questionId,
          stem: question?.stem ?? record.questionId,
          selectedAnswer: record.selectedAnswer,
          correctAnswer: question?.answer,
          knowledgePointId: record.knowledgePointId,
          knowledgePointTitle: point?.title ?? record.knowledgePointId,
          mistakeReason: record.mistakeReason,
          analysis: question?.analysis,
        };
      });
    const weakPointTitles = [...new Set(reviewItems.map((item) => item.knowledgePointTitle))].slice(0, 3);
    const adjustment = await this.applyStageAssessmentAdjustment(userId, score, weakPointTitles);

    const result = {
      id: `stage-result-${Date.now()}`,
      userId,
      submittedAt: new Date().toISOString(),
      totalQuestions: records.length,
      correctCount,
      score,
      adjustment,
      reviewItems,
      nextActions: [
        adjustment.message,
        score >= 80 ? '进入真题限时训练，保持每 2-3 天一次阶段复测。' : '先复盘本次错题，再补 1 组同知识点专项练习。',
        weakPointTitles.length ? `优先复习：${weakPointTitles.join('、')}` : '本次正确率较好，建议增加限时速度训练。',
      ],
    };

    this.stageAssessmentResults.push(result);
    return result;
  }

  private async applyStageAssessmentAdjustment(userId: string, score: number, weakPointTitles: string[]) {
    const student = this.getStudent(userId);
    const previousStage = student.stage ?? '强化';
    const nextStage: StudyStage = score < 60 ? '基础' : score >= 80 ? '冲刺' : '强化';
    const profile = this.diagnosticProfilesByUser.get(userId);
    if (profile) {
      const remainingDays = score < 60
        ? Math.max(profile.remainingDays + 7, 14)
        : score >= 80
          ? Math.max(profile.remainingDays - 3, 1)
          : profile.remainingDays;
      const updatedProfile = { ...profile, stage: nextStage, remainingDays };
      await this.learningProfileRepository.save(userId, updatedProfile);
      this.diagnosticProfilesByUser.set(userId, updatedProfile);
    }

    const adjustedPlan = this.generatePlan(userId);

    return {
      previousStage,
      stage: nextStage,
      planPhase: adjustedPlan.phase,
      scoreBand: score < 60 ? 'needs_foundation' : score >= 80 ? 'ready_for_sprint' : 'continue_strengthening',
      message: score < 60
        ? `阶段测评低于 60 分，系统已延长基础补强，并优先安排 ${weakPointTitles[0] ?? '薄弱章节'}。`
        : score >= 80
          ? '阶段测评达到 80 分以上，系统已切换到冲刺训练，增加真题和限时任务。'
          : '阶段测评处于强化区间，系统会继续安排专项突破和错题回炉。',
    };
  }

  async createTutorReply(input: {
    userId?: string;
    questionId: string;
    selectedAnswer?: string;
    prompt?: string;
  }) {
    const question = this.questions.find((item) => item.id === input.questionId);
    if (!question) {
      throw new BadRequestException(`Question ${input.questionId} was not found`);
    }

    const knowledgePoint = this.knowledgePoints.find((point) => point.id === question.knowledgePointIds[0]);
    const selectedAnswer = input.selectedAnswer?.trim().toUpperCase();
    const similarQuestions = this.collectSimilarQuestions(question);
    const evidenceSummary = this.buildEvidenceSummary(question, knowledgePoint, input.userId ?? this.student.id);
    const context = this.buildTutorContext(input, question, knowledgePoint, selectedAnswer, evidenceSummary);

    if (!this.aiTutorService.configured) {
      return this.assembleTutorReply(
        input, question, knowledgePoint,
        buildTemplateTutorReply(context, similarQuestions), 'standard-analysis-assisted',
      );
    }

    let draft: AiTutorReplyDraft;
    let source: string;
    try {
      const result = await this.aiTutorService.explain(context, similarQuestions);
      draft = result.draft;
      source = result.source;
    } catch (error) {
      this.logger.warn(`AI tutor reply failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException('AI 助教暂时不可用，请稍后重试，或先查看标准解析。');
    }

    return this.assembleTutorReply(input, question, knowledgePoint, draft, source);
  }

  async createAiFollowUp(input: {
    userId?: string;
    questionId: string;
    message?: string;
    mode?: AiTutorFollowUpMode;
  }) {
    const question = this.questions.find((item) => item.id === input.questionId);
    if (!question) {
      throw new BadRequestException(`Question ${input.questionId} was not found`);
    }

    const knowledgePoint = this.knowledgePoints.find((point) => point.id === question.knowledgePointIds[0]);
    const evidenceSummary = this.buildEvidenceSummary(question, knowledgePoint, input.userId ?? this.student.id);
    const context = this.buildTutorContext(input, question, knowledgePoint, undefined, evidenceSummary);
    const message = input.message?.trim() || '请解释这道题并整理复习卡片。';

    if (!this.aiTutorService.configured) {
      return this.assembleFollowUp(
        input, question, knowledgePoint, message,
        buildTemplateFollowUp(context, message), 'standard-analysis-follow-up',
      );
    }

    let draft: AiFollowUpDraft;
    let source: string;
    try {
      const result = await this.aiTutorService.followUp(context, message, input.mode);
      draft = result.draft;
      source = result.source;
    } catch (error) {
      this.logger.warn(`AI follow-up failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException('AI 追问暂时不可用，请稍后重试，或先查看标准解析。');
    }

    return this.assembleFollowUp(input, question, knowledgePoint, message, draft, source);
  }

  private collectSimilarQuestions(question: Question): AiTutorSimilarQuestion[] {
    const knowledgePoint = this.knowledgePoints.find((point) => point.id === question.knowledgePointIds[0]);
    const similarQuestions = this.questions
      .filter((item) => item.id !== question.id)
      .filter((item) => item.knowledgePointIds.some((id) => question.knowledgePointIds.includes(id)))
      .slice(0, 3);
    const fallbackSimilarQuestions = this.questions
      .filter((item) => item.id !== question.id && !similarQuestions.includes(item))
      .filter((item) => item.knowledgePointIds.some((id) => {
        const point = this.knowledgePoints.find((candidate) => candidate.id === id);
        return point?.subject === knowledgePoint?.subject;
      }))
      .slice(0, Math.max(0, 3 - similarQuestions.length));
    const broadSimilarQuestions = this.questions
      .filter((item) => item.id !== question.id && !similarQuestions.includes(item) && !fallbackSimilarQuestions.includes(item))
      .slice(0, Math.max(0, 3 - similarQuestions.length - fallbackSimilarQuestions.length));
    return [...similarQuestions, ...fallbackSimilarQuestions, ...broadSimilarQuestions].map((item) => ({
      id: item.id,
      stem: item.stem,
      difficulty: item.difficulty,
      source: item.source,
    }));
  }

  private buildEvidenceSummary(
    question: Question,
    knowledgePoint: KnowledgePoint | undefined,
    userId: string,
  ): KnowledgeEvidenceSummary | null {
    if (!knowledgePoint) return null;
    const pointRecords = this.records.filter(
      (record) => record.userId === userId && record.knowledgePointId === knowledgePoint.id,
    );
    const correctCount = pointRecords.filter((record) => record.correct).length;
    const wrongCount = pointRecords.length - correctCount;
    const masteryRate = pointRecords.length
      ? Math.min(1, correctCount / pointRecords.length)
      : 0;
    const status: 'untouched' | 'weak' | 'review' | 'mastered' = pointRecords.length === 0
      ? 'untouched'
      : masteryRate >= 0.8 && wrongCount === 0
        ? 'mastered'
        : masteryRate >= 0.6
          ? 'review'
          : 'weak';
    const relatedQuestions = this.questions
      .filter((item) => item.id !== question.id)
      .filter((item) => item.knowledgePointIds.includes(knowledgePoint.id))
      .slice(0, 6);
    const prerequisites = knowledgePoint.prerequisites ?? [];
    return buildKnowledgeEvidenceSummary({
      point: {
        id: knowledgePoint.id,
        name: knowledgePoint.title,
        importance: knowledgePoint.importance,
        difficulty: knowledgePoint.importance,
        evidence: null,
      },
      mastery: {
        status,
        mastery: masteryRate,
        accuracy: masteryRate,
        attempts: pointRecords.length,
        correctCount,
        wrongCount,
        nextReviewAt: null,
      },
      examQuestions: [],
      relatedQuestionsCount: relatedQuestions.length,
      prerequisiteCount: prerequisites.length,
      relatedCount: 0,
    });
  }

  private buildTutorContext(
    input: { userId?: string; questionId: string; prompt?: string },
    question: Question,
    knowledgePoint: KnowledgePoint | undefined,
    selectedAnswer: string | undefined,
    evidenceSummary?: KnowledgeEvidenceSummary | null,
  ): AiTutorContext {
    const userId = input.userId ?? this.student.id;
    const knowledgePointId = knowledgePoint?.id ?? question.knowledgePointIds[0];
    const recentWrongQuestions = this.records
      .filter((record) => record.userId === userId && !record.correct && record.knowledgePointId === knowledgePointId)
      .slice(-5)
      .reverse()
      .map((record) => {
        const related = this.questions.find((item) => item.id === record.questionId);
        return {
          stem: related?.stem ?? '（题目已不可用）',
          knowledgePointTitle: knowledgePoint?.title ?? knowledgePointId,
          mistakeReason: record.mistakeReason,
        };
      });
    return {
      userId,
      questionId: question.id,
      stem: question.stem,
      options: question.options ?? [],
      answer: question.answer,
      analysis: question.analysis,
      knowledgePointTitle: knowledgePoint?.title ?? knowledgePointId ?? '408 高频考点',
      subject: knowledgePoint?.subject ?? '408',
      chapter: knowledgePoint?.chapter ?? '高频章节',
      selectedAnswer,
      mistakeReason: null,
      recentWrongQuestions,
      evidenceSummary: evidenceSummary ?? null,
      prompt: input.prompt,
    };
  }

  private assembleTutorReply(
    input: { userId?: string; questionId: string; prompt?: string },
    question: Question,
    knowledgePoint: KnowledgePoint | undefined,
    draft: AiTutorReplyDraft,
    source: string,
  ) {
    const reply = {
      id: `tutor-${Date.now()}`,
      userId: input.userId ?? this.student.id,
      questionId: question.id,
      prompt: input.prompt,
      knowledgePointId: knowledgePoint?.id ?? question.knowledgePointIds[0],
      knowledgePointTitle: knowledgePoint?.title ?? question.knowledgePointIds[0] ?? '408 高频考点',
      answerCheck: draft.answerCheck,
      explanationSteps: draft.explanationSteps,
      hintLayers: draft.hintLayers,
      similarQuestions: draft.similarQuestions,
      nextActions: draft.nextActions,
      source,
    };
    this.aiReviewItems.push({
      id: `review-ai-${reply.id}`,
      contentType: 'ai_reply',
      relatedId: reply.id,
      title: `${reply.knowledgePointTitle} 答疑解析`,
      summary: `AI 生成内容需审核：${reply.answerCheck}`,
      status: 'pending',
      riskLevel: 'low',
      reviewReason: 'AI 答疑会影响学生对标准答案的理解，需要确认没有偏离题目解析。',
      suggestedAction: '核对正确答案、解析步骤和相似题推荐；确认只作为辅助解释后再通过。',
      createdAt: new Date().toISOString(),
    });
    return reply;
  }

  private assembleFollowUp(
    input: { userId?: string; questionId: string; message?: string },
    question: Question,
    knowledgePoint: KnowledgePoint | undefined,
    message: string,
    draft: AiFollowUpDraft,
    source: string,
  ) {
    const relatedPointTitle = knowledgePoint?.title ?? question.knowledgePointIds[0] ?? '408 高频考点';
    const reply = {
      id: `follow-up-${Date.now()}`,
      userId: input.userId ?? this.student.id,
      questionId: question.id,
      message,
      relatedKnowledgePoint: {
        id: knowledgePoint?.id ?? question.knowledgePointIds[0],
        title: relatedPointTitle,
        subject: knowledgePoint?.subject ?? '408',
        chapter: knowledgePoint?.chapter ?? '高频章节',
      },
      replySteps: draft.replySteps,
      misconceptionTips: draft.misconceptionTips,
      reviewCards: draft.reviewCards,
      nextActions: draft.nextActions,
      source,
    };
    this.aiReviewItems.push({
      id: `review-ai-${reply.id}`,
      contentType: 'ai_reply',
      relatedId: reply.id,
      title: `${relatedPointTitle} 追问与复习卡片`,
      summary: `AI 追问内容需审核：${message}`,
      status: 'pending',
      riskLevel: 'low',
      reviewReason: 'AI 追问和复习卡片可能扩展到相邻知识点，需要确认概念边界准确。',
      suggestedAction: '检查复习卡片、易错提示和下一步建议；如存在概念混淆则标记复查。',
      createdAt: new Date().toISOString(),
    });
    return reply;
  }

  private findSimilarQuestions(questionId: string, knowledgePointId: string) {
    const samePointQuestions = this.questions
      .filter((item) => item.id !== questionId)
      .filter((item) => item.knowledgePointIds.includes(knowledgePointId));
    const fallbackQuestions = this.questions
      .filter((item) => item.id !== questionId && !samePointQuestions.includes(item))
      .slice(0, Math.max(0, 3 - samePointQuestions.length));

    return [...samePointQuestions, ...fallbackQuestions].slice(0, 3).map((item) => ({
      id: item.id,
      stem: item.stem,
      difficulty: item.difficulty,
      source: item.source,
    }));
  }

  private createAssessmentReviewSuggestion(accuracyRate: number, weakPointTitle: string | undefined, overtime: boolean) {
    if (accuracyRate < 60) {
      return `先回到 ${weakPointTitle ?? '本次错题'} 的基础概念，复盘错因后再做一组同考点基础题。`;
    }

    if (overtime) {
      return `正确率已有基础，下一轮围绕 ${weakPointTitle ?? '薄弱题型'} 做限时训练，压缩审题和计算时间。`;
    }

    if (accuracyRate >= 85) {
      return '本次表现较稳定，建议进入真题整卷训练，并保留错题复盘节奏。';
    }

    return `先处理 ${weakPointTitle ?? '本次薄弱点'}，再补 1 组变式题验证是否真正掌握。`;
  }

  private async buildAdminUsers(): Promise<AdminManagedUser[]> {
    const calendar = this.getLearningCalendar(this.student.id);
    const trialProgress = await this.getTrialProgress(this.student.id);
    const studentStatus = this.trialStatusByUserId.get(this.student.id)
      ?? (trialProgress.completionRate === 100 ? 'completed' : trialProgress.completedCount > 0 ? 'active' : 'invited');

    return [
      {
        id: this.student.id,
        name: this.student.name,
        role: 'student',
        trialStatus: studentStatus,
        stage: this.student.stage,
        targetScore: this.student.targetScore,
        targetSchool: this.student.targetSchool,
        lastActiveAt: calendar.today.isActive ? calendar.today.date : this.records[this.records.length - 1]?.submittedAt ?? todayKey(),
        nextAction: studentStatus === 'follow_up'
          ? '联系学生填写问卷，并追问最影响备考效率的功能缺口。'
          : studentStatus === 'completed'
            ? '整理试用反馈，判断是否邀请继续深度体验。'
            : trialProgress.nextAction,
      },
      {
        id: 'teacher-001',
        name: '王老师',
        role: 'teacher',
        trialStatus: this.trialStatusByUserId.get('teacher-001') ?? 'active',
        stage: '教研维护',
        lastActiveAt: todayKey(),
        nextAction: '继续维护题库、知识点和班级学情分析。',
      },
      {
        id: 'admin-001',
        name: '管理员',
        role: 'admin',
        trialStatus: this.trialStatusByUserId.get('admin-001') ?? 'active',
        stage: '平台运营',
        lastActiveAt: todayKey(),
        nextAction: '查看试用名单、内容审核和运营数据。',
      },
    ];
  }

  private getStudent(userId: string): UserProfile {
    const profile = this.diagnosticProfilesByUser.get(userId);
    const identity = this.authenticatedUsers.get(userId)
      ?? (userId === this.student.id ? this.student : { id: userId, name: '408 学习者', role: 'student' as const });
    return {
      ...identity,
      targetScore: profile?.targetScore ?? (userId === this.student.id ? this.student.targetScore : undefined),
      currentScore: profile?.currentScore ?? (userId === this.student.id ? this.student.currentScore : undefined),
      dailyHours: profile?.dailyHours ?? (userId === this.student.id ? this.student.dailyHours : undefined),
      remainingDays: profile?.remainingDays ?? (userId === this.student.id ? this.student.remainingDays : undefined),
      weakestSubject: profile?.weakestSubject ?? (userId === this.student.id ? this.student.weakestSubject : undefined),
      stage: profile?.stage ?? (userId === this.student.id ? this.student.stage : '基础'),
      targetSchool: userId === this.student.id ? this.student.targetSchool : undefined,
    };
  }

  private toAdminManagedUser(user: ManagedUserRecord): AdminManagedUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      trialStatus: user.trialStatus,
      stage: user.stage ?? (user.role === 'teacher' ? '教研维护' : user.role === 'admin' ? '平台运营' : '尚未完成诊断'),
      targetScore: user.targetScore,
      targetSchool: user.targetSchool,
      lastActiveAt: user.lastActiveAt,
      nextAction: user.role === 'teacher'
        ? '维护题库并查看已授权学生的学习情况。'
        : user.role === 'admin'
          ? '维护内测名单、教师授权和内容审核。'
          : user.trialStatus === 'follow_up'
            ? '联系学生填写问卷，并追问最影响备考效率的功能缺口。'
            : user.trialStatus === 'completed'
              ? '整理试用反馈，判断是否邀请继续深度体验。'
              : user.onboardingCompleted
                ? '跟进今日任务完成情况和错题复习体验。'
                : '提醒完成首次引导和七天学习计划。',
    };
  }

  private buildSevenDayPlan(userId: string): SevenDayPlanState {
    const base = this.generatePlan(userId);
    const tasks: ScheduledStudyTaskState[] = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const scheduledDate = dateKeyFromOffset(dayIndex);
      for (let taskIndex = 0; taskIndex < Math.min(3, base.dailyTasks.length); taskIndex += 1) {
        const baseTask = base.dailyTasks[(dayIndex + taskIndex) % base.dailyTasks.length];
        tasks.push({
          ...baseTask,
          id: `week-${dayIndex + 1}-${taskIndex + 1}-${randomUUID()}`,
          mode: dayIndex === 0 ? baseTask.mode : dayIndex % 3 === 0 ? '阶段巩固' : baseTask.mode,
          scheduledDate,
          status: 'pending',
          postponeCount: 0,
        });
      }
    }
    return {
      id: `plan-${randomUUID()}`,
      userId,
      phase: base.phase,
      targetScore: base.targetScore,
      remainingDays: base.remainingDays,
      dailyHours: base.dailyHours,
      checkpoint: base.checkpoint,
      startDate: todayKey(),
      tasks,
    };
  }

  private getSevenDayPlanSummary(plan: SevenDayPlanState) {
    const dates = [...new Set(plan.tasks.map((task) => task.scheduledDate))].sort();
    return {
      startDate: plan.startDate,
      days: dates.map((date) => {
        const tasks = plan.tasks.filter((task) => task.scheduledDate === date);
        const completedTasks = tasks.filter((task) => task.status === 'completed').length;
        const priorityRank = (value: string) => (value === '高' ? 0 : value === '中' ? 1 : 2);
        const topTask = [...tasks].sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority))[0];
        return {
          date,
          taskCount: tasks.length,
          completedTasks,
          totalMinutes: tasks.reduce((sum, task) => sum + task.minutes, 0),
          focusTitle: topTask?.title ?? '',
          focusCompleted: topTask ? topTask.status === 'completed' : false,
        };
      }),
    };
  }

  private findScheduledTask(userId: string, taskId: string) {
    return this.sevenDayPlansByUser.get(userId)?.tasks.find((task) => task.id === taskId);
  }

  private async withPlanMutation<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.planMutationTails.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    this.planMutationTails.set(userId, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.planMutationTails.get(userId) === tail) this.planMutationTails.delete(userId);
    }
  }

  generatePlan(userId = this.student.id) {
    const student = this.getStudent(userId);
    this.ensureNodeMasteryFresh();
    const plan = this.useNodeMastery
      ? this.buildNodeDrivenPlan(student)
      : buildStudyPlan({
          targetScore: student.targetScore ?? 115,
          remainingDays: student.remainingDays ?? 96,
          dailyHours: student.dailyHours ?? 3.5,
          stage: student.stage ?? '强化',
          knowledgePoints: this.knowledgePoints,
          records: this.records.filter((record) => record.userId === userId),
        });
    const scheduledPlan = this.sevenDayPlansByUser.get(userId);
    if (scheduledPlan) {
      const dailyTasks = scheduledPlan.tasks
        .filter((task) => task.scheduledDate === todayKey())
        .map((task) => ({
          ...task,
          completed: task.status === 'completed',
        }));
      const completedTaskCount = dailyTasks.filter((task) => task.completed).length;
      return {
        ...plan,
        phase: scheduledPlan.phase,
        checkpoint: scheduledPlan.checkpoint,
        dailyTasks,
        completedTaskCount,
        totalTaskCount: dailyTasks.length,
        completionRate: dailyTasks.length ? Math.round((completedTaskCount / dailyTasks.length) * 100) : 0,
      };
    }
    const completedTaskDates = this.completedTaskDatesByUser.get(userId) ?? new Map<string, string>();
    const completedIds = new Set([...completedTaskDates.entries()]
      .filter(([, date]) => date === todayKey())
      .map(([taskKey]) => taskKey.split('@')[0]));
    const dailyTasks = plan.dailyTasks.map((task) => ({
      ...task,
      completed: completedIds.has(task.id),
    }));
    const completedTaskCount = dailyTasks.filter((task) => task.completed).length;

    return {
      ...plan,
      dailyTasks,
      completedTaskCount,
      totalTaskCount: dailyTasks.length,
      completionRate: dailyTasks.length ? Math.round((completedTaskCount / dailyTasks.length) * 100) : 0,
    };
  }

  private buildNodeDrivenPlan(student: UserProfile): StudyPlan {
    const nodes: NodePlanEvidenceNode[] = [...this.nodeCatalogById.entries()].map(
      ([knowledgeNodeId, entry]) => ({
        knowledgeNodeId,
        subject: entry.subject,
        chapter: entry.chapter,
        title: entry.title,
        importance: entry.importance,
        difficulty: entry.difficulty,
        recent3Frequency: entry.recent3Frequency,
        recent5Frequency: entry.recent5Frequency,
        allTimeEvidence: entry.allTimeEvidence,
        primaryScore5y: entry.primaryScore5y,
        trendDirection: entry.trendDirection,
        trendDelta: entry.trendDelta,
        evidenceConfidence: entry.evidenceConfidence,
      }),
    );
    const tasks = buildNodeDrivenDailyTasks({
      nodes,
      masteryRows: this.nodeMasteryByUser.get(student.id) ?? [],
      targetScore: student.targetScore ?? 115,
      remainingDays: student.remainingDays ?? 96,
      dailyHours: student.dailyHours ?? 3.5,
      stage: student.stage ?? '强化',
    }).map((task, index) => ({ ...task, id: `task-${index + 1}` }));
    const remainingDays = student.remainingDays ?? 96;
    return {
      phase: stagePhase(student.stage ?? '强化'),
      targetScore: student.targetScore ?? 115,
      remainingDays,
      dailyHours: student.dailyHours ?? 3.5,
      dailyTasks: tasks,
      checkpoint: remainingDays <= 45 ? '每 3 天完成一套真题回顾' : '每 7 天完成一次阶段测评',
    };
  }

  private createTaskCompletionAdjustment(task: ReturnType<typeof buildStudyPlan>['dailyTasks'][number], input: {
    completedQuestionCount?: number;
    correctCount?: number;
    minutesSpent?: number;
    selfRating?: number;
  }) {
    const completedQuestionCount = clampNumber(input.completedQuestionCount ?? task.questionCount, 0, 200);
    const correctCount = clampNumber(input.correctCount ?? Math.round(completedQuestionCount * 0.75), 0, completedQuestionCount);
    const minutesSpent = clampNumber(input.minutesSpent ?? task.minutes, 1, 600);
    const selfRating = clampNumber(input.selfRating ?? 3, 1, 5);
    const accuracyRate = completedQuestionCount ? Math.round((correctCount / completedQuestionCount) * 100) : 0;
    const speedRatio = minutesSpent / Math.max(1, task.minutes);
    const reasons: string[] = [];

    if (accuracyRate < 65) {
      reasons.push(`本任务正确率 ${accuracyRate}%，说明 ${task.title} 仍需要先复盘再加题。`);
    } else if (accuracyRate >= 85) {
      reasons.push(`本任务正确率 ${accuracyRate}%，可以在保持复盘的前提下提高训练量。`);
    } else {
      reasons.push(`本任务正确率 ${accuracyRate}%，建议维持当前节奏并补一组同考点题。`);
    }

    if (speedRatio > 1.2) {
      reasons.push(`实际用时 ${minutesSpent} 分钟，高于计划 ${task.minutes} 分钟，需要加入限时训练。`);
    }

    if (selfRating <= 2) {
      reasons.push('自评掌握度偏低，明日优先安排概念复述和错题重做。');
    }

    const weakQuality = accuracyRate < 65 || selfRating <= 2;
    const slowQuality = speedRatio > 1.2;
    const strongQuality = accuracyRate >= 85 && selfRating >= 4 && !slowQuality;
    const intensity: 'increase' | 'decrease' | 'hold' = strongQuality ? 'increase' : weakQuality ? 'decrease' : 'hold';
    const tomorrowQuestionTarget = intensity === 'increase'
      ? task.questionCount + 4
      : intensity === 'decrease'
        ? Math.max(6, task.questionCount - 2)
        : task.questionCount;
    const reviewTarget = weakQuality ? 4 : slowQuality ? 3 : 2;

    return {
      accuracyRate,
      completedQuestionCount,
      correctCount,
      minutesSpent,
      selfRating,
      intensity,
      tomorrowQuestionTarget,
      reviewTarget,
      focusKnowledgePointId: task.knowledgePointId,
      focusTitle: task.title,
      reasons,
      nextActions: [
        weakQuality ? `先复盘 ${task.title} 的错题和概念，再做 ${reviewTarget} 道回炉题。` : `明日继续围绕 ${task.title} 做 ${tomorrowQuestionTarget} 道训练题。`,
        slowQuality ? '加入 10 分钟限时小练，优先压缩审题和计算步骤。' : '完成后用一句话写下本考点最容易混淆的条件。',
      ],
    };
  }

  // ---- Phase 4: Session Management (auto-save & resume) ----

  private readonly practiceSessions = new Map<string, PracticeSession>();
  private readonly submittingSessionIds = new Set<string>();
  private readonly examReviewPlans = new Map<string, ExamReviewPlanState>();

  async startPracticeSession(userId: string, input: {
    type: 'practice_set' | 'stage_assessment' | 'paper';
    questionIds: string[];
    resourceId?: string;
  }) {
    const questionIds = [...new Set(input.questionIds)];
    if (questionIds.length === 0 || questionIds.length !== input.questionIds.length) {
      throw new BadRequestException('A session requires a non-empty list of unique questions');
    }
    const snapshot = await Promise.all(questionIds.map(async (questionId) => this.questionsService.findQuestionById(questionId)));
    const unknownQuestionIndex = snapshot.findIndex((question) => !question);
    if (unknownQuestionIndex !== -1) throw new BadRequestException(`Question ${questionIds[unknownQuestionIndex]} was not found`);

    const existing = [...this.practiceSessions.values()].find((session) =>
      session.userId === userId
      && !session.completed
      && session.type === input.type
      && session.resourceId === input.resourceId
      && sameStringArray(session.questionIds, questionIds),
    );
    if (existing) return this.sessionView(existing);

    const id = `session-${randomUUID()}`;
    const now = Date.now();
    const session: PracticeSession = {
      id,
      userId,
      type: input.type,
      resourceId: input.resourceId,
      questionIds,
      questionSnapshot: snapshot.map((question) => ({ ...question! })),
      answers: {},
      markedQuestions: [],
      currentIndex: 0,
      revision: 0,
      startedAt: new Date(now).toISOString(),
      lastActiveAt: new Date(now).toISOString(),
      totalActiveMs: 0,
      lastResumeAt: now,
      completed: false,
    };
    this.practiceSessions.set(id, session);
    await this.learningSessionRepository.save(session);
    return this.sessionView(session);
  }

  async savePracticeProgress(sessionId: string, userId: string, input: {
    revision: number;
    answers?: Record<string, { selectedAnswer: string; timeSpentSec: number; selfScore?: number; maxScore?: number; confidence?: '确定' | '不确定' | '完全不会'; usedHint?: boolean; answerModified?: boolean }>;
    currentIndex?: number;
    markedQuestions?: string[];
    totalActiveMs?: number;
  }) {
    const session = this.getOwnSession(sessionId, userId);
    if (session.completed) throw new BadRequestException('Completed sessions cannot be changed');
    if (input.revision <= session.revision) return this.sessionView(session);

    const nextSession: PracticeSession = {
      ...session,
      answers: { ...session.answers },
      markedQuestions: [...session.markedQuestions],
      revision: input.revision,
    };
    this.applySessionProgress(nextSession, input);
    const persisted = await this.learningSessionRepository.saveProgress(nextSession);
    if (persisted) {
      const current = this.practiceSessions.get(sessionId);
      if (!current || current.revision < nextSession.revision) this.practiceSessions.set(sessionId, nextSession);
    } else {
      const stored = await this.learningSessionRepository.loadOne(sessionId, userId);
      if (stored && stored.revision > session.revision) this.practiceSessions.set(sessionId, stored);
    }
    return this.sessionView(this.getOwnSession(sessionId, userId));
  }

  getPracticeSession(sessionId: string, userId: string) {
    return this.sessionView(this.getOwnSession(sessionId, userId));
  }

  listActiveSessions(userId: string) {
    const sessions = [...this.practiceSessions.values()]
      .filter((s) => s.userId === userId && !s.completed)
      .map((s) => this.sessionView(s))
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));

    return { sessions, count: sessions.length };
  }

  async submitPracticeSession(sessionId: string, userId: string, input: {
    answers: Array<{ questionId: string; selectedAnswer: string; timeSpentSec: number; selfScore?: number; maxScore?: number; confidence?: '确定' | '不确定' | '完全不会'; usedHint?: boolean; answerModified?: boolean }>;
    totalActiveMs?: number;
  }) {
    const session = this.getOwnSession(sessionId, userId);
    if (session.completed || this.submittingSessionIds.has(sessionId)) {
      throw new BadRequestException('Session has already been submitted');
    }
    const foreignAnswer = input.answers.find((answer) => !session.questionIds.includes(answer.questionId));
    if (foreignAnswer) {
      throw new BadRequestException(`Question ${foreignAnswer.questionId} does not belong to this session`);
    }
    if (new Set(input.answers.map((answer) => answer.questionId)).size !== input.answers.length) {
      throw new BadRequestException('A question can only be submitted once');
    }
    for (const answer of input.answers) this.validateSessionAnswer(answer.questionId, answer);

    this.submittingSessionIds.add(sessionId);

    try {
      const submittedSession: PracticeSession = {
        ...session,
        answers: { ...session.answers },
        markedQuestions: [...session.markedQuestions],
      };

      // Save final progress on a detached candidate so a failed transaction cannot leak into the cache.
      for (const answer of input.answers) {
        submittedSession.answers[answer.questionId] = {
          selectedAnswer: answer.selectedAnswer,
          timeSpentSec: answer.timeSpentSec,
          selfScore: answer.selfScore,
          maxScore: answer.maxScore,
          confidence: answer.confidence,
          usedHint: answer.usedHint,
          answerModified: answer.answerModified,
        };
      }
      this.applySessionProgress(submittedSession, { totalActiveMs: input.totalActiveMs });
      submittedSession.revision += 1;
      submittedSession.completed = true;

      const finalAnswers = submittedSession.questionIds.flatMap((questionId) => {
        const answer = submittedSession.answers[questionId];
        return isAnswered(answer)
          ? [{ questionId, ...answer }]
          : [];
      });
      const snapshotQuestions = new Map(submittedSession.questionSnapshot.map((question) => [question.id, question]));
      const records = finalAnswers.map((answer) =>
        this.buildPracticeRecord({
          userId,
          questionId: answer.questionId,
          knowledgePointId: '',
          actionId: session.actionId ?? null,
          selectedAnswer: answer.selectedAnswer,
          timeSpentSec: answer.timeSpentSec,
          sessionId,
          selfScore: answer.selfScore,
          maxScore: answer.maxScore,
          confidence: answer.confidence,
          usedHint: answer.usedHint,
          answerModified: answer.answerModified,
          questionSnapshot: snapshotQuestions.get(answer.questionId),
        }),
      );

      const committed = await this.learningSessionRepository.commitSubmission(
        submittedSession,
        records,
        async (tx) => {
          await this.scoreCenterService?.applyAttempts(userId, records, tx);
        },
      );
      if (!committed) {
        const [persistedSession, persistedRecords] = await Promise.all([
          this.learningSessionRepository.loadOne(sessionId, userId),
          this.practiceRecordRepository.listByUser(userId),
        ]);
        if (persistedSession) {
          Object.assign(session, persistedSession);
          this.practiceSessions.set(sessionId, session);
        }
        const recordsById = new Map(this.records.map((record) => [record.id, record]));
        for (const record of persistedRecords) recordsById.set(record.id, record);
        this.records.splice(0, this.records.length, ...recordsById.values());
        throw new BadRequestException('Session has already been submitted');
      }
      Object.assign(session, submittedSession);
      this.practiceSessions.set(sessionId, session);
      this.records.push(...records);
      await this.refreshNodeMasteryCache(userId);
      for (const record of records) {
        await this.applyPracticeProgressToTasks(userId, record);
      }
      await this.trackUserEvent(userId, 'session.submit', { sessionId, type: session.type });
      const synchronizationWarnings: string[] = [];
      for (const record of records) {
        if (!record.correct) {
          try {
            await this.ensureReviewSchedule(record);
          } catch (error) {
            this.logger.error(
              `Review schedule synchronization failed after session ${sessionId} committed`,
              error instanceof Error ? error.stack : String(error),
            );
            synchronizationWarnings.push(`review_schedule:${record.questionId}`);
          }
        }
      }

      let workflowResult;
      try {
        workflowResult = session.type === 'practice_set' && session.resourceId
          ? this.createPracticeSetResult(session.resourceId, userId, records)
          : session.type === 'stage_assessment'
            ? await this.createStageAssessmentResult(userId, records)
            : undefined;
      } catch (error) {
        this.logger.error(
          `Workflow result synchronization failed after session ${sessionId} committed`,
          error instanceof Error ? error.stack : String(error),
        );
        synchronizationWarnings.push('workflow_result');
      }

      if (session.type === 'paper') {
        try {
          await this.recordPaperAssessmentHistory(sessionId, userId, session, records);
        } catch (error) {
          this.logger.error(
            `Assessment history synchronization failed after session ${sessionId} committed`,
            error instanceof Error ? error.stack : String(error),
          );
          synchronizationWarnings.push('assessment_history');
        }
      }

      if (session.type === 'stage_assessment') {
        await this.triggerLearningLoop(userId, {
          triggerType: 'stage_assessment',
          sourceId: sessionId,
        });
      }

      const correctCount = records.filter((r) => r.correct).length;
      const reportedTotalQuestions = session.type === 'paper' ? session.questionIds.length : records.length;
      return {
        sessionId,
        completed: true,
        totalQuestions: reportedTotalQuestions,
        correctCount,
        accuracyRate: reportedTotalQuestions ? Math.round((correctCount / reportedTotalQuestions) * 100) : 0,
        totalActiveMs: session.totalActiveMs,
        workflowResult,
        synchronizationWarnings,
        records: records.map((r) => ({
          questionId: r.questionId,
          correct: r.correct,
          mistakeReason: r.mistakeReason,
          timeSpentSec: r.timeSpentSec,
          gradingMode: r.gradingMode,
          selfScore: r.selfScore,
          maxScore: r.maxScore,
        })),
      };
    } finally {
      this.submittingSessionIds.delete(sessionId);
    }
  }

  private async recordPaperAssessmentHistory(
    sessionId: string,
    userId: string,
    session: PracticeSession,
    records: PracticeRecord[],
  ) {
    if (this.assessmentHistoryItems.some((item) => item.sessionId === sessionId)) return;
    const totalQuestions = session.questionIds.length;
    const answeredCount = session.questionIds.filter((questionId) => isAnswered(session.answers[questionId])).length;
    const correctCount = records.filter((record) => record.correct).length;
    const accuracyRate = totalQuestions ? Math.round((correctCount / totalQuestions) * 100) : 0;
    const weakKnowledgePoints = [...new Set(
      records
        .filter((record) => !record.correct || record.mistakeReason !== null)
        .map((record) => this.knowledgePoints.find((point) => point.id === record.knowledgePointId)?.title ?? record.knowledgePointId),
    )].slice(0, 4);
    const weakPointTitle = weakKnowledgePoints[0] ?? '限时整卷训练';
    const elapsedSec = Math.round(session.totalActiveMs / 1000);
    const overtime = elapsedSec > 180 * 60;
    const submittedAt = new Date().toISOString();
    const paper = session.resourceId ? this.papers.find((item) => item.id === session.resourceId) : undefined;

    const historyItem: AssessmentHistoryItem = {
      id: `assessment-history-${Date.now()}-${randomUUID()}`,
      sessionId,
      paperId: paper?.id,
      userId,
      title: paper?.title ?? `408 模拟卷 ${studyDateKey(submittedAt)}`,
      submittedAt,
      score: accuracyRate,
      totalScore: 100,
      accuracyRate,
      elapsedSec,
      unansweredCount: totalQuestions - answeredCount,
      weakPointTitle,
      reviewSuggestion: this.createAssessmentReviewSuggestion(accuracyRate, weakPointTitle, overtime),
    };
    this.assessmentHistoryItems.push(historyItem);
    await this.assessmentHistoryRepository.save(historyItem);
  }

  private applySessionProgress(session: PracticeSession, input: {
    answers?: Record<string, { selectedAnswer: string; timeSpentSec: number; selfScore?: number; maxScore?: number }>;
    currentIndex?: number;
    markedQuestions?: string[];
    totalActiveMs?: number;
  }) {
    if (input.currentIndex != null && input.currentIndex >= session.questionIds.length) {
      throw new BadRequestException('Current question index is outside this session');
    }
    const foreignMarkedQuestion = input.markedQuestions?.find((questionId) => !session.questionIds.includes(questionId));
    if (foreignMarkedQuestion) {
      throw new BadRequestException(`Marked question ${foreignMarkedQuestion} does not belong to this session`);
    }
    if (input.answers) {
      for (const [questionId, answer] of Object.entries(input.answers)) {
        if (!session.questionIds.includes(questionId)) {
          throw new BadRequestException(`Question ${questionId} does not belong to this session`);
        }
        this.validateSessionAnswer(questionId, answer);
      }
    }

    const now = Date.now();
    if (input.totalActiveMs != null) {
      const wallElapsedMs = Math.max(0, now - new Date(session.startedAt).getTime());
      const boundedActiveMs = Math.min(input.totalActiveMs, wallElapsedMs + 5_000);
      session.totalActiveMs = Math.max(session.totalActiveMs, boundedActiveMs);
    }
    session.lastResumeAt = now;
    session.lastActiveAt = new Date(now).toISOString();
    if (input.answers) {
      for (const [questionId, answer] of Object.entries(input.answers)) session.answers[questionId] = answer;
    }
    if (input.currentIndex != null) session.currentIndex = input.currentIndex;
    if (input.markedQuestions) session.markedQuestions = [...new Set(input.markedQuestions)];
  }

  private validateSessionAnswer(questionId: string, answer: {
    selectedAnswer: string;
    timeSpentSec: number;
    selfScore?: number;
    maxScore?: number;
    confidence?: '确定' | '不确定' | '完全不会';
    usedHint?: boolean;
    answerModified?: boolean;
  }) {
    if (typeof answer.selectedAnswer !== 'string' || answer.selectedAnswer.length > 10_000) {
      throw new BadRequestException(`Answer for ${questionId} is invalid`);
    }
    if (!Number.isInteger(answer.timeSpentSec) || answer.timeSpentSec < 0 || answer.timeSpentSec > 10_800) {
      throw new BadRequestException(`Answer time for ${questionId} is invalid`);
    }
    if (answer.selfScore != null && (!Number.isInteger(answer.selfScore) || answer.selfScore < 0 || answer.selfScore > 150)) {
      throw new BadRequestException(`Self score for ${questionId} is invalid`);
    }
    if (answer.maxScore != null && (!Number.isInteger(answer.maxScore) || answer.maxScore < 1 || answer.maxScore > 150)) {
      throw new BadRequestException(`Maximum score for ${questionId} is invalid`);
    }
    if (answer.selfScore != null && answer.maxScore != null && answer.selfScore > answer.maxScore) {
      throw new BadRequestException(`Self score for ${questionId} cannot exceed its maximum score`);
    }
    if (answer.confidence != null && !['确定', '不确定', '完全不会'].includes(answer.confidence)) {
      throw new BadRequestException(`Confidence for ${questionId} is invalid`);
    }
    if (answer.usedHint != null && typeof answer.usedHint !== 'boolean') {
      throw new BadRequestException(`Used hint flag for ${questionId} is invalid`);
    }
    if (answer.answerModified != null && typeof answer.answerModified !== 'boolean') {
      throw new BadRequestException(`Answer modified flag for ${questionId} is invalid`);
    }
  }

  private getOwnSession(sessionId: string, userId: string): PracticeSession {
    const session = this.practiceSessions.get(sessionId);
    if (!session) {
      throw new BadRequestException(`Session ${sessionId} was not found`);
    }
    if (session.userId !== userId) {
      throw new ForbiddenException('You can only access your own sessions');
    }
    return session;
  }

  // ---- Phase 6: Mock Exam (exam session, report, post-exam review tasks) ----

  getExamReport(sessionId: string, userId: string) {
    const session = this.getOwnSession(sessionId, userId);
    if (session.type !== 'paper') {
      throw new BadRequestException('Only paper sessions have exam reports');
    }
    if (!session.completed) {
      throw new BadRequestException('Exam report is available after submission');
    }

    const records = this.records.filter((record) => record.userId === userId && record.sessionId === sessionId);
    const questionsById = new Map(session.questionSnapshot.map((question) => [question.id, question]));
    const missingSnapshotQuestionId = session.questionIds.find((questionId) => !questionsById.has(questionId));
    if (session.questionSnapshot.length === 0 || missingSnapshotQuestionId) {
      throw new BadRequestException('Exam question snapshot is incomplete');
    }

    const correctCount = records.filter((r) => r.correct).length;
    const totalQuestions = session.questionIds.length;
    const accuracyRate = totalQuestions ? Math.round((correctCount / totalQuestions) * 100) : 0;
    const objectiveQuestionIds = session.questionIds.filter((questionId) =>
      questionsById.get(questionId)?.type !== '综合题',
    );
    const subjectiveQuestionIds = session.questionIds.filter((questionId) =>
      questionsById.get(questionId)?.type === '综合题',
    );
    const objectiveRecords = records.filter((record) => objectiveQuestionIds.includes(record.questionId));
    const subjectiveRecords = records.filter((record) => subjectiveQuestionIds.includes(record.questionId));
    const objectiveCorrectCount = objectiveRecords.filter((record) => record.correct).length;
    const subjectiveEarnedScore = subjectiveRecords.reduce((sum, record) => sum + (record.selfScore ?? 0), 0);
    const subjectiveMaxScore = subjectiveRecords.reduce((sum, record) => sum + (record.maxScore ?? 0), 0);
    const answeredQuestionIds = session.questionIds.filter((questionId) => isAnswered(session.answers[questionId]));
    const answeredCount = answeredQuestionIds.length;
    const unansweredCount = session.questionIds.length - answeredCount;
    const totalTimeSec = session.totalActiveMs / 1000;

    // Per-subject breakdown
    const subjectStats = new Map<string, { total: number; answered: number; correct: number; totalTimeSec: number }>();
    for (const questionId of session.questionIds) {
      const question = questionsById.get(questionId);
      const point = question?.knowledgePointIds[0]
        ? this.knowledgePoints.find((item) => item.id === question.knowledgePointIds[0])
        : undefined;
      const subject = point?.subject ?? '未分类';
      const stat = subjectStats.get(subject) ?? { total: 0, answered: 0, correct: 0, totalTimeSec: 0 };
      stat.total += 1;
      subjectStats.set(subject, stat);
    }
    for (const record of records) {
      const question = questionsById.get(record.questionId);
      const point = question?.knowledgePointIds[0]
        ? this.knowledgePoints.find((k) => k.id === question.knowledgePointIds[0])
        : undefined;
      const subject = point?.subject ?? '未分类';
      const stat = subjectStats.get(subject) ?? { total: 0, answered: 0, correct: 0, totalTimeSec: 0 };
      stat.answered += 1;
      if (record.correct) stat.correct += 1;
      stat.totalTimeSec += record.timeSpentSec;
      subjectStats.set(subject, stat);
    }

    // Knowledge point losses
    const pointLosses = new Map<string, { knowledgePointId: string; title: string; subject: string; wrongCount: number }>();
    const lostQuestionIds = [
      ...records.filter((record) => !record.correct).map((record) => record.questionId),
      ...session.questionIds.filter((questionId) => !isAnswered(session.answers[questionId])),
    ];
    for (const questionId of lostQuestionIds) {
      const question = questionsById.get(questionId);
      const pointId = question?.knowledgePointIds[0];
      if (!pointId) continue;
      const point = this.knowledgePoints.find((k) => k.id === pointId);
      const key = pointId;
      const existing = pointLosses.get(key) ?? { knowledgePointId: key, title: point?.title ?? key, subject: point?.subject ?? '未分类', wrongCount: 0 };
      existing.wrongCount += 1;
      pointLosses.set(key, existing);
    }

    return {
      sessionId,
      userId,
      generatedAt: new Date().toISOString(),
      summary: {
        totalQuestions,
        answeredCount,
        unansweredCount,
        correctCount,
        accuracyRate,
        objectiveQuestionCount: objectiveQuestionIds.length,
        objectiveCorrectCount,
        objectiveAccuracyRate: objectiveQuestionIds.length ? Math.round((objectiveCorrectCount / objectiveQuestionIds.length) * 100) : 0,
        subjectiveQuestionCount: subjectiveQuestionIds.length,
        subjectiveEarnedScore,
        subjectiveMaxScore,
        subjectiveScoreRate: subjectiveMaxScore ? Math.round((subjectiveEarnedScore / subjectiveMaxScore) * 100) : 0,
        totalTimeSec: Math.round(totalTimeSec),
        timeLimitSec: 180 * 60, // 180 minutes
        overtime: totalTimeSec > 180 * 60,
      },
      subjectBreakdown: [...subjectStats.entries()].map(([subject, stats]) => ({
        subject,
        totalQuestions: stats.total,
        correctCount: stats.correct,
        accuracyRate: stats.total ? Math.round((stats.correct / stats.total) * 100) : 0,
        totalTimeSec: Math.round(stats.totalTimeSec),
        avgTimeSec: stats.answered ? Math.round(stats.totalTimeSec / stats.answered) : 0,
      })),
      knowledgePointLosses: [...pointLosses.values()]
        .sort((a, b) => b.wrongCount - a.wrongCount)
        .slice(0, 10),
      unansweredQuestions: session.questionIds
        .filter((id) => !isAnswered(session.answers[id]))
        .map((id) => {
          const q = questionsById.get(id);
          return { questionId: id, stem: q?.stem ?? id };
        }),
      // LE-V10 F2 additive: raw lost question ids feeding the diagnosis node
      // attribution (getExamReport keeps its existing fields untouched).
      lostQuestionIds,
    };
  }

  async generatePostExamReviewTasks(sessionId: string, userId: string) {
    return this.withPlanMutation(userId, () => this.generatePostExamReviewTasksUnlocked(sessionId, userId));
  }

  private async generatePostExamReviewTasksUnlocked(sessionId: string, userId: string) {
    const existingPlan = this.examReviewPlans.get(sessionId);
    if (existingPlan) {
      if (existingPlan.userId !== userId) throw new ForbiddenException('You can only access your own exam review plan');
    }
    const report = this.getExamReport(sessionId, userId);
    const localToday = new Date(`${todayKey()}T00:00:00.000Z`);
    const fallbackPoint = [...this.knowledgePoints]
      .sort((left, right) => right.importance - left.importance || right.frequency - left.frequency)[0];
    if (!fallbackPoint) throw new BadRequestException('No knowledge point is available for post-exam review');

    // P1-04: 复习任务只从「本场考试」取材——有失分用失分考点，全对用本场覆盖考点做限时巩固，
    // 不再回退到与本次考试无关的全局最重要知识点。
    const session = this.getOwnSession(sessionId, userId);
    const lossPoints = report.knowledgePointLosses
      .map((loss) => this.knowledgePoints.find((item) => item.id === loss.knowledgePointId))
      .filter((point): point is KnowledgePoint => Boolean(point));
    const coveredPoints = this.collectExamCoveredPoints(session);
    const sourcePoints = lossPoints.length > 0 ? lossPoints : coveredPoints;
    const isPerfect = report.knowledgePointLosses.length === 0;

    const days = Array.from({ length: 3 }, (_, index) => {
      const date = new Date(localToday);
      date.setUTCDate(localToday.getUTCDate() + index + 1);
      const point = sourcePoints.length > 0
        ? sourcePoints[Math.min(index, sourcePoints.length - 1)]
        : fallbackPoint;

      return {
        dayIndex: index + 1,
        date: date.toISOString().slice(0, 10),
        taskId: postExamTaskId(sessionId, index + 1),
        knowledgePointId: point.id,
        focus: point.title,
        subject: point.subject,
        questionCount: index === 0 ? 15 : index === 1 ? 12 : 8,
        minutes: index === 0 ? 90 : index === 1 ? 60 : 45,
        tasks: [
          isPerfect
            ? `限时复练 ${point.title}，保持本场考试的正确率与速度。`
            : index === 0
              ? `复盘 ${point.title} 的错题，写出每道题的错因。`
              : '',
          index <= 1 ? `完成 ${point.title} 同考点专项训练。` : '',
          `限时完成 ${index === 0 ? 15 : index === 1 ? 12 : 8} 题，目标正确率 ${70 + index * 5}% 以上。`,
        ].filter(Boolean),
      };
    });

    const summaryDraft: ExamReviewPlanState = existingPlan
      ? { ...existingPlan, days: [...existingPlan.days] }
      : {
        userId,
        examSessionId: sessionId,
        generatedAt: new Date().toISOString(),
        examAccuracyRate: report.summary.accuracyRate,
        weakPointTitles: sourcePoints.length > 0
          ? sourcePoints.slice(0, 3).map((point) => point.title)
          : [fallbackPoint.title],
        days: [],
        recommendation: report.summary.accuracyRate >= 80
          ? isPerfect
            ? '本次考试全部答对，复习任务针对本场覆盖考点做限时巩固，保持节奏。'
            : '本次考试表现较好，重点保持限时训练节奏，巩固已掌握考点。'
          : report.summary.accuracyRate >= 60
            ? '本次考试处于中间水平，优先复盘错题知识点，再做同考点专项训练。'
            : '基础还存在明显短板，建议暂停新题，先回到高频考点的概念和例题。',
      };

    const reviewPlan = { ...summaryDraft, days };
    const reviewTasks: ScheduledStudyTaskState[] = days.map((day) => ({
      id: day.taskId,
      knowledgePointId: day.knowledgePointId,
      subject: day.subject as Subject,
      chapter: this.knowledgePoints.find((point) => point.id === day.knowledgePointId)!.chapter,
      title: `考后复盘：${day.focus}`,
      mode: '考后复盘',
      minutes: day.minutes,
      questionCount: day.questionCount,
      scheduledDate: day.date,
      priority: '高',
      reason: `来源${isPerfect ? '本场考试覆盖考点（全对巩固）' : '本场考试失分考点'}，正确率 ${reviewPlan.examAccuracyRate}%。`,
      nextAction: day.tasks.join('；'),
      status: 'pending',
      postponeCount: 0,
    }));
    const persisted = await this.examReviewPlanRepository.saveActionablePlan({
      reviewPlan,
      reviewTasks,
      fallbackPlan: this.sevenDayPlansByUser.get(userId) ?? this.buildSevenDayPlan(userId),
    });
    this.examReviewPlans.set(sessionId, persisted.reviewPlan);
    this.sevenDayPlansByUser.set(userId, persisted.studyPlan);
    return persisted.reviewPlan;
  }

  private collectExamCoveredPoints(session: PracticeSession): KnowledgePoint[] {
    const covered: KnowledgePoint[] = [];
    const seen = new Set<string>();
    for (const question of session.questionSnapshot) {
      for (const pointId of question.knowledgePointIds ?? []) {
        if (seen.has(pointId)) continue;
        seen.add(pointId);
        const point = this.knowledgePoints.find((item) => item.id === pointId);
        if (point) covered.push(point);
      }
    }
    return covered;
  }

  getExamScoreHistory(userId: string) {
    const sessions = [...this.practiceSessions.values()]
      .filter((s) => s.userId === userId && s.type === 'paper' && s.completed);

    const history = sessions.map((s) => {
      const records = this.records.filter((record) => record.userId === userId && record.sessionId === s.id);
      const correctCount = records.filter((r) => r.correct).length;
      return {
        sessionId: s.id,
        date: studyDateKey(s.lastActiveAt),
        totalQuestions: s.questionIds.length,
        correctCount,
        accuracyRate: s.questionIds.length ? Math.round((correctCount / s.questionIds.length) * 100) : 0,
        totalTimeMin: Math.round(s.totalActiveMs / 60000),
      };
    }).sort((a, b) => a.date.localeCompare(b.date));

    const trend = history.length >= 2
      ? history[history.length - 1].accuracyRate - history[history.length - 2].accuracyRate
      : 0;

    return {
      userId,
      totalExams: history.length,
      latestAccuracyRate: history[history.length - 1]?.accuracyRate ?? 0,
      trend,
      trendLabel: trend > 0 ? `较上次提升 ${trend} 分` : trend < 0 ? `较上次下降 ${Math.abs(trend)} 分` : '与上次持平',
      history,
    };
  }

  private sessionView(s: PracticeSession) {
    const answeredCount = s.questionIds.filter((questionId) => isAnswered(s.answers[questionId])).length;
    const questionsById = new Map(s.questionSnapshot.map((question) => [question.id, question]));
    return {
      id: s.id,
      type: s.type,
      resourceId: s.resourceId,
      actionId: s.actionId ?? null,
      questionIds: s.questionIds,
      questions: s.questionIds.flatMap((questionId) => {
        const question = questionsById.get(questionId);
        return question ? [toStudentQuestion(question)] : [];
      }),
      answers: s.answers,
      markedQuestions: s.markedQuestions,
      currentIndex: s.currentIndex,
      revision: s.revision,
      totalQuestions: s.questionIds.length,
      answeredCount,
      startedAt: s.startedAt,
      lastActiveAt: s.lastActiveAt,
      totalActiveMs: s.totalActiveMs,
      completed: s.completed,
      progressRate: s.questionIds.length > 0
        ? Math.round((answeredCount / s.questionIds.length) * 100)
        : 0,
    };
  }
}

function isAnswered(answer?: { selectedAnswer: string }) {
  return Boolean(answer?.selectedAnswer.trim());
}

function emptyCoreMetrics() {
  const empty = (window: string) => ({ rate: null, numerator: 0, denominator: 0, window });
  return {
    registrationCompletionRate: empty('最近 30 天'),
    diagnosticCompletionRate: empty('全部内测学生'),
    firstTaskCompletionRate: empty('全部内测学生'),
    day1RetentionRate: empty('已满 1 天注册用户'),
    day7RetentionRate: empty('已满 7 天注册用户'),
    weeklyPlanCompletionRate: empty('最近 7 个自然日'),
    wrongQuestionSecondAccuracyRate: empty('首次到期重做'),
    mockExamCompletionRate: empty('全部模拟考试会话'),
    apiFailureRate: empty('最近 7 天'),
    sessionRecoverySuccessRate: empty('最近 30 天'),
  };
}

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function parseSubject(value: string | undefined): Subject | null {
  const subject = value?.trim();
  if (
    subject === '数据结构'
    || subject === '计算机组成原理'
    || subject === '操作系统'
    || subject === '计算机网络'
  ) {
    return subject;
  }

  return null;
}

function isTrialStatus(value: string | undefined): value is TrialStatus {
  return value === 'invited' || value === 'active' || value === 'completed' || value === 'follow_up';
}

function replaceNestedMap<T>(
  target: Map<string, Map<string, T>>,
  source: Map<string, Map<string, T>>,
) {
  target.clear();
  for (const [userId, values] of source) {
    target.set(userId, new Map(values));
  }
}

function taskCompletionKey(taskId: string, completedDate: string) {
  return `${taskId}@${completedDate}`;
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function dateKeyFromOffset(offset: number) {
  const date = new Date(`${todayKey()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function validateOnboardingInput(input: {
  examYear?: number;
  targetScore: number;
  currentScore: number;
  remainingDays: number;
  dailyHours: number;
  weakestSubject: Subject;
}) {
  const currentYear = new Date().getUTCFullYear();
  if (input.examYear != null && (!Number.isInteger(input.examYear) || input.examYear < currentYear || input.examYear > currentYear + 5)) {
    throw new BadRequestException('Exam year is outside the supported range');
  }
  if (!Number.isFinite(input.targetScore) || input.targetScore < 60 || input.targetScore > 150) {
    throw new BadRequestException('Target score must be between 60 and 150');
  }
  if (!Number.isFinite(input.currentScore) || input.currentScore < 0 || input.currentScore > 150 || input.currentScore > input.targetScore) {
    throw new BadRequestException('Current score must be between 0 and the target score');
  }
  if (!Number.isInteger(input.remainingDays) || input.remainingDays < 1 || input.remainingDays > 730) {
    throw new BadRequestException('Remaining days must be between 1 and 730');
  }
  if (!Number.isFinite(input.dailyHours) || input.dailyHours < 0.5 || input.dailyHours > 12) {
    throw new BadRequestException('Daily study hours must be between 0.5 and 12');
  }
  if (!parseSubject(input.weakestSubject)) {
    throw new BadRequestException('Weakest subject is invalid');
  }
}

function validateTaskCompletionInput(input: {
  completedQuestionCount?: number;
  correctCount?: number;
  minutesSpent?: number;
  selfRating?: number;
}, requireMetrics: boolean) {
  if (requireMetrics && (
    input.completedQuestionCount == null
    || input.correctCount == null
    || input.minutesSpent == null
    || input.selfRating == null
  )) {
    throw new BadRequestException('Scheduled task completion metrics are required');
  }
  if (
    input.completedQuestionCount != null
    && input.correctCount != null
    && input.correctCount > input.completedQuestionCount
  ) {
    throw new BadRequestException('Correct question count cannot exceed completed question count');
  }
}

function inferReviewReason(selfReportedReason: string, records: PracticeRecord[]) {
  const wrongRecords = records.filter((record) => !record.correct);
  const latestWrong = wrongRecords.at(-1);
  const slowCount = records.filter((record) => record.timeSpentSec > record.expectedTimeSec * 1.4).length;
  const wrongRate = records.length ? wrongRecords.length / records.length : 0;
  const signals = [selfReportedReason];
  if (slowCount >= Math.ceil(records.length / 2)) signals.push('速度风险');
  if (wrongRate >= 0.6 && latestWrong?.mistakeReason) signals.push(latestWrong.mistakeReason);
  if (signals.length === 1 && latestWrong?.mistakeReason) signals.push(latestWrong.mistakeReason);
  return [...new Set(signals)].join(' + ');
}

function comparePracticeRecordOrder(left: PracticeRecord, right: PracticeRecord) {
  return left.submittedAt.localeCompare(right.submittedAt) || left.id.localeCompare(right.id);
}

export type PaperType = '模拟卷' | '阶段卷' | '专项卷';

export interface GeneratedPaper {
  id: string;
  title: string;
  paperType: PaperType;
  questionCount: number;
  knowledgePointIds: string[];
  questions: Question[];
  estimatedMinutes: number;
  createdBy: string;
  createdAt: string;
}

export interface AssessmentHistoryItem {
  id: string;
  paperId?: string;
  sessionId?: string;
  userId: string;
  title: string;
  submittedAt: string;
  score: number;
  totalScore: number;
  accuracyRate: number;
  elapsedSec: number;
  unansweredCount: number;
  weakPointTitle: string;
  reviewSuggestion: string;
}

export interface AdminManagedUser {
  id: string;
  email?: string;
  name: string;
  role: 'student' | 'teacher' | 'admin';
  trialStatus: TrialStatus;
  stage?: string;
  targetScore?: number;
  targetSchool?: string;
  lastActiveAt: string;
  nextAction: string;
}

export interface FeedbackItem {
  id: string;
  userId: string;
  rating: number;
  scene: string;
  message: string;
  surveyUrl: string;
  status: 'new' | 'reviewed';
  createdAt: string;
}

export interface StudyReminder {
  id: string;
  type: 'weakness' | 'wrong-question' | 'daily-task' | 'habit' | 'trial' | 'feedback';
  priority: 'high' | 'medium' | 'low';
  title: string;
  reason: string;
  actionText: string;
  actionAnchor: string;
}

export interface ReviewResourceRecommendation {
  source: 'memory-api' | 'postgresql';
  userId: string;
  generatedAt: string;
  weakPointCount: number;
  items: ReviewResource[];
}

export interface ReviewResource {
  id: string;
  knowledgePointId: string;
  knowledgePointTitle: string;
  subject: string;
  resourceType: 'concept_card' | 'mistake_checklist' | 'example_walkthrough' | 'practice_set';
  title: string;
  summary: string;
  estimatedMinutes: number;
  difficulty: '基础' | '中等' | '提高';
  actionText: string;
  actionAnchor: string;
}

// Phase 4 session types
interface PracticeSession {
  id: string;
  userId: string;
  type: 'practice_set' | 'stage_assessment' | 'paper';
  resourceId?: string;
  actionId?: string;
  questionIds: string[];
  questionSnapshot: Question[];
  answers: Record<string, { selectedAnswer: string; timeSpentSec: number; selfScore?: number; maxScore?: number; confidence?: '确定' | '不确定' | '完全不会'; usedHint?: boolean; answerModified?: boolean }>;
  markedQuestions: string[];
  currentIndex: number;
  revision: number;
  startedAt: string;
  lastActiveAt: string;
  totalActiveMs: number;
  lastResumeAt: number;
  completed: boolean;
}

interface ExamSession {
  id: string;
  practiceSessionId: string;
  timeLimitSec: number;
  overtime: boolean;
}

export interface ReviewSchedule {
  questionId: string;
  userId: string;
  inferredReason?: string;
  selfReportedReason?: string;
  note?: string;
  lastWrongRecordId?: string;
  redoCorrect: boolean;
  timeSpentSec: number;
  consecutiveCorrect: number;
  stability: 'learning' | 'review' | 'mastered';
  nextReviewAt: string;
  reviewCount: number;
  lastReviewedAt?: string;
}

function toJsonSnapshot<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function serializeFailure(error: unknown): Prisma.InputJsonObject {
  const statusCode = typeof (error as { getStatus?: () => number })?.getStatus === 'function'
    ? (error as { getStatus: () => number }).getStatus()
    : 500;
  const response = typeof (error as { getResponse?: () => unknown })?.getResponse === 'function'
    ? (error as { getResponse: () => unknown }).getResponse()
    : null;
  const message = response && typeof response === 'object' && 'message' in response
    ? (response as { message?: unknown }).message
    : error instanceof Error
      ? error.message
      : 'Answer submission failed';
  return {
    statusCode,
    message: typeof message === 'string' ? message : JSON.stringify(message),
  };
}

function replayFailedReceipt(snapshot: Prisma.JsonValue | null): HttpException {
  const body = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? snapshot as { statusCode?: unknown; message?: unknown }
    : {};
  const statusCode = typeof body.statusCode === 'number' ? body.statusCode : 500;
  const message = typeof body.message === 'string' ? body.message : 'Answer submission failed';
  return new HttpException(message, statusCode);
}

function toFeedbackItem(record: FeedbackRecord): FeedbackItem {
  return { ...record, surveyUrl: OFFICIAL_FEEDBACK_SURVEY_URL };
}

function replaceFeedbackItems(target: FeedbackItem[], records: FeedbackRecord[]) {
  target.splice(0, target.length, ...records.map(toFeedbackItem));
}

const SUBJECT_NAME_BY_CODE: Record<string, Subject> = {
  DS: '数据结构',
  CO: '计算机组成原理',
  OS: '操作系统',
  CN: '计算机网络',
};

function subjectNameFromCode(code: string): Subject {
  return SUBJECT_NAME_BY_CODE[code] ?? '未分类';
}
