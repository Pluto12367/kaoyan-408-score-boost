# V12-M2a — Recommendation Exposure (EB-3)

> 里程碑：V12-M2a（Recommendation Exposure）
> 目标：闭合审计断点 **EB-3**（推荐曝光零遥测 → 干预证据链第二环整体缺失）
> 状态：**实现 + 测试 + 回归完成**
> 纪律：零 Schema 迁移 / 零写路径变更 / 漏斗为只读投影 / 前端不改版式

---

## 1. 问题陈述

V12-0 审计对干预证据链八环的判定中，**第 2 环 "Student Saw" 是 MISSING**：

| # | 链路层 | 审计前状态 | 证据 |
|---|---|---|---|
| 1 | Recommendation Generated | CONFIRMED | `RecommendationAction`（creationKey 幂等） |
| 2 | **Student Saw** | **MISSING** | 前端推荐面零 trackEvent；`UserEvent` 无曝光类型 |
| 3 | Accepted / Started | CONFIRMED | `RecommendationAction.status` + `actionId` 关联 |

一个更尖锐的实证：`recommendation.created / accepted / completed / failed` 四个类型**在 `RESERVED_CANONICAL_EVENT_TYPES` 中只有声明，全仓零处发射**。也就是说推荐生命周期在服务端**从未产生过任何事件**。

后果：系统无法区分"引擎生成了推荐"与"学生看到了推荐"。任何"推荐是否有效"的推论都缺少分母与观测，漏斗不可falsify。

---

## 2. 设计

### 2.1 六个生命周期阶段的证据来源（严格分工）

| 阶段 | 来源 | 类型 | 为何 |
|---|---|---|---|
| **generated** | `RecommendationAction` 行 | 服务端事实 | 引擎确实产出了它 |
| **exposed** | 客户端遥测 `recommendation.exposed` | 客户端观测 | **只有客户端能观测到"某个面为学生渲染了它"** |
| **viewed** | 客户端遥测 `recommendation.viewed` | 客户端观测 | 打开"为什么推荐"是唯一的查看信号 |
| **started** | `RecommendationAction.startedAt` / `status` | 服务端事实 | 不需要遥测 |
| **completed** | `RecommendationAction.completedAt` / `status` | 服务端事实 | 不需要遥测 |

**红线**：任何阶段都不得由另一阶段推断。`exposed` 绝不从"任务存在"或"计划已生成"推断。

### 2.2 诚实缺席：`null ≠ 0`（本里程碑最重要的一条）

曝光漏斗有两种伪造方式，代码同时拒绝：

| 伪造方式 | 拒绝机制 |
|---|---|
| **把"没有遥测"报成"曝光 0"** | 当窗口内**完全没有**曝光观测时，`exposureTelemetryAvailable=false`，每行 `exposed=null`，summary `exposed=null`，文案明示"无法判断学生是否看到推荐，不给出曝光数字" |
| **把非观测来源算作曝光** | `exposed/viewed` 只能由带身份的客户端观测置为 `true`；无身份的上报被丢弃而不是归属给所有推荐 |

**仪器一旦工作，缺席即有意义**：当遥测确实在流动（存在任意观测），某条推荐没有观测就不再是"未知"，而是 `false`——"仪器正常但没收到该条的曝光上报，判定为未被看到"。这是可证伪的关键：`null`（不可知）与 `false`（未看到）在语义上必须分开。

### 2.3 键匹配

客户端可能只知道 `taskId`（今日任务面）或只知道推荐项 `id`（提分中心面）。事实行的键集合为 `{actionId, taskId}`，观测按键集合任一命中即匹配。因此两端都能正确归因，且**观测永不被归属到未生成的行**（`observations for unknown recommendations are ignored`）。

### 2.4 幂等

`POST /events` 遥测路径**没有**服务端幂等键（append-only）。因此幂等在**投影层**保证：漏斗统计的是**阶段是否达成**（布尔），而非命中次数，重复上报不会灌水。客户端另加 `day:stage:surface:id` 去重，避免同一渲染重复上报。

---

## 3. 实现清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/shared/src/score-center/recommendation-exposure.ts` | 新增（纯） | `buildRecommendationFunnel`、`RecommendationFact`/`ExposureObservation`、阶段判定与中文依据 |
| `apps/api/src/study/recommendation-exposure.service.ts` | 新增（只读） | 合并 `RecommendationAction` 事实 + 遥测观测，窗口/上限钳制 |
| `apps/api/src/study/recommendation-action.repository.ts` | 修改（+9 行） | `listRecentByUser(userId, limit)` |
| `apps/api/src/study/canonical-event-writer.service.ts` | 修改（+5 行） | `recommendation.exposed` / `recommendation.viewed` 进 **telemetry** allowlist |
| `apps/api/src/study/daily-brief.controller.ts` | 修改 | `GET /coach/recommendation-funnel`（self-only）+ `parsePositiveInt` |
| `apps/api/src/study/study.module.ts` | 修改 | 注册 provider |
| `apps/web/src/features/recommendation/recommendationExposure.ts` | 新增 | 客户端上报器：静态演示跳过 + 按日去重 + 无身份丢弃 |
| `apps/web/src/features/student/home/components/TodayMission.tsx` | 修改 | 渲染后上报 `exposed`（加载中/错误中不上报） |
| `apps/web/src/features/today-score-center/TodaysScoreCenter.tsx` | 修改 | 渲染后上报 `exposed`；打开"为什么推荐"才上报 `viewed` |
| `test/recommendation-exposure.test.js` | 新增（11 项） | 纯模块契约 |
| `test/recommendation-exposure-service.test.js` | 新增（7 项） | 服务合并/防御/缺席 |
| `test/v12-exposure-wiring.test.js` | 新增（10 项） | 传输权限 + 防伪造 + 两端接线 + 只读边界 |

**零迁移理由**：漏斗分母复用 `RecommendationAction`（本就存在），观测复用 `UserEvent`（本就存在）。无需新表、无需新写方。

---

## 4. 端点

```
GET /coach/recommendation-funnel?windowDays=30&limit=50
```

- 角色：`student | teacher | admin`（`RoleGuard`）
- **self-only**：不接受 `userId` 覆盖（测试断言）
- 存储不可用 → `{ funnel: null, reason: 'store_unavailable' }`
- 返回：`{ generatedAt, windowDays, funnel: { rows[], summary } }`
  - `rows[]`：每条的五个阶段（`exposed/viewed` 可为 `null`）+ `reachedStage` + 中文 `basis`
  - `summary`：`generated / exposed(null 可) / viewed(null 可) / started / completed / exposureTelemetryAvailable / basis`

---

## 5. 明确未做（诚实边界）

| 项 | 原因 |
|---|---|
| 服务端发射 `recommendation.created/accepted/completed` | 本轮分母直接读 `RecommendationAction` 行，已满足漏斗需求；额外事件属增量，非 EB-3 必需 |
| 复习队列 / 真题对标面的曝光接线 | 已定义 `review_queue` / `exam_aligned` surface 常量，但**未接线**（最小可靠优先，避免为凑覆盖面而接线未验证的面） |
| 曝光遥测的服务端幂等键 | 客户端遥测本就不带 `eventKey`；改为幂等需改变遥测传输契约，超出本轮 |
| 前端漏斗可视化 | 本轮是数据地基；EB-3 的产品消费属于后续（教师/管理端观测或学生端自助） |

---

## 6. 验证证据

| 项 | 命令 | 结果 |
|---|---|---|
| shared 构建 | `tsc -p packages/shared/tsconfig.json` | exit 0 |
| API 类型检查 | `tsc -p apps/api/tsconfig.json --noEmit` | exit 0 |
| 前端类型检查 | `tsc -p apps/web/tsconfig.json --noEmit` | exit 0 |
| 纯模块 | `node test/recommendation-exposure.test.js` | **11/11 pass** |
| 服务层 | `node test/recommendation-exposure-service.test.js` | **7/7 pass** |
| 接线/边界 | `node test/v12-exposure-wiring.test.js` | **10/10 pass** |
| 全量回归 | 逐文件 `node test/*.test.js` | 见 §7 |

### 6.1 前端模块为何用源码断言而非运行时测试（诚实说明）

`recommendationExposure.ts` 依赖 `import.meta.env`（Vite 注入）与 `api/client.ts`（同样依赖 `import.meta.env`）。在 `node:test` + ts-node 下无法求值，故前端侧采用**源码行为断言**（与仓库既有 `frontend-events.test.js`、`ui-design-tokens.test.js` 同约定）：断言静态演示跳过、按日去重、无身份丢弃、且两个渲染面的调用点正确。**这意味着"上报器运行时的真实网络行为"未被本轮自动化覆盖**，属已知缺口。

---

## 7. 遗留风险

| 风险 | 说明 | 处置 |
|---|---|---|
| 曝光数据可被客户端伪造 | 遥测本质是客户端声明；恶意客户端可上报虚假曝光 | 已是既有遥测契约的性质。曝光仅用于漏斗诚实性，不参与掌握度/推荐决策，故影响受限。**若要用于决策，必须先加固** |
| 曝光遥测需真实学生使用才积累 | 生产未部署 V11-M2+，且新端点未上线 | 属部署门控（所有者），非代码问题 |
| 未接线面 | `review_queue` / `exam_aligned` 已留 enum 但无调用 | 后续增量 |
| 前端运行时行为未自动化覆盖 | 见 §6.1 | 建议后续引入轻量 DOM 测试或 e2e 断言 |
