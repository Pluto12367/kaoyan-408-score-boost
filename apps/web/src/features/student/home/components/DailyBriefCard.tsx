import { useEffect, useState } from 'react';
import { API_BASE_URL, fetchWithAuth } from '../../../../api/client';
import { isStaticDemoMode } from '../../../../api/env';

interface DailyBriefData {
  dateKey: string;
  headline: string;
  stateLines: string[];
  priorities: Array<{ title: string; minutes: number | null; reason: string; kind: 'task' | 'review' }>;
  followUpNote: string | null;
}

/**
 * V9 Phase 1 — the coach's daily briefing card. Grounded composition only:
 * every line comes from the /coach/daily-brief read model. Demo mode hides
 * the card instead of faking a briefing.
 */
export function DailyBriefCard() {
  const [brief, setBrief] = useState<DailyBriefData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isStaticDemoMode()) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetchWithAuth(`${API_BASE_URL}/coach/daily-brief`);
        if (!response.ok) throw new Error(`Daily brief failed with ${response.status}`);
        const data = (await response.json()) as DailyBriefData;
        if (cancelled) return;
        setBrief(data);
        setError('');
      } catch (reason) {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : '今日简报加载失败');
      }
    };
    void load();
    // V9 slice 2: recalibrate on return — finishing practice happens away
    // from the dashboard; the brief must recompute when the student comes
    // back (window focus or a custom refresh signal), not just on mount.
    const onFocus = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const onRefreshSignal = () => void load();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('daily-brief:refresh', onRefreshSignal);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('daily-brief:refresh', onRefreshSignal);
    };
  }, []);

  if (isStaticDemoMode()) return null;

  return (
    <section className="dashboard-section daily-brief-section" aria-label="今日教练简报">
      <div className="dashboard-section-heading"><div><span className="dashboard-kicker">Daily Coach</span><h3>今日教练简报</h3></div><span>{brief?.dateKey ?? ''}</span></div>
      {error ? (
        <p className="dashboard-inline-error" role="status">今日简报加载失败：{error}</p>
      ) : !brief ? (
        <p className="dashboard-muted">正在生成今日简报...</p>
      ) : (
        <>
          <p className="daily-brief-headline">{brief.headline}</p>
          <ul className="daily-brief-states">
            {brief.stateLines.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <ol className="daily-brief-priorities">
            {brief.priorities.map((item, index) => (
              <li key={item.title}>
                <strong>{index + 1}. {item.title}</strong>
                <small>{item.kind === 'review' ? '复习恢复' : '今日计划'}{item.minutes != null ? ` · ${item.minutes} 分钟` : ''} · {item.reason}</small>
              </li>
            ))}
          </ol>
          {brief.followUpNote ? <p className="daily-brief-followup">{brief.followUpNote}</p> : null}
        </>
      )}
    </section>
  );
}
