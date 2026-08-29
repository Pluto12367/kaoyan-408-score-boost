import { useEffect, useMemo, useState } from 'react';
import {
  buildKnowledgeCatalogFirstScreenHighlights,
  buildKnowledgePointIndex,
  filterKnowledgeTree,
  resolveKnowledgePointRefs,
  searchKnowledgeTree,
  summarizeSearchHits,
  summarizeSubject,
  type CatalogAtomicPoint,
  type CatalogFirstScreenActionType,
  type CatalogPointContext,
  type CatalogSearchResult,
  type CatalogSubject,
  type SubjectCode,
} from '@kaoyan408/shared';
import { isStaticDemoMode } from '../../api/env';
import {
  fetchKnowledgeDetail,
  fetchMyMastery,
  type KnowledgeDetail,
  type NodeMasterySummary,
  type NodeQuestState,
} from '../../api/endpoints/score-center';
import type { RoleSection } from '../../layouts/RoleNavigation';
import { getKnowledgeCatalog } from './catalogData';
import { SUBJECT_NAMES, SUBJECT_ORDER } from './constants';
import { KnowledgePointDetailDrawer } from './KnowledgePointDetailDrawer';
import { KnowledgeTree, type ExpansionCommand } from './KnowledgeTree';

export function KnowledgeCatalog({
  onNavigate,
  onPracticeQuestion,
  onStartQuest,
  onCompleteQuest,
  questContext,
  questState,
  questError,
  questVersion = 0,
  focusNodeId = null,
}: {
  onNavigate?: (section: RoleSection) => void;
  onPracticeQuestion?: (questionId: string, title: string) => void;
  onStartQuest?: (nodeId: string, title: string, questionIds: string[]) => void;
  onCompleteQuest?: () => void;
  questContext?: boolean;
  questState?: NodeQuestState | null;
  questError?: string;
  questVersion?: number;
  focusNodeId?: string | null;
}) {
  const catalog = useMemo(() => getKnowledgeCatalog(), []);
  const [active, setActive] = useState<SubjectCode>('DS');
  const [query, setQuery] = useState('');
  const [onlyHighFrequency, setOnlyHighFrequency] = useState(false);
  const [onlyHighImportance, setOnlyHighImportance] = useState(false);
  const [expansion, setExpansion] = useState<ExpansionCommand>({ version: 0, mode: 'collapse' });
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [selectedActionType, setSelectedActionType] = useState<CatalogFirstScreenActionType | null>(null);
  const [masteryById, setMasteryById] = useState<Record<string, NodeMasterySummary>>({});
  const [masteryError, setMasteryError] = useState('');
  const [detail, setDetail] = useState<KnowledgeDetail | null>(null);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    if (isStaticDemoMode()) return;
    let cancelled = false;
    fetchMyMastery()
      .then((result) => {
        if (cancelled) return;
        const byId: Record<string, NodeMasterySummary> = {};
        for (const item of result.items) byId[item.knowledgeNodeId] = item;
        setMasteryById(byId);
        setMasteryError('');
      })
      .catch((error) => {
        if (cancelled) return;
        setMasteryError(error instanceof Error ? error.message : '掌握度加载失败，请重试。');
      });
    return () => {
      cancelled = true;
    };
  }, [questVersion]);

  useEffect(() => {
    if (!selectedPointId || isStaticDemoMode()) {
      setDetail(null);
      setDetailError('');
      return;
    }
    let cancelled = false;
    fetchKnowledgeDetail(selectedPointId)
      .then((result) => {
        if (cancelled) return;
        setDetail(result);
        setDetailError('');
      })
      .catch((error) => {
        if (cancelled) return;
        setDetail(null);
        setDetailError(error instanceof Error ? error.message : '知识点详情加载失败，请重试。');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPointId]);

  useEffect(() => {
    if (query.trim()) {
      setExpansion((previous) => ({ version: previous.version + 1, mode: 'expand' }));
    }
  }, [query]);

  const pointIndex = useMemo(() => buildKnowledgePointIndex(catalog), [catalog]);

  useEffect(() => {
    if (!focusNodeId) return;
    if (!pointIndex[focusNodeId]) return;
    const subjectCode = focusNodeId.slice(0, 2) as SubjectCode;
    if (SUBJECT_ORDER.includes(subjectCode)) setActive(subjectCode);
    setSelectedActionType(null);
    setSelectedPointId(focusNodeId);
  }, [focusNodeId, pointIndex]);

  const selectedContext = useMemo<CatalogPointContext | null>(
    () => (selectedPointId ? pointIndex[selectedPointId] ?? null : null),
    [selectedPointId, pointIndex],
  );
  const prerequisiteContexts = useMemo(
    () => (selectedContext ? resolveKnowledgePointRefs(pointIndex, selectedContext.point.prerequisites) : []),
    [selectedContext, pointIndex],
  );
  const relatedContexts = useMemo(
    () => (selectedContext ? resolveKnowledgePointRefs(pointIndex, selectedContext.point.relatedPoints) : []),
    [selectedContext, pointIndex],
  );

  const subject = catalog[active];
  const summary = useMemo(() => summarizeSubject(subject), [subject]);
  const firstScreenHighlights = useMemo(
    () => buildKnowledgeCatalogFirstScreenHighlights({ subject, masteryById }),
    [subject, masteryById],
  );

  const filteredSubject = useMemo(
    () => filterKnowledgeTree(subject, { onlyHighFrequency, onlyHighImportance }),
    [subject, onlyHighFrequency, onlyHighImportance],
  );

  const matches = useMemo(
    () => (query.trim() ? searchKnowledgeTree(catalog, query) : []),
    [catalog, query],
  );
  const searchHits = useMemo(
    () => summarizeSearchHits(matches, active),
    [matches, active],
  );
  const visibleMatches = useMemo(
    () => matches.filter((match) => match.subjectCode === active),
    [matches, active],
  );
  const visibleSubject = useMemo(
    () => (query.trim() ? groupSearchMatches(filteredSubject, visibleMatches) : filteredSubject),
    [filteredSubject, visibleMatches, query],
  );
  const hasResults = visibleSubject.chapters.some((chapter) => chapter.sections.length > 0);

  const expandAll = () => setExpansion((previous) => ({ version: previous.version + 1, mode: 'expand' }));
  const collapseAll = () => setExpansion((previous) => ({ version: previous.version + 1, mode: 'collapse' }));

  return (
    <section id="knowledge-catalog" className="panel" data-testid="knowledge-catalog">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">408 知识图谱</p>
          <h3>知识点目录</h3>
        </div>
      </div>
      <div className="report-tabs" role="tablist" aria-label="科目">
        {SUBJECT_ORDER.map((code) => (
          <button
            key={code}
            type="button"
            role="tab"
            id={`knowledge-subject-${code}`}
            aria-selected={active === code}
            aria-controls="knowledge-catalog-panel"
            className={`report-tab ${active === code ? 'active' : ''}`}
            onClick={() => setActive(code)}
          >
            {SUBJECT_NAMES[code]}
          </button>
        ))}
      </div>
      {firstScreenHighlights.length > 0 ? (
        <div className="catalog-first-screen" aria-label={`${SUBJECT_NAMES[active]}建议先看`}>
          <div className="catalog-first-screen-heading">
            <strong>建议先看</strong>
            <span>{SUBJECT_NAMES[active]} · 按薄弱、高频和闯关状态排序</span>
          </div>
          <div className="catalog-first-screen-grid">
            {firstScreenHighlights.map((highlight) => (
              <button
                key={`${highlight.kind}-${highlight.point.id}`}
                type="button"
                className={`catalog-first-screen-card catalog-first-screen-${highlight.kind}`}
                onClick={() => {
                  setSelectedActionType(highlight.actionType);
                  setSelectedPointId(highlight.point.id);
                }}
              >
                <span className="catalog-first-screen-type">{highlight.title}</span>
                <strong>{highlight.point.name}</strong>
                <span className="catalog-first-screen-reason">{highlight.reason}</span>
                <span className="catalog-first-screen-status">{highlight.statusLabel}</span>
                <span className="catalog-first-screen-action" data-action-type={highlight.actionType}>
                  {highlight.actionLabel}
                </span>
                <span className="catalog-first-screen-action-hint">{highlight.actionHint}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="catalog-filter-bar">
        <input
          type="search"
          className="catalog-search"
          placeholder="搜索当前科目知识点"
          aria-label="搜索当前科目知识点"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          className={`catalog-toggle${onlyHighFrequency ? ' active' : ''}`}
          aria-pressed={onlyHighFrequency}
          onClick={() => setOnlyHighFrequency((value) => !value)}
        >
          只看高频
        </button>
        <button
          type="button"
          className={`catalog-toggle${onlyHighImportance ? ' active' : ''}`}
          aria-pressed={onlyHighImportance}
          onClick={() => setOnlyHighImportance((value) => !value)}
        >
          重要度 ≥ 4
        </button>
        <button type="button" className="catalog-toggle" onClick={expandAll}>全部展开</button>
        <button type="button" className="catalog-toggle" onClick={collapseAll}>全部收起</button>
      </div>
      <div className="catalog-summary" aria-label={`${SUBJECT_NAMES[active]}汇总`}>
        <span>章节数：{summary.chapterCount}</span>
        <span>小节数：{summary.sectionCount}</span>
        <span>原子知识点数：{summary.atomicPointCount}</span>
        {masteryError ? (
          <span className="catalog-mastery-error" role="status">
            掌握度加载失败：{masteryError}
          </span>
        ) : null}
      </div>
      {hasResults ? (
        <KnowledgeTree
          key={subject.code}
          subject={visibleSubject}
          expansionCommand={expansion}
          onSelectPoint={(point) => {
            setSelectedActionType(null);
            setSelectedPointId(point.id);
          }}
          masteryById={masteryById}
        />
      ) : searchHits.otherSubjects.length > 0 ? (
        <div className="catalog-search-hint" role="status">
          <p>“{query.trim()}”在当前科目（{SUBJECT_NAMES[active]}）没有匹配，可在以下科目找到：</p>
          {searchHits.otherSubjects.map((subjectHit) => (
            <button
              key={subjectHit.code}
              type="button"
              className="catalog-toggle"
              onClick={() => setActive(subjectHit.code as SubjectCode)}
            >
              切换到{subjectHit.name}（{subjectHit.count} 个匹配）
            </button>
          ))}
        </div>
      ) : (
        <p className="empty-state">没有符合条件的知识点</p>
      )}
      <KnowledgePointDetailDrawer
        open={selectedPointId !== null}
        onClose={() => {
          setSelectedActionType(null);
          setSelectedPointId(null);
        }}
        context={selectedContext}
        focusIntent={selectedActionType}
        prerequisiteContexts={prerequisiteContexts}
        relatedContexts={relatedContexts}
        mastery={selectedPointId ? masteryById[selectedPointId] ?? null : null}
        relatedQuestions={detail?.relatedQuestions}
        examQuestions={detail?.examQuestions}
        detailError={detailError}
        questStatus={
          selectedPointId
            ? questState?.knowledgeNodeId === selectedPointId
              ? questState.status
              : masteryById[selectedPointId]?.questStatus
            : undefined
        }
        questAttempts={questState?.knowledgeNodeId === selectedPointId ? questState.attempts : undefined}
        questBestAccuracy={questState?.knowledgeNodeId === selectedPointId ? questState.bestAccuracy : undefined}
        questContext={questContext && questState?.knowledgeNodeId === selectedPointId}
        questError={questError}
        onPracticeQuestion={onPracticeQuestion}
        onStartQuest={() => {
          if (!selectedContext || !detail) return;
          onStartQuest?.(
            selectedContext.point.id,
            selectedContext.point.name,
            detail.relatedQuestions.map((question) => question.id),
          );
        }}
        onCompleteQuest={onCompleteQuest}
        onNavigate={() => onNavigate?.('question')}
      />
    </section>
  );
}

function groupSearchMatches(subject: CatalogSubject, matches: CatalogSearchResult[]): CatalogSubject {
  const matchedIdsBySection = new Map<string, Set<string>>();
  for (const match of matches) {
    const ids = matchedIdsBySection.get(match.sectionId) ?? new Set<string>();
    ids.add(match.point.id);
    matchedIdsBySection.set(match.sectionId, ids);
  }
  return {
    ...subject,
    chapters: subject.chapters
      .map((chapter) => ({
        ...chapter,
        sections: chapter.sections
          .map((section) => {
            const matchedIds = matchedIdsBySection.get(section.id);
            const points = matchedIds
              ? section.points.filter((point: CatalogAtomicPoint) => matchedIds.has(point.id))
              : [];
            return { ...section, points };
          })
          .filter((section) => section.points.length > 0),
      }))
      .filter((chapter) => chapter.sections.length > 0),
  };
}
//知识图谱