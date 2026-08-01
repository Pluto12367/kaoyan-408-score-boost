# 题库文档导入：开源参考记录

## 任务

为管理员题库文档导入建立可恢复的导入状态，以及保持学习历史可追溯的不可变题目版本。

## 参考资料与借鉴

| 来源 | 链接 | 借鉴模式 |
| --- | --- | --- |
| MinerU | https://github.com/opendatalab/MinerU | 将文档解析作为可替换的外部提供商任务；保存原始资产、状态与诊断信息。 |
| PP-StructureV3 | https://www.paddleocr.ai/latest/en/version3.x/module_usage/text_recognition.html | 页面/版面解析结果应保留来源页和区域，供人工复核与问题定位。 |
| Docling | https://docling-project.github.io/docling/ | 采用规范化中间结果、结构化元数据与可恢复处理阶段，而非把解析结果直接写入正式题库。 |
| Moodle | https://docs.moodle.org/en/Question_bank | 题库变更必须保持可追溯性，导入和审核状态应与正式题目版本分离。 |

## 本项目决策

- 采用题目族加不可变版本：学习记录继续关联既有 `Question.id`，新版通过同一题目族的新版本表达。
- 采用批次、任务、候选题、资产与确认记录分离的可恢复导入状态；确认操作由幂等键保护。
- 仅保存 SHA-256、来源、状态、成本和诊断元数据；实际文档解析由后续可替换提供商完成。
- 不采用 2GB 服务器本地模型方案：该方案的资源占用和运维成本不适合本项目部署目标。
- 不复制 MinerU、PP-StructureV3、Docling 或 Moodle 的源码；仅根据其公开文档和架构模式进行本项目内重实现。

## Task 7 reference update

- `mineru-open-sdk` 0.2.5 is pinned in the API workspace. Its TypeScript SDK exposes `new MinerU(token).extract(source, { model, timeout })`, `ExtractResult`, and typed provider errors such as `TimeoutError`.
- The provider boundary follows mature async document-ingestion patterns from MinerU/Docling/PaddleOCR-style systems: keep the external parser behind a replaceable adapter, normalize layout into project-owned block unions, keep source regions for review diagnostics, and do not let candidate generation depend on vendor-specific JSON.
- Tests use a deterministic fake provider and injected MinerU client factory so unit coverage never spends external parser credits.
- The production fallback is credential-free: when `MINERU_API_TOKEN` is absent, PDF jobs fail with a safe administrator-facing message and request ID while Excel/CSV imports continue through the table parser.
