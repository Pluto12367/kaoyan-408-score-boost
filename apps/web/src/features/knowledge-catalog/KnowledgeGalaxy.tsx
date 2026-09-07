import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react';
import { motion } from 'framer-motion';
import { Minus, Plus, RotateCcw, Sparkles } from 'lucide-react';
import {
  deriveNodeMasteryStatus,
  type CatalogAtomicPoint,
  type CatalogSubject,
} from '@kaoyan408/shared';
import { EmptyState, GlassCard } from '../../components/ui';
import type { NodeMasterySummary } from '../../api/endpoints/score-center';
import { MASTERY_STATUS_LABELS } from './constants';
import './knowledge-galaxy.css';

const VIEWBOX_WIDTH = 840;
const VIEWBOX_HEIGHT = 500;
const CENTER_X = VIEWBOX_WIDTH / 2;
const CENTER_Y = VIEWBOX_HEIGHT / 2;
const GALAXY_RENDER_LIMIT = 32;

interface GalaxyPoint {
  point: CatalogAtomicPoint;
  chapterName: string;
  sectionName: string;
  mastery: NodeMasterySummary | undefined;
  status: 'untouched' | 'weak' | 'review' | 'mastered';
  x: number;
  y: number;
  radius: number;
}

interface GalaxyEdge {
  source: GalaxyPoint;
  target: GalaxyPoint;
  kind: 'prerequisite' | 'related';
}

export interface KnowledgeGalaxyProps {
  subject: CatalogSubject;
  masteryById: Record<string, NodeMasterySummary>;
  selectedPointId: string | null;
  onSelectPoint?: (point: CatalogAtomicPoint) => void;
  /** V9 Phase 4: whole-catalog known relations (prerequisites + related), shown next to in-view edges. */
  knownRelationCount?: number;
}

export function KnowledgeGalaxy({
  subject,
  masteryById,
  selectedPointId,
  onSelectPoint,
  knownRelationCount,
}: KnowledgeGalaxyProps) {
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);

  const points = useMemo(() => focusPoints(subject, masteryById, selectedPointId), [subject, masteryById, selectedPointId]);
  const layout = useMemo(() => buildLayout(points, masteryById), [points, masteryById]);

  const changeScale = (delta: number) => {
    setViewport((current) => ({
      ...current,
      scale: Math.min(1.55, Math.max(0.72, Number((current.scale + delta).toFixed(2)))),
    }));
  };

  const resetViewport = () => setViewport({ x: 0, y: 0, scale: 1 });

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest('[data-knowledge-galaxy-node]')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setViewport((current) => ({
      ...current,
      x: drag.originX + event.clientX - drag.x,
      y: drag.originY + event.clientY - drag.y,
    }));
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    changeScale(event.deltaY > 0 ? -0.08 : 0.08);
  };

  if (points.length === 0) {
    return (
      <GlassCard className="knowledge-galaxy-card" data-testid="knowledge-galaxy">
        <div className="knowledge-galaxy-heading">
          <div>
            <p className="eyebrow">Knowledge Galaxy</p>
            <h3>{subject.name} · 当前视图</h3>
          </div>
        </div>
        <EmptyState
          title="没有可显示的知识节点"
          description="调整搜索或筛选条件后，Galaxy 会展示当前聚焦的知识点。"
        />
      </GlassCard>
    );
  }

  return (
    <GlassCard className="knowledge-galaxy-card" data-testid="knowledge-galaxy">
      <div className="knowledge-galaxy-heading">
        <div>
          <p className="eyebrow">Knowledge Galaxy</p>
          <h3>{subject.name} · 当前知识焦点</h3>
          <p>优先展示当前筛选范围内的重点节点，完整目录仍保留在下方。</p>
        </div>
        <div className="knowledge-galaxy-heading-meta">
          <span>{points.length} 个聚焦节点</span>
          <span>
            {layout.edges.length} 条视图内关系
            {knownRelationCount != null ? ` · 全库 ${knownRelationCount} 条` : ''}
          </span>
        </div>
      </div>

      <div className="knowledge-galaxy-viewport-tools" aria-label="知识宇宙视图控制">
        <button type="button" className="knowledge-galaxy-icon-button" aria-label="缩小知识宇宙" title="缩小" onClick={() => changeScale(-0.12)}>
          <Minus size={16} aria-hidden="true" />
        </button>
        <span aria-live="polite">{Math.round(viewport.scale * 100)}%</span>
        <button type="button" className="knowledge-galaxy-icon-button" aria-label="放大知识宇宙" title="放大" onClick={() => changeScale(0.12)}>
          <Plus size={16} aria-hidden="true" />
        </button>
        <button type="button" className="knowledge-galaxy-icon-button" aria-label="重置知识宇宙视图" title="重置视图" onClick={resetViewport}>
          <RotateCcw size={16} aria-hidden="true" />
        </button>
      </div>

      <div
        className="knowledge-galaxy-viewport"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <svg
          className="knowledge-galaxy-svg"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          role="img"
          aria-label={`${subject.name}知识宇宙`}
          style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})` }}
        >
          <defs>
            <filter id="knowledge-galaxy-shadow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="var(--primary-strong)" floodOpacity="0.16" />
            </filter>
          </defs>

          <g className="knowledge-galaxy-edges" aria-hidden="true">
            {layout.edges.map((edge) => (
              <line
                key={`${edge.kind}-${edge.source.point.id}-${edge.target.point.id}`}
                className={`knowledge-galaxy-edge knowledge-galaxy-edge-${edge.kind}`}
                x1={edge.source.x}
                y1={edge.source.y}
                x2={edge.target.x}
                y2={edge.target.y}
              />
            ))}
          </g>

          <g className="knowledge-galaxy-center" filter="url(#knowledge-galaxy-shadow)">
            <circle className="knowledge-galaxy-center-halo" cx={CENTER_X} cy={CENTER_Y} r="78" />
            <circle className="knowledge-galaxy-center-core" cx={CENTER_X} cy={CENTER_Y} r="52" />
            <text x={CENTER_X} y={CENTER_Y - 4} textAnchor="middle" className="knowledge-galaxy-center-title">
              {subject.name}
            </text>
            <text x={CENTER_X} y={CENTER_Y + 18} textAnchor="middle" className="knowledge-galaxy-center-subtitle">
              学习焦点
            </text>
          </g>

          <g className="knowledge-galaxy-nodes">
            {layout.points.map((item, index) => {
              const masteryLabel = item.mastery?.mastery == null ? '未评估' : `${Math.round(item.mastery.mastery * 100)}%`;
              const statusLabel = item.mastery ? MASTERY_STATUS_LABELS[item.status] : '未评估';
              const accessibleLabel = `${item.point.name}，${statusLabel}，掌握度 ${masteryLabel}`;
              return (
                <motion.g
                  key={item.point.id}
                  className={`knowledge-galaxy-node knowledge-galaxy-node-${item.status}${selectedPointId === item.point.id ? ' is-selected' : ''}`}
                  data-knowledge-galaxy-node="true"
                  data-mastery-status={item.mastery ? item.status : 'untouched'}
                  role="button"
                  tabIndex={0}
                  aria-label={accessibleLabel}
                  transform={`translate(${item.x} ${item.y})`}
                  initial={{ opacity: 0, scale: 0.72 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: Math.min(index * 0.025, 0.5), duration: 0.28 }}
                  whileHover={{ scale: 1.08 }}
                  onClick={() => onSelectPoint?.(item.point)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectPoint?.(item.point);
                    }
                  }}
                >
                  <title>{accessibleLabel}</title>
                  <circle className="knowledge-galaxy-node-halo" r={item.radius + 7} />
                  <circle className="knowledge-galaxy-node-circle" r={item.radius} />
                  <text className="knowledge-galaxy-node-label" y={item.radius + 20} textAnchor="middle">
                    {truncate(item.point.name, 10)}
                  </text>
                  <text className="knowledge-galaxy-node-meta" y={item.radius + 36} textAnchor="middle">
                    {masteryLabel}
                  </text>
                </motion.g>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="knowledge-galaxy-footer">
        <div className="knowledge-galaxy-legend" aria-label="掌握状态图例">
          <span><i className="knowledge-galaxy-legend-dot knowledge-galaxy-legend-untouched" />未评估</span>
          <span><i className="knowledge-galaxy-legend-dot knowledge-galaxy-legend-weak" />薄弱</span>
          <span><i className="knowledge-galaxy-legend-dot knowledge-galaxy-legend-review" />复习中</span>
          <span><i className="knowledge-galaxy-legend-dot knowledge-galaxy-legend-mastered" />已掌握</span>
        </div>
        <span className="knowledge-galaxy-footer-hint">
          <Sparkles size={14} aria-hidden="true" /> 点击节点查看学习证据与详情
        </span>
      </div>
    </GlassCard>
  );
}

function focusPoints(
  subject: CatalogSubject,
  masteryById: Record<string, NodeMasterySummary>,
  selectedPointId: string | null,
) {
  const points = subject.chapters.flatMap((chapter) =>
    chapter.sections.flatMap((section) => section.points.map((point) => ({ point, chapterName: chapter.name, sectionName: section.name }))),
  );
  const ranked = points
    .map((item, index) => ({ item, index, score: focusScore(item.point, masteryById[item.point.id]) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ item }) => item);
  const selected = selectedPointId ? points.find((item) => item.point.id === selectedPointId) : undefined;
  const withoutSelected = ranked.filter((item) => item.point.id !== selectedPointId);
  return selected ? [selected, ...withoutSelected].slice(0, GALAXY_RENDER_LIMIT) : ranked.slice(0, GALAXY_RENDER_LIMIT);
}

function focusScore(point: CatalogAtomicPoint, mastery: NodeMasterySummary | undefined) {
  const status = mastery ? deriveNodeMasteryStatus({ mastery: mastery.mastery, attempts: mastery.attempts }) : 'untouched';
  const statusWeight = { weak: 400, review: 300, untouched: 200, mastered: 100 }[status];
  return statusWeight + point.importance * 10 + (point.evidence?.recent5Frequency ?? 0);
}

function buildLayout(
  points: Array<{ point: CatalogAtomicPoint; chapterName: string; sectionName: string }>,
  masteryById: Record<string, NodeMasterySummary>,
) {
  const layoutPoints: GalaxyPoint[] = points.map((item, index) => {
    const position = positionFor(index, points.length);
    const mastery = masteryById[item.point.id];
    const status = mastery
      ? deriveNodeMasteryStatus({ mastery: mastery.mastery, attempts: mastery.attempts })
      : 'untouched';
    return {
      ...item,
      mastery,
      status,
      ...position,
      radius: 14 + Math.max(1, Math.min(5, item.point.importance)) * 2.8,
    };
  });
  const byId = new Map(layoutPoints.map((item) => [item.point.id, item]));
  const edges: GalaxyEdge[] = [];
  const seen = new Set<string>();
  for (const source of layoutPoints) {
    for (const id of source.point.prerequisites ?? []) {
      const target = byId.get(id);
      if (!target) continue;
      const key = `prerequisite-${source.point.id}-${target.point.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source, target, kind: 'prerequisite' });
    }
    for (const id of source.point.relatedPoints ?? []) {
      const target = byId.get(id);
      if (!target) continue;
      const key = `related-${source.point.id}-${target.point.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source, target, kind: 'related' });
    }
  }
  return { points: layoutPoints, edges };
}

function positionFor(index: number, total: number) {
  const slotsPerRing = 10;
  const ring = Math.floor(index / slotsPerRing);
  const ringStart = ring * slotsPerRing;
  const ringSize = Math.min(slotsPerRing, total - ringStart);
  const slot = index - ringStart;
  const angle = (slot / Math.max(ringSize, 1)) * Math.PI * 2 - Math.PI / 2;
  const radius = 118 + ring * 78;
  return {
    x: CENTER_X + Math.cos(angle) * radius,
    y: CENTER_Y + Math.sin(angle) * radius * 0.72,
  };
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}
