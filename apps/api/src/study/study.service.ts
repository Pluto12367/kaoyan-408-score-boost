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

  generatePlan() {
    return buildStudyPlan({
      targetScore: this.student.targetScore ?? 115,
      remainingDays: this.student.remainingDays ?? 96,
      dailyHours: this.student.dailyHours ?? 3.5,
      stage: this.student.stage ?? '强化',
      knowledgePoints: this.knowledgePoints,
      records: this.records,
    });
  }
}
