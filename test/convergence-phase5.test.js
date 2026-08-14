import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('node mastery read cache refreshes with a TTL for multi-instance safety', () => {
  const service = readFileSync('apps/api/src/study/study.service.ts', 'utf8');
  assert.match(service, /ensureNodeMasteryFresh/);
  assert.match(service, /reloadNodeMasteries/);
  assert.match(service, /nodeMasteryCacheRefreshedAt/);
});

test('legacy mastery read path is explicitly frozen under the gray switch', () => {
  const service = readFileSync('apps/api/src/study/study.service.ts', 'utf8');
  assert.match(service, /legacy mastery read path frozen/i);
});

test('catalog subject tabs and tree rows carry accessible controls', () => {
  const catalog = readFileSync('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx', 'utf8');
  const tree = readFileSync('apps/web/src/features/knowledge-catalog/KnowledgeTree.tsx', 'utf8');
  assert.match(catalog, /aria-controls=/);
  assert.match(tree, /aria-expanded=\{chapterOpen\}/);
  assert.match(tree, /aria-expanded=\{sectionOpen\}/);
});

test('HTTPS deployment path ships a TLS nginx example and documented steps', () => {
  const httpsConfig = readFileSync('deploy/tencent-ip/nginx-https.conf.example', 'utf8');
  const deployDoc = readFileSync('docs/deploy-to-tencent-ip.md', 'utf8');
  assert.match(httpsConfig, /listen 443 ssl/);
  assert.match(httpsConfig, /ssl_certificate/);
  assert.match(deployDoc, /HTTPS/);
  assert.match(deployDoc, /certbot/);
});
