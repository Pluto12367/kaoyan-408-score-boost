import { useState, useEffect } from 'react';
import { Target, Clock, AlertTriangle, TrendingUp, BookOpen } from 'lucide-react';
import { fetchExamReport, generatePostExamReviewTasks, fetchScoreHistory, type ExamReport as ReportType, type PostExamReviewTasks, type ScoreHistory } from '../api/endpoints/exam';

interface Props {
  sessionId: string;
  onClose: () => void;
}

export function ExamReportView({ sessionId, onClose }: Props) {
  const [report, setReport] = useState<ReportType | null>(null);
  const [reviewTasks, setReviewTasks] = useState<PostExamReviewTasks | null>(null);
  const [scoreHistory, setScoreHistory] = useState<ScoreHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchExamReport(sessionId),
      generatePostExamReviewTasks(sessionId),
      fetchScoreHistory(),
    ]).then(([r, t, h]) => {
      setReport(r);
      setReviewTasks(t);
      setScoreHistory(h);
    }).catch((e) => setError(e instanceof Error ? e.message : '加载失败'));
  }, [sessionId]);

  if (error) return <div className="panel"><p className="task-status">加载失败: {error}</p></div>;
  if (!report) return <div className="panel"><p className="task-status">加载考试报告...</p></div>;

  const { summary } = report;

  return (
    <div className="exam-report">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">考试报告</p>
          <h3>408 模拟考试 · {new Date(report.generatedAt).toLocaleDateString('zh-CN')}</h3>
        </div>
        <button type="button" className="secondary-action" onClick={onClose}>返回</button>
      </div>

      {/* Score summary */}
      <div className="report-score-hero">
        <div className="score-circle">
          <strong>{summary.accuracyRate}</strong>
          <span>正确率 %</span>
        </div>
        <div className="score-details">
          <div><Target size={16} /> 答对 {summary.correctCount}/{summary.totalQuestions} 题</div>
          <div><Clock size={16} /> 用时 {Math.round(summary.totalTimeSec / 60)} 分钟{summary.overtime ? ' (超时)' : ''}</div>
          <div><AlertTriangle size={16} /> 未答 {summary.unansweredCount} 题</div>
        </div>
        {scoreHistory ? (
          <div className="score-trend">
            <TrendingUp size={16} />
            <span>{scoreHistory.trendLabel}</span>
            <span>共 {scoreHistory.totalExams} 次考试</span>
          </div>
        ) : null}
      </div>

      {/* Subject breakdown */}
      <div className="report-section">
        <h4><BookOpen size={16} /> 分科表现</h4>
        <div className="subject-grid">
          {report.subjectBreakdown.map((s) => (
            <div key={s.subject} className="subject-card">
              <strong>{s.subject}</strong>
              <div className="subject-bar">
                <div className="subject-fill" style={{ width: `${s.accuracyRate}%` }} />
              </div>
              <span>{s.correctCount}/{s.totalQuestions} · {s.accuracyRate}% · 均{s.avgTimeSec}秒</span>
            </div>
          ))}
        </div>
      </div>

      {/* Knowledge point losses */}
      {report.knowledgePointLosses.length > 0 ? (
        <div className="report-section">
          <h4><AlertTriangle size={16} /> 知识点失分</h4>
          <div className="loss-list">
            {report.knowledgePointLosses.map((p) => (
              <div key={p.title} className="loss-row">
                <div>
                  <strong>{p.title}</strong>
                  <span>{p.subject}</span>
                </div>
                <span className="loss-count">-{p.wrongCount}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Unanswered */}
      {report.unansweredQuestions.length > 0 ? (
        <div className="report-section">
          <h4>未答题 ({report.unansweredQuestions.length})</h4>
          <div className="unanswered-list">
            {report.unansweredQuestions.map((q) => (
              <div key={q.questionId}><span>{q.stem.slice(0, 50)}...</span></div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Post-exam review tasks */}
      {reviewTasks ? (
        <div className="report-section">
          <h4><Target size={16} /> 考后 3 天复习计划</h4>
          <p className="task-status">{reviewTasks.recommendation}</p>
          <div className="review-days">
            {reviewTasks.days.map((day) => (
              <article key={day.dayIndex} className="review-day-card">
                <div>
                  <strong>第 {day.dayIndex} 天 · {day.date}</strong>
                  <span>{day.subject} · {day.focus}</span>
                </div>
                <div className="day-meta">
                  <span>{day.questionCount} 题</span>
                  <span>{day.minutes} 分钟</span>
                </div>
                <ul>
                  {day.tasks.map((task) => <li key={task}>{task}</li>)}
                </ul>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {/* Score history */}
      {scoreHistory && scoreHistory.history.length > 0 ? (
        <div className="report-section">
          <h4>历史成绩趋势</h4>
          <div className="history-strip">
            {scoreHistory.history.map((h) => (
              <div key={h.sessionId} className="history-bar-wrapper">
                <div className="history-bar" style={{ height: `${h.accuracyRate}%` }} title={`${h.date}: ${h.accuracyRate}%`} />
                <span>{h.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
