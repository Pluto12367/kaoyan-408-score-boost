import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');
const { invitationAvailability } = require('../apps/api/src/auth/invitation-policy.ts');

const now = new Date('2026-07-29T10:00:00.000Z');

test('invitationAvailability rejects disabled, expired and exhausted codes', () => {
  assert.equal(invitationAvailability({
    disabledAt: now,
    startsAt: now,
    expiresAt: new Date('2026-07-30T10:00:00.000Z'),
    usedCount: 0,
    maxUses: 1,
  }, now), 'disabled');
  assert.equal(invitationAvailability({
    disabledAt: null,
    startsAt: now,
    expiresAt: new Date('2026-07-29T09:00:00.000Z'),
    usedCount: 0,
    maxUses: 1,
  }, now), 'expired');
  assert.equal(invitationAvailability({
    disabledAt: null,
    startsAt: now,
    expiresAt: new Date('2026-07-30T10:00:00.000Z'),
    usedCount: 1,
    maxUses: 1,
  }, now), 'exhausted');
});
