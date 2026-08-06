import { useState, useEffect } from 'react';
import { BookOpen, RotateCcw, CheckCircle, Clock, AlertCircle, Target } from 'lucide-react';
import { fetchWrongQuestionDetail, saveWrongQuestionNote, type WrongQuestionDetail as DetailType, type WrongQuestionDetailLayerItem } from '../api/endpoints/review';

interface Props {
  questionId: string;
  onRedo: (questionId: string) => void;
  onPracticeVariant?: (questionId: string, variantOfQuestionId: string) => void;
  onClose: () => void;
}

export function WrongQuestionDetailView({ questionId, onRedo, onPracticeVariant, onClose }: Props) {
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

  function renderLayer(title: string, description: string, items: WrongQuestionDetailLayerItem[]) {
    if (items.length === 0) return null;
    return (
      <div className="review-layer">
        <div className="review-layer-head">
          <span className="layer-tag">{title}</span>
          <p>{description}</p>
        </div>
        {items.map((q) => (
          <div key={q.questionId} className="review-layer-row">
            <div>
              <strong>{q.knowledgePointTitle ?? q.difficulty}</strong>
              <p>{q.stem}</p>
            </div>
            <button type="button" className="secondary-action" onClick={() => onPracticeVariant?.(q.questionId, questionId)}>练习</button>
          </div>
        ))}
      </div>
    );
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
            {detail.masteryCriteria ? <span>变式答对 <strong>{detail.masteryCriteria.variantCorrectCount}</strong> 次</span> : null}
            <span>已复习 <strong>{rs.reviewCount}</strong> 次</span>
            <span>下次复习 <strong>{rs.nextReviewAt.slice(0, 10)}</strong></span>
            <span>自评原因 <strong>{rs.selfReportedReason}</strong></span>
          </div>
          {detail.masteryStatus ? (
            <p className="task-status">系统判定：{detail.masteryStatus}（依据：连续正确 {detail.masteryCriteria?.consecutiveCorrect ?? 0} 次 + 变式答对 {detail.masteryCriteria?.variantCorrectCount ?? 0} 次）</p>
          ) : null}
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

      {/* Four-layer review path */}
      <div className="review-layers">
        <div className="review-layers-head">
          <strong><Target size={14} /> 复测路径</strong>
          <p>按顺序完成：原题 → 变式 → 易混辨析 → 综合应用，连续答对可升级掌握状态。</p>
        </div>
        <div className="review-layer">
          <div className="review-layer-head">
            <span className="layer-tag">原题回顾</span>
            <p>先回顾原题与解析，确认是否已理解核心考点。</p>
          </div>
          <button type="button" className="secondary-action" onClick={() => onRedo(questionId)}>重做原题</button>
        </div>
        {renderLayer('变式题', '同考点变式，连续答对可推动掌握状态升级。', detail.reviewLayers.variants)}
        {renderLayer('易混辨析', '同章节易混知识点辨析，帮助区分易错条件。', detail.reviewLayers.confusingConcepts)}
        {renderLayer('综合应用', '综合应用题，检验跨考点综合运用能力。', detail.reviewLayers.comprehensive)}
      </div>

      {/* Similar questions (legacy read-only list) */}
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