import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// V11-M2 frontend — learning evidence consumption contracts.
// Honesty: a completion marker alone never renders as capability gain;
// chips appear only for completed tasks with backend evidence; failures
// surface as explicit notes.

const REPORT_DIR = new URL('../apps/web/src/features/report/', import.meta.url);
const readReport = (file) => readFile(new URL(file, REPORT_DIR), 'utf8');

test('report workspace mounts the learning-evidence panel on the overview tab', async () => {
  const workspace = await readFile(new URL('../apps/web/src/features/report/ReportWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /import \{ TaskEvidencePanel \} from '\.\/TaskEvidencePanel';/);
  assert.match(
    workspace,
    /<ProgressStoryCard \/>\s*<TaskEvidencePanel \/>/,
    'evidence panel sits with the progress narrative on the overview tab',
  );
});

test('task evidence panel states the honesty contract and renders per-task facts', async () => {
  const panel = await readReport('TaskEvidencePanel.tsx');
  assert.match(panel, /完成标记不等于能力提升/, 'the honesty sentence is user-visible');
  assert.match(panel, /verdict-\$\{task\.verdict\}/, 'verdict classes derive from the projection');
  assert.match(panel, /能力提升/, 'improved verdict is user-visible');
  assert.match(panel, /证据不足/, 'insufficient-data verdict is stated, not hidden');
  assert.match(panel, /masteryDeltas/);
  assert.match(panel, /verdictBasis/, 'every verdict carries its basis');
  assert.match(panel, /isStaticDemoMode\(\) \) ? return null|isStaticDemoMode\(\)\) return null/, 'static demo renders nothing');
  assert.match(panel, /学习证据加载失败/, 'errors are explicit');
});

test('verdict css consumes tokens only', async () => {
  const css = await readFile(new URL('task-evidence.css', REPORT_DIR), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{6}\b/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3}\b/);
  assert.doesNotMatch(css, /rgba?\(/);
  assert.match(css, /var\(--space-/);
  assert.match(css, /var\(--primary/);
});
