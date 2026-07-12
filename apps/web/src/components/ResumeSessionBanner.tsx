import { useState, useEffect } from 'react';
import { Clock, X } from 'lucide-react';
import { listActiveSessions, type SessionView } from '../api/endpoints/sessions';

interface Props {
  onResume: (session: SessionView) => void;
}

export function ResumeSessionBanner({ onResume }: Props) {
  const [activeSessions, setActiveSessions] = useState<SessionView[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    listActiveSessions()
      .then((result) => setActiveSessions(result.sessions))
      .catch(() => { /* no sessions */ });
  }, []);

  const visible = activeSessions.filter((s) => !dismissed.has(s.id));

  if (visible.length === 0) return null;

  return (
    <section className="resume-banner">
      {visible.map((session) => (
        <div key={session.id} className="resume-card">
          <Clock size={16} />
          <div>
            <strong>
              {session.type === 'practice_set' ? '专项练习' : session.type === 'stage_assessment' ? '阶段测评' : '模拟考试'}
            </strong>
            <span>
              进度 {session.progressRate}% · {session.answeredCount}/{session.totalQuestions} 题
              · {Math.round(session.totalActiveMs / 60000)} 分钟
            </span>
          </div>
          <div className="resume-actions">
            <button type="button" className="primary-action" onClick={() => onResume(session)}>
              继续
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={() => setDismissed((d) => new Set([...d, session.id]))}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
