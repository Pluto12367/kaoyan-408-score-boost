// V14 ①（Owner 批准 D-V-1′/D-V-2/D-V-3，2026-09-27）— 提分账本声明纯模块契约。
// 设计 docs/v14-flagship-detailed-design.md §1。
//
// 钉死：
//   1. 两层口径：同题追回（recovered 行）→ OBSERVED/PROXY 随失分行 lossKind；
//      未定价失分追回 → 只计数，金额 null。
//   2. OBSERVED 声明门槛：recovered 候选 < minSamples(3) → insufficient_data，零金额输出。
//   3. PROXY 声明（同节点补偿）独立列表，绝不与 OBSERVED 合并。
//   4. 语义脚注固定：挽回分是测量值，不是成绩预测（RULE-11）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function loadModule() {
  const moduleSource = await source('packages/shared/src/score-anchor/recovery-claim.ts');
  const stripped = moduleSource.replace(/from '([^']*)'/g, (match, specifier) => {
    if (specifier.endsWith('.js') || specifier.startsWith('.')) return match;
    return "from './__stub__'";
  });
  const compiled = ts.transpileModule(stripped, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const runnable = compiled.replace(/import \{[^}]*\} from '\.\/__stub__';/g, '');
  return import(`data:text/javascript;base64,${Buffer.from(runnable).toString('base64')}`);
}

const row = (overrides = {}) => ({
  questionId: 'q-1',
  nodeId: 'DS-N1',
  status: 'recovered',
  priced: true,
  observedLostScore: 10,
  proxyLostScore: 0,
  observedLossWithReattemptSuccess: 10,
  proxyLossWithReattemptSuccess: 0,
  observedLossOutstanding: 0,
  reattemptCount: 1,
  reattemptSources: ['practice'],
  latestReattemptCorrect: true,
  lastLossAt: '2026-09-12T00:00:00Z',
  latestReattemptAt: '2026-09-25T00:00:00Z',
  priorityRank: 1,
  ...overrides,
});

test('同题追回：OBSERVED 失分被追回 → OBSERVED 声明 + 金额', async () => {
  const { buildRecoveryClaims } = await loadModule();
  const result = buildRecoveryClaims({
    rows: [row(), row({ questionId: 'q-2', observedLostScore: 6, observedLossWithReattemptSuccess: 6 }), row({ questionId: 'q-3', observedLostScore: 4, observedLossWithReattemptSuccess: 4 })],
    minSamples: 3,
    nodeNameById: new Map([['DS-N1', '单链表操作']]),
  });
  assert.equal(result.summary.observedRecovered, 20);
  assert.equal(result.claims.length, 3);
  assert.equal(result.claims[0].kind, 'OBSERVED');
  assert.equal(result.claims[0].recoveredScore, 10);
  assert.equal(result.summary.insufficient, false);
});

test('样本不足：< minSamples → insufficient_data，不输出任何金额声明', async () => {
  const { buildRecoveryClaims } = await loadModule();
  const result = buildRecoveryClaims({
    rows: [row()],
    minSamples: 3,
    nodeNameById: new Map(),
  });
  assert.equal(result.summary.insufficient, true);
  assert.equal(result.claims.length, 0);
  assert.equal(result.summary.observedRecovered, 0);
  assert.equal(result.summary.recoveredCandidates, 1);
});

test('未定价失分追回：只计数，金额 null', async () => {
  const { buildRecoveryClaims } = await loadModule();
  const result = buildRecoveryClaims({
    rows: [
      row(), row({ questionId: 'q-2', priced: false, observedLostScore: 0, observedLossWithReattemptSuccess: 0 }),
      row({ questionId: 'q-3', observedLostScore: 4, observedLossWithReattemptSuccess: 4 }),
    ],
    minSamples: 3,
    nodeNameById: new Map(),
  });
  assert.equal(result.summary.insufficient, false);
  assert.equal(result.summary.unpricedRecovered, 1);
  assert.equal(result.claims[1].recoveredScore, null, 'unpriced recovery claims carry NO amount');
});

test('PROXY 层：proxy 失分追回与 self_reported 失分都进 proxyClaims，绝不进 OBSERVED', async () => {
  const { buildRecoveryClaims } = await loadModule();
  const result = buildRecoveryClaims({
    rows: [
      row(),
      row({ questionId: 'q-2', observedLostScore: 0, proxyLostScore: 6, observedLossWithReattemptSuccess: 0, proxyLossWithReattemptSuccess: 6 }),
      row({ questionId: 'q-3', observedLostScore: 5, observedLossWithReattemptSuccess: 5 }),
    ],
    minSamples: 3,
    nodeNameById: new Map(),
  });
  assert.equal(result.summary.observedRecovered, 15); // q1 10 + q3 5
  assert.equal(result.summary.proxyRecovered, 6);
  assert.equal(result.proxyClaims.length, 1);
  assert.equal(result.proxyClaims[0].kind, 'PROXY');
});

test('not_recovered/awaiting 不产生任何声明', async () => {
  const { buildRecoveryClaims } = await loadModule();
  const result = buildRecoveryClaims({
    rows: [
      row(),
      row({ questionId: 'q-2', observedLostScore: 6, observedLossWithReattemptSuccess: 6 }),
      row({ questionId: 'q-3', observedLostScore: 4, observedLossWithReattemptSuccess: 4 }),
      // 两个未追回行：不产生声明、不计入 candidates。
      row({ questionId: 'q-4', status: 'not_recovered', observedLossWithReattemptSuccess: 0, observedLossOutstanding: 10 }),
      row({ questionId: 'q-5', status: 'awaiting_reattempt', observedLossWithReattemptSuccess: 0, observedLossOutstanding: 5 }),
    ],
    minSamples: 3,
    nodeNameById: new Map(),
  });
  assert.equal(result.claims.length, 3);
  assert.equal(result.summary.recoveredCandidates, 3);
  assert.equal(result.summary.observedRecovered, 20);
});

test('语义脚注固定输出（RULE-11）', async () => {
  const { RECOVERY_CLAIM_FOOTNOTE } = await loadModule();
  assert.match(RECOVERY_CLAIM_FOOTNOTE, /测量值/);
  assert.match(RECOVERY_CLAIM_FOOTNOTE, /不是成绩预测/);
});
