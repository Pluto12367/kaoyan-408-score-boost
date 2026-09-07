import { useEffect, useState } from 'react';
import { API_BASE_URL, fetchWithAuth } from '../../api/client';
import { isStaticDemoMode } from '../../api/env';

interface ProgressStoryLine {
  kind: 'gain' | 'decline' | 'flat' | 'milestone' | 'no_data';
  text: string;
}

interface ProgressNarrativeData {
  lines: ProgressStoryLine[];
  weekDelta: number | null;
}

const KIND_CLASS: Record<ProgressStoryLine['kind'], string> = {
  gain: 'progress-story-gain',
  decline: 'progress-story-decline',
  flat: 'progress-story-flat',
  milestone: 'progress-story-milestone',
  no_data: 'progress-story-flat',
};

/** V9 Phase 3 — coach-voiced week-over-week progress on the report page. */
export function ProgressStoryCard() {
  const [story, setStory] = useState<ProgressNarrativeData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isStaticDemoMode()) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetchWithAuth(`${API_BASE_URL}/coach/progress-narrative`);
        if (!response.ok) throw new Error(`Progress narrative failed with ${response.status}`);
        const data = (await response.json()) as ProgressNarrativeData;
        if (cancelled) return;
        setStory(data);
        setError('');
      } catch (reason) {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : '本周进步叙事加载失败');
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (isStaticDemoMode()) return null;

  return (
    <section className="panel progress-story-card" aria-label="本周进步叙事">
      <div className="panel-heading">
        <div><p className="eyebrow">Progress Story</p><h3>本周进步叙事</h3></div>
        {story?.weekDelta != null ? (
          <span className={story.weekDelta >= 1 ? 'progress-story-badge gain' : story.weekDelta <= -1 ? 'progress-story-badge decline' : 'progress-story-badge flat'}>
            {story.weekDelta >= 1 ? `+${story.weekDelta}` : story.weekDelta} 点 / 上周
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="empty-state" role="status">本周进步叙事加载失败：{error}</p>
      ) : !story ? (
        <p className="empty-state">正在生成本周进步叙事...</p>
      ) : (
        <ul className="progress-story-lines">
          {story.lines.map((line, index) => (
            <li key={`${line.kind}-${index}`} className={KIND_CLASS[line.kind]}>{line.text}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
