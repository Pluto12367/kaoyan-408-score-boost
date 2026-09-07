# V10-4 Memory + V10-5 Real AI Companion — 设计补编（Phase A'''）

> 状态：两项均获所有者批准；本文档冻结范围与红线。**本切片仅入本地分支，不随 V10 MVP 部署**（生产仍为 V10-3 MVP，待所有者审查后随下次部署上线）。
> 关键依赖事实：陈述性偏好的输入通道是对话（V10-5），故 V10-4 先建"存储 + 确定性提取 + 面板手动入口"，V10-5 对话 sends 时自动回流记忆——两片咬合。

---

## 1. V10-4 Memory（零 LLM）

### 1.1 存储（宪法 §7.3-② 的可执行形态）

- RuntimeState KV，key = `sprite-memory:{userId}`，**可丢弃运营状态**声明（与 coach-session 同款 Design Gate）；零新表零迁移。
- 条目：`{ id, text, createdAt, lastSeenAt, source: 'user_stated' }`；上限 **12 条**（超限按 lastSeenAt 淘汰最旧），单条 **≤80 字**。
- `sprite-memory.repository.ts`：@Optional PrismaService + `runtimeState.findUnique/upsert`（逐字复刻 coach-session 先例）；库不可用 → `enabled=false`，服务层诚实降级。

### 1.2 提取（确定性，LLM 提取后置）

`sprite-memory.ts` 纯模块：正则模式 `我喜欢|我想考|我的目标(院校)?(是|为)?|我在准备|我不擅长|我怕|我每天` + 有界捕获（≤24 字，截断到标点），单条消息最多提取 3 条、单条 ≤80 字、规范化（trim）。**LLM 参与提取明确后置**（涉及输入理解边界，需独立设计）。

合并 `mergeSpriteMemory(existing[], candidates[], now)`：规范化文本精确去重（命中则 touch lastSeenAt，不上限膨胀）、新条目 id = `mem:{asOf 数字串}:{序号}`、超 12 条淘汰最旧。

### 1.3 端点（全部 self-only：恒用 CurrentUser.id，忽略 viewUserId）

| 端点 | 语义 |
|---|---|
| `GET /sprite/memory` | 列出（≤12 条） |
| `POST /sprite/memory` `{text}` | 确定性提取 + 合并 + 落库 → `{ entries, added, disabled }`（disabled=库不可用，诚实标记） |
| `DELETE /sprite/memory/:id` | 忘记（用户控制感，宪法透明原则） |

`GET /sprite/state` **增量**追加 `memory: { entries: [{id,text}] }`（≤3，纯函数输入新增 `memory` 快照；v1 契约向后兼容增量，版本号不变）。

### 1.4 前端

面板新增"星野记得"区：列表（≤12）+ 每条"忘记"chip（DELETE）+ 手动输入"告诉星野一件关于你的事"（POST）。打开面板时拉取 `GET /sprite/memory`。

### 1.5 红线

记忆绝不回流学习引擎（不写 mastery/计划/复习）；派生优先原则重申：mood/台词/里程碑已是派生记忆（B1），本片只做 B2 陈述性偏好；**无向量**；可随时整片删除。

---

## 2. V10-5 Real AI Companion（对话）

### 2.1 通道（零新后端端点）

面板内"问星野"输入 → `POST /agent/supervisor/run` `{ message }`（不传 intent，走 `detectIntent` 确定性路由；body 禁传 userId——服务端恒取 CurrentUser）。

### 2.2 渲染适配器（诚实、按 routedTo 分型）

| routedTo | 渲染 |
|---|---|
| `coach-agent` | `data.answer.summary` 正文 + `suggestions` chips + `mode==='workflow'` 时标注"确定性模式"（LLM 不可用时诚实可见） |
| `tutor-agent` | 按宪法 §4.2：**不内嵌解题**——卡片"这个问题适合进入讲解模式" + deep-link `#/ai` |
| `planner-agent` | 摘要 + deep-link `#/dashboard` 看计划 |
| `exam-agent` | 摘要 + deep-link `#/test` 去测试（citations 若存在则以"依据节点"小字展示） |
| `ok:false` | 显式错误文案（绝不静默伪装成功） |

### 2.3 记忆回流

每次发送用户消息时并行 best-effort `POST /sprite/memory {text}`——"我喜欢计组"类陈述被确定性提取进记忆，下一轮 `/sprite/state` 即携带（可见于"星野记得"）。

### 2.4 会话连续性声明（红线内）

supervisor coach 路径走 StudyAgentService.run——其记忆是**每请求从 StudentContext 派生的三层 brief**，不携带聊天历史（agent-memory 红线：不用聊天历史）。因此精灵对话为**无状态轮次 + 派生记忆上下文**，不引入 Coach Session 拼接；如未来需要连续对话，走 contextual-coach 通道另行设计。

### 2.5 LLM garnish

**后置不实现**（原 V10-1 设计 §的可选开关）：对话本身即 DeepSeek 驱动的真实 AI 面，garnish 的边际价值低于其复杂度；保留宪法条款待证据需求出现。

---

## 3. Phase B''' 测试计划（RED）

1. `test/sprite-memory.test.js`（新，行为级沙箱）：七类陈述模式提取、规范化与长度截断、单消息 ≤3 条、精确去重 touch lastSeenAt、12 条上限淘汰最旧、id 确定性。
2. `test/sprite-state.test.js` 增补：input.memory → 输出 ≤3 条且字段忠实；无 memory → 空（向后兼容）。
3. `test/sprite-ui.test.js` 增补：星野记得区（GET/POST/DELETE 调用、忘记 chip、手动输入）；对话（supervisor 调用形态、四 routedTo 渲染分型、tutor deep-link `#/ai`、ok:false 显式错误、workflow 模式标注、记忆回流 best-effort）。
4. 接线：study.module.ts 注册 SpriteMemoryService/Repository（源码断言）。
