export interface KnowledgePointNodeDisplay {
  title: string;
  chapter: string;
}

export type KnowledgePointDisplayLookup =
  | Map<string, KnowledgePointNodeDisplay>
  | Record<string, KnowledgePointNodeDisplay>;

function lookup(store: KnowledgePointDisplayLookup, id: string): KnowledgePointNodeDisplay | undefined {
  if (store instanceof Map) return store.get(id);
  return store[id];
}

/**
 * Resolve a coarse KnowledgePoint to its catalog atomic-node display values.
 * Falls back to the knowledge point's own title/chapter when no mapping exists,
 * so existing records never render an empty or raw-id label.
 */
export function resolveKnowledgePointDisplay(
  point: { id: string; title: string; chapter: string },
  nodeMapByPoint: KnowledgePointDisplayLookup,
): { title: string; chapter: string } {
  const display = lookup(nodeMapByPoint, point.id);
  return display ? { title: display.title, chapter: display.chapter } : { title: point.title, chapter: point.chapter };
}
