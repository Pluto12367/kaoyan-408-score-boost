请先不要修改任何代码。

这是我的计算机考研408提分系统。

你现在只进行项目审计和实施计划校准。

请先完整阅读：

1. docs/superpowers/specs/2026-08-07-today-score-center-design.md
2. docs/superpowers/plans/2026-08-07-today-score-center.md
3. data/408/knowledge-tree-408-v2.json
4. data/408/frequency-model-v2.json
5. data/408/exam-mapping/
6. data/408/408-2009-2021-historical-question-index.json
7. README-CODEX.md

重要约束：

- data/408/knowledge-tree-408-v2.json 是当前408知识树的唯一权威版本。
- 2022—2026 真题映射属于 exact atomic evidence。
- 2009—2021 当前属于 historical broad evidence，不得伪装成逐题原子级精标。
- docs/reference/408/ 下的 TypeScript 文件只是 prototype/reference，不是要求直接复制的生产代码。
- 现在禁止修改代码。

然后检查当前真实项目中的：

- 根 package.json
- npm/pnpm/yarn workspace 配置
- prisma/schema.prisma
- migrations
- apps/api
- apps/web
- packages/shared
- 数据库连接
- 用户认证
- 当前测试结构
- 构建和 lint/typecheck 脚本

只输出审计结果：

1. 当前项目结构与 Implementation Plan 哪些一致
2. 哪些计划中的文件路径必须按真实项目调整
3. 现有数据库模型与新模型可能有哪些冲突
4. 哪些现有 API / 页面 / 数据模型可能受影响
5. Task 1 实际会新增和修改哪些文件
6. Task 1 开始前建议执行哪些 baseline 命令
7. 是否存在需要先修复的阻塞问题

最后停止，不要执行 Task 1，也不要修改任何文件。
