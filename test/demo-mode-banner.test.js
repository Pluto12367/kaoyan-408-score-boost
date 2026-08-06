import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('P2-5: demo mode shows a prominent banner and an explicit API pill tooltip', async () => {
  const app = await readFile(new URL('../apps/web/src/App.tsx', import.meta.url), 'utf8');
  assert.match(
    app,
    /apiState === 'mock' \? \(\s*<div className="demo-mode-banner" role="status">/,
    'App should render the demo banner only in mock state',
  );
  assert.match(app, /生产环境不会出现此提示/, 'banner should explain the demo scope');

  const indicator = await readFile(new URL('../apps/web/src/components/ApiStateIndicator.tsx', import.meta.url), 'utf8');
  assert.match(
    indicator,
    /state === 'mock'[\s\S]*?演示模式：数据保存在本地，未连接真实后端/,
    'mock pill tooltip should state the demo limitation',
  );
});

test('P2-5: demo banner styling exists and production forbids mock fallback', async () => {
  const styles = await readFile(new URL('../apps/web/src/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.demo-mode-banner \{/, 'banner styles should exist');
  assert.match(styles, /\.api-pill\.mock \{\s*background: #fef3c7;\s*border: 1px dashed #d97706;/, 'mock pill should be visually distinct');

  const env = await readFile(new URL('../apps/web/src/api/env.ts', import.meta.url), 'utf8');
  assert.match(
    env,
    /Production — NEVER use mock data[\s\S]*?return false;/,
    'production must never fall back to demo data',
  );
});
