import { useEffect, useState } from 'react';
import { isStaticDemoMode } from '../../api/env';
import { fetchTaskEvidence } from '../../api/endpoints/dashboard';
import type { TaskEvidenceRecord } from '../../api/types';
import './task-evidence.css';

/**
 * V11-M2 — learning evidence for recently completed tasks: did capability
 * actually change? Honest contract: only practice-fact and mastery-delta
 * numbers are shown; a completion marker with no practice states plainly
 * that it is not evidence of improvement.
 */
export function TaskEvidencePanel() {
  const [tasks, setTasks] = useState<TaskEvidenceRecord[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isStaticDemoMode()) return;
    let cancelled = false;
    (async () => {
      try {
        const payload = await fetchTaskEvidence();
        if (cancelled) return;
        setTasks(payload.tasks ?? []);
      } catch {
        if (!cancelled) setError('学习证据加载失败，请稍后重试。');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (isStaticDemoMode()) return null;
  if (error) return <p className="task-evidence-note">{error}</p>;
  if (!tasks || tasks.length === 0) return null;

  const improved = tasks.filter((task) => task.verdict === 'improved').length;

  return (
    <div className="task-evidence-panel" role="status" aria-label="任务学习证据">
      <p className="task-evidence-title">最近完成任务的学习证据</p>
      <p className="task-evidence-note">
        完成标记不等于能力提升——以下是每个任务对应知识点上的练习与掌握度事实。
        {improved > 0 ? ` ${improved} 个任务带来了掌握度提升。` : ''}
      </p>
      <ul className="task-evidence-list">
        {tasks.map((task) => (
          <li key={task.taskId} className={`task-evidence-item verdict-${task.verdict}`}>
            <div className="task-evidence-item-head">
              <strong>{task.title}</strong>
              <span className={`task-evidence-verdict verdict-${task.verdict}`}>
                {task.verdict === 'improved' ? '能力提升' : task.verdict === 'practiced' ? '已练习' : task.verdict === 'practiced_no_gain' ? '已练习·未见提升' : '证据不足'}
              </span>
            </div>
            <p className="task-evidence-facts">
              练习 {task.practice.attempts} 次
              {task.practice.accuracyRate != null ? ` · 正确率 ${task.practice.accuracyRate}%` : ''}
              {task.masteryDeltas.length > 0
                ? task.masteryDeltas.map((delta) => (
                    <span key={delta.nodeId}>
                      {' '}· {delta.nodeId} {delta.delta != null ? `${delta.delta > 0 ? '+' : ''}${delta.delta}` : '（快照不足）'}
                    </span>
                  ))
                : null}
            </p>
            <p className="task-evidence-basis">{task.verdictBasis}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
