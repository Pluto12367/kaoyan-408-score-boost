import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// LE-V10 Feature 1 / Milestone 1 — Exam Alignment Selector (pure projection).
//
// Red lines under test (docs/feature1-real-exam-practice-plan.md §5):
//   - every displayed number traces to a source row (evidence payload)
//   - NO frequency snapshot → null fields + 0 stars, never "0 次"
//   - NO mastery record → null mastery ("尚未练习"), never 0%
//   - LOW evidence confidence → estimated gain hidden entirely
//   - predictedGain is always an ESTIMATE with an exposed formula
//   - star thresholds stay in sync with the engine's HIGH_RECENT_FREQUENCY
//     trigger (packages/shared priority.ts) — enforced by a source check

const SELECTOR_URL = new URL('../apps/api/src/study/exam-alignment.selector.ts', import.meta.url);

async function loadSelector() {
  const source = await readFile(SELECTOR_URL, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(() => {
    throw new Error('exam-alignment.selector must stay dependency-free');
  }, module, module.exports);
  return module.exports;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const nodeMeta = (id, name, subject) => ({ knowledgeNodeId: id, name, subject });

const snapshot = (overrides = {}) => ({
  knowledgeNodeId: 'DS-TREE-BST',
  recent3Frequency: 3,
  recent5Frequency: 6,
  allTimeEvidence: 8,
  primaryScore5y: 12,
  trendDirection: 'UP',
  trendDelta: 0.4,
  evidenceConfidence: 'HIGH',
  ...overrides,
});

const examHit = (knowledgeNodeId, year, questionNo, subject = '数据结构') => ({
  knowledgeNodeId,
  year,
  questionNo,
  subject,
});

const mastery = (overrides = {}) => ({
  knowledgeNodeId: 'DS-TREE-BST',
  mastery: 0.62,
  attempts: 14,
  ...overrides,
});

const baseIndex = (overrides = {}) => ({
  nodesById: {
    'DS-TREE-BST': nodeMeta('DS-TREE-BST', '二叉排序树', '数据结构'),
    'OS-DEADLOCK': nodeMeta('OS-DEADLOCK', '死锁', '操作系统'),
    'CN-TCP-CONG': nodeMeta('CN-TCP-CONG', 'TCP 拥塞控制', '计算机网络'),
  },
  snapshotByNode: {
    'DS-TREE-BST': snapshot(),
  },
  masteryByNode: {
    'DS-TREE-BST': mastery(),
  },
  examHitsByNode: {
    'DS-TREE-BST': [
      examHit('DS-TREE-BST', 2025, 8),
      examHit('DS-TREE-BST', 2024, 10),
      examHit('DS-TREE-BST', 2023, 12),
      examHit('DS-TREE-BST', 2022, 5),
    ],
  },
  ...overrides,
});

const question = (questionId, nodeIds) => ({ questionId, nodeIds });

// ---------------------------------------------------------------------------
// buildExamAlignment — projection correctness
// ---------------------------------------------------------------------------

test('alignment item maps every field from its source row and carries evidence', async () => {
  const { buildExamAlignment } = await loadSelector();
  const result = buildExamAlignment(
    [question('q-1', ['DS-TREE-BST'])],
    baseIndex(),
  );
  const item = result.items[0];

  assert.equal(item.questionId, 'q-1');
  assert.equal(item.primaryNode.knowledgeNodeId, 'DS-TREE-BST');
  assert.equal(item.primaryNode.name, '二叉排序树');
  assert.equal(item.stars, 5, 'recent5=6 → five stars');
  assert.equal(item.recent5Frequency, 6);
  assert.equal(item.recent3Frequency, 3);
  assert.equal(item.frequencyConfidence, 'HIGH');
  assert.equal(item.mastery, 0.62);
  assert.equal(item.attempts, 14);
  assert.equal(item.lastSeenYear, 2025, 'latest exam hit year');
  assert.deepEqual(
    item.examHits.map((hit) => `${hit.year}#${hit.questionNo}`),
    ['2025#8', '2024#10', '2023#12'],
    'exam hits are year-desc and capped at 3',
  );
  // 估算: round(12 * (1 - 0.62) * 0.6) = round(2.736) = 3
  assert.equal(item.predictedGainEstimate, 3);
  assert.match(item.evidence.gainFormula, /primaryScore5y/);
  assert.match(item.evidence.gainFormula, /0\.6/);
  assert.equal(item.evidence.frequencySource.table, 'KnowledgeFrequencySnapshot');
  assert.equal(item.evidence.masterySource.table, 'UserKnowledgeMastery');

  assert.equal(result.summary.coveredNodeCount, 1);
  assert.equal(result.summary.highFrequencyCount, 1);
  assert.deepEqual([...result.summary.coveredYears], [2025, 2024, 2023, 2022]);
});

test('honesty: no snapshot → zero stars and null counts, never a fabricated 0', async () => {
  const { buildExamAlignment } = await loadSelector();
  const result = buildExamAlignment(
    [question('q-2', ['OS-DEADLOCK'])],
    baseIndex(),
  );
  const item = result.items[0];
  assert.equal(item.stars, 0);
  assert.equal(item.recent5Frequency, null);
  assert.equal(item.recent3Frequency, null);
  assert.equal(item.frequencyConfidence, null);
  assert.equal(item.predictedGainEstimate, null);
  assert.equal(item.mastery, null, 'never practiced ≠ 0% mastery');
  assert.equal(item.attempts, null);
  assert.deepEqual([...item.examHits], []);
  assert.equal(item.lastSeenYear, null);
  assert.equal(result.summary.coveredNodeCount, 0, 'nodes without snapshots never count as covered');
});

test('honesty: LOW confidence hides the estimated gain even with full data', async () => {
  const { buildExamAlignment } = await loadSelector();
  const index = baseIndex({
    snapshotByNode: { 'DS-TREE-BST': snapshot({ evidenceConfidence: 'LOW' }) },
  });
  const result = buildExamAlignment([question('q-1', ['DS-TREE-BST'])], index);
  assert.equal(result.items[0].predictedGainEstimate, null);
  assert.equal(result.items[0].stars, 5, 'frequency display itself is unaffected');
});

test('honesty: mastery missing keeps frequency display but drops the gain', async () => {
  const { buildExamAlignment } = await loadSelector();
  const index = baseIndex({ masteryByNode: {} });
  const result = buildExamAlignment([question('q-1', ['DS-TREE-BST'])], index);
  const item = result.items[0];
  assert.equal(item.mastery, null);
  assert.equal(item.predictedGainEstimate, null, 'no headroom basis without mastery');
});

test('star tiers follow the documented thresholds', async () => {
  const { buildExamAlignment } = await loadSelector();
  const cases = [
    [5, 5], [4, 4], [3, 4], [2, 3], [1, 3], [0, 0],
  ];
  for (const [recent5, expectedStars] of cases) {
    const index = baseIndex({
      snapshotByNode: { 'DS-TREE-BST': snapshot({ recent5Frequency: recent5 }) },
    });
    const result = buildExamAlignment([question('q-1', ['DS-TREE-BST'])], index);
    assert.equal(result.items[0].stars, expectedStars, `recent5=${recent5}`);
  }
});

test('primary node prefers the first node that has a snapshot', async () => {
  const { buildExamAlignment } = await loadSelector();
  const result = buildExamAlignment(
    [question('q-3', ['OS-DEADLOCK', 'DS-TREE-BST', 'CN-TCP-CONG'])],
    baseIndex(),
  );
  assert.equal(result.items[0].primaryNode.knowledgeNodeId, 'DS-TREE-BST');
});

test('question with no node resolution yields a minimal honest item', async () => {
  const { buildExamAlignment } = await loadSelector();
  const result = buildExamAlignment([question('q-4', [])], baseIndex());
  const item = result.items[0];
  assert.equal(item.questionId, 'q-4');
  assert.equal(item.primaryNode, null);
  assert.equal(item.stars, 0);
  assert.equal(item.recent5Frequency, null);
});

test('summary aggregates across items without double counting nodes', async () => {
  const { buildExamAlignment } = await loadSelector();
  const index = baseIndex({
    snapshotByNode: {
      'DS-TREE-BST': snapshot(),
      'CN-TCP-CONG': snapshot({
        knowledgeNodeId: 'CN-TCP-CONG',
        recent5Frequency: 4,
        recent3Frequency: 2,
        primaryScore5y: 8,
      }),
    },
    masteryByNode: {
      'DS-TREE-BST': mastery(),
      'CN-TCP-CONG': mastery({ knowledgeNodeId: 'CN-TCP-CONG', mastery: 0.3, attempts: 4 }),
    },
    examHitsByNode: {
      'DS-TREE-BST': [examHit('DS-TREE-BST', 2025, 8)],
      'CN-TCP-CONG': [examHit('CN-TCP-CONG', 2023, 37, '计算机网络')],
    },
  });
  const result = buildExamAlignment(
    [question('q-1', ['DS-TREE-BST']), question('q-2', ['CN-TCP-CONG']), question('q-1b', ['DS-TREE-BST'])],
    index,
  );
  assert.equal(result.summary.coveredNodeCount, 2, 'distinct nodes only');
  assert.equal(result.summary.highFrequencyCount, 2, '5★ + 4★ nodes both count as high');
  assert.deepEqual([...result.summary.coveredYears], [2025, 2023]);
});

// ---------------------------------------------------------------------------
// rankByExamAlignment — exam-aligned ordering (selector-level, engine untouched)
// ---------------------------------------------------------------------------

test('ranking: stars, then frequency, then mastery gap; ties break deterministically', async () => {
  const { buildExamAlignment, rankByExamAlignment } = await loadSelector();
  const index = baseIndex({
    snapshotByNode: {
      'DS-TREE-BST': snapshot(),
      'OS-DEADLOCK': snapshot({ knowledgeNodeId: 'OS-DEADLOCK', recent5Frequency: 6, recent3Frequency: 3, primaryScore5y: 10 }),
      'CN-TCP-CONG': snapshot({ knowledgeNodeId: 'CN-TCP-CONG', recent5Frequency: 2, recent3Frequency: 1, primaryScore5y: 6 }),
    },
    masteryByNode: {
      'DS-TREE-BST': mastery(),
      'OS-DEADLOCK': mastery({ knowledgeNodeId: 'OS-DEADLOCK', mastery: 0.2, attempts: 5 }),
      'CN-TCP-CONG': mastery({ knowledgeNodeId: 'CN-TCP-CONG', mastery: 0.9, attempts: 30 }),
    },
  });
  const built = buildExamAlignment(
    [question('q-cn', ['CN-TCP-CONG']), question('q-bst', ['DS-TREE-BST']), question('q-os', ['OS-DEADLOCK'])],
    index,
  );
  const ranked = rankByExamAlignment(built.items, []);
  // 5★/freq6 gap .8 (os) vs 5★/freq6 gap .38 (bst) vs 3★ (cn)
  assert.deepEqual(ranked.map((item) => item.questionId), ['q-os', 'q-bst', 'q-cn']);
});

test('ranking: recently practiced questions are demoted within their tier', async () => {
  const { buildExamAlignment, rankByExamAlignment } = await loadSelector();
  const index = baseIndex({
    snapshotByNode: {
      'DS-TREE-BST': snapshot(),
      'OS-DEADLOCK': snapshot({ knowledgeNodeId: 'OS-DEADLOCK', recent5Frequency: 6, recent3Frequency: 3, primaryScore5y: 10 }),
    },
    masteryByNode: {
      'DS-TREE-BST': mastery(),
      'OS-DEADLOCK': mastery({ knowledgeNodeId: 'OS-DEADLOCK', mastery: 0.62, attempts: 14 }),
    },
  });
  const built = buildExamAlignment(
    [question('q-bst', ['DS-TREE-BST']), question('q-os', ['OS-DEADLOCK'])],
    index,
  );
  const ranked = rankByExamAlignment(built.items, [{ questionId: 'q-os', lastPracticedAt: '2026-09-06T00:00:00.000Z' }]);
  assert.equal(ranked[0].questionId, 'q-bst', 'the practiced twin moves behind the fresh one');
});

test('ranking: empty inputs and no-op recency pass through safely', async () => {
  const { rankByExamAlignment } = await loadSelector();
  assert.deepEqual(rankByExamAlignment([], []), []);
});

// ---------------------------------------------------------------------------
// Engine threshold sync — star semantics never drift from the engine
// ---------------------------------------------------------------------------

test('star thresholds stay in sync with the engine HIGH_RECENT_FREQUENCY trigger', async () => {
  const selectorModule = await loadSelector();
  const sharedSource = await readFile(
    new URL('../packages/shared/src/score-center/priority.ts', import.meta.url),
    'utf8',
  );
  const engineRule = sharedSource.match(/recent3Y\.frequency\s*>=\s*(\d+)/);
  assert.ok(engineRule, 'engine threshold literal must remain findable in priority.ts');
  assert.equal(
    selectorModule.ENGINE_HIGH_RECENT_FREQUENCY_THRESHOLD,
    Number(engineRule[1]),
    'selector must mirror the engine threshold (update together, never fork)',
  );
});

test('gain formula constant is exported and conservative', async () => {
  const { GAIN_CONSERVATIVE_FACTOR } = await loadSelector();
  assert.equal(GAIN_CONSERVATIVE_FACTOR, 0.6);
  assert.ok(GAIN_CONSERVATIVE_FACTOR > 0 && GAIN_CONSERVATIVE_FACTOR < 1);
});

// ---------------------------------------------------------------------------
// Purity + wiring contract
// ---------------------------------------------------------------------------

test('selector purity: no imports, no clock, no randomness', async () => {
  const source = await readFile(SELECTOR_URL, 'utf8');
  const imports = [...source.matchAll(/^import\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/gm)].map((match) => match[1]);
  assert.deepEqual(imports, [], 'selector stays dependency-free');
  assert.doesNotMatch(source, /Date\.now|Math\.random/, 'deterministic projection only');
});

test('M1 wiring: service loads via the exported score-center loaders and registers in StudyModule', async () => {
  const service = await readFile(new URL('../apps/api/src/study/exam-alignment.service.ts', import.meta.url), 'utf8');
  assert.match(service, /from '\.\.\/score-center\/repository'/, 'reuse the exported loaders — no duplicated loading logic');
  assert.match(service, /resolveKnowledgeNodesForQuestion/);
  assert.match(service, /loadLatestFrequencyForNodes/);
  assert.match(service, /loadExamQuestionsForNodes/);
  assert.match(service, /userKnowledgeMastery\.findMany/, 'mastery comes from the SoT table');
  assert.match(service, /buildExamAlignment/);
  assert.doesNotMatch(service, /\.create\(|\.update\(|\.delete\(/, 'read-only service');

  const moduleSource = await readFile(new URL('../apps/api/src/study/study.module.ts', import.meta.url), 'utf8');
  assert.match(moduleSource, /ExamAlignmentService/);
});

// ---------------------------------------------------------------------------
// M2 — wiring into the recommended practice set (incremental response field)
// ---------------------------------------------------------------------------

test('M2 section: plain mode returns the base byte-for-byte — no new key at all', async () => {
  const { withExamAlignmentSection } = await loadSelector();
  const base = { id: 'set-1', reason: 'r', questions: [{ id: 'q-1' }] };
  const result = withExamAlignmentSection(base, undefined, null, { serviceEnabled: true });
  assert.deepEqual(result, base, 'plain mode must stay byte-identical (no examAlignment key)');
  assert.equal(Object.keys(result).length, Object.keys(base).length);
});

test('M2 section: exam_aligned with a disabled store yields an explicit null', async () => {
  const { withExamAlignmentSection } = await loadSelector();
  const base = { id: 'set-1', questions: [{ id: 'q-1' }] };
  const result = withExamAlignmentSection(base, 'exam_aligned', null, { serviceEnabled: false });
  assert.equal(result.examAlignment, null, 'honest absence is an explicit null, not a fake payload');
  assert.equal(result.id, 'set-1');
});

test('M2 section: exam_aligned attaches the alignment with ranking applied', async () => {
  const { withExamAlignmentSection } = await loadSelector();
  const index = baseIndex();
  const { buildExamAlignment } = await loadSelector();
  const alignment = buildExamAlignment(
    [question('q-cn', ['CN-TCP-CONG']), question('q-bst', ['DS-TREE-BST'])],
    index,
  );
  const base = { id: 'set-1', questions: [{ id: 'q-cn' }, { id: 'q-bst' }] };
  const result = withExamAlignmentSection(base, 'exam_aligned', alignment, {
    serviceEnabled: true,
    recentPractice: [{ questionId: 'q-bst', lastPracticedAt: '2026-09-06T00:00:00.000Z' }],
  });
  assert.ok(result.examAlignment);
  assert.deepEqual(
    result.examAlignment.items.map((item) => item.questionId),
    ['q-cn', 'q-bst'],
    'recently practiced q-bst is demoted behind q-cn within its tier',
  );
  assert.equal(result.examAlignment.summary.coveredNodeCount, 1);
});

test('M2 section: alignment null with enabled store still yields explicit null', async () => {
  const { withExamAlignmentSection } = await loadSelector();
  const base = { id: 'set-1', questions: [{ id: 'q-1' }] };
  const result = withExamAlignmentSection(base, 'exam_aligned', null, { serviceEnabled: true });
  assert.equal(result.examAlignment, null);
});

test('M2 wiring: mode flows through controller and service; engine stays untouched', async () => {
  const controller = await readFile(new URL('../apps/api/src/study/study.controller.ts', import.meta.url), 'utf8');
  assert.match(controller, /@Query\('mode'\) mode\?: string/);
  assert.match(
    controller,
    /getRecommendedPracticeSet\(\s*this\.resolveUserId\(user, viewUserId\),\s*parseMinutesBudget\(minutes\),\s*mode\)/,
    'controller passes mode as the third argument',
  );

  const serviceSource = await readFile(new URL('../apps/api/src/study/study.service.ts', import.meta.url), 'utf8');
  const block = serviceSource.slice(
    serviceSource.indexOf('async getRecommendedPracticeSet'),
    serviceSource.indexOf('private getRecommendedPracticeSetLegacy'),
  );
  assert.match(block, /mode\?: string/, 'service signature gains an optional mode');
  assert.match(block, /attachToPracticeSet\(/, 'wiring goes through the alignment service');
  assert.match(block, /getRecommendedPracticeSetLegacy/, 'legacy branch preserved');
  assert.match(block, /getRecommendedPracticeSetFromState/, 'state branch preserved');
  assert.match(block, /recentPracticeRefs|lastPracticedAt|recent/, 'recency source is wired');

  const sharedDiffSafe = await readFile(new URL('../packages/shared/src/score-center/recommendation.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(sharedDiffSafe, /exam_aligned/, 'the shared engine never learns about the mode (zero engine change)');
});
