import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('auth gate delegates to the focused product experience', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /AuthExperience/);
  assert.doesNotMatch(app, /auth-brand-row/);
});

test('auth hero presents product metrics and the AI learning visual', async () => {
  const hero = await source('apps/web/src/features/auth/LoginHero.tsx');
  assert.match(hero, /408 OS/);
  assert.match(hero, /StatsCard/);
  assert.match(hero, /AIVisual/);
});

test('auth hero positions the product as an AI learning operating system', async () => {
  const hero = await source('apps/web/src/features/auth/LoginHero.tsx');
  assert.match(hero, /AI 驱动的 408 学习操作系统/);
  assert.match(hero, /基于 Student State 与 AI 推荐引擎/);
});

test('styles define tagline and trust copy', async () => {
  const styles = await source('apps/web/src/styles.css');
  assert.match(styles, /\.auth-tagline \{/);
  assert.match(styles, /\.auth-trust \{/);
  assert.match(styles, /\.auth-feature-grid span small \{/);
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

test('account panel shows the registration guide copy in register mode', async () => {
  const panel = await source('apps/web/src/features/auth/AccountPanel.tsx');
  assert.match(panel, /auth-register-guide/);
  assert.match(panel, /三步开始提分：填写邀请码 → 创建账号 → 完成入学诊断/);
});

test('styles define the registration guide', async () => {
  const styles = await source('apps/web/src/styles.css');
  assert.match(styles, /\.auth-register-guide \{/);
});

test('mobile styles stack the auth brand row and keep feature tags usable', async () => {
  const styles = await source('apps/web/src/styles.css');
  assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*?\.auth-brand-row \{[\s\S]*?flex-direction:\s*column/);
  assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*?\.auth-feature-grid \{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});

test('styles use the uploaded background image with a readable overlay', async () => {
  const styles = await source('apps/web/src/styles.css');
  const rule = styles.match(/\.auth-shell-redesign \{[\s\S]*?\}/)?.[0] ?? '';
  assert.match(rule, /url\('\/auth-bg\.jpg'\)/);
  assert.match(rule, /background-size:\s*auto,\s*cover/);
});
