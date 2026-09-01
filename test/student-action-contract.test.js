import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadModule(path) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

const validActions = [
  { id: 'a-today', type: 'today_task', title: 'Today', destination: 'practice', source: 'today-plan', context: { taskId: 'task-1' } },
  { id: 'a-review', type: 'review_due', title: 'Review', destination: 'review', source: 'review-due', context: { questionId: 'question-1' } },
  { id: 'a-knowledge', type: 'knowledge_explore', title: 'Explore', destination: 'knowledge', source: 'knowledge', context: { knowledgeNodeId: 'node-1' } },
  { id: 'a-assessment', type: 'assessment_review', title: 'Assessment review', destination: 'test', source: 'assessment', context: { assessmentId: 'assessment-1', questionId: 'question-1' } },
  { id: 'a-session', type: 'continue_session', title: 'Continue', destination: 'practice', source: 'session', context: { sessionId: 'session-1' } },
];

const pureActionModules = [
  'apps/web/src/features/student/actions/studentAction.ts',
  'apps/web/src/features/student/actions/studentActionDestination.ts',
  'apps/web/src/features/student/actions/studentActionCommand.ts',
  'apps/web/src/features/student/actions/actionCandidates.ts',
  'apps/web/src/features/student/actions/canonicalNextAction.ts',
  'apps/web/src/features/student/actions/adapters/todayActionAdapter.ts',
  'apps/web/src/features/student/actions/adapters/reviewActionAdapter.ts',
  'apps/web/src/features/student/actions/adapters/knowledgeActionAdapter.ts',
  'apps/web/src/features/student/actions/adapters/assessmentActionAdapter.ts',
  'apps/web/src/features/student/actions/adapters/reportActionAdapter.ts',
  'apps/web/src/features/student/actions/adapters/sessionActionAdapter.ts',
  'apps/web/src/features/student/actions/adapters/trainingActionAdapter.ts',
];

test('StudentAction contract accepts representative actions and rejects invalid boundaries', async () => {
  const { isStudentAction } = await loadModule('apps/web/src/features/student/actions/studentAction.ts');

  for (const action of validActions) assert.equal(isStudentAction(action), true);
  assert.equal(isStudentAction({ ...validActions[0], destination: 'home', priority: '高' }), true, 'today task may use home and source priority string');
  assert.equal(isStudentAction({ id: 'a-review-fallback', type: 'redo_wrong_question', title: 'Fallback review', destination: 'review', source: 'wrong-summary-fallback', context: { questionId: 'question-fallback' } }), true, 'review fallback keeps its lower-authority source');
  assert.equal(isStudentAction({ ...validActions[0], priority: false }), false, 'priority must remain a primitive number or string');
  assert.equal(isStudentAction({ ...validActions[0], context: {} }), false, 'required ID must be present');
  assert.equal(isStudentAction({ id: 'unknown', title: 'Unknown' }), false, 'field-only object must be rejected');
  assert.equal(isStudentAction({ ...validActions[0], context: { taskId: () => 'task-1' } }), false, 'function values are not IDs');
  assert.equal(isStudentAction({ ...validActions[0], context: { taskId: Promise.resolve('task-1') } }), false, 'Promise values are not IDs');
  assert.equal(isStudentAction({ ...validActions[0], context: { taskId: 'task-1', repository: { get: () => null } } }), false, 'repository values must be rejected');
  assert.equal(isStudentAction({ ...validActions[0], context: { taskId: 'task-1', persistence: { table: 'tasks' } } }), false, 'persistence values must be rejected');
  assert.equal(isStudentAction({ ...validActions[0], context: { taskId: 'task-1', nested: { ok: true } } }), true, 'plain data extensions are allowed');
  assert.equal(isStudentAction({ ...validActions[0], destination: 'ai' }), false, 'only coach_explain may target ai');
  assert.equal(isStudentAction({ ...validActions[0], source: 'assessment' }), false, 'today_task cannot use assessment source');
  assert.equal(isStudentAction({ ...validActions[2], source: 'coach' }), false, 'knowledge_explore cannot use coach source');
  assert.equal(isStudentAction({ ...validActions[3], destination: 'review' }), false, 'assessment review must target test');
  assert.equal(isStudentAction({ id: 'a-report', type: 'open_report', title: 'Report', destination: 'home', source: 'report', context: { reportId: 'report-1' } }), false, 'reports must target test');

  const source = await readFile(new URL('../apps/web/src/features/student/actions/studentAction.ts', import.meta.url), 'utf8');
  for (const forbidden of ['api/', 'React', 'Callback', 'Repository', 'Prisma', 'localStorage', 'fetch(']) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be imported or referenced`);
  }
});

test('pure action modules keep API and state boundaries out of runtime action data', async () => {
  for (const path of pureActionModules) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    const runtimeImports = (source.match(/^\s*import(?!\s+type\b)[^\n]*$/gm) ?? []).join('\n');

    assert.doesNotMatch(runtimeImports, /api(?:\/|['"])/i, `${path} must not have a runtime API import`);
    for (const forbidden of [
      /\bRecommendationService\b/i,
      /\bStudentState(?:Store|Service|Repository|Writer)?\b/i,
      /\b(?:write|save|persist|update)StudentState\b/i,
      /\b(?:build|calculate|compute|derive|rank|score)(?:Mastery|ReviewPriority|WrongReviewPriority)\b/i,
      /\bfetch\s*\(/i,
      /\blocalStorage\b/i,
      /\buse(?:State|Effect|Reducer|Callback|Memo)\b/i,
      /\bon(?:Click|Navigate|Select|Review|Redo|Practice)\b/i,
    ]) {
      assert.doesNotMatch(source, forbidden, `${path} must remain a pure action data module`);
    }
  }
});
