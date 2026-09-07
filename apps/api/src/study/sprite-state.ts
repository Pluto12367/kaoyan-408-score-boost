/**
 * V10-1 SpriteState — the companion layer's mood derivation (pure).
 *
 * The sprite is a companion surface, never a source of learning facts
 * (docs/v10-sprite-product-constitution.md §7): this module only derives a
 * presentational state from already-derived read models (StudentContext,
 * today plan, V4 proactive interventions, V9 ProgressStory). Deterministic
 * ordered guards (statechart-style, first match wins), evidence-carrying,
 * no LLM, no storage, no clock — time arrives injected. Deleting this module
 * removes a surface and changes nothing else.
 *
 * Contract design: docs/v10-1-sprite-core-design.md (§2 contract, §4 ladder,
 * CL-1..CL-5 clarifications).
 */

import { buildSpriteLines } from './sprite-persona';

export const SPRITE_STATE_VERSION = 'sprite-state-v1' as const;

export type SpriteMood =
  | 'recovery'
  | 'concern'
  | 'celebrate'
  | 'rest'
  | 'streak'
  | 'encourage'
  | 'focused'
  | 'idle'
  | 'unknown';

export type MoodReasonKind =
  | 'gap_recovery'
  | 'carry_over'
  | 'high_risk'
  | 'medium_risk'
  | 'progress_gain'
  | 'evidence_milestone'
  | 'plan_complete'
  | 'streak_active'
  | 'plan_pending'
  | 'session_active'
  | 'no_signal'
  | 'insufficient_data'
  | 'context_unavailable';

export type SpriteLineTone = 'encourage' | 'firm' | 'warm' | 'neutral';

export type EvidenceSource =
  | 'student_context'
  | 'today_plan'
  | 'proactive'
  | 'progress_story'
  | 'recovery'
  | 'session';

export interface SpriteEvidenceRef {
  readonly source: EvidenceSource;
  /** Input-root-relative dotted path, e.g. 'context.momentum.studyStreak'. */
  readonly field: string;
  readonly detail: string;
}

export interface SpriteLine {
  readonly id: string;
  readonly text: string;
  readonly tone: SpriteLineTone;
  readonly evidenceRefs: readonly SpriteEvidenceRef[];
  readonly action?: {
    readonly kind: 'deep_link';
    readonly target: string;
    readonly label: string;
  };
}

export interface SpriteContextLite {
  readonly momentum: { readonly studyStreak: number };
  readonly practice: {
    readonly recentAccuracy: { readonly status: string; readonly value: number | null; readonly sampleSize: number };
    readonly totalCount: number;
  };
  readonly review: { readonly dueCount: number; readonly overdueCount: number };
}

export interface SpritePlanLite {
  readonly completedTasks: number;
  readonly totalTasks: number;
  readonly recoveredFromGap: boolean;
  readonly carryOverCount: number;
  readonly firstOpenTaskTitle: string | null;
}

export interface SpriteInterventionLite {
  readonly id: string;
  readonly trigger: string;
  readonly severity: 'high' | 'medium' | 'low';
  readonly headline: string;
  readonly actions: readonly string[];
  readonly actorHint: 'review' | 'plan' | 'practice' | 'coach';
}

export interface SpriteStoryLite {
  readonly weekDelta: number | null;
  readonly gatesPassed: number;
  readonly resolvedCount: number | null;
  readonly streak: number;
}

/** V10-3 — celebratory facts only; each entry must carry its own evidence. */
export interface SpriteMilestone {
  readonly kind: 'evidence_gate' | 'resolved' | 'streak' | 'gap_recovery';
  readonly label: string;
  readonly evidenceRef: SpriteEvidenceRef;
}

export interface SpriteStateInput {
  readonly asOf: string;
  readonly userId: string;
  readonly context: SpriteContextLite | null;
  readonly plan: SpritePlanLite | null;
  readonly interventions: readonly SpriteInterventionLite[];
  readonly story: SpriteStoryLite | null;
  readonly activeSession: boolean;
  readonly unavailableSources: readonly string[];
  /** V10-4 additive increment (still sprite-state-v1): bounded user-stated memories. */
  readonly memory?: readonly { readonly id: string; readonly text: string }[] | null;
}

export interface SpriteState {
  readonly version: typeof SPRITE_STATE_VERSION;
  readonly userId: string;
  readonly asOf: string;
  readonly mood: SpriteMood;
  readonly moodReason: {
    readonly kind: MoodReasonKind;
    readonly detail: string;
    readonly evidenceRefs: readonly SpriteEvidenceRef[];
  };
  readonly presence: {
    readonly visible: boolean;
    readonly mode: 'normal' | 'quiet';
    readonly reason: string;
  };
  readonly lines: readonly SpriteLine[];
  readonly bond: {
    readonly streakDays: number | null;
    readonly recoveredFromGap: boolean;
    readonly milestones: readonly SpriteMilestone[];
  };
  readonly degraded: {
    readonly unavailableSources: readonly string[];
    readonly contextAvailable: boolean;
  };
  /** V10-4 additive increment: user-stated memories for ambient display (≤3). */
  readonly memory: {
    readonly entries: readonly { readonly id: string; readonly text: string }[];
  };
  readonly source: 'derived';
}

interface MoodVerdict {
  readonly mood: SpriteMood;
  readonly kind: MoodReasonKind;
  readonly detail: string;
  readonly evidenceRefs: readonly SpriteEvidenceRef[];
}

export function buildSpriteState(input: SpriteStateInput): SpriteState {
  const contextAvailable = input.context != null;
  const streak = input.context?.momentum.studyStreak ?? 0;
  const review = input.context?.review ?? { dueCount: 0, overdueCount: 0 };
  const accuracyStatus = input.context?.practice.recentAccuracy.status ?? 'insufficient_data';
  const plan = input.plan;

  const verdict = resolveMood(input, {
    streak,
    review,
    accuracyStatus,
    plan,
  });

  const lines = buildSpriteLines(verdict.mood, verdict.kind, {
    carryOverCount: plan?.carryOverCount ?? 0,
    weekDelta: input.story?.weekDelta ?? null,
    gatesPassed: input.story?.gatesPassed ?? 0,
    resolvedCount: input.story?.resolvedCount ?? null,
    studyStreak: streak,
    openTaskCount: plan ? Math.max(plan.totalTasks - plan.completedTasks, 0) : 0,
    firstOpenTaskTitle: plan?.firstOpenTaskTitle ?? null,
    concernHeadline: verdict.kind === 'high_risk' || verdict.kind === 'medium_risk'
      ? firstWorrisomeIntervention(input.interventions)?.headline ?? null
      : null,
    concernActorHint: verdict.kind === 'high_risk' || verdict.kind === 'medium_risk'
      ? firstWorrisomeIntervention(input.interventions)?.actorHint ?? null
      : null,
  });

  return {
    version: SPRITE_STATE_VERSION,
    userId: input.userId,
    asOf: input.asOf,
    mood: verdict.mood,
    moodReason: {
      kind: verdict.kind,
      detail: verdict.detail,
      evidenceRefs: verdict.evidenceRefs,
    },
    presence: {
      visible: true,
      mode: input.activeSession ? 'quiet' : 'normal',
      reason: input.activeSession
        ? 'practice session in progress — low disturbance'
        : 'ambient presence on the student dashboard',
    },
    lines,
    bond: {
      streakDays: contextAvailable ? streak : null,
      recoveredFromGap: plan?.recoveredFromGap === true,
      milestones: deriveMilestones(input, streak).slice(0, 3),
    },
    degraded: {
      unavailableSources: input.unavailableSources,
      contextAvailable,
    },
    memory: {
      entries: (input.memory ?? []).slice(0, 3).map((item) => ({ id: item.id, text: item.text })),
    },
    source: 'derived',
  };
}

function resolveMood(
  input: SpriteStateInput,
  facts: {
    streak: number;
    review: { dueCount: number; overdueCount: number };
    accuracyStatus: string;
    plan: SpriteStateInput['plan'];
  },
): MoodVerdict {
  // Guard #1 — upstream failure is named, never disguised as a quiet new user.
  if (input.context == null) {
    return {
      mood: 'unknown',
      kind: 'context_unavailable',
      detail: 'StudentContext 读取失败，本轮降级为诚实缺席',
      evidenceRefs: [{ source: 'student_context', field: 'context', detail: 'StudentContext unavailable at this pull' }],
    };
  }

  // Guard #2 — a live practice session means silence (CL-1): the data states
  // resurface on the next pull after the session ends.
  if (input.activeSession) {
    return {
      mood: 'focused',
      kind: 'session_active',
      detail: '练习会话进行中，精灵保持安静陪伴',
      evidenceRefs: [{ source: 'session', field: 'activeSession', detail: '存在未完成且 2 小时内活跃的练习会话' }],
    };
  }

  const plan = facts.plan;

  // Guard #3 — gap recovery (missed-day-recovery facts), before any risk talk.
  if (plan?.recoveredFromGap === true) {
    return {
      mood: 'recovery',
      kind: 'gap_recovery',
      detail: '今日计划包含断档恢复标记',
      evidenceRefs: [{ source: 'recovery', field: 'plan.recoveredFromGap', detail: '计划由断档恢复重锚生成' }],
    };
  }
  if (plan != null && plan.carryOverCount > 0) {
    return {
      mood: 'recovery',
      kind: 'carry_over',
      detail: `${plan.carryOverCount} 个未完成任务已结转回今日`,
      evidenceRefs: [{ source: 'recovery', field: 'plan.carryOverCount', detail: `${plan.carryOverCount} 个任务结转` }],
    };
  }

  // Guard #4 — evidence-based concern; low severity never worries (CL-5: an
  // empty list means "no risk worth surfacing", not failure).
  const worrisome = firstWorrisomeIntervention(input.interventions);
  if (worrisome != null) {
    return {
      mood: 'concern',
      kind: worrisome.severity === 'high' ? 'high_risk' : 'medium_risk',
      detail: `主动干预命中：${worrisome.trigger}`,
      evidenceRefs: [{
        source: 'proactive',
        field: 'interventions.0.headline',
        detail: `trigger=${worrisome.trigger}; severity=${worrisome.severity}`,
      }],
    };
  }

  // Guard #5 — celebration only with real, gated evidence.
  const story = input.story;
  if (story != null) {
    if (story.weekDelta != null && story.weekDelta >= 1) {
      return {
        mood: 'celebrate',
        kind: 'progress_gain',
        detail: `本周掌握度周环比 +${story.weekDelta} 点`,
        evidenceRefs: [{
          source: 'progress_story',
          field: 'story.weekDelta',
          detail: '周环比为正且两侧各 ≥2 个有效快照',
        }],
      };
    }
    if (story.gatesPassed > 0) {
      return {
        mood: 'celebrate',
        kind: 'evidence_milestone',
        detail: `${story.gatesPassed} 个节点通过证据门槛`,
        evidenceRefs: [{ source: 'progress_story', field: 'story.gatesPassed', detail: `${story.gatesPassed} 个节点通过 evidence gate` }],
      };
    }
    if (story.resolvedCount != null && story.resolvedCount > 0) {
      return {
        mood: 'celebrate',
        kind: 'evidence_milestone',
        detail: `${story.resolvedCount} 道错题重做解决`,
        evidenceRefs: [{ source: 'progress_story', field: 'story.resolvedCount', detail: `${story.resolvedCount} 道错题已解决` }],
      };
    }
  }

  // Guard #6 — rest needs a finished plan AND zero review debt.
  if (
    plan != null &&
    plan.totalTasks > 0 &&
    plan.completedTasks >= plan.totalTasks &&
    facts.review.dueCount === 0 &&
    facts.review.overdueCount === 0
  ) {
    return {
      mood: 'rest',
      kind: 'plan_complete',
      detail: '今日计划全部完成且无复习债务',
      evidenceRefs: [
        { source: 'today_plan', field: 'plan.completedTasks', detail: `${plan.completedTasks}/${plan.totalTasks} 完成` },
        { source: 'student_context', field: 'context.review.overdueCount', detail: '无逾期复习' },
      ],
    };
  }

  // Guard #7 — an established rhythm is worth acknowledging.
  if (facts.streak >= 3) {
    return {
      mood: 'streak',
      kind: 'streak_active',
      detail: `连续学习 ${facts.streak} 天`,
      evidenceRefs: [{ source: 'student_context', field: 'context.momentum.studyStreak', detail: `连续学习 ${facts.streak} 天` }],
    };
  }

  // Guard #8 — a pending plan gets a calm nudge, not pressure.
  if (plan != null && plan.totalTasks > 0 && plan.completedTasks < plan.totalTasks) {
    return {
      mood: 'encourage',
      kind: 'plan_pending',
      detail: `今日还有 ${plan.totalTasks - plan.completedTasks} 个任务未完成`,
      evidenceRefs: [
        { source: 'today_plan', field: 'plan.totalTasks', detail: `${plan.totalTasks - plan.completedTasks}/${plan.totalTasks} 待完成` },
        { source: 'today_plan', field: 'plan.firstOpenTaskTitle', detail: '第一个未完成任务' },
      ],
    };
  }

  // Guard #9 — honest unknown: a thin profile is insufficient_data, not zero.
  if (
    facts.accuracyStatus === 'insufficient_data' &&
    (plan == null || plan.totalTasks === 0) &&
    facts.streak === 0
  ) {
    return {
      mood: 'unknown',
      kind: 'insufficient_data',
      detail: '练习样本不足，尚无法形成任何判断',
      evidenceRefs: [{
        source: 'student_context',
        field: 'context.practice.recentAccuracy.status',
        detail: 'recentAccuracy = insufficient_data',
      }],
    };
  }

  // Guard #10 — quiet default: present, calm, no fabrication.
  return {
    mood: 'idle',
    kind: 'no_signal',
    detail: '已检查动量、计划与风险：无待处理信号',
    evidenceRefs: [{ source: 'student_context', field: 'context.momentum', detail: 'momentum 已检查，无信号' }],
  };
}

function firstWorrisomeIntervention(interventions: SpriteStateInput['interventions']): SpriteInterventionLite | null {
  const high = interventions.find((item) => item.severity === 'high');
  if (high != null) return high;
  const medium = interventions.find((item) => item.severity === 'medium');
  return medium ?? null;
}

/**
 * V10-3 — achievements derived only from inputs the sprite already holds
 * (no new queries); fixed order, capped by the caller. Quest-pass milestones
 * need a bounded quest lookup and stay out of scope until a dedicated slice.
 */
function deriveMilestones(input: SpriteStateInput, streak: number): SpriteMilestone[] {
  const milestones: SpriteMilestone[] = [];
  const story = input.story;

  if (story != null && story.gatesPassed > 0) {
    milestones.push({
      kind: 'evidence_gate',
      label: `${story.gatesPassed} 个知识节点的提升通过了证据门槛`,
      evidenceRef: { source: 'progress_story', field: 'story.gatesPassed', detail: `${story.gatesPassed} 个节点通过 evidence gate` },
    });
  }
  if (story != null && story.resolvedCount != null && story.resolvedCount > 0) {
    milestones.push({
      kind: 'resolved',
      label: `重做解决了 ${story.resolvedCount} 道错题`,
      evidenceRef: { source: 'progress_story', field: 'story.resolvedCount', detail: `${story.resolvedCount} 道错题已解决` },
    });
  }
  if (streak >= 7) {
    milestones.push({
      kind: 'streak',
      label: `连续学习 ${streak} 天`,
      evidenceRef: { source: 'student_context', field: 'context.momentum.studyStreak', detail: `连续学习 ${streak} 天` },
    });
  }
  if (input.plan?.recoveredFromGap === true) {
    milestones.push({
      kind: 'gap_recovery',
      label: '断档恢复完成，节奏已重建',
      evidenceRef: { source: 'recovery', field: 'plan.recoveredFromGap', detail: '计划由断档恢复重锚生成' },
    });
  }
  return milestones;
}
