import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  applyDiagnosticProfile as buildDiagnosticProfile,
  buildStudyPlan,
  classifyMistake,
  computeWeaknessReport,
  postExamTaskId,
  type DiagnosticProfile,
  type KnowledgePoint,
  type PracticeRecord,
  type Question,
  type StudyStage,
  type Subject,
  type UserProfile,
} from '@kaoyan408/shared';
import { CreatePracticeRecordDto } from './dto/create-practice-record.dto';
import { QuestionsService, type ReviewItem } from '../questions/questions.service';
import { toStudentQuestion, toStudentQuestions } from '../questions/question-view';
import { PracticeRecordRepository } from './practice-record.repository';
import { LearningProgressRepository, type TaskCompletionMetric } from './learning-progress.repository';
import { LearningSessionRepository } from './learning-session.repository';
import { LearningProfileRepository } from './learning-profile.repository';
import { RuntimeStateRepository } from './runtime-state.repository';
import { ReviewScheduleRepository, scheduleKey, type ReviewAttemptState } from './review-schedule.repository';
import { ExamReviewPlanRepository, type ExamReviewPlanState } from './exam-review-plan.repository';
import {
  nearestAvailableStudyDate,
  OnboardingPlanRepository,
  type OnboardingProfileState,
  type ScheduledStudyTaskState,
  type SevenDayPlanState,
} from './onboarding-plan.repository';
import { BetaMetricsService } from './beta-metrics.service';
import { AuthenticatedUserRegistry } from '../auth/authenticated-user.registry';
import { TeacherStudentAuthorizationRepository } from './teacher-student-authorization.repository';
import { AdminUserRepository, type ManagedUserRecord, type TrialStatus } from './admin-user.repository';
import { FEEDBACK_SCENES, FeedbackRepository, type FeedbackRecord, type FeedbackScene } from './feedback.repository';
import { studyDateKey } from './study-date';

const OFFICIAL_FEEDBACK_SURVEY_URL = 'https://wj.qq.com/s2/27160624/40fe/';

@Injectable()
export class StudyService implements OnModuleInit {
  private readonly logger = new Logger(StudyService.name);

  constructor(
    private readonly questionsService: QuestionsService,
    private readonly practiceRecordRepository: PracticeRecordRepository,
    private readonly learningProgressRepository: LearningProgressRepository,
    private readonly learningSessionRepository: LearningSessionRepository,
    private readonly learningProfileRepository: LearningProfileRepository,
    private readonly runtimeStateRepository: RuntimeStateRepository,
    private readonly reviewScheduleRepository: ReviewScheduleRepository,
    private readonly examReviewPlanRepository: ExamReviewPlanRepository,
    private readonly onboardingPlanRepository: OnboardingPlanRepository,
    private readonly betaMetricsService: BetaMetricsService,
    private readonly authenticatedUsers: AuthenticatedUserRegistry,
    private readonly teacherStudentAuthorizations: TeacherStudentAuthorizationRepository,
    private readonly adminUsers: AdminUserRepository,
    private readonly feedbackRepository: FeedbackRepository,
  ) {}

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

  private get questions(): Question[] {
    return this.questionsService.listQuestions();
  }

  private readonly records: PracticeRecord[] = [
    { id: 'r-001', userId: 'u-001', questionId: 'q-001', knowledgePointId: 'co-cache', correct: false, timeSpentSec: 180, expectedTimeSec: 100, mistakeReason: '概念不清', submittedAt: '2026-06-21' },
    { id: 'r-002', userId: 'u-001', questionId: 'q-001', knowledgePointId: 'co-cache', correct: false, timeSpentSec: 120, expectedTimeSec: 100, mistakeReason: '概念不清', submittedAt: '2026-06-22' },
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
    const runtimeState = await this.runtimeStateRepository.loadAll();
    replaceArrayFromState(this.papers, runtimeState.get('papers'));
    replaceArrayFromState(this.assessmentHistoryItems, runtimeState.get('assessmentHistoryItems'));
    replaceFeedbackItems(this.feedbackItems, await this.feedbackRepository.list());
    const savedSystemConfig = runtimeState.get('systemConfig');
    if (savedSystemConfig && typeof savedSystemConfig === 'object') {
      this.systemConfig = savedSystemConfig as typeof this.systemConfig;
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

  createKnowledgePoint(input: Partial<KnowledgePoint>) {
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

    this.knowledgePoints.push(point);
    this.questionsService.registerKnowledgePoint(point);
    return point;
  }

  getOverviewReport(userId?: string) {
    const uid = userId ?? this.student.id;
    const student = this.getStudent(uid);
    return computeWeaknessReport({
      knowledgePoints: this.knowledgePoints,
      records: this.records.filter((r) => r.userId === uid),
      targetScore: student.targetScore ?? 115,
    });
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
    const subjects: Subject[] = ['数据结构', '计算机组成原理', '操作系统', '计算机网络'];
    const wrongQuestions = this.listWrongQuestions(userId);
    const wrongByPoint = new Map<string, number>();
    for (const item of wrongQuestions) {
      wrongByPoint.set(item.knowledgePointId, (wrongByPoint.get(item.knowledgePointId) ?? 0) + item.wrongCount);
    }

    const subjectMaps = subjects.map((subject) => {
      const points = this.knowledgePoints
        .filter((point) => point.subject === subject)
        .map((point) => {
          const records = this.records.filter((record) => record.userId === userId && record.knowledgePointId === point.id);
          const taskIds = new Set(this.sevenDayPlansByUser.get(userId)?.tasks
            .filter((task) => task.knowledgePointId === point.id)
            .map((task) => task.id) ?? []);
          const taskMetrics = [...(this.taskCompletionMetricsByUser.get(userId)?.entries() ?? [])]
            .filter(([taskId]) => taskIds.has(taskId))
            .map(([, metric]) => metric);
          const taskQuestionCount = taskMetrics.reduce((sum, metric) => sum + metric.completedQuestionCount, 0);
          const taskCorrectCount = taskMetrics.reduce((sum, metric) => sum + metric.correctCount, 0);
          const correctCount = records.filter((record) => record.correct).length + taskCorrectCount;
          const practiceCount = records.length + taskQuestionCount;
          const wrongCount = records.filter((record) => !record.correct).length + Math.max(0, taskQuestionCount - taskCorrectCount) + (wrongByPoint.get(point.id) ?? 0);
          const accuracyRate = practiceCount ? Math.round((correctCount / practiceCount) * 100) : 0;
          const practiceCoverage = Math.min(100, practiceCount * 25);
          const masteryRate = practiceCount
            ? Math.round((accuracyRate * 0.7) + (practiceCoverage * 0.3))
            : Math.max(10, Math.round((point.frequency + point.importance) * 6));
          const status: MasteryStatus = masteryRate < 60 || wrongCount >= 2
            ? 'weak'
            : masteryRate < 80 || practiceCount < 3
              ? 'review'
              : 'mastered';

          return {
            knowledgePointId: point.id,
            title: point.title,
            chapter: point.chapter,
            importance: point.importance,
            frequency: point.frequency,
            masteryRate,
            accuracyRate,
            practiceCount,
            wrongCount,
            status,
            nextAction: status === 'weak'
              ? '先复盘错题，再做 5 道同考点基础题。'
              : status === 'review'
                ? '补 3 道变式题，并记录易混点。'
                : '进入限时训练，保持速度和稳定性。',
            actionAnchor: status === 'weak' ? '#wrong-book' : '#question',
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
      todayPlan: this.getTodayPlan(userId),
    };
  }

  getTodayPlan(userId: string) {
    const scheduledPlan = this.sevenDayPlansByUser.get(userId);
    const plan = this.generatePlan(userId);
    const report = this.getOverviewReport(userId);
    const calendar = this.getLearningCalendar(userId);
    const wrongQuestions = this.listWrongQuestions(userId);
    const today = todayKey();

    if (scheduledPlan) {
      const dayTasks = scheduledPlan.tasks.filter((task) => task.scheduledDate === today);
      const completedTasks = dayTasks.filter((task) => task.status === 'completed').length;
      const priorityTasks = dayTasks.map((task) => ({
        ...task,
        completed: task.status === 'completed',
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
        reviewDue: wrongQuestions.filter((q) => q.reviewStatus === 'pending').length,
        checkpoint: scheduledPlan.checkpoint,
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
      })),
      reviewDue: wrongQuestions.filter((q) => q.reviewStatus === 'pending').length,
      checkpoint: plan.checkpoint,
      weekProgress: [],
    };
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
    if (teacherId && authorizedIds.length === 0) {
      throw new ForbiddenException('Teacher has no authorized students');
    }
    const studentIds = authorizedIds.length ? authorizedIds : [this.student.id];
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
      summary: this.buildAssessmentHistorySummary(items),
    };
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
    await this.runtimeStateRepository.save('papers', this.papers);
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

    this.assessmentHistoryItems.push({
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
    });
    await this.runtimeStateRepository.save('assessmentHistoryItems', this.assessmentHistoryItems);

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
    await this.runtimeStateRepository.save('systemConfig', this.systemConfig);

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

  listWrongQuestions(userId = this.student.id) {
    const grouped = new Map<string, PracticeRecord[]>();
    const reviewedQuestions = this.wrongQuestionReviewDatesByUser.get(userId) ?? new Map<string, string>();
    for (const record of this.records.filter((item) => item.userId === userId)) {
      const bucket = grouped.get(record.questionId) ?? [];
      bucket.push(record);
      grouped.set(record.questionId, bucket);
    }

    return [...grouped.entries()].flatMap(([questionId, records]) => {
      const latestRecord = records[records.length - 1];
      if (latestRecord.correct) {
        return [];
      }

      const question = this.questions.find((item) => item.id === questionId);
      const knowledgePoint = this.knowledgePoints.find((item) => item.id === latestRecord.knowledgePointId);
      const wrongCount = records.filter((record) => !record.correct).length;

      return [{
        questionId,
        stem: question?.stem ?? questionId,
        answer: question?.answer,
        analysis: question?.analysis,
        knowledgePointId: latestRecord.knowledgePointId,
        knowledgePointTitle: knowledgePoint?.title ?? latestRecord.knowledgePointId,
        subject: knowledgePoint?.subject ?? '未分类',
        chapter: knowledgePoint?.chapter ?? '未分类',
        wrongCount,
        latestMistakeReason: latestRecord.mistakeReason,
        latestSubmittedAt: latestRecord.submittedAt,
        reviewStatus: reviewedQuestions.has(questionId) ? 'reviewed' : 'pending',
        reviewedAt: reviewedQuestions.get(questionId) ?? null,
      }];
    });
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
      this.reviewSchedules.set(key, schedule);
      await this.reviewScheduleRepository.saveSchedule(schedule);
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

    // Spaced repetition intervals
    const intervals = [1, 3, 7, 14]; // days
    const intervalIndex = Math.min(consecutiveCorrect, intervals.length - 1);
    const nextIntervalDays = consecutiveCorrect === 0 ? 1 : intervals[intervalIndex];

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
    this.reviewSchedules.set(key, schedule);
    const attempt: ReviewAttemptState = {
      redoCorrect: input.redoCorrect,
      timeSpentSec: input.timeSpentSec,
      reportedReason: selfReportedReason,
      inferredReason,
      nextIntervalDays,
      reviewedAt: now.toISOString(),
    };
    const attempts = this.reviewAttemptsByKey.get(key) ?? [];
    attempts.push(attempt);
    this.reviewAttemptsByKey.set(key, attempts);
    await this.reviewScheduleRepository.saveReview(schedule, attempt);

    // Also mark as reviewed in the existing tracking
    const reviewed = this.wrongQuestionReviewDatesByUser.get(userId) ?? new Map<string, string>();
    reviewed.set(questionId, now.toISOString());
    this.wrongQuestionReviewDatesByUser.set(userId, reviewed);
    await this.learningProgressRepository.saveWrongQuestionReview(userId, questionId, now.toISOString());

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
    const point = question?.knowledgePointIds[0]
      ? this.knowledgePoints.find((k) => k.id === question.knowledgePointIds[0])
      : undefined;

    const key = scheduleKey(userId, questionId);
    const schedule = this.reviewSchedules.get(key);
    const reviewHistory = this.reviewAttemptsByKey.get(key) ?? [];
    const similar = this.findSimilarQuestions(questionId, point?.id ?? '');

    return {
      questionId,
      stem: question?.stem ?? questionId,
      answer: question?.answer,
      analysis: question?.analysis,
      knowledgePointTitle: point?.title ?? '未知考点',
      subject: point?.subject ?? '未分类',
      chapter: point?.chapter ?? '未分类',
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
      recommendation: schedule?.stability === 'mastered'
        ? '已稳定掌握，保持定期限时训练。'
        : schedule?.stability === 'review'
          ? '在巩固阶段，继续按间隔复习并记录易错条件。'
          : '仍在学习阶段，建议先重读概念再重做。',
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
      mistakeReasonStats: [...mistakeReasonCounts.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((left, right) => right.count - left.count),
      priorityRedoItems,
      nextReviewActions,
      generatedAt: new Date().toISOString(),
    };
  }

  getRecommendedPracticeSet(userId = this.student.id) {
    const report = this.getOverviewReport(userId);
    const stage = this.getStudent(userId).stage ?? '强化';
    const weakPointIds = report.weakPoints.map((point) => point.knowledgePointId);
    const fallbackPointIds = this.generatePlan(userId).dailyTasks.map((task) => task.knowledgePointId);
    const knowledgePointIds = [...new Set([...(weakPointIds.length ? weakPointIds : fallbackPointIds)])].slice(0, 4);
    let matchingQuestions = this.questions.filter((question) =>
      question.knowledgePointIds.some((id) => knowledgePointIds.includes(id)),
    );
    if (matchingQuestions.length === 0) {
      knowledgePointIds.push(...this.questions.flatMap((question) => question.knowledgePointIds).slice(0, 2));
      matchingQuestions = this.questions.filter((question) =>
        question.knowledgePointIds.some((id) => knowledgePointIds.includes(id)),
      );
    }
    const questionCount = stage === '冲刺' ? 20 : report.accuracyRate < 55 ? 16 : 12;
    const questions = matchingQuestions.slice(0, Math.min(questionCount, matchingQuestions.length));

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

  getRecommendedReviewResources(userId = this.student.id): ReviewResourceRecommendation {
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
            : '按概念不清、条件遗漏、计算失误、审题偏差四类检查最近错因。',
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

  async createPracticeRecord(input: CreatePracticeRecordDto & { userId: string; questionSnapshot?: Question }) {
    const questionSnapshot = input.questionSnapshot
      ?? await this.questionsService.findQuestionById(input.questionId)
      ?? undefined;
    const record = this.buildPracticeRecord({ ...input, questionSnapshot });
    const savedRecord = await this.practiceRecordRepository.save(record);
    this.records.push(savedRecord);
    if (!savedRecord.correct) {
      await this.ensureReviewSchedule(savedRecord);
    }
    return savedRecord;
  }

  private buildPracticeRecord(input: CreatePracticeRecordDto & { userId: string; questionSnapshot?: Question }): PracticeRecord {
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
      gradingMode: isSubjective ? 'self_assessed' : 'objective',
      selfScore: input.selfScore,
      maxScore: input.maxScore,
    };
  }

  private async ensureReviewSchedule(record: PracticeRecord) {
    const key = scheduleKey(record.userId, record.questionId);
    const existing = this.reviewSchedules.get(key);
    const nextReviewAt = new Date();
    nextReviewAt.setUTCDate(nextReviewAt.getUTCDate() + 1);
    const schedule: ReviewSchedule = {
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
    this.reviewSchedules.set(key, schedule);
    if (!this.reviewAttemptsByKey.has(key)) this.reviewAttemptsByKey.set(key, []);
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
    return this.createStageAssessmentResult(userId, records);
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

  createTutorReply(input: {
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
    const isCorrect = selectedAnswer ? selectedAnswer === question.answer : null;
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
    const explanationSteps = [
      `先定位考点：${knowledgePoint?.subject ?? '408'} / ${knowledgePoint?.chapter ?? '高频章节'} / ${knowledgePoint?.title ?? question.knowledgePointIds[0] ?? '核心考点'}。`,
      `再看标准解析：${question.analysis}`,
      selectedAnswer
        ? `你选择了 ${selectedAnswer}，标准答案是 ${question.answer}，${isCorrect ? '说明方向正确，接下来要压缩解题时间。' : '建议回到题干条件，重新对照公式或定义。'}`
        : `本题标准答案是 ${question.answer}，建议先独立复盘一遍再看解析。`,
    ];

    const reply = {
      id: `tutor-${Date.now()}`,
      userId: input.userId ?? this.student.id,
      questionId: question.id,
      prompt: input.prompt,
      knowledgePointId: knowledgePoint?.id ?? question.knowledgePointIds[0],
      knowledgePointTitle: knowledgePoint?.title ?? question.knowledgePointIds[0] ?? '408 高频考点',
      answerCheck: selectedAnswer
        ? `你选择 ${selectedAnswer}，正确答案是 ${question.answer}，${isCorrect ? '本题作答正确。' : '本题需要重点复盘。'}`
        : `正确答案是 ${question.answer}。`,
      explanationSteps,
      similarQuestions: [...similarQuestions, ...fallbackSimilarQuestions, ...broadSimilarQuestions].map((item) => ({
        id: item.id,
        stem: item.stem,
        difficulty: item.difficulty,
        source: item.source,
      })),
      nextActions: [
        `复述 ${knowledgePoint?.title ?? '该考点'} 的核心规则，并写出本题用到的判断依据。`,
        '完成 2-3 道同考点相似题，重点记录错因而不是只看答案。',
        '如果仍然出错，把题干条件逐句标注，检查是否遗漏限制条件。',
      ],
      source: 'standard-analysis-assisted',
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

  createAiFollowUp(input: {
    userId?: string;
    questionId: string;
    message?: string;
  }) {
    const question = this.questions.find((item) => item.id === input.questionId);
    if (!question) {
      throw new BadRequestException(`Question ${input.questionId} was not found`);
    }

    const knowledgePoint = this.knowledgePoints.find((point) => point.id === question.knowledgePointIds[0]);
    const message = input.message?.trim() || '请解释这道题并整理复习卡片。';
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
      replySteps: [
        `先定位考点：本题主要考 ${relatedPointTitle}，不要只记答案，要看题干条件如何触发规则。`,
        `再对照标准答案：正确答案是 ${question.answer}，解析依据是：${question.analysis}`,
        message.includes('A')
          ? '你提到的 A 选项通常是干扰项，建议把它和正确选项逐句比较，找出条件不匹配的位置。'
          : '如果仍不确定，先把题干中的限制条件圈出来，再判断每个选项是否满足这些条件。',
      ],
      misconceptionTips: [
        `不要把 ${relatedPointTitle} 的定义和相邻考点混用。`,
        '408 选择题常用“看起来熟悉但条件不完整”的选项制造干扰。',
      ],
      reviewCards: [
        {
          id: `card-concept-${question.id}`,
          type: 'concept',
          title: `${relatedPointTitle} 核心概念`,
          content: `复习时先能口述 ${relatedPointTitle} 的定义、适用条件和常见题干关键词。`,
          nextAction: '用 2 分钟写出本考点的判断依据，再做 2 道同考点题。',
        },
        {
          id: `card-rule-${question.id}`,
          type: 'rule',
          title: '本题判断规则',
          content: `看到类似题目时，先提取题干条件，再和选项逐项匹配；本题标准答案为 ${question.answer}。`,
          nextAction: '重做本题，并说明为什么其他选项不满足条件。',
        },
        {
          id: `card-mix-${question.id}`,
          type: 'confusion',
          title: '易混点提醒',
          content: `如果把 ${relatedPointTitle} 和前置知识混淆，容易只凭关键词选错。`,
          nextAction: '整理一个“易混选项对比表”，记录正确条件和错误诱因。',
        },
      ],
      nextActions: [
        '先复述本题考点，再回到错题本标记是否真正理解。',
        '完成 3 道同知识点题目，观察是否还会被同类干扰项影响。',
      ],
      source: 'standard-analysis-follow-up',
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

  private buildAssessmentHistorySummary(items: AssessmentHistoryItem[]) {
    const latest = items[0];
    const previous = items[1];
    const bestScore = items.length ? Math.max(...items.map((item) => item.score)) : 0;
    const improvementText = !latest
      ? '还没有测评记录，先完成一套模拟卷建立基线。'
      : !previous
        ? '已建立第一次测评基线，下一次可重点观察正确率和用时变化。'
        : latest.score > previous.score
          ? `较上次提升 ${latest.score - previous.score} 分，继续巩固本次薄弱点。`
          : latest.score === previous.score
            ? '与上次持平，建议通过限时训练和错题复盘提高稳定性。'
            : `较上次下降 ${previous.score - latest.score} 分，先复盘本次错题再进入新题训练。`;

    return {
      attemptCount: items.length,
      bestScore,
      latestAccuracyRate: latest?.accuracyRate ?? 0,
      improvementText,
    };
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
        return {
          date,
          taskCount: tasks.length,
          completedTasks,
          totalMinutes: tasks.reduce((sum, task) => sum + task.minutes, 0),
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
    const plan = buildStudyPlan({
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
    answers?: Record<string, { selectedAnswer: string; timeSpentSec: number; selfScore?: number; maxScore?: number }>;
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
    answers: Array<{ questionId: string; selectedAnswer: string; timeSpentSec: number; selfScore?: number; maxScore?: number }>;
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
          selectedAnswer: answer.selectedAnswer,
          timeSpentSec: answer.timeSpentSec,
          sessionId,
          selfScore: answer.selfScore,
          maxScore: answer.maxScore,
          questionSnapshot: snapshotQuestions.get(answer.questionId),
        }),
      );

      const committed = await this.learningSessionRepository.commitSubmission(submittedSession, records);
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

    const days = Array.from({ length: 3 }, (_, index) => {
      const date = new Date(localToday);
      date.setUTCDate(localToday.getUTCDate() + index + 1);
      const loss = report.knowledgePointLosses[index] ?? report.knowledgePointLosses[0];
      const point = loss
        ? this.knowledgePoints.find((item) => item.id === loss.knowledgePointId) ?? fallbackPoint
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
          index === 0 ? `复盘 ${point.title} 的错题，写出每道题的错因。` : '',
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
        weakPointTitles: report.knowledgePointLosses.length
          ? report.knowledgePointLosses.slice(0, 3).map((point) => point.title)
          : [fallbackPoint.title],
        days: [],
        recommendation: report.summary.accuracyRate >= 80
          ? '本次考试表现较好，重点保持限时训练节奏，巩固已掌握考点。'
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
      reason: `来源考试 ${sessionId}，正确率 ${reviewPlan.examAccuracyRate}%。`,
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

function todayKey() {
  return studyDateKey(new Date());
}

function lastNDates(count: number) {
  const today = new Date(`${todayKey()}T00:00:00.000Z`);

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - (count - index - 1));
    return date.toISOString().slice(0, 10);
  });
}

function nextNDates(count: number) {
  const today = new Date(`${todayKey()}T00:00:00.000Z`);

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function countByDate(dates: string[]) {
  return dates.reduce((acc, date) => {
    const key = studyDateKey(date);
    acc.set(key, (acc.get(key) ?? 0) + 1);
    return acc;
  }, new Map<string, number>());
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

function replaceArrayFromState<T>(target: T[], value: unknown) {
  if (!Array.isArray(value)) return;
  target.splice(0, target.length, ...(value as T[]));
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

type MasteryStatus = 'weak' | 'review' | 'mastered';

// Phase 4 session types
interface PracticeSession {
  id: string;
  userId: string;
  type: 'practice_set' | 'stage_assessment' | 'paper';
  resourceId?: string;
  questionIds: string[];
  questionSnapshot: Question[];
  answers: Record<string, { selectedAnswer: string; timeSpentSec: number; selfScore?: number; maxScore?: number }>;
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

function toFeedbackItem(record: FeedbackRecord): FeedbackItem {
  return { ...record, surveyUrl: OFFICIAL_FEEDBACK_SURVEY_URL };
}

function replaceFeedbackItems(target: FeedbackItem[], records: FeedbackRecord[]) {
  target.splice(0, target.length, ...records.map(toFeedbackItem));
}
