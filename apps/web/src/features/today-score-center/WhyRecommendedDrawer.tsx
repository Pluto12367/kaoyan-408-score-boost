import { buildReasonDetailFromCode, resolveShownReasons, PRIORITY_SCORE_NOTE, type PriorityReasonCode } from '@kaoyan408/shared';
import { reasonCopy } from './reason-copy';
import type { ScoreCenterItem } from './types';

interface WhyRecommendedDrawerProps {
  item: ScoreCenterItem | null;
  onClose: () => void;
}

const breakdownLabels: Record<string, string> = {
  examValue: '真题价值',
  weakness: '薄弱度',
  forgetting: '遗忘度',
  difficulty: '难度',
  trend: '趋势',
  pinned: '置顶',
};

/**
 * 「为什么推荐我学这个」.
 *
 * G1 Release Hardening (owner decision A1, EVIDENCED_REASON-only): the main why
 * list shows EVIDENCED reasons only. This drawer used to print every reason code
 * the engine returned, which meant exam statistics (frequency, trend) and pure
 * context (exam is near) sat in the same list as observations about the student,
 * under a heading that promised a reason.
 *
 * The three tiers are now separated and labelled:
 *   why             EVIDENCED — "the system observed this about you"
 *   sortingFactors  INFERRED — exam statistics that steer the ranking, explicitly
 *                    labelled as not being the student's evidence
 *   context         CONTEXTUAL_FACT — the situation
 *
 * Numeric gaps render as `—`, never as a literal 0, and the priority score is
 * labelled as an ordering hint rather than an obligation.
 */
export function WhyRecommendedDrawer({ item, onClose }: WhyRecommendedDrawerProps) {
  if (!item) return null;
  const codes = (item.reasonCodes ?? []) as PriorityReasonCode[];
  const view = resolveShownReasons({ reasons: codes, reasonDetails: codes.map(buildReasonDetailFromCode) });
  const breakdown = item.scoreBreakdown ?? {};

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-label="为什么推荐我学这个">
        <div className="dialog-head">
          <h3>为什么推荐我学这个</h3>
          <button type="button" className="secondary-action" onClick={onClose} aria-label="关闭">关闭</button>
        </div>
        <p className="eyebrow">{item.title}</p>
        <p className="task-status">
          学习优先级：{priorityBand(item.score)}（{item.score ?? '—'}/100）
        </p>
        <p className="dashboard-muted">{PRIORITY_SCORE_NOTE}</p>

        {view.reasons.length > 0 ? (
          <>
            <h4>为什么推荐（你的学习证据）</h4>
            <ul className="reason-list" data-testid="drawer-evidenced-reasons">
              {view.reasons.map((reason) => <li key={reason.code}>{reason.statement || reason.code}</li>)}
            </ul>
          </>
        ) : (
          <p className="task-status" data-testid="drawer-insufficient">{view.insufficientNote}</p>
        )}

        {view.inferred.length > 0 ? (
          <>
            <h4>排序参考（考试统计，不是你的学习证据）</h4>
            <ul className="reason-list" data-testid="drawer-sorting-factors">
              {view.inferred.map((factor) => (
                <li key={factor.code}>{factor.statement || reasonCopy[factor.code] || factor.code}</li>
              ))}
            </ul>
          </>
        ) : null}

        {view.contextFacts.length > 0 ? (
          <>
            <h4>当前情况</h4>
            <ul className="reason-list" data-testid="drawer-context-facts">
              {view.contextFacts.map((fact) => (
                <li key={fact.code}>{fact.statement || reasonCopy[fact.code] || fact.code}</li>
              ))}
            </ul>
          </>
        ) : null}

        <h4>分数构成</h4>
        <dl className="breakdown-list">
          {Object.entries(breakdownLabels).map(([key, label]) => (
            <div key={key} className="breakdown-row">
              <dt>{label}</dt>
              {/* Missing is rendered as absent, not as a zero the student would read as a real value. */}
              <dd>{breakdown[key] == null ? '—' : Math.round(breakdown[key])}</dd>
            </div>
          ))}
        </dl>
        <p className="task-status">
          暂无个人做题数据时，当前按中性冷启动值计算，不视为掌握度差。
        </p>
      </section>
    </div>
  );
}

/** Ordering hint only — never a directive. */
function priorityBand(score: number | null | undefined): string {
  if (score == null) return '未计算';
  if (score >= 70) return '高';
  if (score >= 45) return '中';
  return '低';
}
