import { useState } from 'react';
import { Target } from 'lucide-react';
import type { StudyPlan, UserProfile } from '@kaoyan408/shared';
import { importAssessmentHistory } from '../../api/endpoints/dashboard';

interface DiagnosticSummaryProps {
  student: UserProfile;
  plan: StudyPlan;
  status: string;
  onSubmit: () => void;
}

export function DiagnosticSummary({ student, plan, status, onSubmit }: DiagnosticSummaryProps) {
  const [historyTitle, setHistoryTitle] = useState('');
  const [historyScore, setHistoryScore] = useState('');
  const [historyTotal, setHistoryTotal] = useState('');
  const [historyStatus, setHistoryStatus] = useState('');
  const [importing, setImporting] = useState(false);

  async function handleImportHistory() {
    const score = Number(historyScore);
    const totalScore = Number(historyTotal);
    const title = historyTitle.trim();
    if (!title) {
      setHistoryStatus('请填写考试/测验名称。');
      return;
    }
    if (!Number.isFinite(totalScore) || totalScore <= 0) {
      setHistoryStatus('总分必须是大于 0 的数字。');
      return;
    }
    if (!Number.isFinite(score) || score < 0 || score > totalScore) {
      setHistoryStatus('得分必须在 0 到总分之间。');
      return;
    }
    setImporting(true);
    setHistoryStatus('');
    try {
      await importAssessmentHistory({ title, score, totalScore });
      setHistoryStatus(`已导入：${title}（${score}/${totalScore}）。评估历史已更新，趋势会与当前水平对比。`);
      setHistoryTitle('');
      setHistoryScore('');
      setHistoryTotal('');
    } catch (error) {
      setHistoryStatus(error instanceof Error ? error.message : '历史成绩导入失败，请重试。');
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="panel diagnostic-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">入学诊断</p><h3>根据目标和基础生成阶段计划</h3></div>
        <button type="button" className="secondary-action" onClick={onSubmit}><Target size={18} /> 开始入学诊断</button>
      </div>
      <p className="task-status">{status}</p>
      <div className="diagnostic-grid">
        <article><strong>{student.currentScore ?? 0}</strong><span>当前估分</span></article>
        <article><strong>{student.targetScore ?? 0}</strong><span>目标分</span></article>
        <article><strong>{student.weakestSubject ?? '待诊断'}</strong><span>最弱科目</span></article>
        <article><strong>{plan.phase}</strong><span>当前计划阶段</span></article>
      </div>
      <div className="history-import">
        <h4>历史成绩导入（可选）</h4>
        <p className="muted">把之前的模拟考/测验成绩录进来，报告趋势会与当前备考水平对比。</p>
        <div className="history-import-fields">
          <input
            type="text"
            placeholder="考试/测验名称（如：暑期模考）"
            value={historyTitle}
            onChange={(event) => setHistoryTitle(event.target.value)}
          />
          <input
            type="number"
            min={0}
            placeholder="得分"
            value={historyScore}
            onChange={(event) => setHistoryScore(event.target.value)}
          />
          <input
            type="number"
            min={1}
            placeholder="总分（如 100）"
            value={historyTotal}
            onChange={(event) => setHistoryTotal(event.target.value)}
          />
          <button type="button" className="secondary-action" disabled={importing} onClick={() => void handleImportHistory()}>
            {importing ? '导入中...' : '导入成绩'}
          </button>
        </div>
        {historyStatus ? <p className="task-status">{historyStatus}</p> : null}
      </div>
    </section>
  );
}
