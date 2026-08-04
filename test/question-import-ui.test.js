import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('admin question-import workspace exposes the operational review contract', async () => {
  const [navigation, admin, workspace, upload, review, batches, api, sourcePreview, assetEditor, formulaPreview, types] = await Promise.all([
    source('apps/web/src/layouts/RoleNavigation.tsx'),
    source('apps/web/src/features/admin/AdminWorkspace.tsx'),
    source('apps/web/src/features/admin/question-import/QuestionImportWorkspace.tsx'),
    source('apps/web/src/features/admin/question-import/NewImportPanel.tsx'),
    source('apps/web/src/features/admin/question-import/CandidateReview.tsx'),
    source('apps/web/src/features/admin/question-import/ImportBatchList.tsx'),
    source('apps/web/src/api/endpoints/question-import.ts'),
    source('apps/web/src/features/admin/question-import/SourcePagePreview.tsx'),
    source('apps/web/src/features/admin/question-import/QuestionAssetEditor.tsx'),
    source('apps/web/src/features/admin/question-import/FormulaPreview.tsx'),
    source('apps/web/src/api/types.ts'),
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
  assert.match(workspace, /generateQuestionImportIdempotencyKey/);
  assert.doesNotMatch(workspace, /confirmQuestionImport\([\s\S]*crypto\.randomUUID\(\)/);
  assert.match(review, /\\uFEFF/);
  assert.match(review, /确认导入/);
  assert.match(review, /确认导入失败/);
  assert.match(review, /confirming/);
  assert.match(batches, /costSummary/);
  assert.match(batches, /providerSummary/);
  assert.match(upload, /后端尚未支持手动选择/);
  assert.match(api, /authenticatedFetch/);
  assert.match(api, /new FormData/);
  assert.doesNotMatch(api, /Content-Type[^\n]*multipart/i);
  assert.match(sourcePreview, /authenticatedFetch/);
  assert.match(sourcePreview, /URL\.createObjectURL/);
  assert.match(sourcePreview, /URL\.revokeObjectURL/);
  assert.match(sourcePreview, /原始 PDF 第.*页/);
  assert.match(sourcePreview, /sourceRegion/);
  assert.match(sourcePreview, /left:\s*`\$\{.*\.x \* 100\}%`/);
  assert.match(formulaPreview, /katex\.render\(latex,.*throwOnError:\s*false.*trust:\s*false.*strict:\s*'warn'/s);
  assert.match(formulaPreview, /公式 LaTeX/);
  assert.match(formulaPreview, /解析提示/);
  assert.match(assetEditor, /保留原图/);
  assert.match(assetEditor, /删除图片/);
  assert.match(assetEditor, /裁剪并上传/);
  assert.match(assetEditor, /canvas\.toBlob/);
  assert.match(assetEditor, /image\/png/);
  assert.match(assetEditor, /URL\.revokeObjectURL/);
  assert.match(review, /低置信度/);
  assert.match(review, /KeyboardEvent/);
  assert.match(review, /event\.key === 'ArrowRight'/);
  assert.match(review, /event\.key\.toLowerCase\(\) === 'a'/);
  assert.match(review, /assetIds:\s*_assetIds/);
  for (const field of ['options', 'answer', 'analysis', 'type', 'difficulty', 'source', 'year', 'expectedTimeSec', 'knowledgePointIds']) {
    assert.match(review, new RegExp(field), `review UI must edit ${field}`);
  }
  assert.match(review, /duplicateTarget/);
  assert.match(workspace, /retryQuestionImport/);
  assert.match(workspace, /cancelQuestionImport/);
  assert.match(upload, /downloadQuestionImportTemplate/);
  assert.doesNotMatch(upload, /href="\/admin\/question-imports\/templates/);
  assert.match(api, /getImportPagePreview/);
  assert.match(api, /uploadCandidateAsset/);
  assert.match(api, /deleteCandidateAsset/);
  assert.match(types, /sourceRegion\?: \{ x: number; y: number; width: number; height: number \}/);
  assert.match(types, /assetIds: string\[\]/);
});
