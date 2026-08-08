export type SubjectCode = 'DS' | 'CO' | 'OS' | 'CN';

export type CatalogNodeType = 'subject' | 'chapter' | 'section' | 'atomicPoint';

export type TrendDirection = 'rising' | 'stable' | 'falling' | 'cold';

export type EvidenceConfidence = 'high' | 'medium' | 'low';

export interface FrequencyEvidence {
  recent3Frequency: number;
  recent5Frequency: number;
  allTimeEvidence: number;
  trendDirection: TrendDirection;
  trendDelta: number;
  evidenceConfidence: EvidenceConfidence;
  primaryScore5y?: number;
}

export interface ChapterSectionStats {
  relatedQuestionCount: number;
  primaryQuestionCount: number;
  primaryScore: number;
  yearCount: number;
  avgRelatedQuestionsPerYear: number;
  coverageRate: number;
}

export interface CatalogAtomicPoint {
  id: string;
  name: string;
  subject: SubjectCode;
  order: number;
  importance: number;
  difficulty: number;
  prerequisites: string[];
  relatedPoints: string[];
  evidence: FrequencyEvidence | null;
}

export interface CatalogSection {
  id: string;
  name: string;
  order: number;
  points: CatalogAtomicPoint[];
  stats?: ChapterSectionStats;
}

export interface CatalogChapter {
  id: string;
  name: string;
  order: number;
  sections: CatalogSection[];
  stats?: ChapterSectionStats;
}

export interface CatalogSubject {
  code: SubjectCode;
  name: string;
  chapters: CatalogChapter[];
}

export type KnowledgeCatalog = Record<SubjectCode, CatalogSubject>;

export interface RawKnowledgeNode {
  id: string;
  nodeType: string;
  subject: string;
  name: string;
  parentId: string | null;
  order: number;
  importance: number;
  difficulty: number;
  prerequisites?: string[];
  relatedPoints?: string[];
}

export interface RawFrequencyItem {
  knowledgePointId: string;
  recent3Y: { frequency: number };
  recent5Y: { frequency: number; primaryScore?: number };
  allTimeEvidence: { frequency: number };
  trend: { direction: string; delta: number };
  evidenceConfidence: string;
}

export interface RawChapterSectionStat {
  nodeId: string;
  nodeType: string;
  subject: string;
  name: string;
  parentId: string | null;
  atomicPointCount: number;
  relatedQuestionCount: number;
  primaryQuestionCount: number;
  primaryScore: number;
  years: number[];
  yearCount: number;
  avgRelatedQuestionsPerYear: number;
  coverageRate: number;
}

export interface SubjectSummary {
  chapterCount: number;
  sectionCount: number;
  atomicPointCount: number;
}

export interface CatalogFilterOptions {
  onlyHighFrequency?: boolean;
  onlyHighImportance?: boolean;
}

export interface CatalogSearchResult {
  point: CatalogAtomicPoint;
  subjectCode: SubjectCode;
  subjectName: string;
  chapterId: string;
  chapterName: string;
  sectionId: string;
  sectionName: string;
}

export interface CatalogPointContext {
  point: CatalogAtomicPoint;
  subjectCode: SubjectCode;
  subjectName: string;
  chapterId: string;
  chapterName: string;
  sectionId: string;
  sectionName: string;
}

export type KnowledgePointIndex = Record<string, CatalogPointContext>;

const SUBJECT_ORDER: SubjectCode[] = ['DS', 'CO', 'OS', 'CN'];
const HIGH_FREQUENCY_MIN = 4;
const HIGH_IMPORTANCE_MIN = 4;

function isSubjectCode(value: string): value is SubjectCode {
  return (SUBJECT_ORDER as string[]).includes(value);
}

function sortByOrder(left: RawKnowledgeNode, right: RawKnowledgeNode): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}

export function buildKnowledgeTree(nodes: RawKnowledgeNode[]): KnowledgeCatalog {
  const byId = new Map<string, RawKnowledgeNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) {
      throw new Error(`knowledge-catalog: duplicate node id ${node.id}`);
    }
    byId.set(node.id, node);
  }

  const subjectNodes = new Map<SubjectCode, RawKnowledgeNode>();
  const childrenByParent = new Map<string, RawKnowledgeNode[]>();

  for (const node of nodes) {
    if (!isSubjectCode(node.subject)) {
      throw new Error(`knowledge-catalog: node ${node.id} has unsupported subject "${node.subject}"`);
    }
    if (node.nodeType === 'subject') {
      if (subjectNodes.has(node.subject)) {
        throw new Error(`knowledge-catalog: duplicate subject node ${node.id}`);
      }
      if (node.parentId != null) {
        throw new Error(`knowledge-catalog: subject node ${node.id} must not have a parent`);
      }
      subjectNodes.set(node.subject, node);
      continue;
    }
    if (node.nodeType !== 'chapter' && node.nodeType !== 'section' && node.nodeType !== 'atomicPoint') {
      throw new Error(`knowledge-catalog: node ${node.id} has unsupported nodeType "${node.nodeType}"`);
    }
    if (node.parentId == null) {
      throw new Error(`knowledge-catalog: node ${node.id} is missing parentId`);
    }
    const parent = byId.get(node.parentId);
    if (!parent) {
      throw new Error(`knowledge-catalog: node ${node.id} has orphan parent ${node.parentId}`);
    }
    if (parent.subject !== node.subject) {
      throw new Error(
        `knowledge-catalog: node ${node.id} subject "${node.subject}" differs from parent "${parent.subject}"`,
      );
    }
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentId, siblings);
  }

  for (const code of SUBJECT_ORDER) {
    if (!subjectNodes.has(code)) {
      throw new Error(`knowledge-catalog: missing subject ${code}`);
    }
  }

  const catalog = {} as KnowledgeCatalog;
  let placed = 0;
  for (const code of SUBJECT_ORDER) {
    const subjectNode = subjectNodes.get(code)!;
    const chapters = (childrenByParent.get(code) ?? [])
      .filter((node) => node.nodeType === 'chapter')
      .sort(sortByOrder)
      .map((chapterNode) => {
        const sections = (childrenByParent.get(chapterNode.id) ?? [])
          .filter((node) => node.nodeType === 'section')
          .sort(sortByOrder)
          .map((sectionNode) => {
            const points = (childrenByParent.get(sectionNode.id) ?? [])
              .filter((node) => node.nodeType === 'atomicPoint')
              .sort(sortByOrder)
              .map((pointNode) => ({
                id: pointNode.id,
                name: pointNode.name,
                subject: pointNode.subject as SubjectCode,
                order: pointNode.order,
                importance: pointNode.importance,
                difficulty: pointNode.difficulty,
                prerequisites: [...(pointNode.prerequisites ?? [])],
                relatedPoints: [...(pointNode.relatedPoints ?? [])],
                evidence: null,
              }));
            placed += points.length;
            return { id: sectionNode.id, name: sectionNode.name, order: sectionNode.order, points };
          });
        placed += sections.length;
        return { id: chapterNode.id, name: chapterNode.name, order: chapterNode.order, sections };
      });
    placed += chapters.length;
    catalog[code] = { code, name: subjectNode.name, chapters };
  }

  const expectedPlaced = nodes.length - subjectNodes.size;
  if (placed !== expectedPlaced) {
    throw new Error(
      `knowledge-catalog: expected ${expectedPlaced} nested nodes, placed only ${placed}; hierarchy may be inconsistent`,
    );
  }
  return catalog;
}

function toFrequencyEvidence(item: RawFrequencyItem): FrequencyEvidence {
  return {
    recent3Frequency: item.recent3Y.frequency,
    recent5Frequency: item.recent5Y.frequency,
    allTimeEvidence: item.allTimeEvidence.frequency,
    trendDirection: item.trend.direction as TrendDirection,
    trendDelta: item.trend.delta,
    evidenceConfidence: item.evidenceConfidence as EvidenceConfidence,
    ...(item.recent5Y.primaryScore != null ? { primaryScore5y: item.recent5Y.primaryScore } : {}),
  };
}

export function joinFrequencyEvidence(
  catalog: KnowledgeCatalog,
  frequencyItems: RawFrequencyItem[],
): KnowledgeCatalog {
  const evidenceById = new Map<string, RawFrequencyItem>();
  for (const item of frequencyItems) {
    if (!evidenceById.has(item.knowledgePointId)) {
      evidenceById.set(item.knowledgePointId, item);
    }
  }

  const joined = {} as KnowledgeCatalog;
  for (const code of SUBJECT_ORDER) {
    joined[code] = {
      ...catalog[code],
      chapters: catalog[code].chapters.map((chapter) => ({
        ...chapter,
        sections: chapter.sections.map((section) => ({
          ...section,
          points: section.points.map((point) => {
            const item = evidenceById.get(point.id);
            return item ? { ...point, evidence: toFrequencyEvidence(item) } : point;
          }),
        })),
      })),
    };
  }
  return joined;
}

function toChapterSectionStats(item: RawChapterSectionStat): ChapterSectionStats {
  return {
    relatedQuestionCount: item.relatedQuestionCount,
    primaryQuestionCount: item.primaryQuestionCount,
    primaryScore: item.primaryScore,
    yearCount: item.yearCount,
    avgRelatedQuestionsPerYear: item.avgRelatedQuestionsPerYear,
    coverageRate: item.coverageRate,
  };
}

export function joinChapterSectionStats(
  catalog: KnowledgeCatalog,
  statsItems: RawChapterSectionStat[],
): KnowledgeCatalog {
  const statsById = new Map<string, RawChapterSectionStat>();
  for (const item of statsItems) {
    if (!statsById.has(item.nodeId)) {
      statsById.set(item.nodeId, item);
    }
  }

  const joined = {} as KnowledgeCatalog;
  for (const code of SUBJECT_ORDER) {
    joined[code] = {
      ...catalog[code],
      chapters: catalog[code].chapters.map((chapter) => {
        const chapterStats = statsById.get(chapter.id);
        const sections = chapter.sections.map((section) => {
          const sectionStats = statsById.get(section.id);
          return sectionStats ? { ...section, stats: toChapterSectionStats(sectionStats) } : section;
        });
        return chapterStats ? { ...chapter, stats: toChapterSectionStats(chapterStats), sections } : { ...chapter, sections };
      }),
    };
  }
  return joined;
}

export function filterKnowledgeTree(
  subject: CatalogSubject,
  options: CatalogFilterOptions,
): CatalogSubject {
  const chapters = subject.chapters
    .map((chapter) => {
      const sections = chapter.sections
        .map((section) => {
          const points = section.points.filter((point) => {
            if (options.onlyHighFrequency) {
              if (point.evidence == null || point.evidence.recent5Frequency < HIGH_FREQUENCY_MIN) {
                return false;
              }
            }
            if (options.onlyHighImportance && point.importance < HIGH_IMPORTANCE_MIN) {
              return false;
            }
            return true;
          });
          return points.length > 0 ? { ...section, points } : null;
        })
        .filter((section): section is CatalogSection => section !== null);
      return sections.length > 0 ? { ...chapter, sections } : null;
    })
    .filter((chapter): chapter is CatalogChapter => chapter !== null);
  return { ...subject, chapters };
}

export function searchKnowledgeTree(
  catalog: KnowledgeCatalog,
  query: string,
): CatalogSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results: CatalogSearchResult[] = [];
  for (const code of SUBJECT_ORDER) {
    const subject = catalog[code];
    for (const chapter of subject.chapters) {
      for (const section of chapter.sections) {
        for (const point of section.points) {
          if (point.name.toLowerCase().includes(needle)) {
            results.push({
              point,
              subjectCode: subject.code,
              subjectName: subject.name,
              chapterId: chapter.id,
              chapterName: chapter.name,
              sectionId: section.id,
              sectionName: section.name,
            });
          }
        }
      }
    }
  }
  return results;
}

export function buildKnowledgePointIndex(catalog: KnowledgeCatalog): KnowledgePointIndex {
  const index: KnowledgePointIndex = {};
  for (const code of SUBJECT_ORDER) {
    const subject = catalog[code];
    for (const chapter of subject.chapters) {
      for (const section of chapter.sections) {
        for (const point of section.points) {
          if (index[point.id]) {
            throw new Error(`knowledge-catalog: duplicate atomic point id ${point.id}`);
          }
          index[point.id] = {
            point,
            subjectCode: subject.code,
            subjectName: subject.name,
            chapterId: chapter.id,
            chapterName: chapter.name,
            sectionId: section.id,
            sectionName: section.name,
          };
        }
      }
    }
  }
  return index;
}

export function resolveKnowledgePointRefs(
  index: KnowledgePointIndex,
  ids: readonly string[],
): CatalogPointContext[] {
  const seen = new Set<string>();
  const resolved: CatalogPointContext[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const context = index[id];
    if (context) resolved.push(context);
  }
  return resolved;
}

export function summarizeSubject(subject: CatalogSubject): SubjectSummary {
  const chapterCount = subject.chapters.length;
  const sectionCount = subject.chapters.reduce((sum, chapter) => sum + chapter.sections.length, 0);
  const atomicPointCount = subject.chapters.reduce(
    (sum, chapter) => sum + chapter.sections.reduce((inner, section) => inner + section.points.length, 0),
    0,
  );
  return { chapterCount, sectionCount, atomicPointCount };
}
