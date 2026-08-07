import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');
const { AuthService } = require('../apps/api/src/auth/auth.service.ts');
const { ForbiddenException } = require('@nestjs/common');

function createAuthService(findUnique) {
  return new AuthService(
    { user: { findUnique } },
    {},
  );
}

function withEnv(env, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('Case A: demo mode with no DATABASE_URL lets a matching teacher token through without a DB query', async () => {
  await withEnv({ DATABASE_URL: undefined, ALLOW_DEMO_AUTH: 'true' }, async () => {
    const auth = createAuthService(() => {
      throw new Error('database must not be queried in demo/in-memory mode');
    });
    const { token } = auth.demoLogin('teacher');
    const profile = await auth.requireRole(`Bearer ${token}`, ['teacher'], '/teacher/questions');
    assert.equal(profile.role, 'teacher');
    assert.equal(profile.id, 'teacher-001');
  });
});

test('Case B: demo mode still rejects a student token on a teacher-only route', async () => {
  await withEnv({ DATABASE_URL: undefined, ALLOW_DEMO_AUTH: 'true' }, async () => {
    const auth = createAuthService(() => {
      throw new Error('database must not be queried in demo/in-memory mode');
    });
    const { token } = auth.demoLogin('student');
    await assert.rejects(
      auth.requireRole(`Bearer ${token}`, ['teacher'], '/teacher/questions'),
      /Current role cannot access this resource/,
    );
  });
});

test('Case C: with DATABASE_URL set, requireRole keeps the database-backed account check', async () => {
  await withEnv({ DATABASE_URL: 'postgresql://example', ALLOW_DEMO_AUTH: 'true' }, async () => {
    let queried = false;
    const auth = createAuthService(async () => {
      queried = true;
      return { accountStatus: 'ACTIVE', mustChangePassword: false };
    });
    const { token } = auth.demoLogin('teacher');
    const profile = await auth.requireRole(`Bearer ${token}`, ['teacher'], '/teacher/questions');
    assert.equal(queried, true, 'database-backed check must still run in normal mode');
    assert.equal(profile.role, 'teacher');
    assert.equal(profile.accountStatus, 'active');

    const disabledAuth = createAuthService(async () => ({ accountStatus: 'DISABLED', mustChangePassword: false }));
    await assert.rejects(
      disabledAuth.requireRole(`Bearer ${token}`, ['teacher'], '/teacher/questions'),
      (error) => error instanceof ForbiddenException,
      'disabled account must be rejected in database mode',
    );
  });
});

test('Case D: without ALLOW_DEMO_AUTH a missing database must not silently fall back', async () => {
  const token = withEnv({ DATABASE_URL: undefined, ALLOW_DEMO_AUTH: 'true' }, () => {
    const auth = createAuthService(() => {
      throw new Error('unused');
    });
    return auth.demoLogin('teacher').token;
  });

  await withEnv({ DATABASE_URL: undefined, ALLOW_DEMO_AUTH: undefined }, async () => {
    const auth = createAuthService(async () => {
      throw new Error('real database error must propagate');
    });
    await assert.rejects(
      auth.requireRole(`Bearer ${token}`, ['teacher'], '/teacher/questions'),
      /real database error must propagate/,
    );
  });
});
