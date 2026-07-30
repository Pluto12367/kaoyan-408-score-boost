import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedIpPilotOrigin, validateEnvironment } from '../scripts/validate-environment.mjs';

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
    WEB_ORIGIN: 'http://1.1.1.1',
    VITE_API_BASE_URL: '/api',
    ALLOW_INSECURE_HTTP_IP: 'true',
  });
  assert.deepEqual(errors, []);
});

test('rejects every non-public IPv4 range at the HTTP pilot boundary', () => {
  const nonPublicAddresses = [
    '0.0.0.0',
    '0.255.255.255',
    '01.1.1.1',
    '10.0.0.0',
    '10.255.255.255',
    '100.64.0.0',
    '100.127.255.255',
    '127.0.0.0',
    '127.255.255.255',
    '169.254.0.0',
    '169.254.255.255',
    '172.16.0.0',
    '172.31.255.255',
    '192.0.0.0',
    '192.0.0.255',
    '192.0.2.0',
    '192.0.2.255',
    '192.88.99.0',
    '192.88.99.255',
    '192.168.0.0',
    '192.168.255.255',
    '198.18.0.0',
    '198.19.255.255',
    '198.51.100.0',
    '198.51.100.255',
    '203.0.113.0',
    '203.0.113.255',
    '224.0.0.0',
    '239.255.255.255',
    '240.0.0.0',
    '255.255.255.255',
  ];

  for (const address of nonPublicAddresses) {
    assert.equal(
      isAllowedIpPilotOrigin(`http://${address}`, true),
      false,
      `${address} must not be accepted as a public pilot address`,
    );
  }
});

test('accepts public IPv4 addresses adjacent to excluded pilot ranges', () => {
  const publicAddresses = [
    '1.1.1.1',
    '100.63.255.255',
    '100.128.0.0',
    '169.253.255.255',
    '169.255.0.0',
    '172.15.255.255',
    '172.32.0.0',
    '192.0.1.255',
    '192.0.3.0',
    '198.17.255.255',
    '198.20.0.0',
    '223.255.255.255',
  ];

  for (const address of publicAddresses) {
    assert.equal(
      isAllowedIpPilotOrigin(`http://${address}`, true),
      true,
      `${address} must remain available as a public pilot address`,
    );
  }
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
    WEB_ORIGIN: 'http://1.1.1.1',
    VITE_API_BASE_URL: '/api',
  });
  assert.ok(errors.some((error) => error.includes('WEB_ORIGIN')));
});

test('rejects an HTTP IPv4 pilot origin with a non-default port', () => {
  const errors = validateEnvironment({
    ...production,
    WEB_ORIGIN: 'http://1.1.1.1:3000',
    VITE_API_BASE_URL: '/api',
    ALLOW_INSECURE_HTTP_IP: 'true',
  });
  assert.ok(errors.some((error) => error.includes('WEB_ORIGIN')));
});

test('rejects an HTTP IPv4 pilot origin with URL userinfo', () => {
  assert.equal(isAllowedIpPilotOrigin('http://user:password@1.1.1.1', true), false);
});
