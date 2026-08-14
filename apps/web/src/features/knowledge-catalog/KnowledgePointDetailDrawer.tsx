import type { CatalogPointContext } from '@kaoyan408/shared';
import { OverlayDialog } from '../../components/OverlayDialog';
import type { KnowledgeDetail, NodeMasterySummary } from '../../api/endpoints/score-center';
import { ALL_TIME_EVIDENCE_LABEL, MASTERY_STATUS_LABELS, NO_FREQUENCY_LABEL, TREND_LABELS } from './constants';

interface KnowledgePointDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  context: CatalogPointContext | null;
  prerequisiteContexts: CatalogPointContext[];
  relatedContexts: CatalogPointContext[];
  mastery?: NodeMasterySummary | null;
  relatedQuestions?: KnowledgeDetail['relatedQuestions'];
  examQuestions?: KnowledgeDetail['examQuestions'];
  detailError?: string;
  onPracticeQuestion?: (questionId: string, title: string) => void;
  onNavigate?: () => void;
}

export function KnowledgePointDetailDrawer({
  open,
  onClose,
  context,
  prerequisiteContexts,
  relatedContexts,
  mastery,
  relatedQuestions,
  examQuestions,
  detailError,
  onPracticeQuestion,
  onNavigate,
}: KnowledgePointDetailDrawerProps) {
  if (!open || !context) return null;

  const { point, subjectName, chapterName, sectionName } = context;
  const evidence = point.evidence;

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

        <section className="catalog-drawer-section">
          <h4>考频证据</h4>
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

        <section className="catalog-drawer-section">
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
          <button type="button" className="catalog-cta" onClick={onNavigate}>
            去练习
          </button>
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
                    className="catalog-cta"
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

        <section className="catalog-drawer-section">
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
