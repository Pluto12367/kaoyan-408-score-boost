import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('wrong question exam link API carries nodes, frequency, exam hits and summary', async () => {
  const api = await source('apps/web/src/api/endpoints/review.ts');
  assert.match(api, /fetchWrongQuestionExamLinks/, 'review api should expose fetchWrongQuestionExamLinks');
  assert.match(api, /\/wrong-questions\/\$\{encodeURIComponent\(questionId\)\}\/exam-links/, 'endpoint path should hit the exam-links route');
  assert.match(api, /WrongQuestionExamLinks/, 'review api should carry the WrongQuestionExamLinks type');
  assert.match(api, /knowledgeNodes/, 'type should carry resolved knowledge nodes');
  assert.match(api, /examHits/, 'type should carry exam hits');
  assert.match(api, /frequency/, 'type should carry frequency evidence');
  assert.match(api, /summary/, 'type should carry the aggregate summary');
});

test('wrong question detail renders the exam-link block with summary, hits and catalog shortcut', async () => {
  const detail = await source('apps/web/src/components/WrongQuestionDetail.tsx');
  assert.match(detail, /fetchWrongQuestionExamLinks/, 'detail should load the exam link payload');
  assert.match(detail, /考点真题/, 'detail should render the exam-hit section');
  assert.match(detail, /近 3 年/, 'detail should show recent 3 year hits');
  assert.match(detail, /近 5 年/, 'detail should show recent 5 year hits');
  assert.match(detail, /真题累计/, 'detail should show the accumulated real-exam score');
  assert.match(detail, /暂无真题命中记录/, 'detail should show an honest empty state');
  assert.match(detail, /onOpenCatalog/, 'detail should offer opening the point in the catalog');
});

test('knowledge catalog accepts an external focus node to open its drawer', async () => {
  const catalog = await source('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx');
  assert.match(catalog, /focusNodeId/, 'catalog should accept an external focus node id');
  assert.match(catalog, /setSelectedPointId\(focusNodeId\)/, 'catalog should select the focused node');
  assert.match(catalog, /setActive\(/, 'catalog should switch subject for a cross-subject node');
});

test('app shell wires the wrong-question -> catalog focus bridge and keeps it optional', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /catalogFocusNodeId/, 'app should hold the catalog focus state');
  assert.match(app, /handleOpenCatalogNode|openCatalogNode/, 'app should navigate to the catalog with a focus node');
  assert.match(app, /focusNodeId=\{catalogFocusNodeId\}/, 'app should pass the focus node to the catalog');
});

test('score center exposes the wrong question exam-links route and service method', async () => {
  const routes = await source('apps/api/src/score-center/routes.ts');
  assert.match(routes, /wrong-questions\/:questionId\/exam-links/, 'score center routes should expose the exam-links endpoint');
  assert.match(routes, /getWrongQuestionExamLinks/, 'route should delegate to the score center service');
  const service = await source('apps/api/src/score-center/service.ts');
  assert.match(service, /async getWrongQuestionExamLinks/, 'score center service should resolve exam links');
  assert.match(service, /resolveKnowledgeNodesForQuestion/, 'service should resolve nodes through the attribution chain');
  const repository = await source('apps/api/src/score-center/repository.ts');
  assert.match(repository, /loadExamQuestionsForNodes/, 'repository should load exam questions for a set of nodes');
  assert.match(repository, /loadLatestFrequencyForNodes/, 'repository should load the latest frequency snapshots for nodes');
});