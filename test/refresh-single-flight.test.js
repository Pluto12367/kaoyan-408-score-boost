import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadRefreshGate() {
  const source = await readFile(new URL('../apps/web/src/api/refreshGate.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

test('concurrent 401 callers share a single refresh request', async () => {
  const { refreshSessionOnce, hasRefreshInFlight } = await loadRefreshGate();
  let calls = 0;
  let resolveRefresh = () => {};
  const refresh = (token) => {
    calls += 1;
    return new Promise((resolve) => {
      resolveRefresh = () => resolve({ token: `new-${token}` });
    });
  };

  const first = refreshSessionOnce('rt-1', refresh);
  const second = refreshSessionOnce('rt-1', refresh);

  assert.equal(calls, 1, 'refresh must be invoked exactly once for concurrent callers');
  assert.equal(hasRefreshInFlight(), true, 'gate should report an in-flight refresh');

  resolveRefresh();
  const [sessionA, sessionB] = await Promise.all([first, second]);
  assert.equal(sessionA.token, 'new-rt-1');
  assert.equal(sessionB.token, 'new-rt-1');
  assert.equal(hasRefreshInFlight(), false, 'gate must be released after refresh settles');
});

test('a failed refresh releases the gate so the next caller retries', async () => {
  const { refreshSessionOnce, hasRefreshInFlight } = await loadRefreshGate();
  let calls = 0;
  const refresh = async () => {
    calls += 1;
    if (calls === 1) throw new Error('refresh token revoked');
    return { token: 'ok' };
  };

  await assert.rejects(refreshSessionOnce('rt-1', refresh), /revoked/);
  assert.equal(hasRefreshInFlight(), false, 'failed refresh must not leave the gate locked');

  const session = await refreshSessionOnce('rt-1', refresh);
  assert.equal(session.token, 'ok');
  assert.equal(calls, 2, 'a later caller may retry after a failed refresh');
});

test('client.ts routes the 401 refresh through the single-flight gate', async () => {
  const source = await readFile(new URL('../apps/web/src/api/client.ts', import.meta.url), 'utf8');
  assert.match(source, /import \{[^}]*refreshSessionOnce[^}]*\} from '\.\/refreshGate';/, 'client should import the refresh gate');
  assert.match(
    source,
    /refreshed = await refreshSessionOnce\(session\.refreshToken, refreshAuthSession\);/,
    '401 refresh must go through the single-flight gate',
  );
});

test('failed refresh only clears the session when no concurrent refresh replaced it', async () => {
  const source = await readFile(new URL('../apps/web/src/api/client.ts', import.meta.url), 'utf8');
  const failureBlock = source.slice(source.indexOf('} catch {', source.indexOf('canUseCurrentSession')));
  assert.match(failureBlock, /getActiveAuthSession\(\)/, 'failure path should re-check the stored session');
  assert.match(
    failureBlock,
    /if \(afterToken === usedToken\)/,
    'only clear the session when the token used for the failed request is still active',
  );
});

test('useAuth session restore and auto-refresh share the single-flight gate', async () => {
  const source = await readFile(new URL('../apps/web/src/hooks/useAuth.ts', import.meta.url), 'utf8');
  assert.match(source, /import \{[^}]*refreshSessionOnce[^}]*\} from '\.\.\/api\/refreshGate';/, 'useAuth should import the refresh gate');
  assert.match(source, /refreshSessionOnce\(stored\.refreshToken, refreshAuthSession\)/, 'mount restore must use the gate');
  assert.match(source, /refreshSessionOnce\(authSession\.refreshToken!, refreshAuthSession\)/, 'auto-refresh must use the gate');
  assert.doesNotMatch(
    source.slice(source.indexOf('// Restore session on mount')),
    /refreshAuthSession\(stored\.refreshToken\)/,
    'mount restore must not call refresh directly',
  );
});
