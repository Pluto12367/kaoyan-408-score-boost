/**
 * V10-1 Sprite Persona — the copy layer of the companion (pure, dependency-free).
 *
 * 星野 speaks only from verified facts (see docs/v10-sprite-product-constitution.md §3):
 * every template interpolates numbers passed in from the derivation layer, every
 * produced line carries evidence and must pass validatePersonaCopy (the six
 * forbidden categories of the constitution: comparison / guilt / empty_cheer /
 * anxiety / childish / false_promise). Static templates self-check at module
 * scope; runtime copy (intervention headlines) falls back to a safe static line
 * instead of ever tripping the guardrail.
 */

import type { MoodReasonKind, SpriteEvidenceRef, SpriteLine, SpriteLineTone, SpriteMood } from './sprite-state';

export const SPRITE_LINE_MAX_LENGTH = 60;

export type PersonaViolationCategory =
  | 'comparison'
  | 'guilt'
  | 'empty_cheer'
  | 'anxiety'
  | 'childish'
  | 'false_promise'
  | 'length';

export interface PersonaViolation {
  readonly category: PersonaViolationCategory;
  readonly pattern: string;
}

const FORBIDDEN_PATTERNS: readonly {
  readonly category: Exclude<PersonaViolationCategory, 'length'>;
  readonly regex: RegExp;
}[] = [
  { category: 'comparison', regex: /落后|别的同学|其他同学|排名|超过.{0,8}的考生/ },
  { category: 'guilt', regex: /你怎么又|你总是|再不.{0,8}就|辜负|白费|活该|都怪你/ },
  { category: 'empty_cheer', regex: /你最棒|你最优秀|相信自己|加油加油|一定可以|你可以的/ },
  { category: 'anxiety', regex: /来不及|考不上|危险|完了|惨了|告急/ },
  { category: 'childish', regex: /人家|呜呜|主人|棒棒哒|么么|哟~|嘛~/ },
  { category: 'false_promise', regex: /我帮你把|已帮你|已经帮你|我已提升|帮你改好|替你完成|替你学习/ },
];

export function validatePersonaCopy(text: string): PersonaViolation[] {
  const violations: PersonaViolation[] = [];
  for (const { category, regex } of FORBIDDEN_PATTERNS) {
    const match = regex.exec(text);
    if (match) violations.push({ category, pattern: match[0] });
  }
  if (text.length > SPRITE_LINE_MAX_LENGTH) {
    violations.push({ category: 'length', pattern: 'SPRITE_LINE_MAX_LENGTH' });
  }
  return violations;
}

/** Facts the copy templates may interpolate — all precomputed by the derivation layer. */
export interface SpriteCopyContext {
  readonly carryOverCount: number;
  readonly weekDelta: number | null;
  readonly gatesPassed: number;
  readonly resolvedCount: number | null;
  readonly studyStreak: number;
  readonly openTaskCount: number;
  readonly firstOpenTaskTitle: string | null;
  readonly concernHeadline: string | null;
  readonly concernActorHint: 'review' | 'plan' | 'practice' | 'coach' | null;
}

const ACTOR_TARGETS: Record<SpriteCopyContext['concernActorHint'] & string, { target: string; label: string }> = {
  review: { target: '#/wrong-book', label: '清复习' },
  plan: { target: '#/dashboard', label: '看计划' },
  practice: { target: '#/question', label: '去练习' },
  coach: { target: '#/ai', label: '问教练' },
};

const DASHBOARD_ACTION = { kind: 'deep_link' as const, target: '#/dashboard', label: '看今日任务' };
const PRACTICE_ACTION = { kind: 'deep_link' as const, target: '#/question', label: '去练习' };
const WRONG_BOOK_ACTION = { kind: 'deep_link' as const, target: '#/wrong-book', label: '看错题' };
const STORY_ACTION = { kind: 'deep_link' as const, target: '#/test', label: '看进步叙事' };

const SAFE_CONCERN_FALLBACK = '复习和错题在提醒你：今天先清最急的一件事。';

function truncateTitle(title: string): string {
  return title.length > 14 ? `${title.slice(0, 14)}…` : title;
}

function buildLine(
  mood: SpriteMood,
  kind: MoodReasonKind,
  text: string,
  tone: SpriteLineTone,
  evidenceRefs: readonly SpriteEvidenceRef[],
  action?: SpriteLine['action'],
): SpriteLine {
  // Static templates are checked at build time; a future edit that trips the
  // constitution fails the contract tests instead of reaching a student.
  const violations = validatePersonaCopy(text);
  if (violations.length > 0) {
    throw new Error(`persona template ${mood}.${kind} violates the constitution: ${JSON.stringify(violations)}`);
  }
  return { id: `${mood}.${kind}`, text, tone, evidenceRefs, ...(action ? { action } : {}) };
}

export function buildSpriteLines(mood: SpriteMood, kind: MoodReasonKind, facts: SpriteCopyContext): SpriteLine[] {
  switch (kind) {
    case 'gap_recovery':
      return [
        buildLine(
          mood,
          kind,
          '欢迎回来。断档不清零，进度都在。今天从一件小事开始。',
          'warm',
          [{ source: 'recovery', field: 'plan.recoveredFromGap', detail: '今日计划由断档恢复生成，进度未被清零' }],
          DASHBOARD_ACTION,
        ),
      ];
    case 'carry_over':
      return [
        buildLine(
          mood,
          kind,
          `欢迎回来。我把 ${facts.carryOverCount} 个未完成任务排回了今天，从第一个开始就好。`,
          'warm',
          [{ source: 'recovery', field: 'plan.carryOverCount', detail: `${facts.carryOverCount} 个任务已结转回今日窗口` }],
          DASHBOARD_ACTION,
        ),
      ];
    case 'high_risk':
    case 'medium_risk': {
      const headline = facts.concernHeadline ?? '';
      const text = headline.length > 0 && validatePersonaCopy(headline).length === 0
        ? headline
        : SAFE_CONCERN_FALLBACK;
      const target = ACTOR_TARGETS[facts.concernActorHint ?? 'coach'] ?? ACTOR_TARGETS.coach;
      return [
        buildLine(
          mood,
          kind,
          text,
          'firm',
          [{ source: 'proactive', field: 'interventions.0.headline', detail: `来自风险层的主动干预（severity=${kind === 'high_risk' ? 'high' : 'medium'}）` }],
          { kind: 'deep_link' as const, target: target.target, label: target.label },
        ),
      ];
    }
    case 'progress_gain':
      return [
        buildLine(
          mood,
          kind,
          `这周平均掌握度 +${facts.weekDelta} 点——不是感觉，是快照算出来的。`,
          'warm',
          [{ source: 'progress_story', field: 'story.weekDelta', detail: '周环比为正且两侧各 ≥2 个有效快照' }],
          STORY_ACTION,
        ),
      ];
    case 'evidence_milestone':
      if (facts.gatesPassed > 0) {
        return [
          buildLine(
            mood,
            kind,
            `${facts.gatesPassed} 个知识节点的提升通过了证据门槛，稳。`,
            'warm',
            [{ source: 'progress_story', field: 'story.gatesPassed', detail: `${facts.gatesPassed} 个节点通过 evidence gate` }],
            STORY_ACTION,
          ),
        ];
      }
      return [
        buildLine(
          mood,
          kind,
          `重做解决了 ${facts.resolvedCount} 道错题，错误债务在变少。`,
          'warm',
          [{ source: 'progress_story', field: 'story.resolvedCount', detail: `${facts.resolvedCount} 道错题已重做解决` }],
          WRONG_BOOK_ACTION,
        ),
      ];
    case 'plan_complete':
      return [
        buildLine(
          mood,
          kind,
          '今天的计划全部完成。到这里就好，明天我照常在。',
          'neutral',
          [
            { source: 'today_plan', field: 'plan.completedTasks', detail: '今日任务全部完成' },
            { source: 'student_context', field: 'context.review.overdueCount', detail: '无逾期复习债务' },
          ],
        ),
      ];
    case 'streak_active':
      return [
        buildLine(
          mood,
          kind,
          `连续学习 ${facts.studyStreak} 天，节奏已经长在你身上。`,
          'warm',
          [{ source: 'student_context', field: 'context.momentum.studyStreak', detail: `连续学习 ${facts.studyStreak} 天` }],
        ),
      ];
    case 'plan_pending':
      return [
        buildLine(
          mood,
          kind,
          `今天还有 ${facts.openTaskCount} 个任务。从「${truncateTitle(facts.firstOpenTaskTitle ?? '第一个任务')}」开始就好。`,
          'encourage',
          [
            { source: 'today_plan', field: 'plan.totalTasks', detail: `${facts.openTaskCount} 个任务待完成` },
            { source: 'today_plan', field: 'plan.firstOpenTaskTitle', detail: '第一个未完成任务' },
          ],
          DASHBOARD_ACTION,
        ),
      ];
    case 'session_active':
      return [];
    case 'insufficient_data':
      return [
        buildLine(
          mood,
          kind,
          '我还不够了解你——先做一组小练习，我才能真正帮上忙。',
          'neutral',
          [{ source: 'student_context', field: 'context.practice.recentAccuracy.status', detail: '练习样本不足（insufficient_data）' }],
          PRACTICE_ACTION,
        ),
      ];
    case 'context_unavailable':
      return [
        buildLine(
          mood,
          kind,
          '这次没读到你的学习数据。不是你的问题，稍后再试试。',
          'neutral',
          [{ source: 'student_context', field: 'context', detail: 'StudentContext 本次拉取失败' }],
        ),
      ];
    case 'no_signal':
    default:
      return [
        buildLine(
          mood,
          kind === 'no_signal' ? kind : 'no_signal',
          '我在。想学的时候点我，我随时都在。',
          'neutral',
          [{ source: 'student_context', field: 'context.momentum', detail: '已检查动量与计划：无待处理信号' }],
        ),
      ];
  }
}
