import assert from 'node:assert/strict';
import test from 'node:test';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

test('API build keeps the established dist/main.js production entrypoint', async () => {
  const entrypoint = 'apps/api/dist/main.js';
  await assert.doesNotReject(access(entrypoint, constants.R_OK));
});
