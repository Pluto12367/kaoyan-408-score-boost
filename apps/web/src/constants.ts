export const riskLabel: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
};

export const reviewStatusLabel: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  needs_recheck: '需复查',
};

export const priorityLabel: Record<string, string> = {
  high: '高优先级',
  medium: '中优先级',
  low: '低优先级',
};

export const masteryStatusLabel: Record<string, string> = {
  weak: '去补弱',
  review: '去巩固',
  mastered: '限时训练',
};

export const reviewCardTypeLabel: Record<string, string> = {
  concept: '概念卡',
  rule: '规则卡',
  confusion: '易混卡',
};

export const reviewResourceTypeLabel: Record<string, string> = {
  concept_card: '概念卡片',
  mistake_checklist: '错因清单',
  example_walkthrough: '例题拆解',
  practice_set: '专项训练',
};

export const roleLabel: Record<string, string> = {
  student: '学生',
  teacher: '教师',
  admin: '管理员',
};

export const trialStatusLabel: Record<string, string> = {
  invited: '已邀请',
  active: '试用中',
  completed: '已完成',
  follow_up: '待回访',
};

export const permissionHint: Record<string, string> = {
  student: '学生可使用诊断、计划、练习、错题和 AI 答疑。',
  teacher: '教师可维护题库、知识点并生成试卷。',
  admin: '管理员可查看运营指标、审核内容并调整推荐策略。',
};

export function createInitialPaperSession(paper: { questionCount: number; estimatedMinutes: number }) {
  return {
    answeredCount: 0,
    unansweredCount: paper.questionCount,
    totalQuestions: paper.questionCount,
    elapsedSec: 0,
    timeLimitSec: paper.estimatedMinutes * 60,
    overtime: false,
    progressRate: 0,
  };
}
