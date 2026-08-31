import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadModule(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    if (specifier in dependencies) return dependencies[specifier];
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

test('maps every canonical student action destination to its role section', async () => {
  const { toRoleSection } = await loadModule('apps/web/src/features/student/actions/studentActionDestination.ts');

  assert.deepEqual(Object.fromEntries([
    ['home', toRoleSection('home')],
    ['practice', toRoleSection('practice')],
    ['knowledge', toRoleSection('knowledge')],
    ['review', toRoleSection('review')],
    ['test', toRoleSection('test')],
    ['ai', toRoleSection('ai')],
  ]), {
    home: 'dashboard',
    practice: 'question',
    knowledge: 'knowledge-catalog',
    review: 'wrong-book',
    test: 'test',
    ai: 'ai',
  });
});

test('recognizes only canonical destinations and rejects legacy aliases', async () => {
  const { isStudentActionDestination } = await loadModule('apps/web/src/features/student/actions/studentActionDestination.ts');

  for (const value of ['home', 'practice', 'knowledge', 'review', 'test', 'ai']) {
    assert.equal(isStudentActionDestination(value), true);
  }
  for (const value of ['plan', 'score-center', 'report', '', null, 1, {}]) {
    assert.equal(isStudentActionDestination(value), false, `${String(value)} is not canonical`);
  }
});

test('preserves navigation-edge normalization for legacy aliases', async () => {
  const lucide = new Proxy({}, { get: () => function Icon() { return null; } });
  const { normalizeRoleSection } = await loadModule('apps/web/src/layouts/RoleNavigation.tsx', {
    'lucide-react': lucide,
  });

  assert.equal(normalizeRoleSection('plan'), 'dashboard');
  assert.equal(normalizeRoleSection('score-center'), 'dashboard');
  assert.equal(normalizeRoleSection('report'), 'test');
  assert.equal(normalizeRoleSection('question'), 'question');
});

test('keeps ai exclusive to explicit coach explain actions', async () => {
  const { isStudentAction } = await loadModule('apps/web/src/features/student/actions/studentAction.ts');
  const { isStudentActionDestination, toRoleSection } = await loadModule('apps/web/src/features/student/actions/studentActionDestination.ts');
  const aiAction = {
    id: 'coach-1',
    type: 'coach_explain',
    title: 'Explain this question',
    destination: 'ai',
    source: 'coach',
    context: { questionId: 'question-1' },
  };

  assert.equal(isStudentAction(aiAction), true);
  assert.equal(isStudentAction({
    id: 'today-ai-1',
    type: 'today_task',
    title: 'Today task',
    destination: 'ai',
    source: 'today-plan',
    context: { taskId: 'task-1' },
  }), false);
  assert.equal(aiAction.type, 'coach_explain');
  assert.equal(aiAction.source, 'coach');
  assert.equal(aiAction.context.questionId, 'question-1');
  assert.equal(isStudentActionDestination('home'), true);
  assert.equal(toRoleSection('home'), 'dashboard');
  assert.notEqual(aiAction.destination, 'home');
});

test('loads the destination mapping without React or API runtime dependencies', async () => {
  const source = await readFile(new URL('../apps/web/src/features/student/actions/studentActionDestination.ts', import.meta.url), 'utf8');

  for (const forbidden of ['React', 'react', 'api/', 'fetch(', 'localStorage']) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be referenced`);
  }
  await loadModule('apps/web/src/features/student/actions/studentActionDestination.ts');
});
