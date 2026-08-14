import { useEffect, useState } from 'react';
import { isStaticDemoMode } from '../../api/env';
import { fetchMasteryTrend, type MasteryTrend } from '../../api/endpoints/trend';

export function MasteryTrendPanel() {
  const [trend, setTrend] = useState<MasteryTrend | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isStaticDemoMode()) return;
    let cancelled = false;
    fetchMasteryTrend(14)
      .then((result) => {
        if (cancelled) return;
        setTrend(result);
        setError('');
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : '掌握度趋势加载失败，请重试。');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isStaticDemoMode()) {
    return (
      <section className="panel mastery-trend-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">报告图谱化</p><h3>掌握度趋势</h3></div>
        </div>
        <p className="empty-state">演示模式不展示掌握度趋势；登录后按每日快照自动积累。</p>
      </section>
    );
  }

  const hasData = Boolean(trend && trend.overall.length > 0);
  return (
    <section className="panel mastery-trend-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">报告图谱化</p><h3>掌握度趋势</h3></div>
        {trend ? <span>近 {trend.days} 天 · 每日快照</span> : null}
      </div>
      {error ? (
        <p className="empty-state" role="status">掌握度趋势加载失败：{error}</p>
      ) : !hasData ? (
        <p className="empty-state">暂无掌握度快照。完成练习后，系统会按天记录节点掌握度并在此形成趋势。</p>
      ) : (
        <>
          <div className="trend-overall">
            <h4>整体掌握度</h4>
            <TrendBars points={trend!.overall} />
          </div>
          <div className="trend-subjects">
            {trend!.subjects.map((subject) => (
              <article key={subject.subject} className="trend-subject">
                <header>
                  <strong>{subject.subject}</strong>
                  <span>平均掌握度 {subject.averageMastery}%</span>
                </header>
                <TrendBars points={subject.series} />
                {subject.weakestNodes.length ? (
                  <ul className="trend-weak-list">
                    {subject.weakestNodes.map((node) => (
                      <li key={node.knowledgeNodeId}>
                        <strong>{node.title}</strong>
                        <small>{node.chapter} · 当前 {node.mastery}%</small>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
          <div className="trend-deltas">
            <section>
              <h4>提升最快</h4>
              {trend!.improving.length ? (
                <ul>
                  {trend!.improving.map((item) => (
                    <li key={item.knowledgeNodeId}><strong>{item.title}</strong><span>+{item.delta}%</span></li>
                  ))}
                </ul>
              ) : <p className="catalog-drawer-empty">暂无</p>}
            </section>
            <section>
              <h4>需要关注</h4>
              {trend!.declining.length ? (
                <ul>
                  {trend!.declining.map((item) => (
                    <li key={item.knowledgeNodeId}><strong>{item.title}</strong><span>{item.delta}%</span></li>
                  ))}
                </ul>
              ) : <p className="catalog-drawer-empty">暂无</p>}
            </section>
          </div>
        </>
      )}
    </section>
  );
}

function TrendBars({ points }: { points: Array<{ date: string; averageMastery: number }> }) {
  if (points.length === 0) return <p className="catalog-drawer-empty">暂无数据</p>;
  return (
    <div className="trend-bars" role="img" aria-label="掌握度趋势柱状图">
      {points.map((point) => (
        <div key={point.date} className="trend-bar-col" title={`${point.date}：${point.averageMastery}%`}>
          <span className="trend-bar" style={{ height: `${Math.max(2, point.averageMastery)}%` }} />
          <small>{point.date.slice(5)}</small>
        </div>
      ))}
    </div>
  );
}
