import { useEffect, useState } from 'react';
import { isStaticDemoMode } from '../../api/env';
import {
  fetchEffectivenessSummary,
  type EffectivenessOutcome,
  type EffectivenessSummary,
} from '../../api/endpoints/effectiveness';

const ARCHETYPE_LABELS: Record<string, string> = {
  strong_consistent: '稳定强势',
  strong_slip: '强势但松动',
  average: '中等水平',
  average_idle: '中等但懈怠',
  weak_cram: '基础薄弱·突击型',
  weak_overdue: '基础薄弱·复习欠债',
  regressing: '状态下滑',
  balanced: '均衡推进',
  overloaded: '任务过载',
  returning: '回归学习者',
  failing: '需要重点支持',
};

const STATUS_LABELS: Record<string, string> = {
  delivered: '已投递',
  executed: '已执行',
  completed: '已完成',
  expired: '已过期',
  ignored: '未响应',
};

const CONFIDENCE_LABELS: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
  insufficient_data: '数据不足',
};

/**
 * V8 backlog #10 — "你的努力带来了什么" powered by the V6.3 effectiveness
 * read model. Honesty contract: only evidence-gate-passed nodes present
 * gains as conclusions; blocked nodes are named insufficient, and
 * correlation is never sold as causation.
 */
export function EffectivenessPanel() {
  const [summary, setSummary] = useState<EffectivenessSummary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isStaticDemoMode()) return;
    let cancelled = false;
    fetchEffectivenessSummary(30)
      .then((result) => {
        if (cancelled) return;
        setSummary(result);
        setError('');
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : '学习效果数据加载失败，请重试。');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isStaticDemoMode()) {
    return (
      <section className="panel effectiveness-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">Learning Effectiveness</p><h3>努力与效果</h3></div>
        </div>
        <p className="empty-state">演示模式不展示学习效果；登录后系统会用你的真实练习记录按周评估。</p>
      </section>
    );
  }

  const outcomes = summary?.outcomes;
  const passedOutcomes = (outcomes?.outcomes ?? [])
    .filter((outcome) => outcome.evidenceGate.passed)
    .sort((left, right) => right.attemptsInWindow - left.attemptsInWindow);

  return (
    <section className="panel effectiveness-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">Learning Effectiveness</p><h3>努力与效果</h3></div>
        {summary ? <span>近 {summary.windowDays} 天 · 证据门槛评估</span> : null}
      </div>
      {error ? (
        <p className="empty-state" role="status">学习效果数据加载失败：{error}</p>
      ) : !summary ? (
        <p className="empty-state">正在加载学习效果评估...</p>
      ) : !outcomes?.hasLearningData ? (
        <p className="empty-state">
          最近 {summary.windowDays} 天还没有练习记录。完成几组练习后，系统会按知识节点评估你的提升。
        </p>
      ) : (
        <>
          {summary.profile.profile ? (
            <p className="effectiveness-profile-line">
              学习画像：<strong>{ARCHETYPE_LABELS[summary.profile.profile.archetype] ?? summary.profile.profile.archetype}</strong>
              {summary.profile.inputs ? (
                <span> · 平均掌握 {Math.round(summary.profile.inputs.avgMastery * 100)}% · 近期正确率 {Math.round(summary.profile.inputs.recentAccuracy * 100)}%</span>
              ) : null}
            </p>
          ) : null}

          <div className="effectiveness-summary-grid">
            <article>
              <strong>{outcomes.summary.gatePassed}</strong>
              <span>个节点证据充分</span>
            </article>
            <article>
              <strong>{outcomes.summary.gateBlocked}</strong>
              <span>个节点证据不足</span>
            </article>
            <article>
              <strong>{outcomes.summary.nodesEvaluated}</strong>
              <span>个节点参与评估</span>
            </article>
          </div>

          {passedOutcomes.length > 0 ? (
            <ul className="effectiveness-gain-list">
              {passedOutcomes.map((outcome: EffectivenessOutcome) => (
                <li key={outcome.knowledgeNodeId} className="effectiveness-gain-item">
                  <strong>{outcome.knowledgeNodeId}</strong>
                  <span>
                    掌握度 {percentLabel(outcome.masteryBefore)} → {percentLabel(outcome.masteryAfter)}
                    （{outcome.masteryGain != null && outcome.masteryGain >= 0 ? '+' : ''}{Math.round((outcome.masteryGain ?? 0) * 100)}）
                    · {outcome.attemptsInWindow} 次练习 · 置信度 {CONFIDENCE_LABELS[outcome.confidence] ?? outcome.confidence}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">
              还没有节点达到证据门槛（至少 5 次练习且掌握度变化明显）。继续按今日计划练习，评估会自动出现——
              在此之前系统不会假装知道你提升了多少。
            </p>
          )}

          {outcomes.summary.gateBlocked > 0 ? (
            <p className="effectiveness-blocked-note">
              另有 {outcomes.summary.gateBlocked} 个节点因练习量或数据不足暂不下结论（证据不足 ≠ 没进步，只是还不能证明）。
            </p>
          ) : null}

          {summary.interventions.hasSourceFacts ? (
            <p className="effectiveness-intervention-line">
              系统干预跟踪：{Object.entries(summary.interventions.byStatus)
                .map(([status, count]) => `${STATUS_LABELS[status] ?? status} ${count}`)
                .join(' · ') || '暂无'}
            </p>
          ) : null}

          <p className="effectiveness-disclaimer">相关不等于因果：效果评估描述的是与学习行为的关联，不承诺分数变化。</p>
        </>
      )}
    </section>
  );
}

function percentLabel(value: number | null): string {
  return value == null ? '--' : `${Math.round(value * 100)}%`;
}
