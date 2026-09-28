/**
 * V14 ③（Owner 批准 D-T-1/2，2026-09-27）— 「今天做什么」合并纯模块。
 * 设计 docs/v14-flagship-detailed-design.md §3。
 *
 * 语义边界：
 *   • 只读投影（D-T-1）：不建 StudyTask、零写方；完成态由前端内存标记。
 *   • reason 串只拼接证据字段原文（finding count / observedLostScore / 处方 stage），
 *     不生成新的判断——杜绝黑盒文案（与 CodeBrick 的本质差异）。
 *   • 处方 UNAVAILABLE/NO_CONTENT 步不产出动作（无内容不编题，同处方语义）。
 *
 * Pure: 零 IO，确定性。
 */

export type TodayActionKind = 'prescription_step' | 'review_due' | 'wrong_due';

export interface TodayActionLaunch {
  type: 'practice_set' | 'due_review' | 'wrong_book';
  /** practice_set 显式题单参数（freePracticeContext 同形状）。 */
  nodeId?: string;
  questionSubtype?: string;
  questionCount?: number;
}

export interface TodayAction {
  id: string;
  kind: TodayActionKind;
  priority: number;
  title: string;
  /** 只含证据字段原文的拼接串；引用数字可溯源到 Evidence。 */
  reason: string;
  launch: TodayActionLaunch;
  evidenceNodeId: string | null;
}

export interface TodayActionsResult {
  actions: TodayAction[];
  nothingReason: string | null;
}

/** 处方阶梯步（消费方只传本模块需要的字段）。 */
export interface TodayActionPrescriptionStep {
  order: number;
  stage: string;
  label: string;
  status: 'READY' | 'UNAVAILABLE' | 'NO_CONTENT';
  questionCount: number;
  reason: string | null;
}

export interface TodayActionFinding {
  nodeId: string;
  questionSubtype: string;
  reasonLabel: string;
  count: number;
  observedLostScore: number;
}

export interface BuildTodayActionsInput {
  limit: number;
  prescription: {
    dataStatus: 'OK' | 'LIMITED_CONTENT' | 'NO_CONTENT' | 'EMPTY';
    target: { nodeId: string; questionSubtype: string; reasonLabel: string } | null;
    ladder: TodayActionPrescriptionStep[];
    reason: string;
  } | null;
  dueReviews: { count: number; questions: unknown[] };
  wrongSummary: { pendingCount: number; newestAt: string | null };
  finding: TodayActionFinding | null;
}

const PER_SOURCE_CAP = 2;

export function buildTodayActions(input: BuildTodayActionsInput): TodayActionsResult {
  const limit = Math.max(1, Math.min(5, Math.trunc(input.limit) || 3));
  const actions: TodayAction[] = [];

  // 1. 处方步（READY 且数据可用）。每源最多 2 条。
  const ladder = (input.prescription?.ladder ?? []).filter((step) => step.status === 'READY');
  const target = input.prescription?.target ?? null;
  for (const step of ladder.slice(0, PER_SOURCE_CAP)) {
    if (actions.length >= limit) break;
    const reasonParts: string[] = [];
    if (input.finding) {
      reasonParts.push(`该考点 ${input.finding.count} 题复发（观测失分 ${input.finding.observedLostScore} 分）`);
    }
    if (step.reason) reasonParts.push(step.reason);
    actions.push({
      id: `rx-${step.order}`,
      kind: 'prescription_step',
      priority: 1,
      title: `${step.label} · ${target?.reasonLabel ?? '薄弱考点'}`,
      reason: reasonParts.join('，'),
      launch: {
        type: 'practice_set',
        nodeId: target?.nodeId,
        questionSubtype: target?.questionSubtype !== 'unknown' ? target?.questionSubtype : undefined,
        questionCount: step.questionCount,
      },
      evidenceNodeId: target?.nodeId ?? null,
    });
  }

  // 2. 到期复习。
  if (input.dueReviews.count > 0 && actions.length < limit) {
    const count = Math.min(input.dueReviews.count, PER_SOURCE_CAP);
    actions.push({
      id: 'review-due',
      kind: 'review_due',
      priority: 2,
      title: `复习到期 ${input.dueReviews.count} 题`,
      reason: '按记忆曲线今日到期',
      launch: { type: 'due_review' },
      evidenceNodeId: null,
    });
  }

  // 3. 错题到期。
  if (input.wrongSummary.pendingCount > 0 && actions.length < limit) {
    actions.push({
      id: 'wrong-due',
      kind: 'wrong_due',
      priority: 3,
      title: `错题复盘 ${input.wrongSummary.pendingCount} 题`,
      reason: input.wrongSummary.newestAt
        ? `最近错题 ${input.wrongSummary.newestAt.slice(0, 10)}，黄金 48h 复盘窗口`
        : '有待复盘错题',
      launch: { type: 'wrong_book' },
      evidenceNodeId: null,
    });
  }

  if (actions.length === 0) {
    return {
      actions: [],
      nothingReason: '暂无待办动作——完成入学诊断或先做几道题，系统会按诊断结果生成今日训练。',
    };
  }
  return { actions, nothingReason: null };
}
