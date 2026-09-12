import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// G1.6 — behaviour-pattern read model contract.
//
// The detectors themselves are pure and already covered by
// test/g1-guidance-protocol.test.js. What this file pins is the *boundary* of
// the one new backend read added by G1:
//   • self-only (resolveUserId discipline, same as every /coach/* endpoint)
//   • bounded reads (no unbounded table scans on a 2C2G box)
//   • zero writes — Guidance must never become a second state system (task §17)
//   • detection lives in the shared pure module, not re-implemented here

const SERVICE = new URL('../apps/api/src/study/practice-pattern.service.ts', import.meta.url);
const CONTROLLER = new URL('../apps/api/src/study/daily-brief.controller.ts', import.meta.url);

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('G1.6: the practice-pattern read model exists and is bounded', async () => {
  const source = stripComments(readFileSync(SERVICE, 'utf8'));
  assert.ok(source.length > 0, 'service file must exist');
  assert.match(source, /findMany\(/, 'it reads the existing tables');
  assert.match(source, /take:/, 'every list read must be bounded');
  assert.match(source, /DATABASE_URL/, 'it degrades honestly when the store is absent');
  assert.doesNotMatch(source, /createMany|\.create\(|\.update\(|\.delete\(|\.upsert\(/, 'no writes');
});

test('G1.6: detection is delegated to the shared pure module', async () => {
  const source = stripComments(readFileSync(SERVICE, 'utf8'));
  assert.match(source, /detectBehaviorSignals/, 'the shared detector must be the only implementation');
  assert.match(source, /BEHAVIOR_SIGNAL_IDS|BehaviorSignal/, 'the shared types are used, not re-declared');
});

test('G1.6: the endpoint is registered, self-only and never writes', async () => {
  const source = stripComments(readFileSync(CONTROLLER, 'utf8'));
  assert.match(source, /@Get\('coach\/practice-patterns'\)/, 'the route must be registered');
  const routeIndex = source.indexOf("@Get('coach/practice-patterns')");
  const handler = source.slice(routeIndex, routeIndex + 900);
  assert.match(handler, /@UseGuards\(RoleGuard\)/);
  assert.match(handler, /@Roles\('student'/);
  assert.match(handler, /resolveUserId\(user, viewUserId\)/, 'self-only resolution discipline');
});

test('G1.6: no fabricated reason or second state leaks through this read', async () => {
  const source = stripComments(readFileSync(SERVICE, 'utf8'));
  // The service must not invent thresholds; the shared module owns them.
  assert.doesNotMatch(source, />= 0\.5|>= 60|>= 3\b/, 'thresholds belong to BEHAVIOR_THRESHOLDS');
});
