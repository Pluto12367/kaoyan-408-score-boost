const PHASES = {
  基础: '基础补强',
  强化: '专题突破',
  冲刺: '真题冲刺',
};

const MISTAKE_SUGGESTIONS = {
  概念不清: '强化概念辨析与映射过程',
  知识点混淆: '建立相邻考点对比表',
  审题问题: '训练关键词圈画与条件复述',
  计算失误: '补做限时计算与过程校验',
  速度偏慢: '加入限时套题和步骤压缩训练',
};

export function requireQuestionKnowledgePoint(question) {
  if (!question.knowledgePointIds || question.knowledgePointIds.length === 0) {
    throw new Error('题目至少绑定一个知识点');
  }

  return question;
}

export function classifyMistake({ correct, selectedAnswer, correctAnswer, timeSpentSec, expectedTimeSec }) {
  const slow = timeSpentSec > expectedTimeSec * 1.45;

  if (correct && slow) return '速度偏慢';
  if (correct) return null;
  if (!selectedAnswer || timeSpentSec < expectedTimeSec * 0.65) return '审题问题';
  if (selectedAnswer !== correctAnswer && slow) return '概念不清';
  return '知识点混淆';
}

export function buildStudyPlan({ targetScore, remainingDays, dailyHours, stage, knowledgePoints, records }) {
  const report = computeWeaknessReport({ knowledgePoints, records, targetScore });
  const phase = PHASES[stage] ?? (remainingDays <= 45 ? '真题冲刺' : '专题突破');
  const minutesPerPoint = Math.max(35, Math.floor((dailyHours * 60) / 4));
  const weakIds = new Set(report.weakPoints.map((point) => point.knowledgePointId));

  const originalOrder = new Map(knowledgePoints.map((point, index) => [point.id, index]));
  const sortedPoints = [...knowledgePoints].sort((a, b) => {
    const weakDelta = Number(weakIds.has(b.id)) - Number(weakIds.has(a.id));
    if (weakDelta !== 0) return weakDelta;
    const priorityDelta = b.frequency + b.importance - (a.frequency + a.importance);
    if (priorityDelta !== 0) return priorityDelta;
    return originalOrder.get(a.id) - originalOrder.get(b.id);
  });

  const dailyTasks = sortedPoints.slice(0, 4).map((point, index) => ({
    id: `task-${index + 1}`,
    knowledgePointId: point.id,
    subject: point.subject,
    chapter: point.chapter,
    title: point.title,
    minutes: minutesPerPoint,
    questionCount: stage === '冲刺' ? 18 : 12,
    mode: index === 0 ? '诊断复盘' : stage === '基础' ? '基础例题' : '专项训练',
  }));

  return {
    phase,
    targetScore,
    remainingDays,
    dailyHours,
    dailyTasks,
    checkpoint: remainingDays <= 45 ? '每 3 天完成一套真题回顾' : '每 7 天完成一次阶段测评',
  };
}

export function computeWeaknessReport({ knowledgePoints, records, targetScore }) {
  const pointMap = new Map(knowledgePoints.map((point) => [point.id, point]));
  const grouped = new Map();

  for (const record of records) {
    const bucket = grouped.get(record.knowledgePointId) ?? [];
    bucket.push(record);
    grouped.set(record.knowledgePointId, bucket);
  }

  const correctCount = records.filter((record) => record.correct).length;
  const accuracyRate = records.length ? round1((correctCount / records.length) * 100) : 0;

  const scored = [...grouped.entries()].map(([knowledgePointId, items]) => {
    const point = pointMap.get(knowledgePointId);
    const wrongItems = items.filter((item) => !item.correct);
    const slowItems = items.filter((item) => item.timeSpentSec > item.expectedTimeSec * 1.45);
    const accuracy = items.length ? wrongItems.length / items.length : 1;
    const reason = topReason(wrongItems.map((item) => item.mistakeReason).filter(Boolean));
    const weaknessScore = accuracy * 100 + (point?.importance ?? 3) * 8 + (point?.frequency ?? 3) * 6;

    return {
      knowledgePointId,
      subject: point?.subject ?? '未分类',
      chapter: point?.chapter ?? '未分类',
      title: point?.title ?? knowledgePointId,
      attempts: items.length,
      wrongCount: wrongItems.length,
      slowCount: slowItems.length,
      accuracyRate: round1(((items.length - wrongItems.length) / items.length) * 100),
      topReason: reason,
      suggestion: MISTAKE_SUGGESTIONS[reason] ?? '补做同源题并复述解题步骤',
      weaknessScore,
    };
  });

  const weakPoints = scored
    .filter((item) => item.wrongCount > 0)
    .sort((a, b) => b.weaknessScore - a.weaknessScore)
    .slice(0, 5);

  const speedRisks = scored
    .filter((item) => item.wrongCount === 0 && item.slowCount > 0)
    .sort((a, b) => b.slowCount - a.slowCount);

  const estimatedGain = Math.max(8, Math.round((100 - accuracyRate) * 0.45 + Math.max(targetScore - 95, 0) * 0.18));

  return {
    accuracyRate,
    completionRate: records.length ? Math.min(100, Math.round((records.length / 20) * 100)) : 0,
    weakPoints,
    speedRisks,
    mistakeReasons: countReasons(records),
    estimatedGain,
    summary: `当前正确率 ${accuracyRate}%，预计提分空间 ${estimatedGain} 分；优先处理 ${weakPoints[0]?.chapter ?? '高频章节'}。`,
  };
}

export function recommendPracticeSet({ stage, report }) {
  if (stage === '冲刺') {
    return {
      title: '真题错题回炉训练',
      knowledgePointIds: report.weakPoints.map((point) => point.knowledgePointId),
      questionCount: 20,
      focus: '近十年真题、错题重做、限时复盘',
    };
  }

  return {
    title: report.accuracyRate < 55 ? '高频基础考点补强' : '薄弱专题突破',
    knowledgePointIds: report.weakPoints.map((point) => point.knowledgePointId),
    questionCount: report.accuracyRate < 55 ? 16 : 12,
    focus: report.accuracyRate < 55 ? '例题理解、概念复述、基础题组' : '相似考点辨析、变式题组',
  };
}

function topReason(reasons) {
  const counts = countStrings(reasons);
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function countReasons(records) {
  return countStrings(records.map((record) => record.mistakeReason).filter(Boolean));
}

function countStrings(items) {
  return items.reduce((acc, item) => {
    acc[item] = (acc[item] ?? 0) + 1;
    return acc;
  }, {});
}

function round1(value) {
  return Math.round(value * 10) / 10;
}
