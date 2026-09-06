import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// V8 backlog #10 — effectiveness read API consumption (first mile).
// The V6.3 endpoints exist but no page consumed them. The panel must be
// honest: gate-passed outcomes show gains, insufficient evidence never
// renders as a conclusion.

test('effectiveness endpoint wrapper hits the canonical summary route', () => {
  const endpoint = readFileSync('apps/web/src/api/endpoints/effectiveness.ts', 'utf8');
  assert.match(endpoint, /fetchWithAuth\(`\$\{API_BASE_URL\}\/effectiveness\/summary/);
  assert.match(endpoint, /windowDays/);
  assert.match(endpoint, /EvidenceGateResult|evidenceGate/);
  assert.match(endpoint, /averageMastery: number \| null|quality: 'ok' \| 'insufficient_data' \| 'single_attempt'/);
});

test('EffectivenessPanel renders gains only for gate-passed nodes and keeps insufficient_data honest', () => {
  const panel = readFileSync('apps/web/src/features/report/EffectivenessPanel.tsx', 'utf8');
  assert.match(panel, /fetchEffectivenessSummary/);
  assert.match(panel, /evidenceGate\.passed/);
  assert.match(panel, /证据不足/, 'blocked nodes must be explicitly named insufficient, not hidden');
  assert.match(panel, /相关不等于因果|相关不等于/, 'correlation disclaimer required');
  assert.match(panel, /let cancelled = false;/);
  assert.match(panel, /isStaticDemoMode/, 'demo mode short-circuits instead of faking data');
});

test('ReportWorkspace exposes the effectiveness tab', () => {
  const workspace = readFileSync('apps/web/src/features/report/ReportWorkspace.tsx', 'utf8');
  assert.match(workspace, /id: 'effectiveness', label: '努力与效果'/);
  assert.match(workspace, /<EffectivenessPanel \/>/);
});
