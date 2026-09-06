import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// V8 backlog #7 — wrong-question counter semantics.
// canonical reviewStatus.pendingWrongQuestionCount counts UNRESOLVED rows
// (reviewed-but-unresolved included); legacy summary pendingCount counts
// NEVER-REVIEWED questions. The report must not label the former as 待复盘,
// which the mistakes page uses for the latter (0 vs 23 read as a contradiction
// in production).

test('report risk wording distinguishes unresolved (canonical) from never-reviewed (legacy)', () => {
  const source = readFileSync('apps/web/src/features/report/ReportSummaryPanel.tsx', 'utf8');

  assert.match(
    source,
    /risks\.push\(canonicalOverview\s*\?\s*`还有 \$\{pendingWrongCount\} 道错题尚未标记解决`\s*:\s*`还有 \$\{pendingWrongCount\} 道错题待复盘`\);/,
  );
  assert.match(
    source,
    /canonicalOverview\s*\?\s*`还有 \$\{pendingWrongCount\} 道错题尚未标记解决。`\s*:\s*`还有 \$\{pendingWrongCount\} 道错题待复盘，先把丢分点变成可修复动作。`/,
  );
});

test('mistakes workspace keeps its pendingCount (never-reviewed) wording', () => {
  const source = readFileSync('apps/web/src/features/mistakes/MistakeWorkspace.tsx', 'utf8');
  assert.match(source, /还有 \$\{summaryData\.pendingCount\} 道错题待复盘/);
});
