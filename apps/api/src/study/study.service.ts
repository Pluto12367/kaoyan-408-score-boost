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

    return {
      id: `stage-result-${Date.now()}`,
      userId,
      submittedAt: new Date().toISOString(),
      totalQuestions: records.length,
      correctCount,
      score,
      reviewItems,
      nextActions: [
        score >= 80 ? '进入真题限时训练，保持每 2-3 天一次阶段复测。' : '先复盘本次错题，再补 1 组同知识点专项练习。',
        weakPointTitles.length ? `优先复习：${weakPointTitles.join('、')}` : '本次正确率较好，建议增加限时速度训练。',
      ],
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
