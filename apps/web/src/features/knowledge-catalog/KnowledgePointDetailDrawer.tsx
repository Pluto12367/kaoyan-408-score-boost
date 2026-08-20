import { useEffect, useRef } from 'react';
import { buildKnowledgeEvidenceSummary } from '@kaoyan408/shared';
import type { CatalogFirstScreenActionType, CatalogPointContext } from '@kaoyan408/shared';
import { OverlayDialog } from '../../components/OverlayDialog';
import type { KnowledgeDetail, NodeMasterySummary, NodeQuestStatus } from '../../api/endpoints/score-center';
import { ALL_TIME_EVIDENCE_LABEL, MASTERY_STATUS_LABELS, NO_FREQUENCY_LABEL, QUEST_STATUS_LABELS, TREND_LABELS } from './constants';

interface KnowledgePointDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  context: CatalogPointContext | null;
  focusIntent?: CatalogFirstScreenActionType | null;
  prerequisiteContexts: CatalogPointContext[];
  relatedContexts: CatalogPointContext[];
  mastery?: NodeMasterySummary | null;
  relatedQuestions?: KnowledgeDetail['relatedQuestions'];
  examQuestions?: KnowledgeDetail['examQuestions'];
  detailError?: string;
  questStatus?: NodeQuestStatus;
  questAttempts?: number;
  questBestAccuracy?: number;
  questContext?: boolean;
  questError?: string;
  onPracticeQuestion?: (questionId: string, title: string) => void;
  onStartQuest?: () => void;
  onCompleteQuest?: () => void;
  onNavigate?: () => void;
}

export function KnowledgePointDetailDrawer({
  open,
  onClose,
  context,
  focusIntent,
  prerequisiteContexts,
  relatedContexts,
  mastery,
  relatedQuestions,
  examQuestions,
  detailError,
  questStatus,
  questAttempts,
  questBestAccuracy,
  questContext,
  questError,
  onPracticeQuestion,
  onStartQuest,
  onCompleteQuest,
  onNavigate,
}: KnowledgePointDetailDrawerProps) {
  const evidenceSectionRef = useRef<HTMLElement | null>(null);
  const masterySectionRef = useRef<HTMLElement | null>(null);
  const questSectionRef = useRef<HTMLElement | null>(null);
  const examSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || !context || !focusIntent) return;
    const target =
      focusIntent === 'inspect'
        ? evidenceSectionRef.current
        : focusIntent === 'exam'
          ? examSectionRef.current
          : focusIntent === 'quest'
            ? questSectionRef.current
            : null;
    if (!target) return;
    const timer = window.setTimeout(() => {
      target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      target.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, context?.point.id, focusIntent]);

  if (!open || !context) return null;

  const { point, subjectName, chapterName, sectionName } = context;
  const evidence = point.evidence;
  const evidenceSummary = buildKnowledgeEvidenceSummary({
    point,
    mastery: mastery
      ? {
          status: mastery.status,
          mastery: mastery.mastery,
          accuracy: mastery.accuracy,
          attempts: mastery.attempts,
          correctCount: mastery.correctCount,
          wrongCount: mastery.wrongCount,
          nextReviewAt: mastery.nextReviewAt,
        }
      : null,
    examQuestions,
    relatedQuestionsCount: relatedQuestions?.length ?? 0,
    prerequisiteCount: prerequisiteContexts.length,
    relatedCount: relatedContexts.length,
  });
  const evidenceCards = evidenceSummary.cards;
  const relatedQuestionCount = relatedQuestions?.length ?? 0;
  const examQuestionCount = examQuestions?.length ?? 0;
  const hasRelatedQuestions = relatedQuestionCount > 0;
  const hasExamQuestions = examQuestionCount > 0;
  const actionDataPending = !detailError && relatedQuestions == null && examQuestions == null;
  const practiceActionLabel = hasRelatedQuestions
    ? '去练习'
    : actionDataPending
      ? '题库加载中'
      : '暂无题库题';
  const practiceActionHint = hasRelatedQuestions
    ? ''
    : actionDataPending
      ? '正在加载关联题库，稍后会显示可练题目。'
      : detailError
        ? '题库加载失败，请稍后重试。'
      : hasExamQuestions
        ? '该节点已有真题命中，先看真题命中；补齐题库后再进入练习。'
        : '该节点暂无关联题库题目，补齐题库后再进入练习。';
  const canStartQuest = hasRelatedQuestions;
  const questActionLabel = canStartQuest
    ? '开始闯关'
    : actionDataPending
      ? '题库加载中'
      : '暂无闯关题';
  const questUnavailableHint = actionDataPending
    ? '正在加载关联题库，加载完成后会开放闯关入口。'
    : detailError
      ? '题库加载失败，暂不能开始闯关。'
    : hasExamQuestions
      ? '该节点已有真题命中，但暂无题库题；先看真题命中，补题后再闯关。'
      : '该节点暂无题库题，补齐关联题后再开放闯关。';
  const sectionClassName = (...targets: CatalogFirstScreenActionType[]) =>
    `catalog-drawer-section${focusIntent && targets.includes(focusIntent) ? ' catalog-drawer-section-focused' : ''}`;

  return (
    <OverlayDialog label={`知识点详情：${point.name}`} onClose={onClose}>
      <div className="catalog-drawer">
        <header className="catalog-drawer-header">
          <p className="eyebrow">{subjectName}</p>
          <h3>{point.name}</h3>
          <p className="catalog-drawer-breadcrumb">
            {chapterName} → {sectionName}
          </p>
          <button type="button" className="catalog-drawer-close" onClick={onClose}>
            关闭
          </button>
        </header>

        <dl className="catalog-detail-grid">
          <div>
            <dt>重要度</dt>
            <dd>{point.importance} / 5</dd>
          </div>
          <div>
            <dt>难度</dt>
            <dd>{point.difficulty} / 5</dd>
          </div>
        </dl>

        <section
          ref={evidenceSectionRef}
          className={sectionClassName('inspect')}
          tabIndex={-1}
        >
          <h4>学习证据与建议</h4>
          <div className="catalog-evidence-grid">
            {evidenceCards.map((card) => (
              <article
                key={card.title}
                className={`catalog-evidence-card catalog-evidence-tone-${card.tone}`}
              >
                <strong>{card.title}</strong>
                <p>{card.value}</p>
                <small>{card.note}</small>
              </article>
            ))}
          </div>
          {evidence ? (
            <dl className="catalog-detail-grid">
              <div>
                <dt>近3年</dt>
                <dd>{evidence.recent3Frequency}</dd>
              </div>
              <div>
                <dt>近5年</dt>
                <dd>{evidence.recent5Frequency}</dd>
              </div>
              <div>
                <dt>{ALL_TIME_EVIDENCE_LABEL}</dt>
                <dd>{evidence.allTimeEvidence}</dd>
              </div>
              <div>
                <dt>趋势</dt>
                <dd>{TREND_LABELS[evidence.trendDirection] ?? evidence.trendDirection}</dd>
              </div>
            </dl>
          ) : (
            <p className="catalog-drawer-empty">{NO_FREQUENCY_LABEL}</p>
          )}
        </section>

        <section
          ref={masterySectionRef}
          className={sectionClassName('inspect')}
          tabIndex={-1}
        >
          <h4>我的掌握度</h4>
          {mastery ? (
            <dl className="catalog-detail-grid">
              <div>
                <dt>掌握度</dt>
                <dd>{Math.round(mastery.mastery * 100)}%</dd>
              </div>
              <div>
                <dt>练习次数</dt>
                <dd>{mastery.attempts}</dd>
              </div>
              <div>
                <dt>正确 / 错误</dt>
                <dd>{mastery.correctCount} / {mastery.wrongCount}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>{MASTERY_STATUS_LABELS[mastery.status]}</dd>
              </div>
            </dl>
          ) : (
            <p className="catalog-drawer-empty">尚未练习该知识点</p>
          )}
          <button
            type="button"
            className="primary-action catalog-drawer-primary"
            disabled={!hasRelatedQuestions}
            aria-disabled={!hasRelatedQuestions}
            onClick={hasRelatedQuestions ? onNavigate : undefined}
          >
            {practiceActionLabel}
          </button>
          {!hasRelatedQuestions ? <p className="catalog-drawer-action-note">{practiceActionHint}</p> : null}
        </section>

        <section
          ref={questSectionRef}
          className={sectionClassName('quest')}
          tabIndex={-1}
        >
          <h4>节点闯关</h4>
          <dl className="catalog-detail-grid">
            <div>
              <dt>闯关状态</dt>
              <dd>{questStatus ? QUEST_STATUS_LABELS[questStatus] : '未开始'}</dd>
            </div>
            {questAttempts ? (
              <div>
                <dt>闯关次数</dt>
                <dd>{questAttempts}</dd>
              </div>
            ) : null}
            {questBestAccuracy ? (
              <div>
                <dt>最佳正确率</dt>
                <dd>{Math.round(questBestAccuracy)}%</dd>
              </div>
            ) : null}
          </dl>
          {questStatus === 'passed' ? (
            <p className="catalog-drawer-empty">本节点已通关，继续保持。</p>
          ) : questContext ? (
            <>
              <button type="button" className="secondary-action" onClick={onCompleteQuest}>
                完成闯关并结算
              </button>
              {questError ? <p className="catalog-mastery-error">{questError}</p> : null}
            </>
          ) : (
            <>
              <button
                type="button"
                className={`secondary-action${canStartQuest ? '' : ' catalog-action-disabled'}`}
                disabled={!canStartQuest}
                aria-disabled={!canStartQuest}
                onClick={canStartQuest ? onStartQuest : undefined}
              >
                {questActionLabel}
              </button>
              {!canStartQuest ? <p className="catalog-drawer-action-note">{questUnavailableHint}</p> : null}
              {questError ? <p className="catalog-mastery-error">{questError}</p> : null}
            </>
          )}
        </section>

        <section className="catalog-drawer-section">
          <h4>考点题库{relatedQuestions?.length ? `（${relatedQuestions.length} 题）` : ''}</h4>
          {detailError ? (
            <p className="catalog-drawer-empty">题库加载失败：{detailError}</p>
          ) : relatedQuestions?.length ? (
            <ul className="catalog-ref-list">
              {relatedQuestions.map((question) => (
                <li key={question.id} className="catalog-ref-item">
                  <strong>{question.stem}</strong>
                  <small>
                    {question.type} · {question.difficulty}
                    {question.year ? ` · ${question.year} 年` : ''} · {question.source}
                  </small>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => onPracticeQuestion?.(question.id, point.name)}
                  >
                    练习本题
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="catalog-drawer-empty">暂无关联题库题目</p>
          )}
        </section>

        <section
          ref={examSectionRef}
          className={sectionClassName('exam')}
          tabIndex={-1}
        >
          <h4>真题命中</h4>
          {examQuestions?.length ? (
            <ul className="catalog-ref-list">
              {examQuestions.map((item) => (
                <li key={item.id} className="catalog-ref-item">
                  <strong>
                    {item.year} 年 {item.questionNo} 题 · {item.questionType}
                    {item.score != null ? ` · ${item.score} 分` : ''}
                  </strong>
                  {item.summary ? <small>{item.summary}</small> : null}
                  {item.sourceUrl ? (
                    <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                      查看真题来源
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="catalog-drawer-empty">暂无真题命中记录</p>
          )}
        </section>

        <section className="catalog-drawer-section">
          <h4>前置知识</h4>
          {prerequisiteContexts.length ? (
            <ul className="catalog-ref-list">
              {prerequisiteContexts.map((item) => (
                <ReferenceItem
                  key={item.point.id}
                  context={item}
                  currentSubjectCode={context.subjectCode}
                />
              ))}
            </ul>
          ) : (
            <p className="catalog-drawer-empty">暂无</p>
          )}
        </section>

        <section className="catalog-drawer-section">
          <h4>相关知识</h4>
          {relatedContexts.length ? (
            <ul className="catalog-ref-list">
              {relatedContexts.map((item) => (
                <ReferenceItem
                  key={item.point.id}
                  context={item}
                  currentSubjectCode={context.subjectCode}
                />
              ))}
            </ul>
          ) : (
            <p className="catalog-drawer-empty">暂无</p>
          )}
        </section>
      </div>
    </OverlayDialog>
  );
}

function ReferenceItem({
  context,
  currentSubjectCode,
}: {
  context: CatalogPointContext;
  currentSubjectCode: string;
}) {
  const crossSubject = context.subjectCode !== currentSubjectCode;
  return (
    <li className="catalog-ref-item">
      <strong>{context.point.name}</strong>
      <small>
        {crossSubject ? `${context.subjectName} · ` : ''}
        {context.chapterName} · {context.sectionName}
      </small>
    </li>
  );
}
