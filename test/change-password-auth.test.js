import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('change password request must carry the bearer token', async () => {
  const source = await readFile(new URL('../apps/web/src/api/endpoints/auth.ts', import.meta.url), 'utf8');
  assert.match(source, /import \{[^}]*fetchWithAuth[^}]*\} from '\.\.\/client';/, 'auth endpoints should import fetchWithAuth');
  assert.match(
    source,
    /export async function changePassword[\s\S]*?fetchWithAuth\(`\$\{API_BASE_URL\}\/auth\/change-password`/,
    'changePassword must call the guarded endpoint through fetchWithAuth',
  );
  assert.doesNotMatch(
    source.slice(source.indexOf('changePassword')),
    /export async function changePassword[\s\S]*?return requestAuthSession\('\/auth\/change-password'\)/,
    'changePassword must not use the unauthenticated requestAuthSession helper',
  );
});
