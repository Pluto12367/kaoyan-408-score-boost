import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// V12-M2b frontend — learning evidence ledger consumption.
// Honesty contracts pinned here:
//   • activity-only records never render as ability evidence
//   • the panel states when the system refuses to judge ability
//   • absence (no records / store down) is stated, never rendered as zero
//   • static demo renders nothing

const REPORT_DIR = new URL('../apps/web/src/features/report/', import.meta.url);
const readReport = (file) => readFile(new URL(file, REPORT_DIR), 'utf8');

test('report workspace mounts the learning evidence ledger on the overview tab', async () => {
  const workspace = await readFile(
    new URL('../apps/web/src/features/report/ReportWorkspace.tsx', import.meta.url),
    'utf8',
  );
  assert.match(workspace, /import \{ LearningEvidenceLedger \} from '\.\/LearningEvidenceLedger';/);
  assert.match(
    workspace,
    /<TaskEvidencePanel \/>\s*<LearningEvidenceLedger \/>/,
    'the ledger sits with the per-task evidence panel',
  );
});

test('the ledger labels evidence strength instead of implying uniform proof', async () => {
  const panel = await readReport('LearningEvidenceLedger.tsx');
  assert.match(panel, /观测证据/, 'strong observations are labelled');
  assert.match(panel, /自评证据/, 'self-reports are labelled as the weaker kind');
  assert.match(panel, /仅活动/, 'activity-only records are labelled as such');
  assert.match(panel, /strength-\$\{/, 'strength drives the rendered class');
});

test('the ledger states that only observed performance can support an ability claim', async () => {
  const panel = await readReport('LearningEvidenceLedger.tsx');
  assert.match(panel, /只有被系统观测到的作答/, 'the rule is user-visible');
});

test('the ledger surfaces the refusal to judge when no ability evidence exists', async () => {
  const panel = await readReport('LearningEvidenceLedger.tsx');
  assert.match(panel, /hasAbilityEvidence/, 'the refusal is driven by the projection, not by hope');
  assert.match(panel, /拒绝据此判断/, 'the refusal is stated in words');
});

test('an activity-only row never renders a capability number', async () => {
  const panel = await readReport('LearningEvidenceLedger.tsx');
  assert.match(
    panel,
    /canInfluenceMastery/,
    'rows must branch on whether the evidence may influence mastery',
  );
});

test('the ledger states absence instead of rendering it as zero', async () => {
  const panel = await readReport('LearningEvidenceLedger.tsx');
  assert.match(panel, /reason === 'store_unavailable'|store_unavailable/, 'store outage is explicit');
  assert.match(panel, /学习证据/, 'the panel names what it is showing');
});

test('the ledger renders nothing in static demo mode and states errors', async () => {
  const panel = await readReport('LearningEvidenceLedger.tsx');
  assert.match(panel, /isStaticDemoMode\(\)\) return null/);
  assert.match(panel, /加载失败/);
});

test('the ledger consumes the V12-M1 endpoint through the api layer', async () => {
  const panel = await readReport('LearningEvidenceLedger.tsx');
  assert.match(panel, /fetchLearningEvidence/);
  const endpoints = await readFile(
    new URL('../apps/web/src/api/endpoints/dashboard.ts', import.meta.url),
    'utf8',
  );
  assert.match(endpoints, /export async function fetchLearningEvidence/);
  assert.match(endpoints, /coach\/learning-evidence/);
});

test('ledger css consumes design tokens only', async () => {
  const css = await readReport('learning-ledger.css');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{6}\b/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3}\b/);
  assert.doesNotMatch(css, /rgba?\(/);
  assert.match(css, /var\(--space-/);
});
