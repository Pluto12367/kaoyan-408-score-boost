export interface LearningInsight {
  type: 'progress' | 'risk' | 'next-step';
  title: string;
  evidence: string;
  impact: string;
  action: string;
}

export interface LearningInsightMasteryPoint {
  title: string;
}

export interface LearningInsightMasteryMap {
  weakestPoints?: LearningInsightMasteryPoint[];
}

export interface LearningInsightTodayPlanTask {
  status: string;
  completed?: boolean;
  title: string;
}

export interface LearningInsightTodayPlan {
  summary: {
    completedTasks: number;
    totalTasks: number;
  };
  priorityTasks: LearningInsightTodayPlanTask[];
}

export interface LearningInsightWrongSummary {
  pendingCount?: number;
}

export interface LearningInsightLearningProfile {
  summary?: {
    accuracyRate?: number;
    streakDays?: number;
  };
}

function firstWeakTitle(masteryMap: LearningInsightMasteryMap | null) {
  return masteryMap?.weakestPoints?.[0]?.title ?? null;
}

function firstTaskTitle(todayPlan: LearningInsightTodayPlan | null) {
  return todayPlan?.priorityTasks.find((task) => task.status !== 'completed' && !task.completed)?.title ?? null;
}

function hasInsightData(input: {
  masteryMap: LearningInsightMasteryMap | null;
  wrongSummary: LearningInsightWrongSummary | null;
  todayPlan: LearningInsightTodayPlan | null;
  learningProfile: LearningInsightLearningProfile | null;
}) {
  return Boolean(
    input.masteryMap?.weakestPoints?.length
    || (input.wrongSummary?.pendingCount ?? 0) > 0
    || input.todayPlan?.priorityTasks?.length
    || input.learningProfile?.summary,
  );
}

export function buildLearningInsights(input: {
  masteryMap: LearningInsightMasteryMap | null;
  wrongSummary: LearningInsightWrongSummary | null;
  todayPlan: LearningInsightTodayPlan | null;
  learningProfile: LearningInsightLearningProfile | null;
}): LearningInsight[] {
  const weakTitle = firstWeakTitle(input.masteryMap);
  const taskTitle = firstTaskTitle(input.todayPlan);
  const pendingWrongCount = input.wrongSummary?.pendingCount ?? 0;
  const completedTasks = input.todayPlan?.summary.completedTasks ?? 0;
  const totalTasks = input.todayPlan?.summary.totalTasks ?? 0;
  const learningProfileSummary = input.learningProfile?.summary ?? {};
  const accuracy = learningProfileSummary.accuracyRate;
  const streak = learningProfileSummary.streakDays;

  if (!hasInsightData(input)) {
    return [
      {
        type: 'progress',
        title: '进步点：等待更多真实学习记录',
        evidence: '当前还没有足够的练习、错题或阶段数据，完成入学诊断后会自动生成。',
        impact: '空态不会误导你，后续会用真实数据替换。',
        action: '完成入学诊断',
      },
      {
        type: 'risk',
        title: '风险点：暂无可判断风险',
        evidence: '目前没有足够的学习证据，因此不会编造风险。',
        impact: '完成几组练习和一次错题复盘后，这里会变得具体。',
        action: '完成入学诊断',
      },
      {
        type: 'next-step',
        title: '下一步建议：先建立学习基线',
        evidence: '先完成入学诊断，系统会为你生成今日任务和首个主行动。',
        impact: '之后的洞察和动作会基于真实学习数据更新。',
        action: '完成入学诊断',
      },
    ];
  }

  const progress: LearningInsight = {
    type: 'progress',
    title: '进步点：今天已经有真实推进',
    evidence: weakTitle
      ? `当前最弱点聚焦在 ${weakTitle}，今日计划会围绕它展开。`
      : '已完成入学诊断后，系统会用真实练习记录持续累积进步证据。',
    impact: accuracy != null
      ? `当前学习画像正确率约 ${accuracy}% ，继续完成今日任务会让趋势更稳定。`
      : `今日计划已完成 ${completedTasks}/${totalTasks} 项，继续积累记录后会自动生成更稳定的趋势。`,
    action: taskTitle ? `去完成今日任务：${taskTitle}` : '完成入学诊断并生成今日任务',
  };

  const risk: LearningInsight = {
    type: 'risk',
    title: '风险点：先补最容易反复失分的地方',
    evidence: pendingWrongCount > 0
      ? `还有 ${pendingWrongCount} 道错题待处理，说明复盘链路还没有收口。`
      : weakTitle
        ? `当前薄弱点集中在 ${weakTitle}，先把高频失分点补上。`
        : '暂未看到明显风险，但仍需要持续练习来校准掌握度。',
    impact: streak != null
      ? `连续学习 ${streak} 天已经形成节奏，下一步要把错题和薄弱点串起来。`
      : '保持连续练习，风险判断会更准确。',
    action: pendingWrongCount > 0 ? '去错题本优先复盘' : '继续薄弱点练习',
  };

  const nextStep: LearningInsight = {
    type: 'next-step',
    title: '下一步建议：把结论落到动作',
    evidence: taskTitle
      ? `今天先做 ${taskTitle}，完成后系统会自动更新掌握度和下一步建议。`
      : '先完成入学诊断，系统会为你生成唯一主行动。',
    impact: '这些建议会随着练习记录、错题复盘和阶段测评持续更新。',
    action: pendingWrongCount > 0
      ? '去错题本'
      : weakTitle
        ? '去练习薄弱点'
        : '完成入学诊断',
  };

  return [progress, risk, nextStep];
}
