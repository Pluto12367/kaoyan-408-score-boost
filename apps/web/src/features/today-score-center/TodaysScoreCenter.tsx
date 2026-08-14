import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchTodayPlan } from '../../api/endpoints/onboarding';
import { generateScoreCenterPlan } from '../../api/endpoints/score-center';
import { RecommendationCard } from './RecommendationCard';
import { WhyRecommendedDrawer } from './WhyRecommendedDrawer';
import { subjectCopy } from './reason-copy';
import type { ScoreCenterItem, ScoreCenterPlan } from './types';

const MINUTE_OPTIONS = [30, 60, 120, 180] as const;

function defaultTargetExamDate(): string {
  const now = new Date();
  const year = now.getMonth() >= 11 ? now.getFullYear() + 1 : now.getFullYear();
  return `${year}-12-20`;
}

export function TodaysScoreCenter() {
  const [plan, setPlan] = useState<ScoreCenterPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [minutes, setMinutes] = useState<30 | 60 | 120 | 180>(120);
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [explainItem, setExplainItem] = useState<ScoreCenterItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const today = await fetchTodayPlan();
      setPlan(today.scoreCenter ?? null);
      if (today.scoreCenter?.availableMinutes) {
        setMinutes(today.scoreCenter.availableMinutes as 30 | 60 | 120 | 180);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '今日提分计划加载失败，请重试。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = useCallback(async (nextMinutes: 30 | 60 | 120 | 180) => {
    setGenerating(true);
    setError('');
    try {
      const next = await generateScoreCenterPlan({
        targetExamDate: defaultTargetExamDate(),
        availableMinutes: nextMinutes,
      });
      setPlan(next);
      setMinutes(nextMinutes);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '今日提分计划生成失败，请重试。');
    } finally {
      setGenerating(false);
    }
  }, []);

  const visibleItems = useMemo(() => {
    const items = plan?.items ?? [];
    return subjectFilter === 'all' ? items : items.filter((item) => item.subject === subjectFilter);
  }, [plan, subjectFilter]);

  const subjects = useMemo(() => [...new Set((plan?.items ?? []).map((item) => item.subject))], [plan]);
  const isEmptyPlan = !plan || plan.items.length === 0;

  const startPractice = useCallback(() => {
    window.location.hash = '#/question';
  }, []);

  return (
    <section id="today-score-center" className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">今日提分中心</p>
          <h3>今天最应该学什么</h3>
        </div>
      </div>
      {plan?.stale ? (
        <p className="task-status">当前展示上一次有效计划，新的推荐计算暂时不可用。</p>
      ) : null}
      <div className="score-center-time-controls" role="group" aria-label="计划时长">
        {MINUTE_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={minutes === option ? 'active' : ''}
            onClick={() => void generate(option)}
            disabled={generating}
          >
            {option} 分钟
          </button>
        ))}
      </div>
      {subjects.length > 1 ? (
        <label className="score-center-filter">
          科目
          <select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)}>
            <option value="all">全部</option>
            {subjects.map((subject) => (
              <option key={subject} value={subject}>{subjectCopy[subject] ?? subject}</option>
            ))}
          </select>
        </label>
      ) : null}
      {loading ? <p className="task-status">正在加载今日提分计划...</p> : null}
      {error ? (
        <div className="module-error">
          <span>{error}</span>
          <button type="button" className="secondary-action" onClick={() => void load()}>重新加载</button>
        </div>
      ) : null}
      {!loading && !error && isEmptyPlan ? (
        <div className="empty-state">
          <p>还没有今日提分计划。</p>
          <button type="button" className="primary-action" onClick={() => void generate(120)} disabled={generating}>
            生成今日计划
          </button>
        </div>
      ) : null}
      {!loading && !error && plan && plan.items.length > 0 ? (
        <>
          <p className="task-status">
            共 {plan.summary.totalTasks} 项 · 建议总时长 {plan.summary.totalMinutes} 分钟
          </p>
          <div className="score-center-list">
            {visibleItems.slice(0, 3).map((item) => (
              <RecommendationCard key={item.id} item={item} onExplain={setExplainItem} onStart={startPractice} />
            ))}
          </div>
          {visibleItems.length > 3 ? (
            <>
              <h4>今日完整建议</h4>
              <div className="score-center-list">
                {visibleItems.slice(3).map((item) => (
                  <RecommendationCard key={item.id} item={item} onExplain={setExplainItem} onStart={startPractice} />
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : null}
      <WhyRecommendedDrawer item={explainItem} onClose={() => setExplainItem(null)} />
    </section>
  );
}
