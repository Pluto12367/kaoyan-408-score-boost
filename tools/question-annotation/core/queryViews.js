import { normalizeText } from './lexical.js';

export const QUERY_VIEW_VERSION = 'query-views-v2';

/**
 * Build the normalized question text views used by Retrieval V2. Analysis is
 * usable exactly when its normalized content is non-empty; there is no length
 * threshold or retrieval-dependent fallback.
 */
export function buildQueryViews(question) {
  const stem = normalizeText(question?.stem ?? '');
  const analysis = normalizeText(question?.analysis ?? '');
  const views = [{ type: 'stem', content: stem }];

  if (analysis.length > 0) {
    views.push({ type: 'analysis', content: analysis });
    return { views, availability: 'stem+analysis' };
  }

  return { views, availability: 'stem' };
}
