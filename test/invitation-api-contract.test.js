import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('admin invitation controller is admin-only and never lists full codes', async () => {
  const source = await readFile(new URL('../apps/api/src/auth/admin-accounts.controller.ts', import.meta.url), 'utf8');
  assert.match(source, /@Controller\('admin'\)/);
  assert.match(source, /@UseGuards\(RoleGuard\)/);
  assert.match(source, /@Roles\('admin'\)/);
  assert.match(source, /@Get\('invitations'\)/);
  assert.match(source, /@Post\('invitations'\)/);
  assert.match(source, /@Post\('invitations\/:invitationId\/disable'\)/);
  assert.doesNotMatch(source, /listInvitations\([\s\S]*code:/);
});
