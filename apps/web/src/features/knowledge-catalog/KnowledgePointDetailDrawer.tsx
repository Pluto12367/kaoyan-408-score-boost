import type { CatalogPointContext } from '@kaoyan408/shared';
import { OverlayDialog } from '../../components/OverlayDialog';
import { ALL_TIME_EVIDENCE_LABEL, NO_FREQUENCY_LABEL, TREND_LABELS } from './constants';

interface KnowledgePointDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  context: CatalogPointContext | null;
  prerequisiteContexts: CatalogPointContext[];
  relatedContexts: CatalogPointContext[];
}

export function KnowledgePointDetailDrawer({
  open,
  onClose,
  context,
  prerequisiteContexts,
  relatedContexts,
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
