import {
  buildStudyPlan,
  computeWeaknessReport,
} from '@kaoyan408/shared';
import { knowledgePoints, practiceRecords, questions, student } from '../../mockData';
import type {
  DashboardOverview,
  AdminMetrics,
  TeacherClassAnalytics,
  AdminUserManagement,
  AdminManagedUser,
  ReviewQueue,
  SystemConfig,
  FeedbackList,
  TrialProgress,
  StudyReminders,
  SprintPlan,
  MasteryMap,
  MasteryPoint,
  PracticeSet,
  ReviewResourceRecommendation,
  LearningProfile,
  AiFollowUp,
  WrongQuestionSummary,
  GeneratedPaper,
  PaperSubmitResult,
  AssessmentHistory,
  GeneratePaperInput,
} from '../types';

// ---- Dashboard ----

export function createMockOverview(): DashboardOverview {
  const report = computeWeaknessReport({
    knowledgePoints,
    records: practiceRecords,
    targetScore: student.targetScore ?? 110,
  });
  const plan = buildStudyPlan({
    targetScore: student.targetScore ?? 110,
    remainingDays: student.remainingDays ?? 90,
    dailyHours: student.dailyHours ?? 3,
    stage: student.stage ?? '强化',
    knowledgePoints,
    records: practiceRecords,
  });

  return {
    source: 'mock',
    student,
    knowledgePoints,
    questions,
    practiceRecords,
    wrongQuestions: [{
      questionId: questions[0].id,
      stem: questions[0].stem,
      answer: questions[0].answer,
      analysis: questions[0].analysis,
      knowledgePointId: 'co-cache',
      knowledgePointTitle: 'Cache 映射与替换',
      subject: '计算机组成原理',
      chapter: '存储系统',
      wrongCount: 2,
      latestMistakeReason: '概念不清',
      latestSubmittedAt: '2026-06-22',
      reviewStatus: 'pending',
      reviewedAt: null,
    }],
    learningCalendar: createMockLearningCalendar(),
    stageAssessment: createMockStageAssessment(),
    report,
    plan,
  };
}

function createMockStageAssessment() {
  return {
    id: `stage-${new Date().toISOString().slice(0, 10)}`,
    title: '强化阶段测评',
    userId: student.id,
    description: '根据当前薄弱点生成的小测，用于判断本阶段是否需要继续专项突破。',
    estimatedMinutes: 12,
    focusKnowledgePoints: knowledgePoints.slice(0, 2),
    questions: questions.slice(0, 2),
  };
}

function createMockLearningCalendar() {
  const today = new Date().toISOString().slice(0, 10);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    return {
      date: key,
      completedTaskCount: index === 6 ? 1 : 0,
      practiceCount: index >= 4 ? 1 : 0,
      isActive: index >= 4,
    };
  });

  return { days, today: days[days.length - 1], streakDays: 3 };
}

// ---- Admin ----

export function createMockAdminMetrics(): AdminMetrics {
  return {
    source: 'memory-api',
    activeStudentCount: 1,
    questionCount: questions.length,
    knowledgePointCount: knowledgePoints.length,
    practiceRecordCount: practiceRecords.length,
    todayPracticeCount: 1,
    todayCompletedTaskCount: 1,
    completedTaskCount: 1,
    accuracyRate: 66.7,
    weakPointCount: 1,
    pendingWrongQuestionCount: 1,
    pendingReviewCount: 0,
    averagePracticeTimeSec: 140,
    retentionDays: 3,
    topWeakPoint: 'Cache 映射与替换',
    core: {
      registrationCompletionRate: mockRate(80, 8, 10, '最近 30 天'),
      diagnosticCompletionRate: mockRate(75, 6, 8, '全部内测学生'),
      firstTaskCompletionRate: mockRate(62.5, 5, 8, '全部内测学生'),
      day1RetentionRate: mockRate(60, 3, 5, '已满 1 天注册用户'),
      day7RetentionRate: mockRate(null, 0, 0, '已满 7 天注册用户'),
      weeklyPlanCompletionRate: mockRate(66.7, 12, 18, '最近 7 个自然日'),
      wrongQuestionSecondAccuracyRate: mockRate(50, 2, 4, '首次到期重做'),
      mockExamCompletionRate: mockRate(50, 1, 2, '全部模拟考试会话'),
      apiFailureRate: mockRate(1.2, 2, 167, '最近 7 天'),
      sessionRecoverySuccessRate: mockRate(100, 3, 3, '最近 30 天'),
    },
    generatedAt: new Date().toISOString(),
  };
}

function mockRate(rate: number | null, numerator: number, denominator: number, window: string) {
  return { rate, numerator, denominator, window };
}

export function createMockTeacherClassAnalytics(): TeacherClassAnalytics {
  return {
    source: 'mock',
    className: '408 强化体验班',
    generatedAt: new Date().toISOString(),
    overview: {
      studentCount: 1,
      activeStudentCount: 1,
      averageAccuracyRate: 66.7,
      averageCompletionRate: 40,
      pendingWrongQuestionCount: 1,
    },
    subjectWeakness: [
      { subject: '数据结构', weakPointCount: 0, averageMastery: 72, recommendation: '保持树与图的真题巩固。' },
      { subject: '计算机组成原理', weakPointCount: 1, averageMastery: 38, recommendation: '安排 Cache 映射与替换专题讲解。' },
      { subject: '操作系统', weakPointCount: 1, averageMastery: 58, recommendation: '补一次进程同步与 PV 操作小课。' },
      { subject: '计算机网络', weakPointCount: 0, averageMastery: 70, recommendation: '继续做 TCP 可靠传输限时训练。' },
    ],
    weakKnowledgePoints: [
      {
        knowledgePointId: 'co-cache', title: 'Cache 映射与替换', subject: '计算机组成原理',
        accuracyRate: 0, wrongCount: 2,
        recommendedAction: '围绕 Cache 映射与替换做 15 分钟概念串讲，再布置 5 道变式题。',
      },
      {
        knowledgePointId: 'os-sync', title: '进程同步与互斥', subject: '操作系统',
        accuracyRate: 50, wrongCount: 1,
        recommendedAction: '用生产者消费者模型串讲 PV 操作，再做同类题。',
      },
    ],
    atRiskStudents: [{
      userId: student.id, name: student.name, riskType: '正确率偏低',
      reason: '最近练习正确率低于 70%，错题集中在高频考点。',
      nextAction: '本周优先跟进 Cache 映射与替换，要求完成错题复盘和同考点训练。',
    }],
    teachingActions: [
      '本周小课优先讲 Cache 映射与替换，讲完立即做变式题检验。',
      '安排一次错题复盘课，要求学生写出错因而不是只看答案。',
      '保持测评后复盘节奏，用历史记录观察连续两次趋势。',
    ],
  };
}

export function createMockAdminUserManagement(): AdminUserManagement {
  const users: AdminManagedUser[] = [
    {
      id: student.id, name: student.name, role: 'student', trialStatus: 'active',
      stage: student.stage, targetScore: student.targetScore, targetSchool: student.targetSchool,
      lastActiveAt: new Date().toISOString().slice(0, 10),
      nextAction: '完成核心试用流程后，邀请填写问卷并追问真实备考痛点。',
    },
    {
      id: 'teacher-001', name: '王老师', role: 'teacher', trialStatus: 'active',
      stage: '教研维护', lastActiveAt: new Date().toISOString().slice(0, 10),
      nextAction: '继续维护题库、知识点和班级学情分析。',
    },
    {
      id: 'admin-001', name: '管理员', role: 'admin', trialStatus: 'active',
      stage: '平台运营', lastActiveAt: new Date().toISOString().slice(0, 10),
      nextAction: '查看试用名单、内容审核和运营数据。',
    },
  ];

  return {
    source: 'mock',
    generatedAt: new Date().toISOString(),
    summary: {
      totalUsers: users.length,
      studentCount: users.filter((u) => u.role === 'student').length,
      activeTrialCount: users.filter((u) => u.trialStatus === 'active').length,
      followUpCount: users.filter((u) => u.trialStatus === 'follow_up').length,
    },
    users,
  };
}

export function createMockReviewQueue(): ReviewQueue {
  return { source: 'memory-api', pendingCount: 0, approvedCount: 0, generatedAt: new Date().toISOString(), items: [] };
}

export function createMockSystemConfig(): SystemConfig {
  return {
    source: 'memory-api',
    recommendation: { stageAssessmentQuestionLimit: 6, dailyTargetQuestionCount: 30, speedRiskMultiplier: 1.4 },
    updatedBy: 'system', updatedAt: new Date().toISOString(),
  };
}

export function createMockFeedbackList(): FeedbackList {
  return { totalCount: 0, averageRating: 0, surveyUrl: 'https://wj.qq.com/s2/27160624/40fe/', items: [] };
}

// ---- Trial & Learning ----

export function createMockTrialProgress(): TrialProgress {
  return {
    userId: student.id, title: '15 分钟体验任务', completedCount: 0, totalCount: 5, completionRate: 0,
    nextAction: '提交入学诊断',
    items: [
      { id: 'diagnostic', title: '提交入学诊断', description: '生成阶段计划。', completed: false, actionAnchor: '#dashboard' },
      { id: 'daily-task', title: '完成一个今日任务', description: '记录今日进度。', completed: false, actionAnchor: '#plan' },
      { id: 'practice-set', title: '提交推荐题组', description: '体验题组作答。', completed: false, actionAnchor: '#question' },
      { id: 'wrong-review', title: '标记一次错题复盘', description: '体验错题闭环。', completed: false, actionAnchor: '#wrong-book' },
      { id: 'feedback', title: '提交体验反馈', description: '提交站内反馈或问卷。', completed: false, actionAnchor: '#feedback' },
    ],
  };
}

export function createMockStudyReminders(): StudyReminders {
  return {
    userId: student.id, title: '今日提分提醒', generatedAt: new Date().toISOString(),
    items: [
      { id: 'mock-weakness', type: 'weakness', priority: 'high', title: '优先补强 Cache 映射与替换',
        reason: '当前薄弱点集中在高频章节，建议先做一组推荐题。', actionText: '去练推荐题组', actionAnchor: '#question' },
      { id: 'mock-task', type: 'daily-task', priority: 'medium', title: '完成一个今日任务',
        reason: '先完成计划中的小任务，能更快看到报告变化。', actionText: '去看计划', actionAnchor: '#plan' },
      { id: 'mock-feedback', type: 'feedback', priority: 'low', title: '体验后补充真实建议',
        reason: '走完核心流程后填写问卷，有助于完善后续功能。', actionText: '去反馈', actionAnchor: '#feedback' },
    ],
  };
}

export function createMockSprintPlan(): SprintPlan {
  const today = new Date().toISOString().slice(0, 10);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return {
      dayIndex: index + 1, date: date.toISOString().slice(0, 10),
      focus: index === 6 ? '阶段小测与错题回看' : index % 2 === 0 ? 'Cache 映射与替换' : '操作系统进程同步',
      minutes: 150, questionTarget: index === 6 ? 40 : 30, reviewTarget: index % 3 === 2 ? 4 : 2,
      reason: index === 6 ? '用小测检查本周补弱效果。' : '围绕当前薄弱点做短周期补强。',
    };
  });

  return {
    userId: student.id, title: '7 天冲刺计划', currentStage: student.stage,
    scoreGap: Math.max(0, (student.targetScore ?? 0) - (student.currentScore ?? 0)),
    targetScore: student.targetScore, currentScore: student.currentScore, remainingDays: student.remainingDays,
    weeklyQuestionTarget: days.reduce((sum, d) => sum + d.questionTarget, 0),
    weeklyReviewTarget: days.reduce((sum, d) => sum + d.reviewTarget, 0),
    risks: ['错题复盘不足时，本周提分会更依赖重复刷题而不是消化。'],
    generatedAt: new Date().toISOString(), days,
  };
}

export function createMockMasteryMap(): MasteryMap {
  const points: MasteryPoint[] = knowledgePoints.map((point, index) => ({
    knowledgePointId: point.id, title: point.title, chapter: point.chapter,
    importance: point.importance, frequency: point.frequency,
    masteryRate: index === 1 ? 38 : 72, accuracyRate: index === 1 ? 0 : 75,
    practiceCount: index === 1 ? 2 : 1, wrongCount: index === 1 ? 2 : 0,
    status: (index === 1 ? 'weak' : 'review') as MasteryPoint['status'],
    nextAction: index === 1 ? '先复盘错题，再做 5 道同考点基础题。' : '补 3 道变式题，并记录易混点。',
    actionAnchor: index === 1 ? '#wrong-book' : '#question',
  }));

  const subjects = ['数据结构', '计算机组成原理', '操作系统', '计算机网络'].map((subject) => {
    const subjectPoints = points.filter((p) => knowledgePoints.find((k) => k.id === p.knowledgePointId)?.subject === subject);
    return {
      subject,
      averageMastery: subjectPoints.length ? Math.round(subjectPoints.reduce((sum, p) => sum + p.masteryRate, 0) / subjectPoints.length) : 0,
      weakCount: subjectPoints.filter((p) => p.status === 'weak').length,
      reviewCount: subjectPoints.filter((p) => p.status === 'review').length,
      masteredCount: subjectPoints.filter((p) => p.status === 'mastered').length,
      points: subjectPoints,
    };
  });

  return {
    userId: student.id, title: '408 掌握度地图', generatedAt: new Date().toISOString(), subjects,
    weakestPoints: points.filter((p) => p.status === 'weak').map((p) => ({ ...p, subject: '计算机组成原理' })),
  };
}

export function createMockPracticeSet(): PracticeSet {
  return {
    id: 'practice-set-mock', userId: student.id, title: '薄弱专题突破',
    stage: student.stage ?? '强化', focus: '相似考点辨析、变式题组、错因复盘',
    reason: '根据当前错题和薄弱知识点生成演示题组。', knowledgePointIds: ['co-cache'],
    questionCount: Math.min(questions.length, 4), estimatedMinutes: 10, questions: questions.slice(0, 4),
  };
}

export function createMockReviewResourceRecommendations(): ReviewResourceRecommendation {
  return {
    source: 'memory-api', userId: student.id, generatedAt: new Date().toISOString(), weakPointCount: 1,
    items: [
      {
        id: 'resource-co-cache-concept', knowledgePointId: 'co-cache', knowledgePointTitle: 'Cache 映射与替换',
        subject: '计算机组成原理', resourceType: 'concept_card', title: 'Cache 映射与替换核心概念卡',
        summary: '先复述直接映射、组相联和全相联的地址划分、命中判断与替换条件。',
        estimatedMinutes: 15, difficulty: '基础', actionText: '看完后做同考点题', actionAnchor: '#question',
      },
      {
        id: 'resource-co-cache-mistake', knowledgePointId: 'co-cache', knowledgePointTitle: 'Cache 映射与替换',
        subject: '计算机组成原理', resourceType: 'mistake_checklist', title: 'Cache 映射与替换错因检查清单',
        summary: '依次检查地址位数、组号计算、替换范围和写策略，定位最近错误发生在哪一步。',
        estimatedMinutes: 8, difficulty: '基础', actionText: '去错题本复盘', actionAnchor: '#wrong-book',
      },
      {
        id: 'resource-co-cache-practice', knowledgePointId: 'co-cache', knowledgePointTitle: 'Cache 映射与替换',
        subject: '计算机组成原理', resourceType: 'practice_set', title: 'Cache 映射与替换专项验证训练',
        summary: '完成 3 到 5 道变式题，用正确率和耗时判断薄弱点是否已经补上。',
        estimatedMinutes: 15, difficulty: '中等', actionText: '进入专项训练', actionAnchor: '#question',
      },
    ],
  };
}

export function createMockLearningProfile(): LearningProfile {
  return {
    userId: student.id,
    summary: {
      name: student.name, currentStage: student.stage, targetScore: student.targetScore,
      currentScore: student.currentScore, weakestSubject: student.weakestSubject,
      accuracyRate: 42.9, streakDays: 1,
    },
    loopStats: {
      diagnosticCompleted: true, practiceSetCount: 1, stageAssessmentCount: 1,
      reviewedWrongQuestionCount: 1, wrongQuestionCount: 1,
    },
    timeline: [
      { id: 'mock-profile-1', type: 'diagnostic', title: '入学诊断完成', date: '2026-06-30', summary: '系统已生成阶段计划。' },
      { id: 'mock-profile-2', type: 'practice_set', title: '推荐题组练习', date: '2026-06-30', summary: '完成推荐题组并同步练习记录。' },
      { id: 'mock-profile-3', type: 'wrong_review', title: '错题复盘', date: '2026-06-30', summary: '已复盘错题并获得相似题建议。' },
    ],
    nextMilestone: '继续完成推荐题组，并复盘本组错因。',
  };
}

export function createMockAiFollowUp(): AiFollowUp {
  return {
    id: 'follow-up-mock', userId: student.id, questionId: questions[0].id,
    message: '为什么我选 A 不对？',
    relatedKnowledgePoint: { id: 'co-cache', title: 'Cache 映射与替换', subject: '计算机组成原理', chapter: '存储系统' },
    replySteps: [
      '先定位考点：本题考查 Cache 映射与替换，不能只凭关键词判断。',
      '再对照标准答案：逐项检查题干条件和选项是否匹配。',
    ],
    misconceptionTips: ['不要把直接映射和组相联映射的条件混用。'],
    reviewCards: [
      { id: 'card-mock-concept', type: 'concept', title: '核心概念',
        content: '复习 Cache 映射时先区分映射方式、替换发生位置和命中条件。',
        nextAction: '用自己的话写出三种映射方式的区别。' },
      { id: 'card-mock-rule', type: 'rule', title: '判断规则',
        content: '先看题干给出的块号、组号或标记位，再判断选项是否符合。',
        nextAction: '重做 2 道同考点题。' },
    ],
    nextActions: ['回到错题本复盘本题，再做一组同知识点题。'],
    source: 'mock',
  };
}

export function createMockWrongQuestionSummary(): WrongQuestionSummary {
  return {
    userId: student.id, pendingCount: 1, reviewedCount: 0, resolvedCount: 0, totalWrongCount: 1,
    mistakeReasonStats: [{ reason: '概念不清', count: 2 }, { reason: '审题问题', count: 1 }],
    priorityRedoItems: [{
      questionId: questions[0].id, stem: questions[0].stem,
      knowledgePointTitle: 'Cache 映射与替换', wrongCount: 2,
      latestMistakeReason: '概念不清', reviewStatus: 'pending',
      nextAction: '先标记复盘，写出错误原因后再重做。',
    }],
    nextReviewActions: ['先复盘 1 道待处理错题，补全错因。', '优先重做 Cache 映射与替换，它的错误次数最高。'],
    generatedAt: new Date().toISOString(),
  };
}

export function createMockGeneratedPaper(input?: Partial<GeneratePaperInput>): GeneratedPaper {
  const selectedQuestions = questions.slice(0, input?.questionCount ?? 2);
  return {
    id: `paper-mock-${new Date().toISOString().slice(0, 10)}`,
    title: input?.title ?? '存储系统专项卷',
    paperType: input?.paperType ?? '专项卷',
    questionCount: selectedQuestions.length,
    knowledgePointIds: input?.knowledgePointIds ?? ['co-cache'],
    questions: selectedQuestions,
    estimatedMinutes: Math.max(8, selectedQuestions.length * 4),
    createdBy: input?.createdBy ?? 'teacher-001',
    createdAt: new Date().toISOString(),
  };
}

export function createMockPaperSubmitResult(paper?: GeneratedPaper, userId = student.id): PaperSubmitResult | null {
  if (!paper) return null;
  const reviewQuestion = paper.questions[0];
  const reviewPoint = knowledgePoints.find((p) => reviewQuestion.knowledgePointIds.includes(p.id)) ?? knowledgePoints[0];
  const correctCount = Math.max(0, paper.questions.length - 1);
  const accuracyRate = Math.round((correctCount / paper.questions.length) * 100);
  const timeLimitSec = paper.estimatedMinutes * 60;
  const elapsedSec = paper.questions.reduce((sum, q) => sum + q.expectedTimeSec + 15, 0);

  return {
    id: `paper-result-mock-${new Date().toISOString().slice(0, 10)}`,
    paperId: paper.id, userId, submittedAt: new Date().toISOString(),
    totalQuestions: paper.questions.length, correctCount, score: accuracyRate, accuracyRate,
    subjectBreakdown: [{
      subject: reviewPoint.subject, totalQuestions: paper.questions.length, correctCount, accuracyRate,
    }],
    reviewItems: [{
      questionId: reviewQuestion.id, stem: reviewQuestion.stem,
      selectedAnswer: reviewQuestion.answer === 'A' ? 'B' : 'A',
      correctAnswer: reviewQuestion.answer, correct: false,
      knowledgePointId: reviewPoint.id, knowledgePointTitle: reviewPoint.title,
      subject: reviewPoint.subject, mistakeReason: '概念不清',
    }],
    weakKnowledgePoints: [reviewPoint.title],
    syncedPracticeRecordCount: paper.questions.length,
    examSession: {
      answeredCount: paper.questions.length, unansweredCount: 0, totalQuestions: paper.questions.length,
      elapsedSec, timeLimitSec, overtime: elapsedSec > timeLimitSec, progressRate: 100,
    },
    nextActions: [
      '先复盘本套卷错题，再按薄弱知识点补一组专项题。',
      `优先处理：${reviewPoint.title}。`,
    ],
  };
}

export function createMockAssessmentHistory(): AssessmentHistory {
  const now = new Date().toISOString();
  return {
    userId: student.id,
    summary: { attemptCount: 2, bestScore: 76, latestAccuracyRate: 76, improvementText: '较上次提升 14 分，继续巩固 Cache 映射与替换。' },
    items: [
      {
        id: 'assessment-history-mock-002', paperId: 'paper-mock-latest', userId: student.id,
        title: '存储系统专项卷', submittedAt: now, score: 76, totalScore: 100, accuracyRate: 76,
        elapsedSec: 38 * 60, unansweredCount: 0, weakPointTitle: 'Cache 映射与替换',
        reviewSuggestion: '先处理 Cache 映射与替换，再补 1 组变式题验证是否真正掌握。',
      },
      {
        id: 'assessment-history-mock-001', paperId: 'paper-mock-baseline', userId: student.id,
        title: '408 基础诊断卷', submittedAt: '2026-06-25T09:30:00.000Z', score: 62, totalScore: 100, accuracyRate: 62,
        elapsedSec: 42 * 60, unansweredCount: 1, weakPointTitle: '进程同步与互斥',
        reviewSuggestion: '回到 PV 操作和临界区概念，先复盘错因再做同考点基础题。',
      },
    ],
  };
}
