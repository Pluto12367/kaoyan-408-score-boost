import { BadRequestException, Injectable } from '@nestjs/common';
import {
  applyDiagnosticProfile as buildDiagnosticProfile,
  buildStudyPlan,
  classifyMistake,
  computeWeaknessReport,
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

@Injectable()
export class StudyService {
  constructor(private readonly questionsService: QuestionsService) {}

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

  private diagnosticProfile: DiagnosticProfile | null = null;

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

  private readonly completedTaskDatesByUser = new Map<string, Map<string, string>>();

  private readonly wrongQuestionReviewDatesByUser = new Map<string, Map<string, string>>();

  private readonly aiReviewItems: ReviewItem[] = [];

  private readonly papers: GeneratedPaper[] = [];

  private readonly stageAssessmentResults: Array<Record<string, unknown>> = [];

  private readonly practiceSetResults: Array<Record<string, unknown>> = [];

  private readonly feedbackItems: FeedbackItem[] = [];

  private systemConfig = {
    source: process.env.DATABASE_URL ? 'postgres-ready-api' : 'memory-api',
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

  getOverviewReport() {
    return computeWeaknessReport({
      knowledgePoints: this.knowledgePoints,
      records: this.records,
      targetScore: this.student.targetScore ?? 115,
    });
  }

  getDashboardOverview() {
    return {
      source: process.env.DATABASE_URL ? 'postgres-ready-api' : 'memory-api',
      student: this.student,
      knowledgePoints: this.knowledgePoints,
      questions: this.questions,
      practiceRecords: this.records,
      wrongQuestions: this.listWrongQuestions(this.student.id),
      learningCalendar: this.getLearningCalendar(this.student.id),
      stageAssessment: this.getStageAssessment(this.student.id),
      report: this.getOverviewReport(),
      plan: this.generatePlan(),
    };
  }

  getTrialProgress(userId = this.student.id) {
    const completedTasks = this.completedTaskDatesByUser.get(userId) ?? new Map<string, string>();
    const reviewedWrongQuestions = this.wrongQuestionReviewDatesByUser.get(userId) ?? new Map<string, string>();
    const userPracticeSetResults = this.practiceSetResults.filter((item) => item.userId === userId);
    const userFeedbackItems = this.feedbackItems.filter((item) => item.userId === userId);
    const items = [
      {
        id: 'diagnostic',
        title: '提交入学诊断',
        description: '生成目标分、当前阶段和第一版学习计划。',
        completed: Boolean(this.diagnosticProfile),
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
        completed: userFeedbackItems.length > 0,
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

  getStudyReminders(userId = this.student.id) {
    const report = this.getOverviewReport();
    const plan = this.generatePlan();
    const wrongQuestions = this.listWrongQuestions(userId);
    const trialProgress = this.getTrialProgress(userId);
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
    const report = this.getOverviewReport();
    const plan = this.generatePlan();
    const wrongQuestions = this.listWrongQuestions(userId);
    const calendar = this.getLearningCalendar(userId);
    const scoreGap = Math.max(0, (this.student.targetScore ?? 0) - (this.student.currentScore ?? 0));
    const weakPointTitles = (report.weakPoints.length ? report.weakPoints : report.speedRisks)
      .map((point) => point.title)
      .slice(0, 4);
    const fallbackFocus = plan.dailyTasks.map((task) => task.title).slice(0, 3);
    const focusPool = weakPointTitles.length ? weakPointTitles : fallbackFocus;
    const baseQuestionTarget = clampNumber(
      this.systemConfig.recommendation.dailyTargetQuestionCount,
      10,
      this.student.stage === '冲刺' ? 80 : 60,
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
        minutes: Math.max(45, Math.round((this.student.dailyHours ?? 3) * 60)),
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
      ...((this.student.remainingDays ?? 0) < 60 ? ['剩余时间偏紧，需要优先保证高频考点和真题回看。'] : []),
      ...(wrongQuestions.length > 0 ? [`错题本仍有 ${wrongQuestions.length} 道待处理，建议每天至少复盘 ${reviewBase} 道。`] : []),
      ...(report.accuracyRate < 60 ? [`当前正确率 ${report.accuracyRate}%，本周先稳住基础题正确率。`] : []),
      ...(calendar.today.practiceCount === 0 ? ['今天还没有练习记录，建议先完成一组短题。'] : []),
    ];

    return {
      userId,
      title: '7 天冲刺计划',
      currentStage: this.student.stage,
      scoreGap,
      targetScore: this.student.targetScore,
      currentScore: this.student.currentScore,
      remainingDays: this.student.remainingDays,
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
          const correctCount = records.filter((record) => record.correct).length;
          const practiceCount = records.length;
          const wrongCount = records.filter((record) => !record.correct).length + (wrongByPoint.get(point.id) ?? 0);
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
    const report = this.getOverviewReport();
    const calendar = this.getLearningCalendar(userId);
    const reviewedWrongQuestions = this.wrongQuestionReviewDatesByUser.get(userId) ?? new Map<string, string>();
    const userPracticeSetResults = this.practiceSetResults.filter((item) => item.userId === userId);
    const userStageResults = this.stageAssessmentResults.filter((item) => item.userId === userId);
    const timeline = [
      ...(this.diagnosticProfile ? [{
        id: 'timeline-diagnostic',
        type: 'diagnostic',
        title: '入学诊断完成',
        date: todayKey(),
        summary: this.diagnosticProfile.diagnosis,
      }] : []),
      ...userPracticeSetResults.map((item) => ({
        id: `timeline-${item.id}`,
        type: 'practice_set',
        title: '推荐题组练习',
        date: String(item.submittedAt).slice(0, 10),
        summary: `完成 ${item.totalQuestions} 题，正确率 ${item.accuracyRate}%。`,
      })),
      ...userStageResults.map((item) => ({
        id: `timeline-${item.id}`,
        type: 'stage_assessment',
        title: '阶段测评',
        date: String(item.submittedAt).slice(0, 10),
        summary: `得分 ${item.score}，计划调整为 ${(item.adjustment as { planPhase?: string })?.planPhase ?? this.generatePlan().phase}。`,
      })),
      ...[...reviewedWrongQuestions.entries()].map(([questionId, reviewedAt]) => ({
        id: `timeline-review-${questionId}`,
        type: 'wrong_review',
        title: '错题复盘',
        date: reviewedAt.slice(0, 10),
        summary: `已复盘错题 ${questionId}，并获得同考点练习建议。`,
      })),
    ].sort((left, right) => right.date.localeCompare(left.date));

    return {
      userId,
      summary: {
        name: this.student.name,
        currentStage: this.student.stage,
        targetScore: this.student.targetScore,
        currentScore: this.student.currentScore,
        weakestSubject: this.student.weakestSubject,
        accuracyRate: report.accuracyRate,
        streakDays: calendar.streakDays,
      },
      loopStats: {
        diagnosticCompleted: Boolean(this.diagnosticProfile),
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

  applyDiagnosticProfile(input: {
    targetScore: number;
    currentScore: number;
    remainingDays: number;
    dailyHours: number;
    weakestSubject: Subject;
  }) {
    const profile = buildDiagnosticProfile(input);
    this.student.targetScore = profile.targetScore;
    this.student.currentScore = profile.currentScore;
    this.student.remainingDays = profile.remainingDays;
    this.student.dailyHours = profile.dailyHours;
    this.student.weakestSubject = profile.weakestSubject;
    this.student.stage = profile.stage;
    this.diagnosticProfile = profile;
    return profile;
  }

  getAdminMetrics() {
    const report = this.getOverviewReport();
    const calendar = this.getLearningCalendar(this.student.id);
    const wrongQuestions = this.listWrongQuestions(this.student.id);
    const completedTaskCount = this.generatePlan().completedTaskCount ?? 0;
    const activeDates = new Set(this.records.map((record) => record.submittedAt.slice(0, 10)));

    return {
      source: process.env.DATABASE_URL ? 'postgres-ready-api' : 'memory-api',
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
      generatedAt: new Date().toISOString(),
    };
  }

  getReviewQueue() {
    const items = [...this.questionsService.listReviewItems(), ...this.aiReviewItems]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    return {
      source: process.env.DATABASE_URL ? 'postgres-ready-api' : 'memory-api',
      pendingCount: items.filter((item) => item.status === 'pending').length,
      approvedCount: items.filter((item) => item.status === 'approved').length,
      items,
      generatedAt: new Date().toISOString(),
    };
  }

  getSystemConfig() {
    return this.systemConfig;
  }

  submitFeedback(input: {
    userId?: string;
    rating?: number;
    scene?: string;
    message?: string;
    surveyUrl?: string;
  }) {
    const message = input.message?.trim();
    if (!message) {
      throw new BadRequestException('Feedback message is required');
    }

    const feedback: FeedbackItem = {
      id: `feedback-${Date.now()}`,
      userId: input.userId ?? this.student.id,
      rating: clampNumber(input.rating ?? 5, 1, 5),
      scene: input.scene?.trim() || '试用体验',
      message,
      surveyUrl: input.surveyUrl ?? 'https://wj.qq.com/s2/27160624/40fe/',
      status: 'new',
      createdAt: new Date().toISOString(),
    };

    this.feedbackItems.push(feedback);
    return feedback;
  }

  getFeedbackList() {
    const items = [...this.feedbackItems].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const averageRating = items.length
      ? Math.round((items.reduce((sum, item) => sum + item.rating, 0) / items.length) * 10) / 10
      : 0;

    return {
      totalCount: items.length,
      averageRating,
      surveyUrl: 'https://wj.qq.com/s2/27160624/40fe/',
      items,
    };
  }

  listPapers() {
    return this.papers;
  }

  generatePaper(input: {
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
    return paper;
  }

  updateSystemConfig(input: {
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

    return this.systemConfig;
  }

  approveReviewItem(reviewItemId: string, reviewerId = 'admin-001') {
    const questionReviewItem = this.questionsService.approveReviewItem(reviewItemId, reviewerId);
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

  reviewWrongQuestion(questionId: string, userId = this.student.id) {
    const wrongQuestion = this.listWrongQuestions(userId).find((item) => item.questionId === questionId);
    if (!wrongQuestion) {
      throw new BadRequestException(`Wrong question ${questionId} was not found`);
    }

    const reviewed = this.wrongQuestionReviewDatesByUser.get(userId) ?? new Map<string, string>();
    const reviewedAt = new Date().toISOString();
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

  getRecommendedPracticeSet(userId = this.student.id) {
    const report = this.getOverviewReport();
    const stage = this.student.stage ?? '强化';
    const weakPointIds = report.weakPoints.map((point) => point.knowledgePointId);
    const fallbackPointIds = this.generatePlan().dailyTasks.map((task) => task.knowledgePointId);
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
      questions,
    };
  }

  submitPracticeSet(practiceSetId: string, input: {
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

    const records = answers.map((answer) => this.createPracticeRecord({
      userId,
      questionId: answer.questionId,
      knowledgePointId: '',
      selectedAnswer: answer.selectedAnswer,
      timeSpentSec: answer.timeSpentSec,
    }));
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

  createPracticeRecord(input: CreatePracticeRecordDto) {
    const question = this.questions.find((item) => item.id === input.questionId);
    if (!question) {
      throw new BadRequestException(`Question ${input.questionId} was not found`);
    }

    const expectedTimeSec = input.expectedTimeSec ?? question.expectedTimeSec;
    const correct = input.selectedAnswer === question.answer;
    const mistakeReason = classifyMistake({
      correct,
      selectedAnswer: input.selectedAnswer,
      correctAnswer: question.answer,
      timeSpentSec: input.timeSpentSec,
      expectedTimeSec,
    });

    const record: PracticeRecord = {
      id: `r-${Date.now()}`,
      userId: input.userId,
      questionId: input.questionId,
      knowledgePointId: question.knowledgePointIds[0] ?? input.knowledgePointId,
      selectedAnswer: input.selectedAnswer,
      correct,
      timeSpentSec: input.timeSpentSec,
      expectedTimeSec,
      mistakeReason,
      submittedAt: new Date().toISOString().slice(0, 10),
    };
    this.records.push(record);
    return record;
  }

  completeStudyTask(taskId: string, userId = this.student.id) {
    const plan = this.generatePlan();
    const task = plan.dailyTasks.find((item) => item.id === taskId);
    if (!task) {
      throw new BadRequestException(`Study task ${taskId} was not found`);
    }

    const completed = this.completedTaskDatesByUser.get(userId) ?? new Map<string, string>();
    completed.set(taskId, todayKey());
    this.completedTaskDatesByUser.set(userId, completed);

    return {
      ...task,
      completed: true,
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
    const report = this.getOverviewReport();
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
      title: `${this.student.stage ?? '强化'}阶段测评`,
      userId,
      description: '根据当前薄弱点生成的小测，用于判断本阶段是否需要继续专项突破。',
      estimatedMinutes: Math.max(10, Math.round(selectedQuestions.reduce((sum, question) => sum + question.expectedTimeSec, 0) / 60)),
      focusKnowledgePoints,
      questions: selectedQuestions,
    };
  }

  submitStageAssessment(input: {
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

    const records = answers.map((answer) => this.createPracticeRecord({
      userId,
      questionId: answer.questionId,
      knowledgePointId: '',
      selectedAnswer: answer.selectedAnswer,
      timeSpentSec: answer.timeSpentSec,
    }));
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
    const adjustment = this.applyStageAssessmentAdjustment(score, weakPointTitles);

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

  private applyStageAssessmentAdjustment(score: number, weakPointTitles: string[]) {
    const previousStage = this.student.stage ?? '强化';
    const nextStage: StudyStage = score < 60 ? '基础' : score >= 80 ? '冲刺' : '强化';
    this.student.stage = nextStage;

    if (score < 60) {
      this.student.remainingDays = Math.max((this.student.remainingDays ?? 96) + 7, 14);
    } else if (score >= 80) {
      this.student.remainingDays = Math.max((this.student.remainingDays ?? 96) - 3, 1);
    }

    const adjustedPlan = this.generatePlan();

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

  generatePlan() {
    const plan = buildStudyPlan({
      targetScore: this.student.targetScore ?? 115,
      remainingDays: this.student.remainingDays ?? 96,
      dailyHours: this.student.dailyHours ?? 3.5,
      stage: this.student.stage ?? '强化',
      knowledgePoints: this.knowledgePoints,
      records: this.records,
    });
    const completedTaskDates = this.completedTaskDatesByUser.get(this.student.id) ?? new Map<string, string>();
    const completedIds = new Set([...completedTaskDates.entries()]
      .filter(([, date]) => date === todayKey())
      .map(([taskId]) => taskId));
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
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
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
    const key = date.slice(0, 10);
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

type MasteryStatus = 'weak' | 'review' | 'mastered';
