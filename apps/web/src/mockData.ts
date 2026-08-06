import type { KnowledgePoint, PracticeRecord, Question, UserProfile } from '@kaoyan408/shared';

export const student: UserProfile = {
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

export const knowledgePoints: KnowledgePoint[] = [
  { id: 'ds-tree', subject: '数据结构', chapter: '树与二叉树', title: '树的遍历应用', importance: 5, frequency: 5, prerequisites: ['线性表'] },
  { id: 'co-cache', subject: '计算机组成原理', chapter: '存储系统', title: 'Cache 映射与替换', importance: 5, frequency: 5, prerequisites: ['存储层次'] },
  { id: 'os-sync', subject: '操作系统', chapter: '进程管理', title: '进程同步与互斥', importance: 5, frequency: 5, prerequisites: ['进程状态'] },
  { id: 'net-tcp', subject: '计算机网络', chapter: '传输层', title: 'TCP 可靠传输', importance: 4, frequency: 5, prerequisites: ['滑动窗口'] },
];

export const questions: Question[] = [
  {
    id: 'q-001',
    stem: '直接映射 Cache（共 8 行）中，主存块号 29 应映射到 Cache 的哪一行？',
    options: ['1', '3', '5', '7'],
    answer: 'C',
    analysis: '直接映射行号 = 主存块号 mod Cache 行数 = 29 mod 8 = 5，映射到第 5 行。',
    knowledgePointIds: ['co-cache'],
    difficulty: '中等',
    type: '选择题',
    source: '章节题',
    year: 2024,
    expectedTimeSec: 100,
  },
];

export const practiceRecords: PracticeRecord[] = [
  { id: 'r-001', userId: 'u-001', questionId: 'q-001', knowledgePointId: 'co-cache', correct: false, timeSpentSec: 180, expectedTimeSec: 100, mistakeReason: '概念混淆', submittedAt: '2026-06-21' },
  { id: 'r-002', userId: 'u-001', questionId: 'q-001', knowledgePointId: 'co-cache', correct: false, timeSpentSec: 120, expectedTimeSec: 100, mistakeReason: '概念混淆', submittedAt: '2026-06-22' },
  { id: 'r-003', userId: 'u-001', questionId: 'q-001', knowledgePointId: 'net-tcp', correct: true, timeSpentSec: 180, expectedTimeSec: 100, mistakeReason: null, submittedAt: '2026-06-24' },
];
