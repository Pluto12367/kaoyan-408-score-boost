import { Injectable } from '@nestjs/common';
import {
  buildStudyPlan,
  classifyMistake,
  computeWeaknessReport,
  type KnowledgePoint,
  type PracticeRecord,
} from '@kaoyan408/shared';
import { CreatePracticeRecordDto } from './dto/create-practice-record.dto';

@Injectable()
export class StudyService {
  private readonly knowledgePoints: KnowledgePoint[] = [
    { id: 'ds-tree', subject: '数据结构', chapter: '树与二叉树', title: '树的遍历应用', importance: 5, frequency: 5, prerequisites: ['线性表'] },
    { id: 'co-cache', subject: '计算机组成原理', chapter: '存储系统', title: 'Cache 映射与替换', importance: 5, frequency: 5, prerequisites: ['存储层次'] },
    { id: 'os-sync', subject: '操作系统', chapter: '进程管理', title: '进程同步与互斥', importance: 5, frequency: 5, prerequisites: ['进程状态'] },
    { id: 'net-tcp', subject: '计算机网络', chapter: '传输层', title: 'TCP 可靠传输', importance: 4, frequency: 5, prerequisites: ['滑动窗口'] },
  ];

  private readonly records: PracticeRecord[] = [];

  listKnowledgePoints() {
    return this.knowledgePoints;
  }

  getOverviewReport() {
    return computeWeaknessReport({
      knowledgePoints: this.knowledgePoints,
      records: this.records,
      targetScore: 115,
    });
  }

  createPracticeRecord(input: CreatePracticeRecordDto) {
    const mistakeReason = classifyMistake({
      correct: input.correct,
      selectedAnswer: input.selectedAnswer,
      correctAnswer: input.selectedAnswer ?? '',
      timeSpentSec: input.timeSpentSec,
      expectedTimeSec: input.expectedTimeSec,
    });

    const record: PracticeRecord = {
      id: `r-${Date.now()}`,
      userId: input.userId,
      questionId: input.questionId,
      knowledgePointId: input.knowledgePointId,
      selectedAnswer: input.selectedAnswer,
      correct: input.correct,
      timeSpentSec: input.timeSpentSec,
      expectedTimeSec: input.expectedTimeSec,
      mistakeReason,
      submittedAt: new Date().toISOString().slice(0, 10),
    };
    this.records.push(record);
    return record;
  }

  generatePlan() {
    return buildStudyPlan({
      targetScore: 115,
      remainingDays: 96,
      dailyHours: 3.5,
      stage: '强化',
      knowledgePoints: this.knowledgePoints,
      records: this.records,
    });
  }
}
