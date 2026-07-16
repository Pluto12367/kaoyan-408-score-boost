import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadStudyDate() {
  const source = await readFile(new URL('../apps/api/src/study/study-date.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

test('study date follows the configured learning timezone', async () => {
  const { studyDateKey } = await loadStudyDate();

  assert.equal(studyDateKey('2026-07-15T16:30:00.000Z', 'Asia/Shanghai'), '2026-07-16');
  assert.equal(studyDateKey('2026-07-15T16:30:00.000Z', 'UTC'), '2026-07-15');
});

test('date-only values retain their calendar date', async () => {
  const { studyDateKey } = await loadStudyDate();

  assert.equal(studyDateKey('2026-07-16', 'Asia/Shanghai'), '2026-07-16');
  assert.equal(studyDateKey('2026-07-16', 'America/Los_Angeles'), '2026-07-16');
});
