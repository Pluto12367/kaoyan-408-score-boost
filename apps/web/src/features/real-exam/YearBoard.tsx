import { useEffect, useState } from 'react';
import {
  fetchRealExamBoard,
  type RealExamBoard,
} from '../../api/endpoints/realExam';
import { hasRenderableBoard, SLOT_TONE_LABEL, slotTone, subjectBadge } from './realExamView';

const YEARS = [2026, 2025, 2024, 2023, 2022];

/**
 * V14-R4-A 作战板 — 按年 47 格真题网格，按学生真实作答状态着色。
 * 数据自取（self-scope 只读投影），失败显式展示，绝不回退演示数据。
 */
export function YearBoard() {
  const [year, setYear] = useState(YEARS[0]);
  const [board, setBoard] = useState<RealExamBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchRealExamBoard(year)
      .then((data) => {
        if (!cancelled) {
          setBoard(data);
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
  }, [year]);

  return (
    <section className="real-exam-board" aria-label="真题作战板">
      <div className="real-exam-years" role="tablist" aria-label="选择年份">
        {YEARS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={candidate === year ? 'real-exam-year active' : 'real-exam-year'}
            onClick={() => setYear(candidate)}
          >
            {candidate}
          </button>
        ))}
      </div>
      {loading ? <p className="muted">加载中…</p> : null}
      {error ? <p className="real-exam-error">加载失败：{error}</p> : null}
      {!loading && !error && board ? (
        hasRenderableBoard(board) ? (
          <>
            <p className="real-exam-summary">
              {board.year} 年：{board.summary.answeredCount}/{board.summary.total} 题已做
              （全对 {board.summary.correctCount} · 答错 {board.summary.wrongCount}）· 卷面 {board.summary.totalScore} 分
            </p>
            <ol className="real-exam-grid">
              {board.slots.map((slot) => {
                const tone = slotTone(slot);
                return (
                  <li key={slot.examNo} className={`real-exam-slot tone-${tone}`}>
                    <span className="slot-subject">{subjectBadge(slot.subject) || '—'}</span>
                    <span className="slot-exam-no">{slot.examNo}</span>
                    <span className="slot-score">{slot.maxScore != null ? `${slot.maxScore}分` : '未定价'}</span>
                    <span className="slot-status">{SLOT_TONE_LABEL[tone]}</span>
                  </li>
                );
              })}
            </ol>
            <div className="real-exam-kps">
              <div>
                <strong>首考考点（收录年份内首现）</strong>
                {board.novelKps.length ? (
                  <ul>{board.novelKps.map((kp) => <li key={kp.knowledgeNodeId}>{kp.name}</li>)}</ul>
                ) : <p className="muted">暂无</p>}
              </div>
              <div>
                <strong>回归考点（沉寂 ≥2 年后重现）</strong>
                {board.returningKps.length ? (
                  <ul>{board.returningKps.map((kp) => <li key={kp.knowledgeNodeId}>{kp.name}（上次 {kp.lastYear}）</li>)}</ul>
                ) : <p className="muted">暂无</p>}
              </div>
            </div>
          </>
        ) : (
          <p className="muted">{board.year} 年真题尚未收录，收录后此处自动点亮。</p>
        )
      ) : null}
    </section>
  );
}
