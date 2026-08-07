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

test('account panel exposes login/register segmented switch and invite hint', async () => {
  const panel = await source('apps/web/src/features/auth/AccountPanel.tsx');
  assert.match(panel, /auth-mode-switch/);
  assert.match(panel, /注册新账号/);
  assert.match(panel, /联系管理员获取邀请码/);
  assert.match(panel, /name="inviteCode"/);
});

test('styles define the segmented switch and invite hint', async () => {
  const styles = await source('apps/web/src/styles.css');
  assert.match(styles, /\.auth-mode-switch \{/);
  assert.match(styles, /\.auth-invite-hint \{/);
});

test('mobile styles stack the auth brand row and keep feature tags usable', async () => {
  const styles = await source('apps/web/src/styles.css');
  assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*?\.auth-brand-row \{[\s\S]*?flex-direction:\s*column/);
  assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*?\.auth-feature-grid span \{[\s\S]*?flex:\s*1 1 calc\(50% - 10px\)/);
});
