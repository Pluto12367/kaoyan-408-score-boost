import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('knowledge detail exposes node-linked bank questions and real exam hits', () => {
  const service = readFileSync('apps/api/src/score-center/service.ts', 'utf8');
  const repository = readFileSync('apps/api/src/score-center/repository.ts', 'utf8');
  assert.match(service, /relatedQuestions/);
  assert.match(service, /examQuestions/);
  assert.match(repository, /loadRelatedQuestionsForNode/);
  assert.match(repository, /loadExamQuestionsForNode/);
});

test('catalog drawer shows node-linked bank questions and exam hits', () => {
  const catalog = readFileSync('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx', 'utf8');
  const drawer = readFileSync('apps/web/src/features/knowledge-catalog/KnowledgePointDetailDrawer.tsx', 'utf8');
  const api = readFileSync('apps/web/src/api/endpoints/score-center.ts', 'utf8');
  assert.match(api, /fetchKnowledgeDetail/);
  assert.match(catalog, /fetchKnowledgeDetail/);
  assert.match(drawer, /学习证据与建议/);
  assert.match(drawer, /考点题库/);
  assert.match(drawer, /真题命中/);
  assert.match(drawer, /前置知识/);
  assert.match(drawer, /相关知识/);
});

test('catalog drawer surfaces a structured evidence card block', () => {
  const drawer = readFileSync('apps/web/src/features/knowledge-catalog/KnowledgePointDetailDrawer.tsx', 'utf8');
  assert.match(drawer, /学习证据与建议/);
  assert.match(drawer, /buildKnowledgeEvidenceSummary/);
  assert.match(drawer, /catalog-evidence-grid/);
  assert.match(drawer, /catalog-evidence-card/);
  assert.match(drawer, /catalog-evidence-tone/);
  assert.match(drawer, /去练习/);
});

test('App wires catalog question practice into the existing redo flow', () => {
  const app = readFileSync('apps/web/src/App.tsx', 'utf8');
  assert.match(app, /onPracticeQuestion/);
});
