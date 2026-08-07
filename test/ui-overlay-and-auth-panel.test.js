import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Phase 0.1: the account panel only shows the login form when signed out', async () => {
  const panel = await readFile(new URL('../apps/web/src/features/auth/AccountPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /!props\.user && !props\.staticDemoMode/, 'login form should only render when there is no signed-in user');
  assert.doesNotMatch(panel, /!props\.hasRefreshToken && !props\.staticDemoMode/, 'the form must not depend on refresh-token presence');
  assert.match(
    panel,
    /props\.hasRefreshToken \|\| Boolean\(props\.user\)/,
    'a signed-in demo session should still offer logout',
  );
});

test('Phase 0.3: the error reason overlay closes with Escape and traps focus', async () => {
  const selector = await readFile(new URL('../apps/web/src/components/ErrorReasonSelector.tsx', import.meta.url), 'utf8');
  assert.match(selector, /useOverlayDialog\(\{ rootRef: overlayRef, onClose \}\)/, 'Escape should close the reason selector');
  assert.match(selector, /className="error-reason-overlay" role="dialog" aria-modal="true"/, 'overlay should expose dialog semantics');
});

test('Phase 0.3: the exam session closes the submit confirm first, then exits with a final save', async () => {
  const session = await readFile(new URL('../apps/web/src/components/ExamSession.tsx', import.meta.url), 'utf8');
  assert.match(
    session,
    /onClose: \(\) => \{\s*if \(showSubmitConfirm\) \{\s*setShowSubmitConfirm\(false\);/,
    'Escape should first dismiss the submit confirmation',
  );
  assert.match(session, /void handleExit\(\)/, 'Escape should exit through the save-then-exit path');
  assert.match(session, /getTrapRoot: \(\) => \(showSubmitConfirm \? confirmOverlayRef\.current : sessionRootRef\.current\)/, 'focus trap should follow the active dialog');
});

test('Phase 0.3: the exam report overlay closes with Escape via the shared dialog wrapper', async () => {
  const app = await readFile(new URL('../apps/web/src/App.tsx', import.meta.url), 'utf8');
  assert.match(
    app,
    /<OverlayDialog label="考试报告" onClose=\{\(\) => setExamReportSessionId\(null\)\}>/,
    'the exam report should render inside the Escape-enabled overlay',
  );
});
