export const PASSAGE_VERSION = 'knowledge-node-passage-v2';
export const PASSAGE_FORMAT = 'canonical-labeled-hierarchical-passage-v2';

function present(value) {
  return value !== null && value !== undefined && value !== '';
}

/** Preserve the V1 unlabeled node passage for the P1 experiment cells. */
export function buildPassageV1(node) {
  return [node?.name, node?.chapterName, node?.sectionName]
    .filter(present)
    .join(' ');
}

/** Build the locked P2 labeled hierarchy without identity or subject fields. */
export function buildPassageV2(node) {
  return [
    ['考点', node?.name],
    ['章节', node?.chapterName],
    ['小节', node?.sectionName],
  ]
    .filter(([, value]) => present(value))
    .map(([label, value]) => `${label}：${value}`)
    .join(' ');
}
