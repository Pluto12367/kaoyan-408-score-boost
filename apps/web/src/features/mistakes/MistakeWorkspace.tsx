import { useEffect, useMemo, useState } from 'react';
import { filterWrongQuestions, type WrongQuestionFilter, type WrongQuestionMasteryStatus } from '@kaoyan408/shared';
import type { WrongQuestion, WrongQuestionSummary } from '../../api';
import { fetchWrongQuestions } from '../../api/endpoints/dashboard';
import { isMockAllowed } from '../../api/env';
import { WrongQuestionDetailView } from '../../components/WrongQuestionDetail';
import { ModuleInlineUnavailable, ModuleResourceMeta } from '../../components/ModuleResourceState';
import type { ModuleResource } from '../../hooks/moduleResource';
import type { RoleSection } from '../../layouts/RoleNavigation';
import { RecommendationEvidence } from '../student/RecommendationEvidence';
import { buildWrongBookNextLearningStep, NextLearningStepCard } from '../student/NextLearningStepCard';
import { buildWrongReviewPriority, rankWrongReviewItems } from './wrongReviewPriority';

interface MistakeWorkspaceProps {
  wrongQuestions: WrongQuestion[];
  initialKnowledgePointId?: string | null;
  summary: ModuleResource<WrongQuestionSummary>;
  status: string;
  detailQuestionId: string | null;
  onOpenDetail: (questionId: string) => void;
  onCloseDetail: () => void;
  onReview: (questionId: string) => void;
  onRedo: (questionId: string, knowledgePointTitle?: string) => void;
  onPracticeVariant?: (questionId: string, variantOfQuestionId: string) => void;
  onOpenCatalog?: (nodeId: string) => void;
  onNavigate: (section: RoleSection) => void;
  onRetrySummary: () => void;
}

const MASTERY_OPTIONS: Array<{ value: WrongQuestionMasteryStatus | ''; label: string }> = [
  { value: '', label: '全部掌握状态' },
  { value: '未掌握', label: '未掌握' },
  { value: '复习中', label: '复习中' },
  { value: '已掌握', label: '已掌握' },
];

const IMPORTANCE_OPTIONS = [
  { value: '', label: '全部重要程度' },
  { value: '4', label: '重要（≥4）' },
  { value: '3', label: '较重要（≥3）' },
];

const FALLBACK_REASONS = [
  '知识点没学过', '概念混淆', '公式记错', '计算错误',
  '审题错误', '推理过程错误', '时间不足', '蒙题',
];

function reviewReasonFor(item: WrongQuestion) {
  const reason = item.latestMistakeReason ?? '待诊断';
  return `为什么要复盘：这题暴露了「${reason}」，关联 ${item.knowledgePointTitle}，已错 ${item.wrongCount} 次。`;
}

export function MistakeWorkspace({ wrongQuestions, initialKnowledgePointId, summary, status, detailQuestionId, onOpenDetail, onCloseDetail, onReview, onRedo, onPracticeVariant, onOpenCatalog, onNavigate, onRetrySummary }: MistakeWorkspaceProps) {
  const summaryData = summary.data;
  const [subject, setSubject] = useState('');
  const [chapter, setChapter] = useState('');
  const [knowledgePointId, setKnowledgePointId] = useState('');
  useEffect(() => {
    if (initialKnowledgePointId !== undefined) {
      setKnowledgePointId(initialKnowledgePointId ?? '');
    }
  }, [initialKnowledgePointId]);
  const [masteryStatus, setMasteryStatus] = useState<WrongQuestionMasteryStatus | ''>('');
  const [mistakeReason, setMistakeReason] = useState('');
  const [minWrongCount, setMinWrongCount] = useState('');
  const [reviewedWithinDays, setReviewedWithinDays] = useState('');
  const [importance, setImportance] = useState('');

  const subjectOptions = useMemo(() => {
    const values = [...new Set(wrongQuestions.map((item) => item.subject).filter(Boolean))];
    return values.length ? values : ['计算机组成原理', '数据结构', '操作系统', '计算机网络'];
  }, [wrongQuestions]);
  const reasonOptions = useMemo(() => {
    const values = [...new Set(wrongQuestions.map((item) => item.latestMistakeReason).filter((value): value is string => Boolean(value)))];
    return values.length ? values : FALLBACK_REASONS;
  }, [wrongQuestions]);
  const chapterOptions = useMemo(() => [...new Set(wrongQuestions.map((item) => item.chapter).filter(Boolean))], [wrongQuestions]);
  const knowledgePointOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of wrongQuestions) {
      if (item.knowledgePointId && !seen.has(item.knowledgePointId)) {
        seen.set(item.knowledgePointId, item.knowledgePointTitle || item.knowledgePointId);
      }
    }
    return [...seen.entries()];
  }, [wrongQuestions]);

  const filters: WrongQuestionFilter = {
    subject: subject || undefined,
    chapter: chapter || undefined,
    knowledgePointId: knowledgePointId || undefined,
    mistakeReason: mistakeReason || undefined,
    minWrongCount: minWrongCount ? Number(minWrongCount) : undefined,
    masteryStatus: masteryStatus || undefined,
    reviewedWithinDays: reviewedWithinDays ? Number(reviewedWithinDays) : undefined,
    importance: importance ? Number(importance) : undefined,
  };
  const filterKey = JSON.stringify(filters);
  const clientFiltered = useMemo(
    () => filterWrongQuestions(wrongQuestions, filters),
    [wrongQuestions, filterKey],
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [serverQuestions, setServerQuestions] = useState<WrongQuestion[] | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError('');
    fetchWrongQuestions(filters)
      .then((items) => {
        if (!cancelled) setServerQuestions(items);
      })
      .catch((error) => {
        if (!cancelled) setListError(error instanceof Error ? error.message : '错题筛选加载失败，请重试。');
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filterKey, reloadKey]);
  const hasActiveFilter = Boolean(subject || chapter || knowledgePointId || masteryStatus || mistakeReason || minWrongCount || reviewedWithinDays || importance);
  const displayQuestions = listError && isMockAllowed()
    ? clientFiltered
    : (serverQuestions ?? wrongQuestions);
  const prioritizedQuestions = useMemo(() => rankWrongReviewItems(displayQuestions), [displayQuestions]);
  const selectedKnowledgePointTitle = knowledgePointId
    ? knowledgePointOptions.find(([value]) => value === knowledgePointId)?.[1] ?? knowledgePointId
    : null;
  const wrongBookNextLearningStep = buildWrongBookNextLearningStep({
    pendingCount: summaryData?.pendingCount ?? wrongQuestions.length,
    filteredKnowledgePointTitle: selectedKnowledgePointTitle,
  });
  const todayReviewTask = prioritizedQuestions[0] ?? null;
  const todayReviewPriority = todayReviewTask ? buildWrongReviewPriority(todayReviewTask) : null;
  const wrongReviewLoop = [
    { title: '先看错因', description: '先判断是知识点没学过、概念混淆、审题错误，还是时间问题。' },
    { title: '再做修复', description: '针对错因补一个最小动作：看解析、写笔记、重做原题。' },
    { title: '最后复测', description: '用同考点变式或下一次复习验证，避免只记住原题答案。' },
  ];

  function resetFilters() {
    setSubject('');
    setChapter('');
    setKnowledgePointId('');
    setMasteryStatus('');
    setMistakeReason('');
    setMinWrongCount('');
    setReviewedWithinDays('');
    setImportance('');
  }

  return (
    <section id="wrong-book" className="panel">
      <div className="panel-heading">
        <div><p className="eyebrow">错题本</p><h3>自动收集需要回炉的题目</h3></div>
        <span>{summaryData?.pendingCount ?? wrongQuestions.length} 道待复盘</span>
      </div>
      <p className="task-status">{status}</p>
      {summaryData ? <ModuleResourceMeta resource={summary} onRetry={onRetrySummary} /> : null}
      {summaryData ? <>
      <div className="wrong-summary-grid">
        <article><strong>{summaryData.pendingCount}</strong><span>待复盘</span></article>
        <article><strong>{summaryData.reviewedCount}</strong><span>已复盘</span></article>
        <article><strong>{summaryData.resolvedCount}</strong><span>重做解决</span></article>
        <article><strong>{summaryData.totalWrongCount}</strong><span>当前错题</span></article>
      </div>
      <div className="wrong-loop-panel">
        <article><strong>高频错因</strong><div className="mistake-stat-list">{summaryData.mistakeReasonStats.map((item) => <span key={item.reason}>{item.reason} · {item.count}</span>)}</div></article>
        <article>
          <strong>优先重做</strong>
          {summaryData.priorityRedoItems[0]
            ? <p>{summaryData.priorityRedoItems[0].knowledgePointTitle} · 错 {summaryData.priorityRedoItems[0].wrongCount} 次 · {summaryData.priorityRedoItems[0].nextAction}</p>
            : <p>当前没有待重做错题，可以进入限时训练。</p>}
        </article>
        <article><strong>闭环建议</strong><ul>{summaryData.nextReviewActions.map((action) => <li key={action}>{action}</li>)}</ul></article>
      </div>
      <RecommendationEvidence
        title="错题复盘依据"
        reason={summaryData.priorityRedoItems[0]
          ? `优先处理 ${summaryData.priorityRedoItems[0].knowledgePointTitle || '当前高风险错题'}`
          : summaryData.pendingCount > 0
            ? `还有 ${summaryData.pendingCount} 道错题待复盘`
            : '当前错题压力较低，可以进入专项训练巩固。'}
        evidence={`待复盘 ${summaryData.pendingCount} 道，已复盘 ${summaryData.reviewedCount} 道，重做解决 ${summaryData.resolvedCount} 道`}
        impact="复盘和重做会减少待处理错题，并影响薄弱点、今日任务和后续训练推荐。"
        confidence={summaryData.totalWrongCount >= 5 ? 'high' : summaryData.totalWrongCount > 0 ? 'medium' : 'low'}
        nextDataHint="持续标记错因并完成重做，错题推荐会更贴近真实薄弱点。"
      />
      <NextLearningStepCard step={wrongBookNextLearningStep} onNavigate={onNavigate} />
      </> : <ModuleInlineUnavailable title="错题摘要" resource={summary} onRetry={onRetrySummary} />}
      <div className="wrong-review-loop-card">
        <div className="wrong-review-loop-head">
          <strong>复盘闭环</strong>
          <span>错题不是再看一遍，而是把错误变成下一次会做的动作。</span>
        </div>
        <div className="wrong-review-loop-steps">
          {wrongReviewLoop.map((step) => (
            <article key={step.title}>
              <strong>{step.title}</strong>
              <span>{step.description}</span>
            </article>
          ))}
        </div>
      </div>
      {todayReviewTask && todayReviewPriority ? (
        <div className="wrong-today-task-panel" role="status" aria-label="今日最该复盘">
          <div className="wrong-today-task-head">
            <strong>今日最该复盘：{todayReviewTask.knowledgePointTitle}</strong>
            <span>{todayReviewPriority.priority} 优先级</span>
          </div>
          <p>{todayReviewPriority.reason}</p>
          <div className="wrong-today-task-actions">
            <button type="button" className="primary-action" onClick={() => onReview(todayReviewTask.questionId)}>先复盘这题</button>
            <button type="button" className="secondary-action" onClick={() => onRedo(todayReviewTask.questionId, todayReviewTask.knowledgePointTitle)}>重做这题</button>
            <button type="button" className="secondary-action" onClick={() => onOpenDetail(todayReviewTask.questionId)}>看详情与笔记</button>
          </div>
          <p className="wrong-today-task-hint">{todayReviewPriority.suggestedAction}</p>
        </div>
      ) : null}
      <div className="wrong-filter-bar" role="group" aria-label="错题筛选">
        <label>
          <span>科目</span>
          <select value={subject} onChange={(event) => setSubject(event.target.value)}>
            <option value="">全部</option>
            {subjectOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span>章节</span>
          <select value={chapter} onChange={(event) => setChapter(event.target.value)}>
            <option value="">全部</option>
            {chapterOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span>知识点</span>
          <select value={knowledgePointId} onChange={(event) => setKnowledgePointId(event.target.value)}>
            <option value="">全部</option>
            {knowledgePointOptions.map(([value, title]) => <option key={value} value={value}>{title}</option>)}
          </select>
        </label>
        <label>
          <span>掌握状态</span>
          <select value={masteryStatus} onChange={(event) => setMasteryStatus(event.target.value as WrongQuestionMasteryStatus | '')}>
            {MASTERY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>最近复习</span>
          <select value={reviewedWithinDays} onChange={(event) => setReviewedWithinDays(event.target.value)}>
            <option value="">全部</option>
            <option value="7">近 7 天</option>
            <option value="30">近 30 天</option>
          </select>
        </label>
        <label>
          <span>错因</span>
          <select value={mistakeReason} onChange={(event) => setMistakeReason(event.target.value)}>
            <option value="">全部</option>
            {reasonOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span>错误次数</span>
          <select value={minWrongCount} onChange={(event) => setMinWrongCount(event.target.value)}>
            <option value="">全部</option>
            <option value="2">≥ 2 次</option>
            <option value="3">≥ 3 次</option>
          </select>
        </label>
        <label>
          <span>重要程度</span>
          <select value={importance} onChange={(event) => setImportance(event.target.value)}>
            {IMPORTANCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        {hasActiveFilter ? <button type="button" className="secondary-action" onClick={resetFilters}>清除筛选</button> : null}
      </div>
      <div className="wrong-list">
        {listLoading ? (
          <p className="task-status">正在加载筛选结果...</p>
        ) : listError ? (
          <div className="module-error">
            <span>{listError}</span>
            <button type="button" className="secondary-action" onClick={() => setReloadKey((current) => current + 1)}>重新加载</button>
          </div>
        ) : displayQuestions.length === 0 ? (
          <p className="task-status">
            {hasActiveFilter
              ? '没有符合当前筛选条件的错题。'
              : wrongQuestions.length === 0
              ? (summaryData?.resolvedCount ?? 0) > 0
                ? `当前没有待处理错题，历史已通过重做解决 ${summaryData?.resolvedCount ?? 0} 道。`
                : '错题本还是空的，答错的题目会自动出现在这里。'
              : '当前没有待处理错题。'}
          </p>
        ) : displayQuestions.map((item) => (
          <article key={item.questionId} className="wrong-row">
            <div>
              <div className="wrong-row-head">
                <strong>{item.knowledgePointTitle}</strong>
                <span className={`mastery-badge mastery-${item.masteryStatus}`}>{item.masteryStatus}</span>
              </div>
              <p>{item.subject} / {item.chapter} / 错 {item.wrongCount} 次 / {item.latestMistakeReason ?? '待诊断'}{item.importance ? ` / 重要度 ${item.importance}` : ''}</p>
              <small>{item.reviewStatus === 'reviewed' ? '已复盘' : '待复盘'}{item.reviewedAt ? ` · ${item.reviewedAt.slice(0, 10)}` : ''}{item.masteryCriteria ? ` · 连续正确 ${item.masteryCriteria.consecutiveCorrect} 次 · 变式答对 ${item.masteryCriteria.variantCorrectCount}/3 次` : ''}</small>
              <p className="wrong-row-reason">{reviewReasonFor(item)}</p>
              <span>{item.stem}</span>
            </div>
            <button type="button" onClick={() => onOpenDetail(item.questionId)}>详情与笔记</button>
            <button type="button" disabled={item.reviewStatus === 'reviewed'} onClick={() => onReview(item.questionId)}>{item.reviewStatus === 'reviewed' ? '已复盘' : '标记复盘'}</button>
            <button type="button" onClick={() => onRedo(item.questionId, item.knowledgePointTitle)}>重做</button>
            <div className="wrong-row-next-actions" aria-label="复盘后下一步">
              <span>复盘后下一步</span>
              <button type="button" disabled={item.reviewStatus === 'reviewed'} onClick={() => onReview(item.questionId)}>继续复盘</button>
              <button type="button" onClick={() => onOpenDetail(item.questionId)}>做同考点变式</button>
              <button type="button" onClick={() => onNavigate('dashboard')}>回到首页</button>
            </div>
          </article>
        ))}
      </div>
      {detailQuestionId ? <WrongQuestionDetailView questionId={detailQuestionId} onClose={onCloseDetail} onRedo={(questionId) => onRedo(questionId)} onPracticeVariant={onPracticeVariant} onOpenCatalog={onOpenCatalog} /> : null}
    </section>
  );
}
//错题复盘