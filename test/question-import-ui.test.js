import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('admin question-import workspace exposes the operational review contract', async () => {
  const [navigation, admin, workspace, upload, review, batches, api] = await Promise.all([
    source('apps/web/src/layouts/RoleNavigation.tsx'),
    source('apps/web/src/features/admin/AdminWorkspace.tsx'),
    source('apps/web/src/features/admin/question-import/QuestionImportWorkspace.tsx'),
    source('apps/web/src/features/admin/question-import/NewImportPanel.tsx'),
    source('apps/web/src/features/admin/question-import/CandidateReview.tsx'),
    source('apps/web/src/features/admin/question-import/ImportBatchList.tsx'),
    source('apps/web/src/api/endpoints/question-import.ts'),
  ]);

  assert.match(navigation, /role === 'admin'[\s\S]*?#question-import/);
  assert.match(admin, /QuestionImportWorkspace/);
  assert.match(workspace, /2000[\s\S]*?4000[\s\S]*?10000/);
  assert.match(workspace, /clearTimeout/);
  assert.match(workspace, /useRef/);
  assert.match(workspace, /startPolling/);
  assert.match(workspace, /const startPolling[\s\S]*?=> \{\s*if \(!mounted\.current\) return;/);
  assert.match(workspace, /loadBatches\(\)\.then\(\(batches\) => \{\s*if \(mounted\.current\) startPolling\(batches\);\s*\}\)/);
  assert.match(workspace, /startPolling\(batches\)/);
  assert.match(workspace, /mounted\.current = true;[\s\S]*?loadBatches\(\)\.then/);
  assert.match(workspace, /listImportCandidates\(selectedId, candidatePage\)/);
  assert.match(workspace, /getQuestionImport\(selectedId\)/);
  assert.match(upload, /accept="\.xlsx,\.csv,\.pdf"/);
  assert.match(upload, /required[\s\S]*?source|source[\s\S]*?required/);
  assert.match(upload, /rightsConfirmed/);
  assert.match(upload, /第三方解析服务/);
  assert.match(upload, /<details/);
  assert.match(workspace, /localStorage/);
  assert.match(review, /仅显示异常/);
  assert.match(review, /skip/);
  assert.match(review, /new_version/);
  assert.match(review, /onBulkApprove/);
  assert.match(review, /selectedIds/);
  assert.match(review, /保存编辑/);
  assert.match(review, /drafts/);
  assert.doesNotMatch(review, /onChange=\{\(event\) => onUpdate/);
  assert.match(workspace, /crypto\.randomUUID/);
  assert.match(review, /\\uFEFF/);
  assert.match(review, /确认导入/);
  assert.match(batches, /costSummary/);
  assert.match(batches, /providerSummary/);
  assert.match(upload, /后端尚未支持手动选择/);
  assert.match(api, /authenticatedFetch/);
  assert.match(api, /new FormData/);
  assert.doesNotMatch(api, /Content-Type[^\n]*multipart/i);
});
