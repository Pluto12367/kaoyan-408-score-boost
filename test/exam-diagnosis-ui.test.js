import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// LE-V10 F2 — exam diagnosis frontend contracts. Honesty rules:
//   - estimates always labelled 估算 with the basis visible
//   - no target → no gap line; plan-not-generated → explicit hint + CTA pointer
//   - unattributed losses are counted, never silently dropped
//   - static demo mode renders nothing; errors are explicit text
//   - token-only styles (DESIGN.md §7)

const PANEL = new URL('../apps/web/src/features/report/ExamDiagnosisPanel.tsx', import.meta.url);

const readPanel = () => readFile(PANEL, 'utf8');

test('panel renders the 150 estimate with the mandatory 估算 badge and visible basis', async () => {
  const panel = await readPanel();
  assert.match(panel, /估算<\/span>/);
  assert.match(panel, /score150Estimate\.basis/);
  assert.match(panel, /置信度/);
  assert.match(panel, /subjectiveEarned/);
});

test('panel degrades honestly: no data sections get explicit notes, not fake numbers', async () => {
  const panel = await readPanel();
  assert.match(panel, /未携带分值口径/, 'no score basis → stated, never invented');
  assert.match(panel, /未设置目标分数/, 'no target → no gap line');
  assert.match(panel, /recoveryClosureReason === 'recovery_plan_not_generated'/);
  assert.match(panel, /生成考后复习任务/, 'points the student at the existing generate action');
  assert.match(panel, /nodeLossUnmappedCount/, 'unattributed losses are counted');
  assert.match(panel, /暂无真题数据/, 'no snapshot → 暂无真题数据 (never 0 次)');
});

test('panel is a self-fetching ambient-style surface with explicit errors', async () => {
  const panel = await readPanel();
  assert.match(panel, /fetchExamDiagnosis\(sessionId\)/);
  assert.match(panel, /isStaticDemoMode\(\) \) ? return null|isStaticDemoMode\(\)\) return null/, 'static demo renders nothing');
  assert.match(panel, /诊断加载失败/, 'errors are explicit text');
  assert.match(panel, /cancelled/, 'unmount cancels stale writes');
});

test('endpoint and types expose the diagnosis contract', async () => {
  const exam = await readFile(new URL('../apps/web/src/api/endpoints/exam.ts', import.meta.url), 'utf8');
  assert.match(exam, /fetchExamDiagnosis/);
  assert.match(exam, /exam\/diagnosis\/\$\{sessionId\}/);
  const types = await readFile(new URL('../apps/web/src/api/types.ts', import.meta.url), 'utf8');
  assert.match(types, /exam-diagnosis-v1/);
  assert.match(types, /recovery_plan_not_generated/);
});

test('panel mounts in the exam report dialog for students', async () => {
  const app = await readFile(new URL('../apps/web/src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /import \{ ExamDiagnosisPanel \} from '\.\/features\/report\/ExamDiagnosisPanel';/);
  assert.match(
    app,
    /<ExamReportView sessionId=\{examReportSessionId\}[^]*?<\/Suspense>\s*<ExamDiagnosisPanel sessionId=\{examReportSessionId\} \/>/,
    'diagnosis renders right under the exam report in the same dialog',
  );
});

test('diagnosis css consumes tokens only', async () => {
  const css = await readFile(new URL('../apps/web/src/features/report/exam-diagnosis.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{6}\b/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3}\b/);
  assert.doesNotMatch(css, /rgba?\(/);
  assert.match(css, /var\(--space-/);
  assert.match(css, /var\(--primary/);
});
