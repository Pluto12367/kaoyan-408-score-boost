import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('App renders an authentication-first gate before the main workspace', async () => {
  const source = await readFile(new URL('../apps/web/src/App.tsx', import.meta.url), 'utf8');
  const gateIndex = source.indexOf('const shouldShowAuthGate');
  const returnIndex = source.indexOf('if (shouldShowAuthGate)');
  const navigationIndex = source.indexOf('<RoleNavigation role={sessionUser?.role} />');

  assert.notEqual(gateIndex, -1, 'App should compute whether the auth gate is active');
  assert.notEqual(returnIndex, -1, 'App should return the auth gate before the workspace');
  assert.notEqual(navigationIndex, -1, 'App should still render role navigation for authenticated users');
  assert.ok(returnIndex < navigationIndex, 'the auth gate must run before workspace navigation renders');
  assert.match(source, /isStaticDemoMode\(\) \|\| Boolean\(authSession\?\.refreshToken\)/);
});
