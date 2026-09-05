import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');
const { ActionDomainError, toHttpActionError } = require('../apps/api/src/study/recommendation-action.service.ts');

test('action domain errors map to stable HTTP status codes', () => {
  assert.equal(toHttpActionError(new ActionDomainError('ACTION_NOT_FOUND')).getStatus(), 404);
  assert.equal(toHttpActionError(new ActionDomainError('ACTION_FORBIDDEN')).getStatus(), 403);
  assert.equal(toHttpActionError(new ActionDomainError('ACTION_VERSION_CONFLICT')).getStatus(), 409);
  assert.equal(toHttpActionError(new ActionDomainError('ACTION_INVALID_TRANSITION')).getStatus(), 409);
});
