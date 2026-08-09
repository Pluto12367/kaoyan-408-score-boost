/**
 * Deterministic lexical retrieval: self-contained tokenizer + BM25, no
 * dependencies, no network, no embeddings. Subject is a hard filter; the
 * candidate pool is limited to active atomic KnowledgeNodes.
 */

export const LEXICAL_VERSION = 'lexical-bm25-v1';
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

// Text normalization mirrors snapshot.js normalizeText so query and document
// tokenization always agree (full-width -> half-width, lowercase, punctuation
// normalization, whitespace folding).
function fullWidthToHalf(char) {
  const code = char.charCodeAt(0);
  if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0);
  if (code === 0x3000) return ' ';
  return char;
}

export function normalizeText(value) {
  let text = String(value ?? '').trim();
  text = [...text].map(fullWidthToHalf).join('');
  text = text.toLowerCase();
  text = text.replace(/[\u2018\u2019]/g, "'");
  text = text.replace(/[\u201C\u201D]/g, '"');
  text = text.replace(/[，,]/g, ',');
  text = text.replace(/[。.]/g, '.');
  text = text.replace(/[；;]/g, ';');
  text = text.replace(/[：:]/g, ':');
  text = text.replace(/[！!]/g, '!');
  text = text.replace(/[？?]/g, '?');
  text = text.replace(/[\u2013\u2014\u2212_-]/g, '-');
  text = text.replace(/[·・]/g, '-');
  text = text.replace(/\s+/g, ' ');
  return text.trim();
}

function isCjk(char) {
  const code = char.codePointAt(0);
  return (
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff)
  );
}

function pushCjkTokens(run, tokens) {
  if (!run) return;
  for (const char of run) tokens.push(char);
  for (let i = 0; i + 1 < run.length; i += 1) tokens.push(run[i] + run[i + 1]);
}

/**
 * Deterministic tokenizer: ascii/digit words (lowercased, split on
 * non-alphanumerics) plus CJK unigrams and adjacent bigrams. Technical terms
 * like TCP / DNS / Cache / PPP / CSMA/CD tokenize consistently on both the
 * query and the document side; node ids are never tokenized.
 */
export function tokenize(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const tokens = [];
  for (const match of normalized.matchAll(/[a-z0-9]+/g)) tokens.push(match[0]);
  // CJK characters form one space-insensitive run, so '三次握手' and
  // '三次 握手' tokenize identically (deterministic, word-boundary agnostic).
  const cjkRun = [...normalized].filter(isCjk).join('');
  pushCjkTokens(cjkRun, tokens);
  return tokens;
}

/**
 * Build the BM25 index. Each input node is one searchable document; the
 * searchable text uses only real KnowledgeNode fields (name, chapterName,
 * sectionName). When nodeType/isActive are present, inactive and non-atomic
 * nodes are excluded from the corpus. Node order does not affect the index.
 */
export function buildLexicalIndex(nodes) {
  const sorted = [...nodes]
    .filter((entry) => entry.isActive !== false)
    .filter((entry) => entry.nodeType === undefined || entry.nodeType === null || entry.nodeType === 'atomicPoint')
    .sort((a, b) => a.id.localeCompare(b.id));

  const nodeSubject = new Map();
  const docs = new Map();
  const df = new Map();
  const postings = new Map();
  let totalLength = 0;

  for (const entry of sorted) {
    const text = [entry.name, entry.chapterName, entry.sectionName]
      .filter((value) => value != null && value !== '')
      .join(' ');
    const tokens = tokenize(text);
    docs.set(entry.id, tokens);
    nodeSubject.set(entry.id, entry.subject);
    totalLength += tokens.length;
    for (const token of new Set(tokens)) {
      df.set(token, (df.get(token) ?? 0) + 1);
      const list = postings.get(token) ?? [];
      list.push(entry.id);
      postings.set(token, list);
    }
  }

  const N = sorted.length;
  return {
    version: LEXICAL_VERSION,
    nodeSubject,
    docs,
    df,
    postings,
    avgdl: N === 0 ? 0 : totalLength / N,
    N,
  };
}

/**
 * Rank active atomic nodes of one subject by BM25. Only candidates with a
 * positive score are returned, sorted by score descending then nodeId
 * ascending (stable tie-break). An optional positive topK slices the result;
 * empty or weak queries fail safe with [].
 */
export function searchLexical(index, query, subject, topK) {
  const queryTokens = [...new Set(tokenize(query))];
  if (queryTokens.length === 0) return [];

  const candidateDocs = new Set();
  for (const token of queryTokens) {
    for (const nodeId of index.postings.get(token) ?? []) {
      if (index.nodeSubject.get(nodeId) === subject) candidateDocs.add(nodeId);
    }
  }
  if (candidateDocs.size === 0) return [];

  const avgdl = index.avgdl;
  const results = [];
  for (const nodeId of candidateDocs) {
    const tokens = index.docs.get(nodeId) ?? [];
    const dl = tokens.length;
    const tf = new Map();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
    const lengthNorm = avgdl > 0 ? dl / avgdl : 0;
    let score = 0;
    for (const token of queryTokens) {
      const docFreq = index.df.get(token) ?? 0;
      if (docFreq === 0) continue;
      const termFrequency = tf.get(token) ?? 0;
      if (termFrequency === 0) continue;
      const idf = Math.log(1 + (index.N - docFreq + 0.5) / (docFreq + 0.5));
      const denominator = termFrequency + BM25_K1 * (1 - BM25_B + BM25_B * lengthNorm);
      score += idf * ((termFrequency * (BM25_K1 + 1)) / denominator);
    }
    if (score > 0) results.push({ nodeId, score });
  }

  results.sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId));
  if (typeof topK === 'number' && Number.isFinite(topK) && topK > 0) {
    return results.slice(0, topK);
  }
  return results;
}
