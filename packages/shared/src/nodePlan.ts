import type { DailyTask, Subject } from './domain';
import type { NodeMasteryRow } from './nodeMastery';
import type {
  EvidenceConfidence,
  PriorityReasonCode,
  TrendDirection,
} from './score-center/types';
import { calculatePriority } from './score-center/priority';
import { composeDailyPlan } from './score-center/plan';

export interface NodePlanEvidenceNode {
  knowledgeNodeId: string;
  subject: Subject | '未分类';
  chapter: string;
  title: string;
  importance: number;
  difficulty: number;
  recent3Frequency: number;
  recent5Frequency: number;
  allTimeEvidence: number;
  primaryScore5y: number;
  trendDirection: TrendDirection;
  trendDelta: number;
  evidenceConfidence: EvidenceConfidence;
}

const STAGE_PHASES: Record<string, string> = {
  基础: '基础补强',
  强化: '专题突破',
  冲刺: '真题冲刺',
};

const ACTION_MODES: Record<string, DailyTask['mode']> = {
  LEARN: '基础例题',
  REVIEW: '专项训练',
  PRACTICE: '专项训练',
  WRONG_QUESTION: '专项训练',
  MOCK: '阶段巩固',
};

const REASON_LABELS: Record<PriorityReasonCode, string> = {
  HIGH_RECENT_FREQUENCY: '近3年高频考点',
  LOW_MASTERY: '掌握度偏低',
  LOW_ACCURACY: '正确率偏低',
  REPEATED_WRONG: '反复出错',
  REVIEW_DUE: '到期复习',
  RISING_TREND: '考频上升',
  PREREQUISITE_GAP: '前置知识未掌握',
  EXAM_NEAR: '临近考试',
  LOW_EVIDENCE: '考频证据不足',
};

export function buildNodeDrivenDailyTasks(input: {
  nodes: NodePlanEvidenceNode[];
  masteryRows: NodeMasteryRow[];
  targetScore: number;
  remainingDays: number;
  dailyHours: number;
  stage: string;
}): Array<Omit<DailyTask, 'id'>> {
  const masteryByNode = new Map(input.masteryRows.map((row) => [row.knowledgeNodeId, row]));
  const candidates = input.nodes.map((node) => {
    const row = masteryByNode.get(node.knowledgeNodeId);
    const userState = row
      ? {
          mastery: row.mastery,
          accuracy: row.attempts ? row.correctCount / row.attempts : 0.5,
          recentAccuracy: row.attempts ? row.correctCount / row.attempts : 0.55,
          attempts: row.attempts,
          correctCount: row.correctCount,
          wrongCount: row.wrongCount,
          confidence: row.attempts ? Math.min(1, 1 - Math.exp(-(row.attempts + 1) / 12)) : 0,
          pinned: false,
        }
      : undefined;
    const priority = calculatePriority(
      {
        knowledgePointId: node.knowledgeNodeId,
        importance: node.importance,
        difficulty: node.difficulty,
        recent3Y: { frequency: node.recent3Frequency },
        recent5Y: { frequency: node.recent5Frequency, primaryScore: node.primaryScore5y },
        allTimeEvidence: { frequency: node.allTimeEvidence },
        trend: { direction: node.trendDirection, delta: node.trendDelta },
        evidenceConfidence: node.evidenceConfidence,
      },
      userState,
      { daysToExam: input.remainingDays },
    );
    return {
      knowledgePointId: node.knowledgeNodeId,
      subject: node.subject,
      difficulty: node.difficulty,
      mastery: userState?.mastery ?? 0.5,
      recentAccuracy: userState?.recentAccuracy ?? 0.55,
      recentWrongCount: userState?.wrongCount ?? 0,
      forgetting: 0.5,
      score: priority.score,
      reasonCodes: priority.reasons,
      prerequisites: [],
      pinned: userState?.pinned ?? false,
    };
  });
  const availableMinutes = Math.min(180, Math.max(30, Math.round(input.dailyHours * 60))) as 30 | 60 | 120 | 180;
  const drafts = composeDailyPlan({
    candidates,
    availableMinutes,
    daysToExam: input.remainingDays,
  });
  const nodeById = new Map(input.nodes.map((node) => [node.knowledgeNodeId, node]));
  return drafts.map((draft) => {
    const node = nodeById.get(draft.knowledgePointId);
    const title = node?.title ?? draft.knowledgePointId;
    return {
      knowledgePointId: draft.knowledgePointId,
      subject: (node?.subject ?? '未分类') as Subject,
      chapter: node?.chapter ?? '',
      title,
      minutes: draft.estimatedMinutes,
      questionCount: draft.action === 'MOCK' ? 30 : 8,
      mode: ACTION_MODES[draft.action] ?? '专项训练',
      priority: draft.score >= 70 ? '高' : draft.score >= 45 ? '中' : '低',
      reason: draft.reasonCodes.map((code) => REASON_LABELS[code] ?? code).join('，'),
      nextAction: `完成后用 5 分钟整理 ${title} 的关键规则。`,
    };
  });
}

export function stagePhase(stage: string): string {
  return STAGE_PHASES[stage] ?? '专题突破';
}
