import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../apps/web/src/components/ui/', import.meta.url);
const source = (name) => readFile(new URL(name, root), 'utf8');

test('408 OS UI primitives exist and expose a small composable surface', async () => {
  const names = ['GlassCard.tsx', 'SurfaceCard.tsx', 'ProgressRing.tsx', 'EmptyState.tsx'];
  await Promise.all(names.map((name) => access(new URL(name, root))));

  const files = await Promise.all(names.map(source));
  const combined = files.join('\n');
  assert.match(combined, /className/);
  assert.doesNotMatch(combined, /#[0-9a-f]{3,8}/i, 'primitives should consume existing CSS tokens');
});

test('ProgressRing exposes progress semantics and clamps visual input', async () => {
  const progressRing = await source('ProgressRing.tsx');
  assert.match(progressRing, /role="progressbar"/);
  assert.match(progressRing, /aria-valuenow/);
  assert.match(progressRing, /Math\.min\(100, Math\.max\(0/);
});

test('EmptyState provides an explicit status region without inventing business data', async () => {
  const emptyState = await source('EmptyState.tsx');
  assert.match(emptyState, /role="status"/);
  assert.match(emptyState, /title/);
  assert.match(emptyState, /description/);
});

test('Design System documentation records the shared token and primitive contract', async () => {
  const documentation = await readFile(new URL('../docs/frontend-design-system.md', import.meta.url), 'utf8');
  for (const term of ['Color Token', 'Typography', 'Spacing', 'Radius', 'Shadow', 'Animation', 'GlassCard', 'ProgressRing', 'EmptyState']) {
    assert.match(documentation, new RegExp(term));
  }
});
