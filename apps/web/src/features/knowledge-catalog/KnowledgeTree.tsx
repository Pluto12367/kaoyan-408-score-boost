import { useEffect, useState } from 'react';
import type { CatalogAtomicPoint, CatalogSubject } from '@kaoyan408/shared';
import { deriveNodeMasteryStatus } from '@kaoyan408/shared';
import type { NodeMasterySummary, NodeMasteryStatus, NodeQuestStatus } from '../../api/endpoints/score-center';
import { ALL_TIME_EVIDENCE_LABEL, MASTERY_STATUS_LABELS, NO_FREQUENCY_LABEL, QUEST_STATUS_LABELS, TREND_LABELS } from './constants';

export interface ExpansionCommand {
  version: number;
  mode: 'expand' | 'collapse';
}

const noop = () => {};

function Stars({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span className="catalog-stars" aria-label={`${clamped} / 5`}>
      {'★'.repeat(clamped)}
      {'☆'.repeat(5 - clamped)}
    </span>
  );
}

function AtomicPointRow({
  point,
  onSelectPoint = noop,
  masteryStatus,
  questStatus,
}: {
  point: CatalogAtomicPoint;
  onSelectPoint?: (point: CatalogAtomicPoint) => void;
  masteryStatus?: NodeMasteryStatus;
  questStatus?: NodeQuestStatus;
}) {
  const evidence = point.evidence;
  return (
    <button
      type="button"
      className={`catalog-point-row${masteryStatus ? ` mastery-${masteryStatus}` : ''}`}
      data-mastery-status={masteryStatus ?? 'untouched'}
      data-testid="catalog-point"
      onClick={() => onSelectPoint(point)}
    >
      <div className="catalog-point-head">
        <strong>{point.name}</strong>
        <span className="catalog-point-stats">
          {masteryStatus ? (
            <span className="catalog-mastery-badge" data-status={masteryStatus}>
              {MASTERY_STATUS_LABELS[masteryStatus]}
            </span>
          ) : null}
          {questStatus ? (
            <span className="catalog-quest-badge" data-status={questStatus}>
              {QUEST_STATUS_LABELS[questStatus]}
            </span>
          ) : null}
          重要度 <Stars value={point.importance} />
          <span className="catalog-stat-sep">·</span>
          难度 <Stars value={point.difficulty} />
        </span>
      </div>
      {evidence ? (
        <div className="catalog-frequency">
          <span>近3年：{evidence.recent3Frequency}</span>
          <span>近5年：{evidence.recent5Frequency}</span>
          <span>{ALL_TIME_EVIDENCE_LABEL}：{evidence.allTimeEvidence}</span>
          <span>趋势：{TREND_LABELS[evidence.trendDirection] ?? evidence.trendDirection}</span>
        </div>
      ) : (
        <div className="catalog-frequency">{NO_FREQUENCY_LABEL}</div>
      )}
    </button>
  );
}

export function KnowledgeTree({
  subject,
  expansionCommand,
  onSelectPoint,
  masteryById,
}: {
  subject: CatalogSubject;
  expansionCommand?: ExpansionCommand;
  onSelectPoint?: (point: CatalogAtomicPoint) => void;
  masteryById?: Record<string, NodeMasterySummary>;
}) {
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(
    () => new Set(subject.chapters.map((chapter) => chapter.id)),
  );
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!expansionCommand) return;
    if (expansionCommand.mode === 'expand') {
      setExpandedChapters(new Set(subject.chapters.map((chapter) => chapter.id)));
      setExpandedSections(
        new Set(subject.chapters.flatMap((chapter) => chapter.sections.map((section) => section.id))),
      );
    } else {
      setExpandedChapters(new Set());
      setExpandedSections(new Set());
    }
    // expansionCommand.version is the change token; mode always travels with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expansionCommand?.version]);

  const toggleChapter = (chapterId: string) => {
    setExpandedChapters((previous) => {
      const next = new Set(previous);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  const toggleSection = (sectionId: string) => {
    setExpandedSections((previous) => {
      const next = new Set(previous);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const masteryStatus = (pointId: string): NodeMasteryStatus => {
    const item = masteryById?.[pointId];
    if (!item) return 'untouched';
    return deriveNodeMasteryStatus({ mastery: item.mastery, attempts: item.attempts });
  };
  const questStatus = (pointId: string): NodeQuestStatus | undefined =>
    masteryById?.[pointId]?.questStatus;

  return (
    <div id="knowledge-catalog-panel" className="catalog-tree" data-testid="knowledge-tree">
      {subject.chapters.map((chapter) => {
        const chapterOpen = expandedChapters.has(chapter.id);
        return (
          <div className="catalog-chapter" key={chapter.id}>
            <button
              type="button"
              className="catalog-chapter-head"
              aria-expanded={chapterOpen}
              onClick={() => toggleChapter(chapter.id)}
            >
              <span className="catalog-caret" aria-hidden="true">{chapterOpen ? '▾' : '▸'}</span>
              <span>{chapter.name}</span>
              {chapter.stats ? (
                <span className="catalog-stat-meta">
                  近5年主考分值 {chapter.stats.primaryScore} · 涉及 {chapter.stats.relatedQuestionCount} 题 ·{' '}
                  {chapter.stats.yearCount}/5 年出现
                </span>
              ) : null}
              <span className="catalog-count">{chapter.sections.length} 小节</span>
            </button>
            {chapterOpen ? (
              <div className="catalog-chapter-body">
                {chapter.sections.map((section) => {
                  const sectionOpen = expandedSections.has(section.id);
                  return (
                    <div className="catalog-section" key={section.id}>
                      <button
                        type="button"
                        className="catalog-section-head"
                        aria-expanded={sectionOpen}
                        onClick={() => toggleSection(section.id)}
                      >
                        <span className="catalog-caret" aria-hidden="true">{sectionOpen ? '▾' : '▸'}</span>
                        <span>{section.name}</span>
                        {section.stats ? (
                          <span className="catalog-stat-meta">
                            主考 {section.stats.primaryScore} 分 · 涉及 {section.stats.relatedQuestionCount} 题
                          </span>
                        ) : null}
                        <span className="catalog-count">{section.points.length} 知识点</span>
                      </button>
                      {sectionOpen ? (
                        <div className="catalog-section-body">
                          {section.points.map((point) => (
                            <AtomicPointRow
                              key={point.id}
                              point={point}
                              onSelectPoint={onSelectPoint}
                              masteryStatus={masteryStatus(point.id)}
                              questStatus={questStatus(point.id)}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
