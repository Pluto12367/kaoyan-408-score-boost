import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvironment } from '../scripts/validate-environment.mjs';

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:secret@db.internal:5432/kaoyan408',
  JWT_SECRET: 'a-secure-random-secret-that-is-long-enough',
  WEB_ORIGIN: 'https://study.408.test',
  VITE_API_BASE_URL: 'https://api.408.test',
  ALLOW_DEMO_AUTH: 'false',
};

test('accepts a complete production environment', () => {
  assert.deepEqual(validateEnvironment(production), []);
});

test('rejects unsafe production placeholders and demo auth', () => {
  const errors = validateEnvironment({
    ...production,
    DATABASE_URL: 'postgresql://user:password@example.com:5432/app',
    WEB_ORIGIN: 'http://example.com',
    ALLOW_DEMO_AUTH: 'true',
    VITE_ALLOW_MOCK: 'true',
  });
  assert.ok(errors.some((error) => error.includes('DATABASE_URL')));
  assert.ok(errors.some((error) => error.includes('ALLOW_DEMO_AUTH')));
  assert.ok(errors.some((error) => error.includes('WEB_ORIGIN must use HTTPS')));
  assert.ok(errors.some((error) => error.includes('VITE_ALLOW_MOCK')));
});
