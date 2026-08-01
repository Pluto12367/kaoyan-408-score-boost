import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('admin question-import workspace exposes the operational review contract', async () => {
  const [navigation, admin, workspace, upload, review, api] = await Promise.all([
    source('apps/web/src/layouts/RoleNavigation.tsx'),
    source('apps/web/src/features/admin/AdminWorkspace.tsx'),
    source('apps/web/src/features/admin/question-import/QuestionImportWorkspace.tsx'),
    source('apps/web/src/features/admin/question-import/NewImportPanel.tsx'),
    source('apps/web/src/features/admin/question-import/CandidateReview.tsx'),
    source('apps/web/src/api/endpoints/question-import.ts'),
  ]);

  assert.match(navigation, /role === 'admin'[\s\S]*?#question-import/);
  assert.match(admin, /QuestionImportWorkspace/);
  assert.match(workspace, /2000[\s\S]*?4000[\s\S]*?10000/);
  assert.match(workspace, /clearTimeout/);
  assert.match(upload, /accept="\.xlsx,\.csv,\.pdf"/);
  assert.match(upload, /required[\s\S]*?source|source[\s\S]*?required/);
  assert.match(upload, /rightsConfirmed/);
  assert.match(upload, /第三方解析服务/);
  assert.match(upload, /<details/);
  assert.match(workspace, /localStorage/);
  assert.match(review, /仅显示异常/);
  assert.match(review, /skip/);
  assert.match(review, /new_version/);
  assert.match(review, /bulkApprove/);
  assert.match(workspace, /crypto\.randomUUID/);
  assert.match(review, /\\uFEFF/);
  assert.match(review, /确认导入/);
  assert.match(api, /authenticatedFetch/);
  assert.match(api, /new FormData/);
  assert.doesNotMatch(api, /Content-Type[^\n]*multipart/i);
});
