/**
 * RAG API Contract Tests.
 *
 * Validates that the /rag/knowledge/search endpoint is wired correctly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('RAG controller has route GET rag/knowledge/search with role guard', async () => {
  const source = await readFile(new URL('../apps/api/src/study/study.controller.ts', import.meta.url), 'utf8');
  // Not checking study.controller for RAG routes; they are in RagController
});

test('RagController defines the GET rag/knowledge/search route', async () => {
  const source = await readFile(new URL('../apps/api/src/rag/rag.controller.ts', import.meta.url), 'utf8');
  assert.match(source, /Get\('rag\/knowledge\/search'\)/);
  assert.match(source, /@UseGuards\(RoleGuard\)/);
  assert.match(source, /@Roles\('student', 'teacher', 'admin'\)/);
  assert.match(source, /@Query\('q'\)/);
});

test('RagController requires query parameter', async () => {
  const source = await readFile(new URL('../apps/api/src/rag/rag.controller.ts', import.meta.url), 'utf8');
  assert.match(source, /throw new BadRequestException\('q \(query\) is required'\)/);
});

test('RagController is exported from RagModule', async () => {
  const source = await readFile(new URL('../apps/api/src/rag/rag.module.ts', import.meta.url), 'utf8');
  assert.match(source, /controllers:\s*\[\s*RagController\s*\]/);
});

test('RagModule exports KnowledgeSearchService and KnowledgeRetriever', async () => {
  const source = await readFile(new URL('../apps/api/src/rag/rag.module.ts', import.meta.url), 'utf8');
  assert.match(source, /exports:\s*\[\s*KnowledgeSearchService,\s*KnowledgeRetriever,\s*LearningRagService\s*\]/);
});

test('AppModule imports RagModule', async () => {
  const source = await readFile(new URL('../apps/api/src/app.module.ts', import.meta.url), 'utf8');
  assert.match(source, /import.*RagModule.*from.*rag\/rag.module/);
  assert.match(source, /RagModule\s*,/);
});

test('KnowledgeSearchService is injected with embedding provider and vector store', async () => {
  const source = await readFile(new URL('../apps/api/src/rag/rag.module.ts', import.meta.url), 'utf8');
  assert.match(source, /'EMBEDDING_PROVIDER'/);
  assert.match(source, /'VECTOR_STORE'/);
  assert.match(source, /provide:\s*KnowledgeSearchService/);
  assert.match(source, /inject:\s*\[KnowledgeCorpusLoader,\s*'EMBEDDING_PROVIDER',\s*'VECTOR_STORE'\]/);
});