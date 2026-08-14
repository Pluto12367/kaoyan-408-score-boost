import type { Subject } from './domain';
import type { WeakPoint } from './domain';
import type { NodeMasteryStatus } from './score-center/mastery';

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
