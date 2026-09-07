import { buildCoverageSummary } from './examAlignmentView';
import { formatStars } from './examAlignmentView';
import type { PracticeSetExamAlignment } from '../../../api/types';
import './exam-aligned.css';

/**
 * LE-V10 F1 / M4 — post-training real-exam coverage report. Rendered only
 * when the alignment projection exists; honest absence otherwise.
 */
export function ExamCoverageSummary({ alignment }: { alignment: PracticeSetExamAlignment }) {
  const view = buildCoverageSummary(alignment);
  if (!view) return null;
  return (
    <div className="exam-coverage-summary" role="status" aria-label="本次真题覆盖报告">
      <p className="exam-coverage-title">本次真题覆盖报告</p>
      <p>{view.coverageLine} · {view.yearsLine}</p>
      <p>{view.highFrequencyLine}</p>
      {view.nodeRows.length > 0 ? (
        <ul>
          {view.nodeRows.map((row) => (
            <li key={row.name}>
              <span>{row.name}</span>
              <span>
                {row.stars > 0 ? `★${formatStars(row.stars)}` : ''}
                {row.recent5Frequency != null ? ` 近5年 ${row.recent5Frequency} 次` : ' 暂无真题数据'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
