import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, RotateCcw, CheckCircle, Clock, AlertCircle, Target } from 'lucide-react';
import { buildKnowledgeEvidenceSummary } from '@kaoyan408/shared';
import { fetchWrongQuestionDetail, fetchWrongQuestionExamLinks, saveWrongQuestionNote, type WrongQuestionDetail as DetailType, type WrongQuestionDetailLayerItem, type WrongQuestionExamLinks } from '../api/endpoints/review';
import { requestTutorReply } from '../api/endpoints/tutor';
import type { TutorReply } from '../api';

interface Props {
  questionId: string;
  onRedo: (questionId: string) => void;
  onPracticeVariant?: (questionId: string, variantOfQuestionId: string) => void;
  onOpenCatalog?: (nodeId: string) => void;
  onClose: () => void;
}

export function WrongQuestionDetailView({ questionId, onRedo, onPracticeVariant, onOpenCatalog, onClose }: Props) {
  const [detail, setDetail] = useState<DetailType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteStatus, setNoteStatus] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [examLinks, setExamLinks] = useState<WrongQuestionExamLinks | null>(null);
  const [examLinksError, setExamLinksError] = useState('');
  const [aiDiagnosis, setAiDiagnosis] = useState<TutorReply | null>(null);
  const [aiDiagnosisError, setAiDiagnosisError] = useState('');
  const [aiDiagnosisLoading, setAiDiagnosisLoading] = useState(false);
  const scrolledIntoViewFor = useRef<string | null>(null);

  useEffect(() => {
    if (!detail || scrolledIntoViewFor.current === questionId) return;
    scrolledIntoViewFor.current = questionId;
    document.getElementById('wrong-question-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [detail, questionId]);

  useEffect(() => {
    setAiDiagnosis(null);
    setAiDiagnosisError('');
    fetchWrongQuestionDetail(questionId)
      .then((value) => {
        setDetail(value);
        setNote(value.note ?? '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'));
  }, [questionId]);

  useEffect(() => {
    let cancelled = false;
    setExamLinks(null);
    setExamLinksError('');
    fetchWrongQuestionExamLinks(questionId)
      .then((value) => {
        if (!cancelled) setExamLinks(value);
      })
      .catch((e) => {
        if (!cancelled) setExamLinksError(e instanceof Error ? e.message : '真题命中加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [questionId]);

  if (error) return <div className="panel"><p className="task-status">加载失败: {error}</p></div>;
  if (!detail) return <div className="panel"><p className="task-status">加载中...</p></div>;

  const rs = detail.reviewSchedule;
  const latestAttempt = detail.attemptHistory[0];
  const evidenceSummary = useMemo(() => buildKnowledgeEvidenceSummary({
    point: {
      id: detail.questionId,
      name: detail.knowledgePointTitle,
      importance: examLinks?.summary.maxImportance ?? 0,
      difficulty: examLinks?.summary.maxDifficulty ?? 0,
      evidence: examLinks?.frequency[0]
        ? {
            recent3Frequency: examLinks.frequency[0].recent3Frequency,
            recent5Frequency: examLinks.frequency[0].recent5Frequency,
            allTimeEvidence: examLinks.frequency[0].allTimeEvidence,
            primaryScore5y: examLinks.frequency[0].primaryScore5y,
            trendDirection: examLinks.frequency[0].trendDirection.toLowerCase() as 'rising' | 'stable' | 'falling' | 'cold',
            trendDelta: 0,
            evidenceConfidence: examLinks.frequency[0].evidenceConfidence.toLowerCase() as 'high' | 'medium' | 'low',
          }
        : null,
    },
    mastery: {
      status: detail.masteryStatus === '已掌握' ? 'mastered' : detail.masteryStatus === '复习中' ? 'review' : 'weak',
      mastery: detail.masteryCriteria ? Math.min(1, (detail.masteryCriteria.consecutiveCorrect + detail.masteryCriteria.variantCorrectCount) / 5) : 0,
      accuracy: detail.masteryCriteria ? Math.min(1, (detail.masteryCriteria.consecutiveCorrect + detail.masteryCriteria.variantCorrectCount) / 5) : 0,
      attempts: detail.attemptHistory.length,
      correctCount: detail.attemptHistory.filter((attempt) => attempt.correct).length,
      wrongCount: detail.attemptHistory.filter((attempt) => !attempt.correct).length,
      nextReviewAt: rs?.nextReviewAt ?? null,
    },
    examQuestions: examLinks?.examHits.map((hit) => ({
      year: hit.year,
      questionNo: hit.questionNo,
      questionType: hit.questionType,
      score: hit.score,
      summary: hit.summary,
    })) ?? (detail.reviewLayers.original ? [{
      year: Number(detail.attemptHistory[0]?.date.slice(0, 4) ?? new Date().getFullYear()),
      questionNo: 0,
      questionType: detail.reviewLayers.original.type ?? '题目',
      score: null,
      summary: detail.reviewLayers.original.stem,
    }] : []),
    relatedQuestionsCount: detail.similarQuestions.length,
    prerequisiteCount: detail.reviewLayers.confusingConcepts.length,
    relatedCount: detail.reviewLayers.variants.length + detail.reviewLayers.comprehensive.length,
  }), [detail, examLinks, rs]);

  async function handleSaveNote() {
    setNoteSaving(true);
    setNoteStatus('保存中...');
    try {
      await saveWrongQuestionNote(questionId, note);
      setDetail((current) => current ? { ...current, note } : current);
      setNoteStatus('已保存');
    } catch (saveError) {
      setNoteStatus(saveError instanceof Error ? saveError.message : '保存失败');
    } finally {
      setNoteSaving(false);
    }
  }

  async function handleAiDiagnosis() {
    setAiDiagnosisLoading(true);
    setAiDiagnosisError('');
    try {
      const reply = await requestTutorReply({
        questionId,
        selectedAnswer: latestAttempt?.selectedAnswer,
        prompt: 'AI错题诊断：请结合我的最近作答、错因、标准解析和知识证据，指出为什么错、该补哪个概念、下一步怎么复习。',
      });
      setAiDiagnosis(reply);
    } catch (diagnosisError) {
      setAiDiagnosisError(diagnosisError instanceof Error ? diagnosisError.message : 'AI错题诊断生成失败');
    } finally {
      setAiDiagnosisLoading(false);
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

      <div className="wrong-detail-summary-grid">
        <article>
          <strong>本题考点</strong>
          <p>{detail.knowledgePointTitle}</p>
        </article>
        <article>
          <strong>我的错因</strong>
          <p>{latestAttempt?.mistakeReason ?? detail.reviewSchedule?.inferredReason ?? '待诊断'}</p>
        </article>
        <article>
          <strong>我的掌握度</strong>
          <p>{detail.masteryStatus} · 连续正确 {detail.masteryCriteria?.consecutiveCorrect ?? 0} 次</p>
        </article>
        <article>
          <strong>下一步怎么学</strong>
          <p>{detail.recommendation}</p>
        </article>
      </div>

      {detail.analysis ? (
        <div className="detail-analysis">
          <strong><BookOpen size={14} /> 解析</strong>
          <p>{detail.analysis}</p>
        </div>
      ) : null}

      <div className="detail-analysis ai-diagnosis-panel">
        <div className="exam-link-head">
          <strong><Target size={14} /> AI错题诊断</strong>
          <p>基于本题解析、最近作答、错因和知识证据，生成一次面向提分的复盘建议。</p>
        </div>
        <button type="button" className="secondary-action" onClick={handleAiDiagnosis} disabled={aiDiagnosisLoading}>
          {aiDiagnosisLoading ? '生成中...' : '生成 AI 错题诊断'}
        </button>
        {aiDiagnosisError ? <p className="task-status">AI错题诊断失败：{aiDiagnosisError}</p> : null}
        {aiDiagnosis ? (
          <div className="timeline-list">
            <article>
              <div>
                <strong>{aiDiagnosis.answerCheck}</strong>
                <span>{aiDiagnosis.source}</span>
              </div>
            </article>
            {aiDiagnosis.explanationSteps.slice(0, 3).map((step) => (
              <article key={step}><div><strong>{step}</strong></div></article>
            ))}
            {aiDiagnosis.nextActions.slice(0, 3).map((action) => (
              <article key={action}><div><strong>下一步</strong><span>{action}</span></div></article>
            ))}
          </div>
        ) : null}
      </div>

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
          <button type="button" className="secondary-action" onClick={handleSaveNote} disabled={noteSaving}>
            {noteSaving ? '保存中...' : '保存笔记'}
          </button>
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

      {/* Wrong question -> knowledge point -> real exam linkage */}
      <div className="exam-link-panel">
        <div className="exam-link-head">
          <strong><Target size={14} /> 考点真题怎么考</strong>
          <p>这道错题关联的考点在历年 408 真题中的命中情况，帮你看清它的真实考法与权重。</p>
        </div>
        {examLinksError ? (
          <p className="task-status">真题命中加载失败：{examLinksError}</p>
        ) : !examLinks ? (
          <p className="task-status">正在加载真题命中...</p>
        ) : examLinks.summary.nodeCount === 0 ? (
          <p className="task-status">暂无真题命中记录</p>
        ) : (
          <>
            <div className="exam-link-summary">
              <span>近 3 年命中 <strong>{examLinks.summary.recent3Hits}</strong> 次</span>
              <span>近 5 年命中 <strong>{examLinks.summary.recent5Hits}</strong> 次</span>
              <span>真题累计 <strong>{examLinks.summary.totalScore}</strong> 分</span>
              <span>关联考点 <strong>{examLinks.summary.nodeCount}</strong> 个</span>
            </div>
            <div className="catalog-evidence-grid wrong-question-evidence-grid">
              {evidenceSummary.cards.map((card) => (
                <article key={card.title} className={`catalog-evidence-card catalog-evidence-tone-${card.tone}`}>
                  <strong>{card.title}</strong>
                  <p>{card.value}</p>
                  <small>{card.note}</small>
                </article>
              ))}
            </div>
            {examLinks.knowledgeNodes.length > 0 ? (
              <div className="exam-link-nodes">
                {examLinks.knowledgeNodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    className="exam-link-node"
                    onClick={() => onOpenCatalog?.(node.id)}
                    title="在知识图谱中查看该考点"
                  >
                    {node.name}（重要度 {node.importance} / 难度 {node.difficulty}）
                  </button>
                ))}
              </div>
            ) : null}
            {examLinks.examHits.length > 0 ? (
              <ul className="exam-hit-list">
                {examLinks.examHits.map((hit) => (
                  <li key={`${hit.id}-${hit.knowledgeNodeId}`} className="exam-hit-row">
                    <strong>
                      {hit.year} 年 第 {hit.questionNo} 题 · {hit.questionType}
                      {hit.score != null ? ` · ${hit.score} 分` : ''}
                    </strong>
                    {hit.knowledgeNodeName ? <span>{hit.knowledgeNodeName}</span> : null}
                    {hit.summary ? <p>{hit.summary}</p> : null}
                    {hit.sourceUrl ? (
                      <a href={hit.sourceUrl} target="_blank" rel="noreferrer">
                        查看真题来源
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="task-status">该考点暂无真题命中记录</p>
            )}
          </>
        )}
      </div>

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
          <button type="button" className="ghost-action" onClick={() => onRedo(questionId)}>重做原题</button>
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
          <button type="button" className="primary-action detail-primary-cta" onClick={() => onRedo(questionId)}>
            <RotateCcw size={14} /> 重做此题
          </button>
        </div>
      </div>
    </div>
  );
}
