import { useEffect, useMemo, useState } from 'react';
import {
  buildKnowledgeCatalogFirstScreenHighlights,
  buildKnowledgePointIndex,
  deriveNodeMasteryStatus,
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
import { ProgressRing, SurfaceCard } from '../../components/ui';
import { getKnowledgeCatalog } from './catalogData';
import { SUBJECT_NAMES, SUBJECT_ORDER } from './constants';
import { KnowledgeGalaxy } from './KnowledgeGalaxy';
import { KnowledgePointDetailDrawer } from './KnowledgePointDetailDrawer';
import { KnowledgeTree, type ExpansionCommand } from './KnowledgeTree';
import { buildKnowledgeActions } from '../student/actions/adapters/knowledgeActionAdapter';

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
  const knowledgeActions = useMemo(
    () => buildKnowledgeActions({
      nodeId: selectedContext?.point.id,
      title: selectedContext?.point.name ?? '',
      prerequisiteContexts,
      relatedContexts,
      relatedQuestionIds: detail?.relatedQuestions.map((question) => question.id),
      questQuestionIds: detail?.relatedQuestions.map((question) => question.id),
    }),
    [detail?.relatedQuestions, prerequisiteContexts, relatedContexts, selectedContext],
  );
  const nodeAction = knowledgeActions.find((action) => action.type === 'knowledge_explore');
  const handlePracticeQuestion = (questionId: string, title: string) => {
    const action = knowledgeActions.find(
      (candidate) => candidate.type === 'practice_recommended' && candidate.context.questionId === questionId,
    );
    if (!action || action.type !== 'practice_recommended' || !action.context.knowledgeNodeId || !action.context.questionId) return;
    onPracticeQuestion?.(action.context.questionId, action.title || title);
  };
  const questAction = knowledgeActions.find((action) => action.type === 'knowledge_quest');
  const handleStartQuest = () => {
    if (!questAction || questAction.type !== 'knowledge_quest') return;
    onStartQuest?.(
      questAction.context.knowledgeNodeId,
      questAction.title,
      questAction.context.questionIds ?? [],
    );
  };

  const subject = catalog[active];
  const summary = useMemo(() => summarizeSubject(subject), [subject]);
  const subjectOverview = useMemo(
    () => SUBJECT_ORDER.map((code) => {
      const points = flattenSubjectPoints(catalog[code]);
      const knownMastery = points
        .map((point) => masteryById[point.id]?.mastery)
        .filter((value): value is number => value != null);
      const mastery = knownMastery.length > 0
        ? Math.round((knownMastery.reduce((total, value) => total + value, 0) / knownMastery.length) * 100)
        : null;
      const weakCount = points.filter((point) => {
        const item = masteryById[point.id];
        return item ? deriveNodeMasteryStatus({ mastery: item.mastery, attempts: item.attempts }) === 'weak' : false;
      }).length;
      return { code, name: SUBJECT_NAMES[code], pointCount: points.length, mastery, weakCount };
    }),
    [catalog, masteryById],
  );
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
    <section
      id="knowledge-catalog"
      className="panel knowledge-galaxy-page"
      data-testid="knowledge-catalog"
      data-knowledge-node-id={nodeAction?.type === 'knowledge_explore' ? nodeAction.context.knowledgeNodeId : undefined}
    >
      <header className="knowledge-galaxy-hero">
        <div>
          <p className="eyebrow">我的 408 知识宇宙</p>
          <h2>Knowledge Galaxy</h2>
          <p className="knowledge-galaxy-hero-description">
            探索你的知识掌握状态，从当前学习焦点出发理解、定位并进入练习。
          </p>
        </div>
        <div className="knowledge-galaxy-hero-metric">
          <span>当前聚焦</span>
          <strong>{subject.name}</strong>
          <small>{summary.atomicPointCount} 个知识点</small>
        </div>
      </header>
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
      <section className="knowledge-galaxy-overview" aria-labelledby="knowledge-galaxy-overview-title">
        <div className="knowledge-galaxy-overview-heading">
          <div>
            <p className="eyebrow">Student State</p>
            <h3 id="knowledge-galaxy-overview-title">我的 408 学习状态</h3>
          </div>
          <span className="knowledge-galaxy-summary">掌握度来自当前节点学习记录</span>
        </div>
        <div className="knowledge-galaxy-subject-grid">
          {subjectOverview.map((item) => (
            <SurfaceCard key={item.code} className={`knowledge-galaxy-subject-card${active === item.code ? ' is-active' : ''}`}>
              <button
                type="button"
                className="knowledge-galaxy-subject-card-action"
                onClick={() => setActive(item.code)}
              >
                <ProgressRing
                  value={item.mastery}
                  label={item.mastery == null ? '未评估' : `${item.mastery}%`}
                  size={58}
                  strokeWidth={5}
                  tone={item.code === 'DS' ? 'primary' : item.code === 'OS' ? 'warning' : item.code === 'CN' ? 'teal' : 'success'}
                />
                <span className="knowledge-galaxy-subject-copy">
                  <strong>{item.name}</strong>
                  <span>{item.pointCount} 个节点 · {item.weakCount > 0 ? `${item.weakCount} 个薄弱点` : '暂无薄弱点'}</span>
                </span>
              </button>
            </SurfaceCard>
          ))}
        </div>
      </section>
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
      <div className="knowledge-galaxy-workspace">
        <aside className="knowledge-galaxy-controls" aria-label="知识宇宙筛选">
          <div className="knowledge-galaxy-control-heading">
            <strong>探索范围</strong>
            <span>搜索和筛选会同步更新 Galaxy</span>
          </div>
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
        </aside>
        <main className="knowledge-galaxy-visual" aria-label={`${SUBJECT_NAMES[active]}知识宇宙视图`}>
          <KnowledgeGalaxy
            subject={visibleSubject}
            masteryById={masteryById}
            selectedPointId={selectedPointId}
            onSelectPoint={(point) => {
              setSelectedActionType(null);
              setSelectedPointId(point.id);
            }}
          />
        </main>
      </div>
      <section className="knowledge-galaxy-tree-section" aria-labelledby="knowledge-galaxy-tree-title">
        <div className="knowledge-galaxy-tree-heading">
          <h3 id="knowledge-galaxy-tree-title">完整知识目录</h3>
          <span>用于精确搜索、筛选和展开浏览</span>
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
      </section>
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
        onPracticeQuestion={handlePracticeQuestion}
        onStartQuest={handleStartQuest}
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

function flattenSubjectPoints(subject: CatalogSubject): CatalogAtomicPoint[] {
  return subject.chapters.flatMap((chapter) =>
    chapter.sections.flatMap((section) => section.points),
  );
}
//知识图谱
