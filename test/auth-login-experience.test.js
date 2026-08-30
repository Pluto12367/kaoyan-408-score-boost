import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('App delegates the signed-out experience without changing auth handlers', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /AuthExperience/);
  assert.match(app, /onSubmit=\{handleAccountSubmit\}/);
  assert.match(app, /onPasswordChangeSubmit=\{handlePasswordChangeSubmit\}/);
  assert.match(app, /onToggleMode=\{\(\) => setAuthMode/);
});

test('login hero positions 408 OS as an AI learning operating system', async () => {
  const hero = await source('apps/web/src/features/auth/LoginHero.tsx');
  assert.match(hero, /408 OS/);
  assert.match(hero, /AI 驱动的 408 学习操作系统/);
  assert.match(hero, /Student State/);
  assert.match(hero, /AI 推荐引擎/);
  assert.match(hero, /<StatsCard value="152" label="距离考研"/);
  assert.match(hero, /<StatsCard value="87%" label="知识掌握"/);
  assert.match(hero, /<StatsCard value="3240" label="累计训练题"/);
  assert.match(hero, /<AIVisual/);
});

test('auth experience uses Motion with reduced-motion support and an isolated stylesheet', async () => {
  const experience = await source('apps/web/src/features/auth/AuthExperience.tsx');
  const card = await source('apps/web/src/features/auth/LoginCard.tsx');
  assert.match(experience, /from 'framer-motion'/);
  assert.match(experience, /useReducedMotion/);
  assert.match(card, /from 'framer-motion'/);
  assert.match(experience, /\.\/auth-experience\.css/);
  assert.doesNotMatch(experience, /styles\.css|theme-optimizations|themePreference/);
});

test('login card keeps account flows and presents the new product copy', async () => {
  const card = await source('apps/web/src/features/auth/LoginCard.tsx');
  const panel = await source('apps/web/src/features/auth/AccountPanel.tsx');
  assert.match(card, /variant="login-card"/);
  assert.match(panel, /欢迎回来，Explorer/);
  assert.match(panel, /继续你的 408 学习旅程/);
  assert.match(panel, /没有账号？/);
  assert.match(panel, /立即注册/);
  assert.match(panel, /name="email"/);
  assert.match(panel, /name="password"/);
  assert.match(panel, /mustChangePassword/);
});

test('isolated auth styles define the requested layout, glass card and responsive fallback', async () => {
  const styles = await source('apps/web/src/features/auth/auth-experience.css');
  assert.match(styles, /grid-template-columns:\s*minmax\(0,\s*45fr\)\s+minmax\(420px,\s*55fr\)/);
  assert.match(styles, /radial-gradient/);
  assert.match(styles, /backdrop-filter:\s*blur\(20px\)/);
  assert.match(styles, /max-width:\s*420px/);
  assert.match(styles, /border-radius:\s*24px/);
  assert.match(styles, /min-height:\s*48px/);
  assert.match(styles, /#6366f1/i);
  assert.match(styles, /#8b5cf6/i);
  assert.match(styles, /@media \(max-width:\s*900px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
});

test('the login experience does not couple to frozen theme worktree files', async () => {
  const files = await Promise.all([
    source('apps/web/src/features/auth/AuthExperience.tsx'),
    source('apps/web/src/features/auth/LoginHero.tsx'),
    source('apps/web/src/features/auth/LoginCard.tsx'),
    source('apps/web/src/features/auth/AIVisual.tsx'),
    source('apps/web/src/features/auth/AnimatedBackground.tsx'),
  ]);
  const combined = files.join('\n');
  for (const frozenName of ['PracticePanel', 'ExamSession', 'styles.css', 'theme-optimizations', 'themePreference']) {
    assert.doesNotMatch(combined, new RegExp(frozenName));
  }
});
