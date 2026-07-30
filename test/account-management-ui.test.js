import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('registration UI requires invitation code and admin UI exposes invitation management', async () => {
  const account = await readFile(new URL('../apps/web/src/features/auth/AccountPanel.tsx', import.meta.url), 'utf8');
  const admin = await readFile(new URL('../apps/web/src/features/admin/AdminWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(account, /name="inviteCode"/);
  assert.match(account, /邀请码|閭€璇风爜/);
  assert.match(admin, /InvitationManagementPanel/);
  assert.match(admin, /StudentAccountActions/);
});
