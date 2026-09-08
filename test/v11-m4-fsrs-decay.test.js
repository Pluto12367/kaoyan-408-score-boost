import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// LE/V11-M4 — FSRS predictor (pure) + forgetting-defense selector.
//
// Mathematical invariants under test (no fabricated golden values — the
// shadow experiment on real data is the empirical validation):
//   - R(0, S) = 1 (recall at zero elapsed time is certain)
//   - R decreases monotonically in elapsed days t
//   - I(r, S) is the exact inverse of R(t, S): R(I(r,S), S) ≈ r
//   - stability grows on high-R recall, shrinks on lapse
//   - difficulty stays clamped in [1, 10]; stability in [0.1, 10000]
// Honesty: DEFAULT_FSRS_WEIGHTS are the published fsrs4anki FSRS-4.5
// defaults, labelled UNTRAINED — the shadow experiment (review-shadow.ts)
// is the empirical validator, and weight optimization is out of scope.

const FSRS_URL = new URL('../packages/shared/src/score-center/fsrs-scheduler.ts', import.meta.url);
const DECAY_URL = new URL('../packages/shared/src/score-center/decay-defense.selector.ts', import.meta.url);

function loadModule(url) {
  const cache = new Map();
  const load = (resolved) => {
    if (cache.has(resolved.href)) return cache.get(resolved.href);
    const source = readFileSync(resolved, 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    cache.set(resolved.href, module.exports);
    const localRequire = (requested) => {
      if (!requested.startsWith('.')) throw new Error(`bare specifier not allowed: ${requested}`);
      const resolvedDep = requested.endsWith('.ts') ? new URL(requested, resolved) : new URL(`${requested}.ts`, resolved);
      return load(resolvedDep);
    };
    new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
    return module.exports;
  };
  return load(url);
}

test('FSRS predictor: recall probability is 1 at zero elapsed and decreases with time', async () => {
  const { recallProbability } = await loadModule(FSRS_URL);
  assert.equal(recallProbability(0, 5), 1);
  let previous = 1;
  for (const days of [1, 3, 7, 14, 30, 90]) {
    const r = recallProbability(days, 5);
    assert.ok(r > 0 && r < 1, `R(${days}) must be in (0,1), got ${r}`);
    assert.ok(r <= previous, `R must decrease as elapsed days grow (at t=${days})`);
    previous = r;
  }
});

test('FSRS predictor: higher stability holds recall longer (monotone in S)', async () => {
  const { recallProbability } = await loadModule(FSRS_URL);
  for (const days of [5, 15, 40]) {
    const weakS = recallProbability(days, 2);
    const strongS = recallProbability(days, 8);
    assert.ok(strongS > weakS, `at t=${days}, larger stability must retain more`);
  }
});

test('FSRS predictor: interval formula is the exact inverse of the recall curve', async () => {
  const { recallProbability, nextInterval, DEFAULT_TARGET_RETENTION } = await loadModule(FSRS_URL);
  assert.ok(DEFAULT_TARGET_RETENTION > 0.8 && DEFAULT_TARGET_RETENTION < 0.95);
  for (const stability of [1, 3, 7, 21, 60]) {
    const interval = nextInterval(stability);
    assert.ok(interval >= 1, 'minimum interval is one day');
    const back = recallProbability(interval, stability);
    assert.ok(
      Math.abs(back - DEFAULT_TARGET_RETENTION) < 0.01,
      `R(I(S), S) must hit the target retention for S=${stability}, got ${back}`,
    );
  }
});

test('FSRS predictor: stability grows on successful recall, shrinks on lapse', async () => {
  const { nextStability } = await loadModule(FSRS_URL);
  const state = { stability: 5, difficulty: 5 };
  const grew = nextStability({ ...state, elapsedDays: 3, correct: true });
  assert.ok(grew.stability > state.stability, `successful recall must grow stability, got ${grew.stability}`);
  const lapsed = nextStability({ stability: 5, difficulty: 5, elapsedDays: 30, correct: false });
  assert.ok(lapsed.stability < 5, `lapse must shrink stability, got ${lapsed.stability}`);
});

test('FSRS predictor: difficulty stays clamped in [1, 10] across grade sequences', async () => {
  const { nextDifficulty } = await loadModule(FSRS_URL);
  let difficulty = 5;
  for (const grade of [1, 1, 1, 4, 4, 4, 2, 3]) {
    difficulty = nextDifficulty(difficulty, grade);
    assert.ok(difficulty >= 1 && difficulty <= 10, `difficulty out of clamp: ${difficulty}`);
  }
});

test('decay-defense selector: flags mastered nodes whose snapshots declined', async () => {
  const { buildDecayDefenseCandidates } = await loadModule(DECAY_URL);
  const candidates = buildDecayDefenseCandidates({
    nodes: [
      { knowledgeNodeId: 'OS-DEADLOCK', name: '死锁', subject: '操作系统' },
      { knowledgeNodeId: 'DS-TREE', name: '二叉排序树', subject: '数据结构' },
      { knowledgeNodeId: 'CN-TCP', name: 'TCP 拥塞控制', subject: '计算机网络' },
    ],
    currentMasteryByNode: { 'OS-DEADLOCK': 0.52, 'DS-TREE': 0.85, 'CN-TCP': 0.4 },
    snapshotsByNode: {
      'OS-DEADLOCK': [{ date: '2026-08-28', mastery: 0.78 }, { date: '2026-09-05', mastery: 0.52 }],
      'DS-TREE': [{ date: '2026-08-20', mastery: 0.84 }, { date: '2026-09-05', mastery: 0.85 }],
      'CN-TCP': [{ date: '2026-08-20', mastery: 0.3 }, { date: '2026-09-05', mastery: 0.4 }],
    },
    asOf: '2026-09-08T00:00:00.000Z',
    lookbackDays: 14,
    masteryFloor: 0.7,
    dropThreshold: 0.15,
  });
  assert.equal(candidates.length, 1, 'only the declined mastered node is flagged');
  assert.equal(candidates[0].knowledgeNodeId, 'OS-DEADLOCK');
  assert.ok(candidates[0].drop >= 0.15);
});

test('decay-defense selector: stable and never-mastered nodes produce no candidates', async () => {
  const { buildDecayDefenseCandidates } = await loadModule(DECAY_URL);
  const candidates = buildDecayDefenseCandidates({
    nodes: [
      { knowledgeNodeId: 'DS-TREE', name: '二叉排序树', subject: '数据结构' },
      { knowledgeNodeId: 'CN-TCP', name: 'TCP 拥塞控制', subject: '计算机网络' },
    ],
    currentMasteryByNode: { 'DS-TREE': 0.85, 'CN-TCP': 0.4 },
    snapshotsByNode: {
      'DS-TREE': [{ date: '2026-08-20', mastery: 0.84 }, { date: '2026-09-05', mastery: 0.85 }],
      'CN-TCP': [{ date: '2026-09-05', mastery: 0.4 }],
    },
    asOf: '2026-09-08T00:00:00.000Z',
    lookbackDays: 14,
    masteryFloor: 0.7,
    dropThreshold: 0.15,
  });
  assert.deepEqual([...candidates], [], 'stable and never-mastered nodes never enter the defense queue');
});
