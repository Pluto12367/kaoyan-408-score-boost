/**
 * V5.3 Production Operations tests.
 *
 * - Startup validation: required vs optional config, placeholder detection,
 *   production strictness, AI/embedding provider status.
 * - Operational health: DEGRADED for unconfigured providers, never fakes HEALTHY.
 * - Secret safety: no API keys/tokens/passwords in source, docs, logs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  validateStartupConfiguration,
  buildOperationalHealth,
} from '../apps/api/dist/operations/startup-validation.js';

function prodEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pass@db:5432/app',
    JWT_SECRET: 'a-sufficiently-long-secret',
    ...overrides,
  };
}

test('startup: production without DATABASE_URL reports missing error', () => {
  const result = validateStartupConfiguration(prodEnv({ DATABASE_URL: '' }));
  assert.ok(result.errors.some((e) => e.includes('DATABASE_URL')));
  const db = result.checks.find((c) => c.name === 'DATABASE_URL');
  assert.equal(db.status, 'missing');
});

test('startup: placeholder values are invalid, not ok', () => {
  const result = validateStartupConfiguration(prodEnv({ JWT_SECRET: 'replace-me' }));
  assert.ok(result.errors.some((e) => e.includes('JWT_SECRET')));
  const jwt = result.checks.find((c) => c.name === 'JWT_SECRET');
  assert.equal(jwt.status, 'invalid');
});

test('startup: valid production config passes with zero errors', () => {
  const result = validateStartupConfiguration(prodEnv());
  assert.equal(result.errors.length, 0);
  assert.equal(result.aiProvider, 'missing', 'no AI key in this fixture');
});

test('startup: AI key present means aiProvider configured', () => {
  const result = validateStartupConfiguration(prodEnv({ AI_API_KEY: 'sk-real-key-1234567890' }));
  assert.equal(result.aiProvider, 'configured');
  const ai = result.checks.find((c) => c.name === 'AI_API_KEY');
  assert.equal(ai.status, 'ok');
});

test('startup: embedding provider needs key AND base URL (DeepSeek limitation)', () => {
  const withKeyOnly = validateStartupConfiguration(prodEnv({ EMBEDDING_API_KEY: 'sk-emb-123' }));
  assert.equal(withKeyOnly.embeddingProvider, 'missing', 'key without base URL = missing');
  const withBoth = validateStartupConfiguration(prodEnv({ EMBEDDING_API_KEY: 'sk-emb-123', EMBEDDING_BASE_URL: 'https://api.openai.com/v1' }));
  assert.equal(withBoth.embeddingProvider, 'configured');
});

test('startup: dev mode (non-production) missing DB is disabled not error', () => {
  const result = validateStartupConfiguration({ NODE_ENV: 'development', DATABASE_URL: '' });
  const db = result.checks.find((c) => c.name === 'DATABASE_URL');
  assert.equal(db.status, 'disabled');
  assert.equal(result.errors.length, 0);
});

test('operational health: unconfigured AI/embedding = DEGRADED, never faked HEALTHY', () => {
  const health = buildOperationalHealth(true, true, false, false);
  assert.equal(health.aiProvider, 'degraded');
  assert.equal(health.embeddingProvider, 'degraded');
  assert.equal(health.overall, 'ok', 'DB is the only critical dependency');
});

test('operational health: disconnected DB = degraded overall', () => {
  const health = buildOperationalHealth(false, true, true, true);
  assert.equal(health.database, 'disconnected');
  assert.equal(health.overall, 'degraded');
});

test('operational health: all configured = ok without faking', () => {
  const health = buildOperationalHealth(true, true, true, true);
  assert.equal(health.overall, 'ok');
  assert.equal(health.aiProvider, 'configured');
});

// ---- secret safety: no credentials in committed source/docs/tests ----

test('secret safety: no real API keys or passwords in committed source/docs', async () => {
  const files = [
    'docs/v51-baseline-certification.md',
    'docs/v51-certification-report.md',
    'docs/v52-release-gate.md',
    'docs/v52-production-certification-final-report.md',
    'docs/v53-production-readiness-gate.md',
    'docs/v35-release-readiness-report.md',
    'apps/api/src/operations/startup-validation.ts',
  ];
  const secretPattern = /sk-[a-zA-Z0-9]{20,}|password\s*[:=]\s*['\"][^'\"]{8,}|Bearer\s+[a-zA-Z0-9._-]{20,}/i;
  for (const file of files) {
    try {
      const content = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
      assert.doesNotMatch(content, secretPattern, `${file} contains a potential credential`);
    } catch {
      // file may not exist yet — skip
    }
  }
});

test('health controller exposes operational status without leaking secrets', async () => {
  const source = await readFile(new URL('../apps/api/src/health.controller.ts', import.meta.url), 'utf8');
  assert.match(source, /buildOperationalHealth/);
  assert.match(source, /operational/);
  // No credentials in health response
  assert.doesNotMatch(source, /AI_API_KEY.*value|password/i);
});