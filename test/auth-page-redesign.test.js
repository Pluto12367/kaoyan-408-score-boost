import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('auth brand row wraps the 408 orb with the product name', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /auth-brand-row/);
});

test('auth feature tags carry lucide icons and keep the feature grid class', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /auth-feature-grid/);
  assert.match(app, /<BookOpenCheck size=\{16\} \/>题库训练/);
  assert.match(app, /<ShieldCheck size=\{16\} \/>错题复盘/);
  assert.match(app, /<Target size=\{16\} \/>学情分析/);
  assert.match(app, /<Brain size=\{16\} \/>AI 辅助/);
});

test('styles upgrade the orb and feature tags', async () => {
  const styles = await source('apps/web/src/styles.css');
  assert.match(styles, /\.auth-orb \{[\s\S]*?box-shadow:[\s\S]*?rgb\(37 99 235/);
  assert.match(styles, /\.auth-feature-grid span \{[\s\S]*?border-radius:\s*999px/);
});
