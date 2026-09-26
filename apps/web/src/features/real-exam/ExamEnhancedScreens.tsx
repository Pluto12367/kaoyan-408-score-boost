import { useEffect, useState } from 'react';
import {
  fetchRealExamChapters,
  fetchRealExamHardQuestions,
  fetchRealExamTrajectory,
  type RealExamChapterMap,
  type RealExamHardQuestions,
  type RealExamTrajectory,
} from '../../api/endpoints/realExam';

/**
 * V14-R4-C 增强屏 — 章节命题图谱 / 命题轨迹 / 难题榜。
 * 全部只读投影：失败显式展示；空数据给显式原因（诚实缺席，绝不伪造条目）。
 */
export function ExamEnhancedScreens() {
  const [chapters, setChapters] = useState<RealExamChapterMap | null>(null);
  const [trajectory, setTrajectory] = useState<RealExamTrajectory | null>(null);
  const [hard, setHard] = useState<RealExamHardQuestions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchRealExamChapters(), fetchRealExamTrajectory(), fetchRealExamHardQuestions()])
      .then(([chapterData, trajectoryData, hardData]) => {
        if (cancelled) return;
        setChapters(chapterData);
        setTrajectory(trajectoryData);
        setHard(hardData);
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
  }, []);

  return (
    <section className="exam-enhanced-screens" aria-label="真题增强数据屏">
      {loading ? <p className="muted">加载中…</p> : null}
      {error ? <p className="real-exam-error">加载失败：{error}</p> : null}

      {!loading && !error && chapters ? (
        <div className="exam-panel">
          <strong>章节命题图谱</strong>
          {chapters.chapters.length > 0 ? (
            <table className="exam-frequency-table">
              <thead>
                <tr>
                  <th>章节</th>
                  {chapters.yearAxis.map((year) => <th key={year}>{year}</th>)}
                  <th>合计</th>
                </tr>
              </thead>
              <tbody>
                {chapters.chapters.map((chapter) => {
                  const total = chapters.yearAxis.reduce((sum, year) => sum + (chapter.years[year] ?? 0), 0);
                  return (
                    <tr key={chapter.chapter}>
                      <td>{chapter.chapter}<span className="muted">（{chapter.subject}）</span></td>
                      {chapters.yearAxis.map((year) => (
                        <td key={year}>{chapter.years[year] > 0 ? `${chapter.years[year]}` : <span className="muted">—</span>}</td>
                      ))}
                      <td><strong>{total}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <p className="muted">暂无章节聚合数据（随真题对标层沉淀）。</p>}
          <p className="exam-levels">单位为当年真题分值（PRIMARY 标签口径，不重复计入次标签）。</p>
        </div>
      ) : null}

      {!loading && !error && trajectory ? (
        <div className="exam-panel">
          <strong>命题轨迹（曾高频 · 近 3 年沉默）</strong>
          {trajectory.rows.length > 0 ? (
            <ul className="exam-trajectory-list">
              {trajectory.rows.map((row) => (
                <li key={row.knowledgeNodeId}>
                  <span>{row.name}</span>
                  <span className="muted">考过 {row.yearsTested} 年 · 累计 {row.totalScore} 分 · 最近 {row.lastYear}（{trajectory.currentYear - row.lastYear} 年未考）</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              {trajectory.currentYear} 年尚无可判定的沉默考点（需至少 3 年考察史 + 近 3 年未考）——随真题年份累积自动点亮。
            </p>
          )}
        </div>
      ) : null}

      {!loading && !error && hard ? (
        <div className="exam-panel">
          <strong>难题榜（全站实测错误率 TOP）</strong>
          {hard.rows.length > 0 ? (
            <table className="exam-frequency-table">
              <thead>
                <tr><th>题目</th><th>科目</th><th>作答</th><th>错误率</th></tr>
              </thead>
              <tbody>
                {hard.rows.map((row) => (
                  <tr key={row.questionId}>
                    <td>
                      {row.year != null && row.examNo != null ? <span className="muted">{row.year}·第 {row.examNo} 题 </span> : null}
                      {row.stemPreview}
                    </td>
                    <td>{row.subject ?? '—'}</td>
                    <td>{row.wrong}/{row.attempts}</td>
                    <td><strong>{row.wrongRatePct}%</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">样本不足：仅统计作答 ≥{hard.minAttempts} 次的题目（避免用一两次作答定难度）。</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
