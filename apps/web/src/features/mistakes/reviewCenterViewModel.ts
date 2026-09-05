import type { MasteryMap, WrongQuestion, WrongQuestionSummary } from '../../api';
import type { DueReviewItem } from '../../api/endpoints/review';

export type ReviewQueueBucket = 'today' | 'overdue' | 'upcoming';
export type ReviewPrioritySource = 'review-due' | 'priority-redo' | 'display-fallback';

export interface ReviewCenterQueueItem {
  questionId: string;
  knowledgePointTitle: string;
  subject: string;
  stem: string;
  bucket: ReviewQueueBucket;
  nextReviewAt: string | null;
  reviewCount: number | null;
  stability: string | null;
  statusLabel: string;
  mastery: number | null;
  masteryLabel: string;
  wrongCount: number | null;
}

export interface ReviewCenterPriorityItem extends ReviewCenterQueueItem {
  source: ReviewPrioritySource;
  reason: string;
  suggestedAction: string;
}

export interface ReviewCenterWeakKnowledge {
  knowledgePointId: string;
  title: string;
  chapter: string;
  mastery: number | null;
  masteryLabel: string;
  status: string;
  wrongCount: number;
  nextAction: string;
}

export interface ReviewCenterViewModel {
  metrics: {
    todayDueCount: number;
    overdueCount: number;
    pendingCount: number;
  };
  priorityItem: ReviewCenterPriorityItem | null;
  queue: Record<ReviewQueueBucket, ReviewCenterQueueItem[]>;
  weakKnowledge: ReviewCenterWeakKnowledge[];
  recentMistakes: WrongQuestion[];
}

interface ReviewCenterViewModelInput {
  dueReviews: DueReviewItem[];
  wrongQuestions: WrongQuestion[];
  priorityRedoItems: WrongQuestionSummary['priorityRedoItems'];
  masteryMap: MasteryMap | null;
  displayFallbackItem?: WrongQuestion | null;
  pendingCount?: number | null;
}

export function formatMasteryRate(value: number | null | undefined): string {
  return value == null ? '未评估' : `${Math.round(value)}%`;
}

export function buildReviewCenterViewModel(input: ReviewCenterViewModelInput): ReviewCenterViewModel {
  const masteryById = buildMasteryIndex(input.masteryMap);
  const wrongByQuestionId = new Map(input.wrongQuestions.map((item) => [item.questionId, item]));
  const queue = {
    today: [] as ReviewCenterQueueItem[],
    overdue: [] as ReviewCenterQueueItem[],
    upcoming: [] as ReviewCenterQueueItem[],
  };

  for (const item of input.dueReviews) {
    const wrongQuestion = wrongByQuestionId.get(item.questionId);
    const bucket = reviewBucket(item.nextReviewAt);
    queue[bucket].push(toDueQueueItem(item, wrongQuestion, masteryById, bucket));
  }

  const duePriority = [...queue.today, ...queue.overdue, ...queue.upcoming][0];
  const priorityItem = duePriority
    ? {
        ...duePriority,
        source: 'review-due' as const,
        reason: duePriority.bucket === 'overdue' ? '这项复习已经逾期，建议优先恢复。' : '这项复习已到期，建议今天完成。',
        suggestedAction: '打开详情，回顾错因后再做一次复测。',
      }
    : input.priorityRedoItems[0]
      ? toPriorityRedoItem(input.priorityRedoItems[0], wrongByQuestionId, masteryById)
      : input.displayFallbackItem
        ? toDisplayFallbackItem(input.displayFallbackItem, masteryById)
        : null;

  return {
    metrics: {
      todayDueCount: queue.today.length,
      overdueCount: queue.overdue.length,
      pendingCount: input.pendingCount ?? input.wrongQuestions.length,
    },
    priorityItem,
    queue,
    weakKnowledge: buildWeakKnowledge(input.masteryMap, input.wrongQuestions),
    recentMistakes: [...input.wrongQuestions]
      .sort((left, right) => Date.parse(right.latestSubmittedAt) - Date.parse(left.latestSubmittedAt))
      .slice(0, 5),
  };
}

function buildMasteryIndex(masteryMap: MasteryMap | null) {
  const index = new Map<string, { masteryRate: number; status: string }>();
  for (const subject of masteryMap?.subjects ?? []) {
    for (const point of subject.points) {
      index.set(point.knowledgePointId, { masteryRate: point.masteryRate, status: point.status });
    }
  }
  return index;
}

/** Resolve a Point-backed wrong question through its explicit Point → Node map. */
export function resolveWrongQuestionMastery(
  wrongQuestion: Pick<WrongQuestion, 'knowledgeNodeIds'>,
  masteryByNodeId: Map<string, { masteryRate: number; status: string }>,
): { masteryRate: number; status: string } | null {
  const values = (wrongQuestion.knowledgeNodeIds ?? [])
    .map((nodeId) => masteryByNodeId.get(nodeId))
    .filter((value): value is { masteryRate: number; status: string } => Boolean(value));
  if (values.length === 0) return null;
  const masteryRate = Math.round(values.reduce((sum, value) => sum + value.masteryRate, 0) / values.length);
  const status = values.some((value) => value.status === 'weak')
    ? 'weak'
    : values.some((value) => value.status === 'review')
      ? 'review'
      : 'mastered';
  return { masteryRate, status };
}

function toDueQueueItem(
  item: DueReviewItem,
  wrongQuestion: WrongQuestion | undefined,
  masteryById: Map<string, { masteryRate: number; status: string }>,
  bucket: ReviewQueueBucket,
): ReviewCenterQueueItem {
  const mastery = wrongQuestion ? resolveWrongQuestionMastery(wrongQuestion, masteryById)?.masteryRate ?? null : null;
  return {
    questionId: item.questionId,
    knowledgePointTitle: item.knowledgePointTitle,
    subject: item.subject,
    stem: item.stem,
    bucket,
    nextReviewAt: item.nextReviewAt ?? null,
    reviewCount: item.reviewCount ?? null,
    stability: item.stability ?? null,
    statusLabel: stabilityLabel(item.stability),
    mastery,
    masteryLabel: formatMasteryRate(mastery),
    wrongCount: wrongQuestion?.wrongCount ?? null,
  };
}

function toPriorityRedoItem(
  item: WrongQuestionSummary['priorityRedoItems'][number],
  wrongByQuestionId: Map<string, WrongQuestion>,
  masteryById: Map<string, { masteryRate: number; status: string }>,
): ReviewCenterPriorityItem {
  const wrongQuestion = wrongByQuestionId.get(item.questionId);
  const mastery = wrongQuestion ? resolveWrongQuestionMastery(wrongQuestion, masteryById)?.masteryRate ?? null : null;
  return {
    questionId: item.questionId,
    knowledgePointTitle: item.knowledgePointTitle,
    subject: wrongQuestion?.subject ?? '暂无科目信息',
    stem: item.stem,
    bucket: 'upcoming',
    nextReviewAt: null,
    reviewCount: null,
    stability: null,
    statusLabel: item.reviewStatus === 'reviewed' ? '已复盘' : '待复盘',
    mastery,
    masteryLabel: formatMasteryRate(mastery),
    wrongCount: item.wrongCount,
    source: 'priority-redo',
    reason: item.latestMistakeReason ? `服务端优先重做：最近错因是「${item.latestMistakeReason}」。` : '服务端标记为优先重做项。',
    suggestedAction: item.nextAction,
  };
}

function toDisplayFallbackItem(
  item: WrongQuestion,
  masteryById: Map<string, { masteryRate: number; status: string }>,
): ReviewCenterPriorityItem {
  const mastery = resolveWrongQuestionMastery(item, masteryById)?.masteryRate ?? null;
  return {
    questionId: item.questionId,
    knowledgePointTitle: item.knowledgePointTitle,
    subject: item.subject,
    stem: item.stem,
    bucket: 'upcoming',
    nextReviewAt: item.reviewedAt ?? null,
    reviewCount: null,
    stability: null,
    statusLabel: item.reviewStatus === 'reviewed' ? '已复盘' : '待复盘',
    mastery,
    masteryLabel: formatMasteryRate(mastery),
    wrongCount: item.wrongCount,
    source: 'display-fallback',
    reason: '当前没有到期或服务端优先项，以下内容仅按已有错题展示顺序呈现。',
    suggestedAction: item.nextAction ?? '打开详情，确认下一步复盘动作。',
  };
}

function buildWeakKnowledge(masteryMap: MasteryMap | null, wrongQuestions: WrongQuestion[]): ReviewCenterWeakKnowledge[] {
  if (masteryMap?.weakestPoints.length) {
    return masteryMap.weakestPoints.slice(0, 5).map((point) => ({
      knowledgePointId: point.knowledgePointId,
      title: point.title,
      chapter: point.chapter,
      mastery: point.masteryRate,
      masteryLabel: formatMasteryRate(point.masteryRate),
      status: point.status,
      wrongCount: point.wrongCount,
      nextAction: point.nextAction,
    }));
  }

  const grouped = new Map<string, WrongQuestion>();
  for (const item of wrongQuestions) {
    if (!grouped.has(item.knowledgePointId)) grouped.set(item.knowledgePointId, item);
  }
  return [...grouped.values()].slice(0, 5).map((item) => ({
    knowledgePointId: item.knowledgePointId,
    title: item.knowledgePointTitle,
    chapter: item.chapter,
    mastery: null,
    masteryLabel: '未评估',
    status: item.masteryStatus,
    wrongCount: item.wrongCount,
    nextAction: item.nextAction ?? '打开错题详情，确认复盘动作。',
  }));
}

function reviewBucket(value: string): ReviewQueueBucket {
  const dateKey = new Date(value).toISOString().slice(0, 10);
  const todayKey = new Date().toISOString().slice(0, 10);
  return dateKey < todayKey ? 'overdue' : 'today';
}

function stabilityLabel(stability: string): string {
  if (stability === 'mastered') return '已掌握';
  if (stability === 'review') return '巩固中';
  return '学习中';
}
