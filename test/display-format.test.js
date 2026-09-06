import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadDisplayFormat() {
  const source = await readFile(new URL('../apps/web/src/displayFormat.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('formatRatePercent rounds floats and never prints null/NaN', async () => {
  const { formatRatePercent } = await loadDisplayFormat();
  assert.equal(formatRatePercent(41.6462), '42%');
  assert.equal(formatRatePercent(0), '0%');
  assert.equal(formatRatePercent(null), '未评估');
  assert.equal(formatRatePercent(undefined), '未评估');
});

test('resolveScoreGapView treats target==estimate as trivially-met, not achieved', async () => {
  const { resolveScoreGapView } = await loadDisplayFormat();
  const flat = resolveScoreGapView(120, 120);
  assert.equal(flat.gap, 0);
  assert.equal(flat.reachedLabel, '--', '还差 cell must not render 0 分 as an achievement');
  assert.match(flat.guidance, /目标分与当前估分持平/);
});

test('resolveScoreGapView keeps meaningful gaps explicit', async () => {
  const { resolveScoreGapView } = await loadDisplayFormat();
  const gap = resolveScoreGapView(120, 340);
  assert.equal(gap.gap, 220);
  assert.equal(gap.reachedLabel, '220 分');
  assert.equal(gap.guidance, null);
});

test('resolveScoreGapView reports unknown scores as dashes', async () => {
  const { resolveScoreGapView } = await loadDisplayFormat();
  assert.deepEqual(resolveScoreGapView(undefined, 120), { gap: null, gapLabel: '--', reachedLabel: '--', guidance: null });
  assert.deepEqual(resolveScoreGapView(120, null), { gap: null, gapLabel: '--', reachedLabel: '--', guidance: null });
});
