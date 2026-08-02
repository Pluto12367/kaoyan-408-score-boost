# PDF 题目解析基准与发布门禁

管理员在 Git 目录外准备三个已获合法授权的样本：可复制文本、扫描件、复杂版式。私有清单格式：

```json
{"samples":[{"kind":"text","path":"C:\\private-question-samples\\text.pdf","expectedQuestions":20},{"kind":"scan","path":"C:\\private-question-samples\\scan.pdf","expectedQuestions":20},{"kind":"complex","path":"C:\\private-question-samples\\complex.pdf","expectedQuestions":20}]}
```

在批准的测试环境设置 `BENCHMARK_API_URL`、`BENCHMARK_ADMIN_EMAIL`、`BENCHMARK_ADMIN_PASSWORD`，再运行：

```powershell
node scripts/benchmark-question-parser.mjs --manifest C:\private-question-samples\manifest.json --output C:\private-question-samples\result.json
```

脚本仅输出批次 ID、计数、指标和成本汇总；不会打印令牌、凭据、题干、答案或解析。结果包含各样本的检测数量、precision/recall、必填字段完整率、答案关联率、公式/图片保留率、人工警告率、耗时及每 100 页成本。`candidateExport` 也只包含 ID、状态、页号和警告代码，便于人工复核而不泄露题目内容。

发布前必须由管理员一起审阅 `result.json`，明确接受纠错率、每 100 页成本和处理时间。系统不预设这些阈值。未明确接受前，生产环境只允许小型 PDF 测试文件，Excel/CSV 可继续使用；不得启用整本书上传。

自动门禁：`npm test`、`npm run build:api`、`npm run build:web`、`npm run test:integration:postgres`、`npm run smoke:production-compose`、`node scripts/staging-smoke.mjs` 和 `git diff --check`。后一个 staging smoke 需要专用学生和管理员账户，并要求 `STAGING_API_URL`、`STAGING_WEB_ORIGIN`、`STAGING_SMOKE_EMAIL`、`STAGING_SMOKE_PASSWORD`、`STAGING_SMOKE_INVITATION`、`STAGING_ADMIN_EMAIL`、`STAGING_ADMIN_PASSWORD`；所有 URL 必须是 HTTPS。它校验管理员接口拒绝未授权上传、生成 CSV 上传、失败任务重试、审核编辑、重复跳过、新版本确认与幂等确认。清理保护和 PDF fake-provider 的端到端验证仍需在隔离测试环境执行。
