import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { API_BASE_URL, fetchWithAuth } from '../../../../api/client';
import { isStaticDemoMode } from '../../../../api/env';

interface ProactiveIntervention {
  id: string;
  trigger: string;
  severity: 'high' | 'medium' | 'low';
  headline: string;
  actions: string[];
  actorHint: string;
  knowledgeNodeId?: string;
}

interface ProactiveData {
  count: number;
  hasRisks: boolean;
  interventions: ProactiveIntervention[];
}

const SEVERITY_LABELS: Record<ProactiveIntervention['severity'], string> = {
  high: '需要处理',
  medium: '建议关注',
  low: '可以稍后',
};

/**
 * V9 Phase 5 — proactive coach, pull-based. The card renders ONLY when the
 * risk derivation surfaces a grounded intervention; quiet means quiet.
 */
export function ProactiveCoachCard() {
  const [data, setData] = useState<ProactiveData | null>(null);

  useEffect(() => {
    if (isStaticDemoMode()) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetchWithAuth(`${API_BASE_URL}/coach/proactive`);
        if (!response.ok) return;
        const payload = (await response.json()) as ProactiveData;
        if (cancelled) return;
        setData(payload);
      } catch {
        // silent: proactive surface must never become an error banner
      }
    };
    void load();
    const onRefreshSignal = () => void load();
    window.addEventListener('daily-brief:refresh', onRefreshSignal);
    return () => {
      cancelled = true;
      window.removeEventListener('daily-brief:refresh', onRefreshSignal);
    };
  }, []);

  if (isStaticDemoMode()) return null;
  if (!data || data.count === 0) return null;

  return (
    <section className="dashboard-section proactive-coach-section" aria-label="AI 主动教练">
      <div className="dashboard-section-heading">
        <div>
          <span className="dashboard-kicker">Proactive Coach</span>
          <h3>教练主动提醒</h3>
        </div>
        <span>{data.count} 条</span>
      </div>
      <ul className="proactive-coach-list">
        {data.interventions.map((item) => (
          <li key={item.id} className={`proactive-coach-item severity-${item.severity}`}>
            <div className="proactive-coach-head">
              {item.severity === 'high' ? <AlertTriangle size={15} aria-hidden="true" /> : null}
              <strong>{item.headline}</strong>
              <span className="proactive-coach-severity">{SEVERITY_LABELS[item.severity]}</span>
            </div>
            {item.actions.length > 0 ? <small>{item.actions.join('；')}</small> : null}
            <span className="proactive-coach-arrow"><ArrowRight size={13} aria-hidden="true" /></span>
          </li>
        ))}
      </ul>
    </section>
  );
}
