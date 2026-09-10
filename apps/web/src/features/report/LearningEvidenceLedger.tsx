import { useEffect, useState } from 'react';
import { isStaticDemoMode } from '../../api/env';
import { fetchLearningEvidence } from '../../api/endpoints/dashboard';
import type { LearningEvidenceBundle, LearningEvidenceRecord } from '../../api/types';
import './learning-ledger.css';

/**
 * V12-M1/M2b — the learning evidence ledger.
 *
 * Shows what the system actually OBSERVED for each action, and — just as
 * important — what it did not. Three kinds of record exist and are labelled
 * differently on purpose:
 *
 *   观测证据 (strong)  a graded attempt or recall outcome was observed; the
 *                      only kind that may support an ability claim
 *   自评证据 (weak)    the student reported numbers; recorded, but it must
 *                      never be shown as proof of ability
 *   仅活动  (none)     something happened and nothing was observed
 *
 * The panel also relays the system's refusal: when no strong observation
 * exists it says so in words rather than rendering a zero or a gain.
 */
export function LearningEvidenceLedger() {
  const [bundle, setBundle] = useState<LearningEvidenceBundle | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isStaticDemoMode()) return;
    let cancelled = false;
    (async () => {
      try {
        const payload = await fetchLearningEvidence();
        if (!cancelled) setBundle(payload);
      } catch {
        if (!cancelled) setError('学习证据加载失败，请稍后重试。');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (isStaticDemoMode()) return null;
  if (error) return <p className="ledger-note">{error}</p>;
  if (!bundle) return null;

  const records = bundle.records ?? [];
  const summary = bundle.summary;

  if (bundle.reason === 'store_unavailable' || summary == null) {
    return (
      <div className="ledger-panel" role="status" aria-label="学习证据台账">
        <p className="ledger-title">学习证据台账</p>
        <p className="ledger-note">学习证据暂时不可用（数据存储未就绪），因此不显示任何能力判断。</p>
      </div>
    );
  }

  return (
    <div className="ledger-panel" role="status" aria-label="学习证据台账">
      <p className="ledger-title">学习证据台账</p>
      <p className="ledger-note">
        只有被系统观测到的作答才能支撑能力判断；自评数字与完成标记会被记录，但不作为能力依据。
      </p>
      <p className="ledger-summary">
        共 {summary.total} 条记录 · 观测证据 {summary.strong} · 自评证据 {summary.weak} · 仅活动 {summary.none}
      </p>
      {summary.hasAbilityEvidence ? (
        <p className="ledger-summary">{summary.basis}</p>
      ) : (
        <p className="ledger-summary ledger-refusal">
          没有可支撑能力推断的观测证据，系统拒绝据此判断能力变化。{summary.basis}
        </p>
      )}
      {records.length === 0 ? (
        <p className="ledger-note">还没有任何学习证据记录——完成一次练习或复习后这里会出现依据。</p>
      ) : (
        <ul className="ledger-list">
          {records.map((record) => (
            <li key={record.id} className={`ledger-item strength-${record.strength}`}>
              <div className="ledger-item-head">
                <strong>{actionLabel(record.action)}</strong>
                <span className={`ledger-badge strength-${record.strength}`}>{strengthLabel(record.strength)}</span>
              </div>
              <p className="ledger-facts">{factLine(record)}</p>
              <p className="ledger-basis">{record.basis}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function actionLabel(action: LearningEvidenceRecord['action']): string {
  switch (action) {
    case 'practice.answered':
      return '练习作答';
    case 'task.completed':
      return '任务完成';
    case 'review.marked':
      return '标记已复习';
    case 'review.recalled':
      return '复习重做';
    case 'assessment.submitted':
      return '测评提交';
    default:
      return '学习动作';
  }
}

function strengthLabel(strength: LearningEvidenceRecord['strength']): string {
  if (strength === 'strong') return '观测证据';
  if (strength === 'weak') return '自评证据';
  return '仅活动';
}

/** Facts are printed only where an observation exists; absence stays absent. */
function factLine(record: LearningEvidenceRecord): string {
  const parts: string[] = [];
  const { attempts, correctCount, accuracyRate, minutesSpent, selfReported } = record.metrics;
  if (attempts != null) parts.push(`作答 ${attempts} 次`);
  if (correctCount != null) parts.push(`正确 ${correctCount} 次`);
  if (accuracyRate != null) parts.push(`正确率 ${accuracyRate}%`);
  if (minutesSpent != null) parts.push(`用时 ${minutesSpent} 分钟`);
  if (selfReported) parts.push('来源：学生自评');
  if (parts.length === 0) return '未观测到任何表现数据。';
  if (!record.canInfluenceMastery) parts.push('（不作为能力依据）');
  return parts.join(' · ');
}
