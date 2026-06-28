import { buildStudyPlan, computeWeaknessReport, recommendPracticeSet } from './appLogic.js';

export const subjects = ['数据结构', '计算机组成原理', '操作系统', '计算机网络'];

export const users = [
  {
    id: 'u-001',
    name: '林同学',
    role: 'student',
    targetSchool: '北京邮电大学',
    targetScore: 115,
    dailyHours: 3.5,
    stage: '强化',
    remainingDays: 96,
  },
  {
    id: 't-001',
    name: '王老师',
    role: 'teacher',
    targetSchool: '408 教研组',
    targetScore: 0,
    dailyHours: 0,
    stage: '教研',
    remainingDays: 0,
  },
  {
    id: 'a-001',
    name: '管理员',
    role: 'admin',
    targetSchool: '平台运营',
    targetScore: 0,
    dailyHours: 0,
    stage: '管理',
    remainingDays: 0,
  },
];

export const knowledgePoints = [
  { id: 'ds-tree', subject: '数据结构', chapter: '树与二叉树', title: '树的遍历应用', importance: 5, frequency: 5, prerequisites: ['线性表'] },
  { id: 'ds-graph', subject: '数据结构', chapter: '图', title: '最短路径与拓扑排序', importance: 5, frequency: 4, prerequisites: ['队列', '栈'] },
  { id: 'co-cache', subject: '计算机组成原理', chapter: '存储系统', title: 'Cache映射与替换', importance: 5, frequency: 5, prerequisites: ['存储层次'] },
  { id: 'co-pipeline', subject: '计算机组成原理', chapter: 'CPU', title: '指令流水线', importance: 4, frequency: 4, prerequisites: ['指令周期'] },
  { id: 'os-sync', subject: '操作系统', chapter: '进程管理', title: '进程同步与互斥', importance: 5, frequency: 5, prerequisites: ['进程状态'] },
  { id: 'os-memory', subject: '操作系统', chapter: '内存管理', title: '分页与页面置换', importance: 5, frequency: 4, prerequisites: ['地址转换'] },
  { id: 'net-tcp', subject: '计算机网络', chapter: '传输层', title: 'TCP可靠传输', importance: 4, frequency: 5, prerequisites: ['滑动窗口'] },
  { id: 'net-route', subject: '计算机网络', chapter: '网络层', title: '路由算法与IP分片', importance: 4, frequency: 4, prerequisites: ['IP协议'] },
];

export const questions = [
  {
    id: 'q-001',
    stem: '给定一棵二叉树的先序和中序序列，判断后序遍历结果。',
    options: ['ABDCE', 'DBECA', 'DEBCA', 'DECBA'],
    answer: 'C',
    analysis: '先序确定根节点，中序划分左右子树，递归还原后输出后序。',
    knowledgePointIds: ['ds-tree'],
    difficulty: '中',
    type: '选择题',
    source: '真题改编',
    year: 2022,
  },
  {
    id: 'q-002',
    stem: '直接映射 Cache 中，主存块号 29 应映射到 Cache 的哪一行？',
    options: ['1', '3', '5', '7'],
    answer: 'B',
    analysis: '直接映射行号等于主存块号对 Cache 行数取模。',
    knowledgePointIds: ['co-cache'],
    difficulty: '中',
    type: '选择题',
    source: '章节题',
    year: 2024,
  },
  {
    id: 'q-003',
    stem: '使用信号量解决生产者消费者问题时，mutex 的初值通常为多少？',
    options: ['0', '1', '缓冲区大小', '-1'],
    answer: 'B',
    analysis: 'mutex 是互斥信号量，初值为 1，表示临界区初始可进入。',
    knowledgePointIds: ['os-sync'],
    difficulty: '易',
    type: '选择题',
    source: '高频题',
    year: 2023,
  },
  {
    id: 'q-004',
    stem: 'TCP 拥塞避免阶段拥塞窗口的增长规律是？',
    options: ['指数增长', '线性增长', '保持不变', '立即减半'],
    answer: 'B',
    analysis: '拥塞避免阶段通常按加性增大，表现为近似线性增长。',
    knowledgePointIds: ['net-tcp'],
    difficulty: '中',
    type: '选择题',
    source: '真题改编',
    year: 2021,
  },
];

export const practiceRecords = [
  { id: 'r-001', userId: 'u-001', questionId: 'q-001', knowledgePointId: 'ds-tree', correct: true, timeSpentSec: 100, expectedTimeSec: 90, mistakeReason: null, submittedAt: '2026-06-19' },
  { id: 'r-002', userId: 'u-001', questionId: 'q-001', knowledgePointId: 'ds-tree', correct: false, timeSpentSec: 160, expectedTimeSec: 90, mistakeReason: '知识点混淆', submittedAt: '2026-06-20' },
  { id: 'r-003', userId: 'u-001', questionId: 'q-002', knowledgePointId: 'co-cache', correct: false, timeSpentSec: 180, expectedTimeSec: 100, mistakeReason: '概念不清', submittedAt: '2026-06-21' },
  { id: 'r-004', userId: 'u-001', questionId: 'q-002', knowledgePointId: 'co-cache', correct: false, timeSpentSec: 120, expectedTimeSec: 100, mistakeReason: '概念不清', submittedAt: '2026-06-22' },
  { id: 'r-005', userId: 'u-001', questionId: 'q-003', knowledgePointId: 'os-sync', correct: false, timeSpentSec: 80, expectedTimeSec: 100, mistakeReason: '审题问题', submittedAt: '2026-06-23' },
  { id: 'r-006', userId: 'u-001', questionId: 'q-004', knowledgePointId: 'net-tcp', correct: true, timeSpentSec: 190, expectedTimeSec: 100, mistakeReason: null, submittedAt: '2026-06-24' },
  { id: 'r-007', userId: 'u-001', questionId: 'q-004', knowledgePointId: 'net-tcp', correct: true, timeSpentSec: 170, expectedTimeSec: 100, mistakeReason: null, submittedAt: '2026-06-25' },
];

export function createDashboardState() {
  const student = users[0];
  const report = computeWeaknessReport({
    knowledgePoints,
    records: practiceRecords,
    targetScore: student.targetScore,
  });
  const plan = buildStudyPlan({
    targetScore: student.targetScore,
    remainingDays: student.remainingDays,
    dailyHours: student.dailyHours,
    stage: student.stage,
    knowledgePoints,
    records: practiceRecords,
  });
  const recommendation = recommendPracticeSet({ stage: '冲刺', report });

  return {
    student,
    users,
    subjects,
    knowledgePoints,
    questions,
    practiceRecords,
    report,
    plan,
    recommendation,
  };
}
