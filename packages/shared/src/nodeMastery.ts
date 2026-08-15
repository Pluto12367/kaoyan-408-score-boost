import type { Subject } from './domain';
import type { WeakPoint } from './domain';
import type { NodeMasteryStatus } from './score-center/mastery';

export type NodeQuestStatus = 'not_started' | 'in_progress' | 'passed';

export const QUEST_PASS_THRESHOLD = 60;

export const QUEST_STATUS_LABELS: Record<NodeQuestStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  passed: '已通关',
};

export function deriveNodeQuestStatus(input: {
  masteryAttempts: number;
  questAttempts: number;
  questPassed: boolean;
}): NodeQuestStatus {
  if (input.questPassed) return 'passed';
  if (input.masteryAttempts > 0 || input.questAttempts > 0) return 'in_progress';
  return 'not_started';
}

export interface NodeMasteryRow {
  knowledgeNodeId: string;
  subject: Subject | '未分类';
  chapter: string;
  title: string;
  importance: number;
  frequency: number;
  mastery: number;
  attempts: number;
  correctCount: number;
  wrongCount: number;
  status: NodeMasteryStatus;
}

export interface NodeMasteryPoint {
  knowledgePointId: string;
  title: string;
  chapter: string;
  importance: number;
  frequency: number;
  masteryRate: number;
  accuracyRate: number;
  practiceCount: number;
  wrongCount: number;
  status: Exclude<NodeMasteryStatus, 'untouched'>;
  nextAction: string;
  actionAnchor: string;
}

export interface NodeMasterySubjectMap {
  subject: string;
  averageMastery: number;
  weakCount: number;
  reviewCount: number;
  masteredCount: number;
  points: NodeMasteryPoint[];
}

export interface NodeMasteryMap {
  userId: string;
  title: string;
  generatedAt: string;
  subjects: NodeMasterySubjectMap[];
  weakestPoints: Array<NodeMasteryPoint & { subject: string }>;
}

export interface MasteryTrendPoint {
  date: string;
  averageMastery: number;
}

export interface NodeTrendSeries {
  knowledgeNodeId: string;
  title: string;
  chapter: string;
  mastery: number;
  series: MasteryTrendPoint[];
}

export interface MasteryTrendSubject {
  subject: string;
  averageMastery: number;
  series: MasteryTrendPoint[];
  weakestNodes: NodeTrendSeries[];
}

export interface MasteryTrendDelta {
  knowledgeNodeId: string;
  title: string;
  delta: number;
}

export interface MasteryTrend {
  userId: string;
  days: number;
  generatedAt: string;
  overall: MasteryTrendPoint[];
  subjects: MasteryTrendSubject[];
  improving: MasteryTrendDelta[];
  declining: MasteryTrendDelta[];
}

export function deriveNodeWeakPoints(rows: NodeMasteryRow[]): WeakPoint[] {
  return rows
    .filter((row) => row.attempts > 0 && row.status === 'weak')
    .map((row) => ({
      knowledgePointId: row.knowledgeNodeId,
      subject: row.subject,
      chapter: row.chapter,
      title: row.title,
      attempts: row.attempts,
      wrongCount: row.wrongCount,
      slowCount: 0,
      accuracyRate: row.attempts ? Math.round((row.correctCount / row.attempts) * 100) : 0,
      topReason: null,
      suggestion: '建议回归基础概念，配合真题巩固该节点。',
      weaknessScore: Math.round((1 - row.mastery) * 100),
    }))
    .sort((left, right) => left.weaknessScore - right.weaknessScore);
}

export function buildNodeMasteryMap(input: {
  userId: string;
  rows: NodeMasteryRow[];
  subjects: string[];
  generatedAt?: string;
}): NodeMasteryMap {
  const practiced = input.rows.filter((row) => row.attempts > 0 && row.status !== 'untouched');
  const subjectMaps = input.subjects.map((subject) => {
    const points = practiced
      .filter((row) => row.subject === subject)
      .map((row) => toPoint(row))
      .sort((left, right) => left.masteryRate - right.masteryRate);
    const averageMastery = points.length
      ? Math.round(points.reduce((sum, point) => sum + point.masteryRate, 0) / points.length)
      : 0;
    return {
      subject,
      averageMastery,
      weakCount: points.filter((point) => point.status === 'weak').length,
      reviewCount: points.filter((point) => point.status === 'review').length,
      masteredCount: points.filter((point) => point.status === 'mastered').length,
      points,
    };
  });
  const weakestPoints = subjectMaps
    .flatMap((subject) => subject.points.map((point) => ({ ...point, subject: subject.subject })))
    .sort((left, right) => left.masteryRate - right.masteryRate)
    .slice(0, 3);
  return {
    userId: input.userId,
    title: '408 掌握度地图',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    subjects: subjectMaps,
    weakestPoints,
  };
}

function toPoint(row: NodeMasteryRow): NodeMasteryPoint {
  const status = row.status as Exclude<NodeMasteryStatus, 'untouched'>;
  return {
    knowledgePointId: row.knowledgeNodeId,
    title: row.title,
    chapter: row.chapter,
    importance: row.importance,
    frequency: row.frequency,
    masteryRate: Math.round(row.mastery * 100),
    accuracyRate: row.attempts ? Math.round((row.correctCount / row.attempts) * 100) : 0,
    practiceCount: row.attempts,
    wrongCount: row.wrongCount,
    status,
    nextAction:
      status === 'weak'
        ? '建议回归基础，先看教材再刷题'
        : status === 'review'
          ? '建议安排巩固复习与变式练习'
          : '建议保持节奏，定期温习',
    actionAnchor: status === 'weak' ? '#wrong-book' : '#question',
  };
}

export function buildMasteryTrend(input: {
  userId: string;
  snapshots: Array<{ knowledgeNodeId: string; mastery: number; snapshotDate: string }>;
  nodeCatalog: Array<{ knowledgeNodeId: string; subject: string; title: string; chapter: string }>;
  subjects: string[];
  days: number;
  generatedAt?: string;
}): MasteryTrend {
  const catalogById = new Map(input.nodeCatalog.map((node) => [node.knowledgeNodeId, node]));
  const byDate = new Map<string, Array<{ knowledgeNodeId: string; mastery: number }>>();
  const nodeByDate = new Map<string, Map<string, number>>();
  for (const snapshot of input.snapshots) {
    const date = snapshot.snapshotDate.slice(0, 10);
    const nodeDates = nodeByDate.get(snapshot.knowledgeNodeId) ?? new Map<string, number>();
    nodeDates.set(date, snapshot.mastery);
    nodeByDate.set(snapshot.knowledgeNodeId, nodeDates);
    const items = byDate.get(date) ?? [];
    items.push({ knowledgeNodeId: snapshot.knowledgeNodeId, mastery: snapshot.mastery });
    byDate.set(date, items);
  }
  const dates = [...byDate.keys()].sort().slice(-Math.max(1, input.days));

  const overall = dates.map((date) => {
    const items = byDate.get(date) ?? [];
    const averageMastery = items.length
      ? Math.round((items.reduce((sum, item) => sum + item.mastery, 0) / items.length) * 100)
      : 0;
    return { date, averageMastery };
  });

  const subjects = input.subjects.map((subject) => {
    const nodes = input.nodeCatalog.filter((node) => node.subject === subject);
    const nodeSeries = nodes
      .map((node) => {
        const nodeDates = nodeByDate.get(node.knowledgeNodeId);
        const series = dates
          .filter((date) => nodeDates?.has(date))
          .map((date) => ({
            date,
            averageMastery: Math.round((nodeDates?.get(date) ?? 0) * 100),
          }));
        const values = [...(nodeDates?.values() ?? [])];
        const mastery = values.length ? Math.round((values[values.length - 1] ?? 0) * 100) : 0;
        return {
          knowledgeNodeId: node.knowledgeNodeId,
          title: node.title,
          chapter: node.chapter,
          mastery,
          series,
        };
      })
      .filter((item) => item.series.length > 0);
    const averageMastery = nodeSeries.length
      ? Math.round(nodeSeries.reduce((sum, item) => sum + item.mastery, 0) / nodeSeries.length)
      : 0;
    const series = dates.map((date) => {
      const values = nodes
        .map((node) => nodeByDate.get(node.knowledgeNodeId)?.get(date))
        .filter((value): value is number => typeof value === 'number');
      return {
        date,
        averageMastery: values.length
          ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100)
          : 0,
      };
    });
    const weakestNodes = nodeSeries
      .filter((item) => item.mastery < 45)
      .sort((left, right) => left.mastery - right.mastery)
      .slice(0, 3);
    return { subject, averageMastery, series, weakestNodes };
  });

  const deltas: MasteryTrendDelta[] = [];
  for (const [nodeId, nodeDates] of nodeByDate) {
    const windowDates = dates.filter((date) => nodeDates.has(date));
    if (windowDates.length < 2) continue;
    const first = nodeDates.get(windowDates[0]) ?? 0;
    const last = nodeDates.get(windowDates[windowDates.length - 1]) ?? 0;
    deltas.push({
      knowledgeNodeId: nodeId,
      title: catalogById.get(nodeId)?.title ?? nodeId,
      delta: Math.round((last - first) * 100),
    });
  }
  const improving = deltas
    .filter((item) => item.delta > 0)
    .sort((left, right) => right.delta - left.delta)
    .slice(0, 3);
  const declining = deltas
    .filter((item) => item.delta < 0)
    .sort((left, right) => left.delta - right.delta)
    .slice(0, 3);

  return {
    userId: input.userId,
    days: input.days,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    overall,
    subjects,
    improving,
    declining,
  };
}
