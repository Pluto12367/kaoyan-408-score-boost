import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');

test('schema stores invitation redemption and account lifecycle state', () => {
  assert.match(schema, /enum AccountStatus\s*\{[\s\S]*ACTIVE[\s\S]*DISABLED[\s\S]*\}/);
  assert.match(schema, /model InvitationCode\s*\{[\s\S]*codeHash\s+String\s+@unique/);
  assert.match(schema, /maxUses\s+Int/);
  assert.match(schema, /usedCount\s+Int\s+@default\(0\)/);
  assert.match(schema, /model InvitationRedemption\s*\{[\s\S]*@@unique\(\[invitationCodeId,\s*userId\]\)/);
  assert.match(schema, /accountStatus\s+AccountStatus\s+@default\(ACTIVE\)/);
  assert.match(schema, /mustChangePassword\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /model AuditEvent\s*\{/);
});
