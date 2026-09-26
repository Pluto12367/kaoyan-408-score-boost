// V14-P0 R2 — optionTrapView pure-helper contract (design §10.3).
//
// Mirrors the CodeBrick-verified presentation: the chosen option's trap comes
// first ("你为什么会选 X"), remaining traps follow ("其他选项为什么错");
// correct answers and unauthoured traps render nothing (never fabricated).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function loadTrapView() {
  const moduleSource = await source('apps/web/src/features/practice/optionTrapView.ts');
  const stripped = moduleSource.replace(/from '([^']*)'/g, (match, specifier) => {
    if (specifier.endsWith('.js') || specifier.startsWith('.')) return match;
    return "from './__stub__'";
  });
  const compiled = ts.transpileModule(stripped, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  // The helper imports a type-only symbol from the api endpoints module —
  // type imports vanish after transpile, so the stub import never fires.
  const runnable = compiled.replace(/import \{[^}]*\} from '\.\/__stub__';/g, '');
  return import(`data:text/javascript;base64,${Buffer.from(runnable).toString('base64')}`);
}

const baseResult = {
  id: 'r-1',
  correct: false,
  mistakeReason: '概念混淆',
  timeSpentSec: 40,
  expectedTimeSec: 100,
  analysis: '逐步核对。',
  correctAnswer: 'A',
  knowledgePointTitle: '线性表',
  selectedAnswer: 'B',
  optionAnalyses: {
    version: 1,
    traps: {
      B: '把表尾插入也算上了。',
      C: '把删除等同于移动。',
    },
  },
};

test('P0-TRAP wrong answer: chosen option trap first, remaining traps sorted after', async () => {
  const { selectOptionTraps, hasRenderableOptionTraps } = await loadTrapView();
  const selection = selectOptionTraps(baseResult);
  assert.deepEqual(selection.selected, { letter: 'B', text: '把表尾插入也算上了。' });
  assert.deepEqual(selection.others, [{ letter: 'C', text: '把删除等同于移动。' }]);
  assert.equal(hasRenderableOptionTraps(baseResult), true);
});

test('P0-TRAP correct answer never renders traps (蒙对也没有「你为什么会选」)', async () => {
  const { selectOptionTraps, hasRenderableOptionTraps } = await loadTrapView();
  const selection = selectOptionTraps({ ...baseResult, correct: true });
  assert.deepEqual(selection, { selected: null, others: [] });
  assert.equal(hasRenderableOptionTraps({ ...baseResult, correct: true }), false);
});

test('P0-TRAP unauthoured traps (null/absent/empty) render nothing — 未撰写 ≠ 伪造内容', async () => {
  const { selectOptionTraps, hasRenderableOptionTraps } = await loadTrapView();
  assert.deepEqual(selectOptionTraps({ ...baseResult, optionAnalyses: null }), { selected: null, others: [] });
  assert.deepEqual(selectOptionTraps({ ...baseResult, optionAnalyses: undefined }), { selected: null, others: [] });
  assert.deepEqual(selectOptionTraps({ ...baseResult, optionAnalyses: { version: 1, traps: {} } }), { selected: null, others: [] });
  assert.equal(hasRenderableOptionTraps({ ...baseResult, optionAnalyses: null }), false);
  assert.equal(hasRenderableOptionTraps(null), false);
});

test('P0-TRAP 蒙对场景（选了无陷阱的错项不可能；选对但没把握→correct 分支已覆盖）；selected 无陷阱时只列其他项', async () => {
  const { selectOptionTraps } = await loadTrapView();
  const selection = selectOptionTraps({ ...baseResult, selectedAnswer: 'D' });
  assert.equal(selection.selected, null);
  assert.deepEqual(selection.others, [
    { letter: 'B', text: '把表尾插入也算上了。' },
    { letter: 'C', text: '把删除等同于移动。' },
  ]);
});
