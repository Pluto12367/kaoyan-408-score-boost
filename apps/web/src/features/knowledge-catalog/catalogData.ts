import treeData from '../../../../../data/408/knowledge-tree-408-v2.json';
import frequencyData from '../../../../../data/408/frequency-model-v2.json';
import statsData from '../../../../../data/408/knowledge-catalog/chapter-section-stats-2022-2026.json';
import {
  buildKnowledgeTree,
  joinChapterSectionStats,
  joinFrequencyEvidence,
  type KnowledgeCatalog,
  type RawChapterSectionStat,
  type RawFrequencyItem,
  type RawKnowledgeNode,
  type SubjectCode,
} from '@kaoyan408/shared';

let cached: KnowledgeCatalog | null = null;

export function getKnowledgeCatalog(): KnowledgeCatalog {
  if (!cached) {
    cached = joinChapterSectionStats(
      joinFrequencyEvidence(
        buildKnowledgeTree((treeData as { nodes: RawKnowledgeNode[] }).nodes),
        (frequencyData as { items: RawFrequencyItem[] }).items,
      ),
      (statsData as { stats: RawChapterSectionStat[] }).stats,
    );
  }
  return cached;
}

export function getKnowledgeSubject(code: SubjectCode) {
  return getKnowledgeCatalog()[code];
}
