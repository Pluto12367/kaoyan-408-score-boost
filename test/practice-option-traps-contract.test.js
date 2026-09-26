// V14-P0 R2 — trap-presentation wiring contract (design §10.3).
//
// Pins the DATA FLOW by source inspection (the repo's component-contract
// style): traps reach the student ONLY through the post-answer feedback merge;
// pre-submission surfaces stay stripped. Behavioural evidence lives in the
// real PG+HTTP E2E (scripts/integration-real-exam-import.mjs).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('P0-TRAP backend: getPracticeFeedback reads persisted traps and marks them post-answer-only', async () => {
  const service = await read('apps/api/src/study/study.service.ts');
  const feedback = service.slice(
    service.indexOf('async getPracticeFeedback'),
    service.indexOf('private async buildPracticeRecordResponse'),
  );
  assert.match(feedback, /select:\s*\{\s*optionAnalyses:\s*true\s*\}/, 'feedback reads the persisted column directly');
  assert.match(feedback, /optionAnalyses:\s*persistedTraps/);
  assert.match(feedback, /POST-ANSWER-only/, 'the safety invariant is stated where the read happens');
  // The pre-submission strip must be untouched: toStudentQuestion still strips.
  const view = await read('apps/api/src/questions/question-view.ts');
  assert.match(view, /optionAnalyses:\s*undefined/, 'student pre-submission strip guard stays in place');
});

test('P0-TRAP backend: both response merge points carry optionAnalyses (receipt path + controller fallback)', async () => {
  const service = await read('apps/api/src/study/study.service.ts');
  const merge = service.slice(
    service.indexOf('private async buildPracticeRecordResponse'),
    service.indexOf('private async markAnswerReceiptFailed'),
  );
  assert.match(merge, /optionAnalyses:\s*feedback\.optionAnalyses/);
  const controller = await read('apps/api/src/study/study.controller.ts');
  assert.match(controller, /optionAnalyses:\s*feedback\.optionAnalyses/);
});

test('P0-TRAP frontend: PracticePanel renders the chosen-option trap first, then other traps', async () => {
  const panel = await read('apps/web/src/features/practice/PracticePanel.tsx');
  assert.match(panel, /你为什么会选 \{traps\.selected\.letter\}/);
  assert.match(panel, /其他选项为什么错/);
  assert.match(panel, /hasRenderableOptionTraps\(answerResult\)/);
  const helper = await read('apps/web/src/features/practice/optionTrapView.ts');
  assert.match(helper, /result\?\.correct/, 'correct answers never render traps');
  const type = await read('apps/web/src/api/endpoints/practice.ts');
  assert.match(type, /optionAnalyses\?:\s*OptionAnalyses \| null/);
});
