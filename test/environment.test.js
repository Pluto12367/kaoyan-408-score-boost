import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvironment } from '../scripts/validate-environment.mjs';

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:secret@db.internal:5432/kaoyan408',
  JWT_SECRET: 'a-secure-random-secret-that-is-long-enough',
  WEB_ORIGIN: 'https://study.408.test',
  VITE_API_BASE_URL: 'https://api.408.test',
  VITE_PUBLIC_BASE_PATH: '/',
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

test('rejects operation-log retention outside the supported range', () => {
  const errors = validateEnvironment({ ...production, AUDIT_LOG_RETENTION_DAYS: '2' });
  assert.ok(errors.some((error) => error.includes('AUDIT_LOG_RETENTION_DAYS')));
});

test('rejects an invalid frontend public base path', () => {
  const errors = validateEnvironment({ ...production, VITE_PUBLIC_BASE_PATH: 'kaoyan-408' });
  assert.ok(errors.some((error) => error.includes('VITE_PUBLIC_BASE_PATH')));
});

test('accepts an explicitly enabled HTTP IPv4 pilot with a same-origin API path', () => {
  const errors = validateEnvironment({
    ...production,
    WEB_ORIGIN: 'http://203.0.113.10',
    VITE_API_BASE_URL: '/api',
    ALLOW_INSECURE_HTTP_IP: 'true',
  });
  assert.deepEqual(errors, []);
});

test('does not let the pilot flag weaken ordinary HTTP domains', () => {
  const errors = validateEnvironment({
    ...production,
    WEB_ORIGIN: 'http://study.example.net',
    VITE_API_BASE_URL: '/api',
    ALLOW_INSECURE_HTTP_IP: 'true',
  });
  assert.ok(errors.some((error) => error.includes('WEB_ORIGIN')));
});

test('rejects HTTP IPv4 unless the temporary pilot flag is explicit', () => {
  const errors = validateEnvironment({
    ...production,
    WEB_ORIGIN: 'http://203.0.113.10',
    VITE_API_BASE_URL: '/api',
  });
  assert.ok(errors.some((error) => error.includes('WEB_ORIGIN')));
});
