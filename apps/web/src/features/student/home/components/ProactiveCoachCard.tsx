import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { API_BASE_URL, fetchWithAuth } from '../../../../api/client';
import { isStaticDemoMode } from '../../../../api/env';
import { trackEvent } from '../../../../api/events';

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
 * V9 Phase 5 — proactive coach, pull-based.
 *
 * G1.6 fix: this card used to render each intervention as an inert `<li>` with
 * a decorative arrow. The API already supplied everything needed to act —
 * `headline` plus three concrete `actions` plus an `actorHint` naming the
 * canonical surface that executes them (`review` / `plan` / `practice` /
 * `coach`) — but the frontend never read `actorHint` and nothing was clickable.
 * That is the "只弹 Toast" anti-pattern the guidance contract bans: a warning
 * with no route back into the learning flow.
 *
 * Now every item is a button that navigates to the surface its own `actorHint`
 * names, so the correction re-enters the loop instead of ending in a toast.
 */

export type ProactiveTargetSection = 'dashboard' | 'question' | 'wrong-book' | 'test' | 'knowledge-catalog' | 'ai';

/** actorHint → the student section that actually executes it. */
export function sectionForActorHint(actorHint: string, hasNode: boolean): ProactiveTargetSection {
  switch (actorHint) {
    case 'review':
      return 'wrong-book';
    case 'practice':
      return hasNode ? 'knowledge-catalog' : 'question';
    case 'plan':
      return 'dashboard';
    case 'coach':
      return 'ai';
    default:
      return 'dashboard';
  }
}

export function ProactiveCoachCard({ onNavigate }: { onNavigate?: (section: ProactiveTargetSection) => void }) {
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
        {data.interventions.map((item) => {
          const section = sectionForActorHint(item.actorHint, Boolean(item.knowledgeNodeId));
          return (
            <li key={item.id} className={`proactive-coach-item severity-${item.severity}`}>
              <button
                type="button"
                className="proactive-coach-action"
                data-testid={`proactive-${item.id}`}
                data-target-section={section}
                onClick={() => {
                  if (isStaticDemoMode()) return;
                  void trackEvent('guidance.accepted', {
                    guidanceId: `proactive:${item.trigger}`,
                    trigger: item.trigger,
                    action: item.actorHint,
                    surface: 'proactive_coach',
                  });
                  // Fallback so the card is actionable even without a callback
                  // (the home mounts it as `<ProactiveCoachCard />`); the hash
                  // router is the app's primary section channel.
                  if (onNavigate) onNavigate(section);
                  else if (typeof window !== 'undefined') window.location.hash = `#/${section}`;
                }}
              >
                <span className="proactive-coach-head">
                  {item.severity === 'high' ? <AlertTriangle size={15} aria-hidden="true" /> : null}
                  <strong>{item.headline}</strong>
                  <span className="proactive-coach-severity">{SEVERITY_LABELS[item.severity]}</span>
                </span>
                {item.actions.length > 0 ? <small className="proactive-coach-steps">{item.actions.join('；')}</small> : null}
                <span className="proactive-coach-go">去做 <ArrowRight size={13} aria-hidden="true" /></span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
