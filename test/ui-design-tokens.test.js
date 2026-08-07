import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 2: primary/secondary/icon actions are defined and token-driven', async () => {
  const styles = await source('apps/web/src/styles.css');

  assert.match(styles, /\.primary-action \{/, 'the main CTA class must be styled (was missing before Phase 2)');
  assert.match(styles, /\.primary-action \{[\s\S]*?background: var\(--primary\)/, 'primary actions should use the primary token');
  assert.match(styles, /\.secondary-action \{[\s\S]*?background: var\(--primary-soft\)/, 'secondary actions should use the soft primary token');
  assert.match(styles, /\.icon-action \{/, 'icon actions should have a base style');
  assert.match(styles, /:focus-visible \{[^}]*outline: 2px solid var\(--primary\)/, 'keyboard focus must show a visible ring');
});

test('Phase 2: semantic tokens exist and shared chrome references them', async () => {
  const styles = await source('apps/web/src/styles.css');

  for (const token of ['--bg', '--surface', '--line', '--line-faint', '--text', '--text-muted', '--primary', '--primary-soft', '--primary-strong', '--radius', '--shadow-card']) {
    assert.match(styles, new RegExp(`${token.replace('--', '--')}: `), `token ${token} should be defined`);
  }
  assert.match(styles, /\.topbar,\s*\.panel,\s*\.metric \{[\s\S]*?background: var\(--surface\)/, 'panels should use the surface token');
  assert.match(styles, /\.sidebar \{[\s\S]*?background: var\(--slate-900\)/, 'the sidebar should use the dark token');
  assert.match(styles, /\.tag-list span \{[\s\S]*?background: var\(--primary-soft\)/, 'tags should use the soft primary token');
  assert.match(styles, /--muted: #64748b/, 'the previously undefined --muted token must now be defined');
});
