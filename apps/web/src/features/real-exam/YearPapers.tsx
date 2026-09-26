import { useEffect, useState } from 'react';
import {
  fetchRealExamDashboard,
  type RealExamDashboard,
} from '../../api/endpoints/realExam';

const ALL_YEARS = Array.from({ length: 18 }, (_, index) => 2026 - index);

export interface StartYearPaperResult {
  ok: boolean;
  error?: string;
}

/**
 * V14-R4-B 真题套卷 — 年份卡片列表（2009-2026 全景，未收录年份显式标注）。
 * 一键组卷走既有整卷链路（D-R4-3），由 App 层回调完成并跳转作答；
 * 演示模式无真题内容 → 显式报错，绝不伪造试卷。
 */
export function YearPapers({ onStartYearPaper }: { onStartYearPaper: (year: number) => Promise<StartYearPaperResult> }) {
  const [dashboard, setDashboard] = useState<RealExamDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingYear, setPendingYear] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchRealExamDashboard()
      .then((data) => {
        if (!cancelled) {
          setDashboard(data);
          setLoading(false);
        }
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

  const indexedYears = new Set(dashboard?.years.map((entry) => entry.year) ?? []);

  async function handleStart(year: number) {
    setPendingYear(year);
    setActionError(null);
    const result = await onStartYearPaper(year);
    setPendingYear(null);
    if (!result.ok) setActionError(result.error ?? '组卷失败，请稍后重试。');
  }

  return (
    <section className="year-papers" aria-label="真题套卷">
      {loading ? <p className="muted">加载中…</p> : null}
      {error ? <p className="real-exam-error">加载失败：{error}</p> : null}
      {actionError ? <p className="real-exam-error">{actionError}</p> : null}
      {!loading && !error && dashboard ? (
        <>
          <p className="muted">按年一键组卷（40 选择 + 7 综合，卷面 150 分结构），作答与报告走既有整卷链路。</p>
          <div className="year-paper-grid">
            {ALL_YEARS.map((year) => {
              const indexed = indexedYears.has(year);
              return (
                <div key={year} className={indexed ? 'year-paper-card' : 'year-paper-card unavailable'}>
                  <strong>{year}</strong>
                  <span>{indexed ? `${dashboard.years.find((entry) => entry.year === year)?.count ?? 0} 题` : '未收录'}</span>
                  {indexed ? (
                    <button
                      type="button"
                      className="primary-action"
                      disabled={pendingYear != null}
                      onClick={() => handleStart(year)}
                    >
                      {pendingYear === year ? '组卷中…' : '开始考试 →'}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}
