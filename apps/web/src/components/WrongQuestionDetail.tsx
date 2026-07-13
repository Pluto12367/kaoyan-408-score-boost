import { useState, useEffect } from 'react';
import { BookOpen, RotateCcw, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { fetchWrongQuestionDetail, saveWrongQuestionNote, type WrongQuestionDetail as DetailType } from '../api/endpoints/review';

interface Props {
  questionId: string;
  onRedo: (questionId: string) => void;
  onClose: () => void;
}

export function WrongQuestionDetailView({ questionId, onRedo, onClose }: Props) {
  const [detail, setDetail] = useState<DetailType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteStatus, setNoteStatus] = useState('');

  useEffect(() => {
    fetchWrongQuestionDetail(questionId)
      .then((value) => {
        setDetail(value);
        setNote(value.note ?? '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'));
  }, [questionId]);

  if (error) return <div className="panel"><p className="task-status">加载失败: {error}</p></div>;
  if (!detail) return <div className="panel"><p className="task-status">加载中...</p></div>;

  const rs = detail.reviewSchedule;

  async function handleSaveNote() {
    setNoteStatus('保存中...');
    try {
      await saveWrongQuestionNote(questionId, note);
      setDetail((current) => current ? { ...current, note } : current);
      setNoteStatus('已保存');
    } catch (saveError) {
      setNoteStatus(saveError instanceof Error ? saveError.message : '保存失败');
    }
  }

  return (
    <div id="wrong-question-detail" className="wrong-detail-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{detail.subject} · {detail.chapter}</p>
          <h3>{detail.knowledgePointTitle}</h3>
        </div>
        <button type="button" className="secondary-action" onClick={onClose}>关闭</button>
      </div>

      <div className="detail-stem">
        <strong>题目</strong>
        <p>{detail.stem}</p>
        {detail.answer ? <span className="answer-badge">答案: {detail.answer}</span> : null}
      </div>

      {detail.analysis ? (
        <div className="detail-analysis">
          <strong><BookOpen size={14} /> 解析</strong>
          <p>{detail.analysis}</p>
        </div>
      ) : null}

      <div className="detail-note">
        <strong><BookOpen size={14} /> 我的错题笔记</strong>
        <textarea
          value={note}
          maxLength={2000}
          placeholder="记录易混条件、关键公式或下次重做时要注意的步骤"
          onChange={(event) => {
            setNote(event.target.value);
            setNoteStatus('');
          }}
        />
        <div className="note-actions">
          <span>{note.length}/2000 {noteStatus}</span>
          <button type="button" className="secondary-action" onClick={handleSaveNote}>保存笔记</button>
        </div>
      </div>

      {/* Review schedule status */}
      {rs ? (
        <div className={`review-status status-${rs.stability}`}>
          <div className="status-header">
            {rs.stability === 'mastered' ? <CheckCircle size={18} /> : <RotateCcw size={18} />}
            <strong>
              {rs.stability === 'mastered' ? '已稳定掌握' : rs.stability === 'review' ? '巩固中' : '学习中'}
            </strong>
          </div>
          <div className="status-grid">
            {rs.inferredReason ? <span>系统综合判断 <strong>{rs.inferredReason}</strong></span> : null}
            <span>连续正确 <strong>{rs.consecutiveCorrect}</strong> 次</span>
            <span>已复习 <strong>{rs.reviewCount}</strong> 次</span>
            <span>下次复习 <strong>{rs.nextReviewAt.slice(0, 10)}</strong></span>
            <span>自评原因 <strong>{rs.selfReportedReason}</strong></span>
          </div>
        </div>
      ) : null}

      {/* Attempt history */}
      <div className="attempt-history">
        <strong><Clock size={14} /> 答题记录</strong>
        {detail.attemptHistory.map((a, i) => (
          <div key={i} className={`attempt-row ${a.correct ? 'correct' : 'wrong'}`}>
            <span>{a.date}</span>
            <span>{a.selectedAnswer ?? '未答'} → {a.correct ? '✓' : '✗'}</span>
            <span>{a.mistakeReason ?? '待归因'}</span>
            <span>{a.timeSpentSec}秒</span>
          </div>
        ))}
      </div>

      {detail.reviewHistory.length > 0 ? (
        <div className="attempt-history">
          <strong><RotateCcw size={14} /> 复习轨迹</strong>
          {detail.reviewHistory.map((item, index) => (
            <div key={`${item.reviewedAt}-${index}`} className={`attempt-row ${item.redoCorrect ? 'correct' : 'wrong'}`}>
              <span>{item.reviewedAt.slice(0, 10)}</span>
              <span>{item.redoCorrect ? '重做正确' : '仍需巩固'}</span>
              <span>{item.inferredReason ?? item.reportedReason ?? '待归因'}</span>
              <span>{item.nextIntervalDays} 天后复习</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Similar questions */}
      {detail.similarQuestions.length > 0 ? (
        <div className="similar-questions">
          <strong>相似题目</strong>
          {detail.similarQuestions.map((q) => (
            <div key={q.id} className="similar-row">
              <span>{q.source} · {q.difficulty}</span>
              <p>{q.stem}</p>
            </div>
          ))}
        </div>
      ) : null}

      {/* Recommendation & actions */}
      <div className="detail-actions">
        <p className="task-status"><AlertCircle size={14} /> {detail.recommendation}</p>
        <div>
          <button type="button" className="primary-action" onClick={() => onRedo(questionId)}>
            <RotateCcw size={14} /> 重做此题
          </button>
        </div>
      </div>
    </div>
  );
}
