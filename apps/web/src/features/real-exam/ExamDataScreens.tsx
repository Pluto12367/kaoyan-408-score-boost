import { useEffect, useState } from 'react';
import {
  fetchRealExamDashboard,
  fetchRealExamFrequency,
  fetchRealExamUncovered,
  type RealExamDashboard,
  type RealExamFrequency,
  type RealExamUncovered,
} from '../../api/endpoints/realExam';
import { ExamEnhancedScreens } from './ExamEnhancedScreens';

const SUBJECTS = [
  { value: '', label: '全部科目' },
  { value: 'DATA_STRUCTURE', label: '数据结构' },
  { value: 'COMPUTER_ORGANIZATION', label: '组成原理' },
  { value: 'OPERATING_SYSTEM', label: '操作系统' },
  { value: 'COMPUTER_NETWORK', label: '计算机网络' },
];

const LEVEL_LABEL: Record<string, string> = { high: '高频（考过≥10年）', mid: '中频（5-9年）', low: '低频（2-4年）', cold: '冷门/未考（≤1年）' };

/**
 * V14-R4-A 数据屏 — 真题大盘 / 考频地图 / 大纲漏网（公共统计，只读）。
 */
export function ExamDataScreens() {
  const [dashboard, setDashboard] = useState<RealExamDashboard | null>(null);
  const [frequency, setFrequency] = useState<RealExamFrequency | null>(null);
  const [uncovered, setUncovered] = useState<RealExamUncovered | null>(null);
  const [subject, setSubject] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchRealExamDashboard(), fetchRealExamFrequency(subject || undefined), fetchRealExamUncovered()])
      .then(([dash, freq, uncov]) => {
        if (cancelled) return;
        setDashboard(dash);
        setFrequency(freq);
        setUncovered(uncov);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [subject]);

  return (
    <section className="exam-data-screens" aria-label="真题数据屏">
      {loading ? <p className="muted">加载中…</p> : null}
      {error ? <p className="real-exam-error">加载失败：{error}</p> : null}
      {!loading && !error && dashboard ? (
        <>
          <div className="exam-dashboard-cards">
            <div className="exam-stat-card">
              <strong>{dashboard.totalQuestions}</strong>
              <span>已收录真题（{dashboard.years.map((entry) => entry.year).join('/')}）</span>
            </div>
            <div className="exam-stat-card">
              <strong>{dashboard.knowledgePointsTested}/{dashboard.knowledgePointsTotal}</strong>
              <span>考点覆盖（{dashboard.coveragePct != null ? `${dashboard.coveragePct}%` : '—'}）</span>
            </div>
            <div className="exam-stat-card">
              <strong>{uncovered?.total ?? '—'}</strong>
              <span>大纲漏网考点（从未在真题出现）</span>
            </div>
          </div>
          <div className="exam-frequency">
            <div className="exam-frequency-head">
              <strong>考频地图</strong>
              <select value={subject} onChange={(event) => setSubject(event.target.value)} aria-label="按科目筛选">
                {SUBJECTS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
              </select>
            </div>
            {frequency && frequency.rows.length > 0 ? (
              <table className="exam-frequency-table">
                <thead>
                  <tr><th>考点</th><th>考过年数</th><th>累计分值</th><th>最近考察</th></tr>
                </thead>
                <tbody>
                  {frequency.rows.slice(0, 50).map((row) => (
                    <tr key={row.knowledgeNodeId}>
                      <td>{row.name}</td>
                      <td>{row.yearsTested} 年</td>
                      <td>{row.totalScore} 分</td>
                      <td>{row.lastYear ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">暂无考察记录（考频数据随真题对标层逐年沉淀）。</p>}
            <p className="exam-levels">
              {Object.entries(frequency?.levels ?? {}).map(([level, count]) => `${LEVEL_LABEL[level] ?? level}：${count}`).join(' · ')}
            </p>
          </div>
          {uncovered && uncovered.nodes.length > 0 ? (
            <details className="exam-uncovered">
              <summary>大纲漏网清单（前 {uncovered.nodes.length} 项 / 共 {uncovered.total} 项）</summary>
              <ul>
                {uncovered.nodes.map((node) => (
                  <li key={node.knowledgeNodeId}>{node.name}<span className="muted">（{node.subject}）</span></li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
      <ExamEnhancedScreens />
    </section>
  );
}
