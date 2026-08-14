import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('wrong-question detail resolves knowledge point titles through the catalog display map', () => {
  const source = readFileSync('apps/api/src/study/study.service.ts', 'utf8');
  assert.match(source, /getWrongQuestionDetail[\s\S]*resolveKnowledgePointDisplay/);
  assert.match(source, /knowledgePointTitle: display\?\.title \|\| point\?\.title \|\| '未知考点'/);
  assert.doesNotMatch(source, /getWrongQuestionDetail[\s\S]{0,900}knowledgePointTitle: point\?\.title \?\? '未知考点'/);
});

test('wrong-question detail resolves from the latest practice record binding to stay consistent with the list', () => {
  const source = readFileSync('apps/api/src/study/study.service.ts', 'utf8');
  const block = source.slice(source.indexOf('getWrongQuestionDetail'), source.indexOf('getWrongQuestionDetail') + 900);
  assert.match(block, /latestRecord\?\.knowledgePointId \?\? question\?\.knowledgePointIds\[0\]/);
});

test('practice answer feedback resolves knowledge point titles through the catalog display map', () => {
  const source = readFileSync('apps/api/src/study/study.service.ts', 'utf8');
  assert.match(source, /getPracticeFeedback[\s\S]*resolveKnowledgePointDisplay/);
  assert.match(source, /knowledgePointTitle: display\?\.title \|\| knowledgePoint\?\.title \|\| ''/);
});

test('wrong-question detail view renders the resolved knowledge point title', () => {
  const source = readFileSync('apps/web/src/components/WrongQuestionDetail.tsx', 'utf8');
  assert.match(source, /detail\.knowledgePointTitle/);
  assert.match(source, /<h3>\{detail\.knowledgePointTitle\}<\/h3>/);
});
