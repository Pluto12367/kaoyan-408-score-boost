import { BadRequestException, Injectable } from '@nestjs/common';
import {
  buildStudyPlan,
  classifyMistake,
  computeWeaknessReport,
  type KnowledgePoint,
  type PracticeRecord,
  type Question,
  type UserProfile,
} from '@kaoyan408/shared';
import { CreatePracticeRecordDto } from './dto/create-practice-record.dto';

@Injectable()
export class StudyService {
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

  private readonly knowledgePoints: KnowledgePoint[] = [
    { id: 'ds-tree', subject: '数据结构', chapter: '树与二叉树', title: '树的遍历应用', importance: 5, frequency: 5, prerequisites: ['线性表'] },
    { id: 'co-cache', subject: '计算机组成原理', chapter: '存储系统', title: 'Cache 映射与替换', importance: 5, frequency: 5, prerequisites: ['存储层次'] },
    { id: 'os-sync', subject: '操作系统', chapter: '进程管理', title: '进程同步与互斥', importance: 5, frequency: 5, prerequisites: ['进程状态'] },
    { id: 'net-tcp', subject: '计算机网络', chapter: '传输层', title: 'TCP 可靠传输', importance: 4, frequency: 5, prerequisites: ['滑动窗口'] },
  ];

  private readonly questions: Question[] = [
    {
      id: 'q-001',
      stem: '直接映射 Cache 中，主存块号 29 应映射到 Cache 的哪一行？',
      options: ['1', '3', '5', '7'],
      answer: 'B',
      analysis: '直接映射行号等于主存块号对 Cache 行数取模。',
      knowledgePointIds: ['co-cache'],
      difficulty: '中等',
      type: '选择题',
      source: '章节题',
      year: 2024,
      expectedTimeSec: 100,
    },
    {
      id: 'q-002',
      stem: 'TCP 拥塞避免阶段拥塞窗口的增长规律是？',
      options: ['指数增长', '线性增长', '保持不变', '立即减半'],
      answer: 'B',
      analysis: '拥塞避免阶段通常按加性增大，表现为近似线性增长。',
      knowledgePointIds: ['net-tcp'],
      difficulty: '中等',
      type: '选择题',
      source: '真题改编',
      year: 2021,
      expectedTimeSec: 100,
    },
  ];

  private readonly records: PracticeRecord[] = [
    { id: 'r-001', userId: 'u-001', questionId: 'q-001', knowledgePointId: 'co-cache', correct: false, timeSpentSec: 180, expectedTimeSec: 100, mistakeReason: '概念不清', submittedAt: '2026-06-21' },
    { id: 'r-002', userId: 'u-001', questionId: 'q-001', knowledgePointId: 'co-cache', correct: false, timeSpentSec: 120, expectedTimeSec: 100, mistakeReason: '概念不清', submittedAt: '2026-06-22' },
    { id: 'r-003', userId: 'u-001', questionId: 'q-002', knowledgePointId: 'net-tcp', correct: true, timeSpentSec: 180, expectedTimeSec: 100, mistakeReason: null, submittedAt: '2026-06-24' },
  ];

  private readonly completedTaskDatesByUser = new Map<string, Map<string, string>>();

  listKnowledgePoints() {
    return this.knowledgePoints;
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

  listWrongQuestions(userId = this.student.id) {
    const grouped = new Map<string, PracticeRecord[]>();
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
      }];
    });
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
    const selectedQuestions = [...focusQuestions, ...fallbackQuestions].slice(0, Math.min(6, this.questions.length));
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
