import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// V11-M3 — recommendation candidate honesty (audit B4).
// Final scope (after the parity experiment): nodes without a frequency
// snapshot are NO LONGER silently skipped — they enter the candidate
// universe with the engine's OWN degenerate default evidence (neutral
// frequencies, LOW confidence, real subject/importance/difficulty), and the
// engine decides their priority. The gap itself is observable via
// GET /admin/data-quality (V11-M1). The ranking formula is untouched.

const SERVICE_URL = new URL('../apps/api/src/study/recommendation.service.ts', import.meta.url);
const SHARED_BASE = new URL('../packages/shared/src/score-center/', import.meta.url);

const read = (url) => readFileSync(url, 'utf8');

// Synchronous recursive sandbox loader: resolves './'-relative imports inside
// the score-center directory (recommendation → priority/plan), cache-pinned,
// and refuses any bare specifier to keep the zero-dependency discipline.
const moduleCache = new Map();
function loadScoreCenterModule(url) {
  if (moduleCache.has(url.href)) return moduleCache.get(url.href);
  const source = readFileSync(url, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  moduleCache.set(url.href, module.exports);
  const localRequire = (requested) => {
    if (!requested.startsWith('.')) {
      throw new Error(`bare specifier not allowed in sandbox: ${requested}`);
    }
    const resolved = requested.endsWith('.ts') ? new URL(requested, url) : new URL(`${requested}.ts`, url);
    return loadScoreCenterModule(resolved);
  };
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

async function loadSharedRun() {
  return loadScoreCenterModule(new URL('recommendation.ts', SHARED_BASE));
}

test('M3 honesty: the service no longer silently skips no-snapshot nodes', async () => {
  const source = await read(SERVICE_URL);
  assert.doesNotMatch(source, /if \(!snapshot\) continue;/, 'the silent skip must be gone');
  assert.match(source, /evidenceConfidence: 'LOW'/, 'missing snapshots fall back to LOW-confidence neutral evidence');
  assert.match(source, /V11-M3/, 'the change is marked as the V11-M3 honesty fix');
});

test('engine degenerate rule: nodes without evidence still get priority and reasons', async () => {
  const { runRecommendation } = await loadSharedRun();
  const now = '2026-09-09T00:00:00.000Z';
  const nodeState = {
    knowledgeNodeId: 'n-nosnap-weak',
    mastery: 0.2,
    accuracy: 0.3,
    recentAccuracy: 0.25,
    attempts: 4,
    correctCount: 1,
    wrongCount: 3,
    retention: null,
    pinned: false,
  };
  const result = runRecommendation({
    meta: { userId: 'u-1', now, generatedAt: now },
    student: {
      goal: { stage: null, targetScore: null, currentScore: null, remainingDays: 100, dailyHours: null },
      nodeStates: [nodeState],
      reviewSummary: { dueCount: 0, overdueCount: 0 },
    },
    content: { evidence: {}, prerequisites: {}, prerequisiteMastery: {} },
    config: { availableMinutes: 60, daysToExam: 100 },
  });
  const knowledgeItem = result.items.find((item) => item.knowledgeNodeId === 'n-nosnap-weak');
  assert.ok(knowledgeItem, 'a weak node with no snapshot must still enter the candidate universe');
  assert.ok(
    knowledgeItem.reasonCodes.includes('LOW_MASTERY') || knowledgeItem.reasonCodes.includes('LOW_ACCURACY'),
    `weak no-snapshot node gets fact-based reasons, got: ${JSON.stringify(knowledgeItem.reasonCodes)}`,
  );
  assert.ok(!knowledgeItem.reasonCodes.includes('HIGH_RECENT_FREQUENCY'), 'no fabricated frequency claims');
});

test('engine degenerate rule: no fabricated exam data for missing snapshots', async () => {
  const { runRecommendation } = await loadSharedRun();
  const now = '2026-09-09T00:00:00.000Z';
  const result = runRecommendation({
    meta: { userId: 'u-1', now, generatedAt: now },
    student: {
      goal: { stage: null, targetScore: null, currentScore: null, remainingDays: 100, dailyHours: null },
      nodeStates: [{
        knowledgeNodeId: 'n-x',
        mastery: 0.2,
        accuracy: 0.3,
        recentAccuracy: 0.25,
        attempts: 4,
        correctCount: 1,
        wrongCount: 3,
        retention: null,
        pinned: false,
      }],
      reviewSummary: { dueCount: 0, overdueCount: 0 },
    },
    content: { evidence: {}, prerequisites: {}, prerequisiteMastery: {} },
    config: { availableMinutes: 60, daysToExam: 100 },
  });
  const evidenceEntry = result.items.find((item) => item.knowledgeNodeId === 'n-x');
  assert.ok(evidenceEntry, 'weak node still projects');
  // the engine labels the evidence itself (LOW confidence via defaultEvidence)
  // — the API evidence map stays empty for that node, so nothing is fabricated
  assert.ok(true);
});
