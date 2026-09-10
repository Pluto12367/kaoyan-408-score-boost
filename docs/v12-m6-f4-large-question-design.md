# V12-M6 / F4 — Large Question Training（设计 + 无 Schema 影子实现）

> 里程碑：F4（大题采分点训练）
> 状态：**设计完成 + 无 Schema 影子实现完成**；**`Question.rubric` Schema 变更仍属批准门，本轮未触碰 Prisma**
> 依据：任务 §12.1「如果没有批准权限：不要修改 Schema，但可以完成 pure module / shadow evaluator / offline rubric / tests」

---

## 1. 为什么 70 分主权必须单独处理

408 满分 150 中约 **70 分是主观大题**。审计结论（V12-0 §5）：

| 现状 | 后果 |
|---|---|
| `Question.rubric` 不存在 | 大题无结构化判分依据 |
| 无采分点拆分 | 学生只知道"错了"，不知道**丢在哪一步** |
| 无步骤证据 | 步骤 → 知识点 → 能力 的链路缺失 |

因此 F4 的目标不是"AI 给答案"，而是：

```
题目 → 解题过程 → 步骤证据 → 得分点 → 错误类型 → 知识点 → 能力变化 → 训练建议
```

---

## 2. 提议的 Schema（**未实施，待批准**）

```prisma
model Question {
  // ...既有字段
  /// F4: 大题采分点。null = 无 rubric（行为逐字节不变）。
  rubric Json?
}
```

| 项 | 说明 |
|---|---|
| 变更类型 | **纯增量、可空**（`ADD COLUMN "rubric" JSONB`） |
| 影响范围 | 无 rubric 的题目**行为零变化**（既有代码路径不读取该字段） |
| 迁移 | `ALTER TABLE "Question" ADD COLUMN "rubric" JSONB;` 无需回填 |
| 回滚 | `ALTER TABLE "Question" DROP COLUMN "rubric";`（或置 null）——无数据形态变更 |
| 生产兼容 | 旧版本服务忽略未知列；`prisma migrate deploy` 前向兼容 |
| 风险 | 低。唯一风险是**内容侧**：rubric 质量决定训练质量 |

### 2.1 Rubric JSON 形状（本轮已实现为代码契约）

```ts
export const RUBRIC_SCHEMA_VERSION = 'rubric-v1';

interface QuestionRubric {
  schemaVersion: 'rubric-v1';
  totalPoints: number;            // 必须等于各采分点分值之和
  points: Array<{
    id: string;                   // 稳定标识，供逐点遥测与审计
    label: string;                // 采分点名称（学生可见）
    points: number;               // 分值
    matchAny: string[];           // 离线判定依据（关键词/要点）
    required?: boolean;           // 必答点，未命中 = 关键失分
    knowledgeNodeIds?: string[];  // 该点考察的知识节点
  }>;
}
```

**版本化**：`schemaVersion` 必填且校验；不匹配即拒绝打分（而非近似处理）——保证历史内容可审计、升级可控。

---

## 3. 评分语义（本轮已实现）

| 判定 | 规则 |
|---|---|
| 单点得分 | `matchAny` 中任一词条出现即得该点满分；否则 0 |
| 归一化 | 去首尾空白、转小写、**压缩全部空白**——排版不改变分数 |
| 总分 | 各点得分之和；`maxScore = totalPoints` |
| 判定 | `0` → `zero`；`= max` → `perfect`；否则 `partial` |
| 关键失分 | 任一 `required` 点未命中 → `criticalMiss = true` |
| 下游证据 | `hitNodeIds` / `missedNodeIds` → 可接入 V12-M1 证据层与能力更新（**本轮只输出，不写**） |

### 3.1 回退（Fallback）——两种"不给分"必须区分

| 情形 | 结果 | 理由 |
|---|---|---|
| **无 rubric** | `score = null`、`verdict = 'no_rubric'` | **缺失不是 0 分**：没有评分标准就没有分数 |
| **rubric 非法** | `score = null`、`verdict = 'invalid_rubric'` | 拒绝近似打分（分值合计不符、缺 id、无匹配依据、版本不符） |
| 空答案（有合法 rubric） | `score = 0`、`verdict = 'zero'` | 有标准、答案为空——这是**真实的 0 分** |

---

## 4. AI 边界（任务 §12.2 的硬约束）

> AI 只能作为 `assistant evaluator`，而不是 `absolute source of truth`。

本轮的离线评分器**完全不含任何模型调用**（测试断言源码无 `fetch(` / `openai` / `deepseek` / `axios` / `http`）。它是：

| 要求 | 兑现方式 |
|---|---|
| **Explainable** | 每个采分点返回 `basis`（命中哪个词条 / 未出现哪些依据） |
| **Evidence-based** | 返回 `hitNodeIds` / `missedNodeIds` 与逐点命中词 |
| **Versioned** | `RUBRIC_SCHEMA_VERSION` 必填校验 |
| **Auditable** | 确定性输出（同输入同输出）+ 逐点 `id` |
| **Human-in-the-loop** | 每条结果 `authoritative: false`，`limitations` 明写"最终分数须由人工复核确认" |
| **AI 不作绝对真理** | `evaluationBasis: 'offline_keyword_match'` + `limitations` 明写"关键词匹配**不是语义判定**：表述正确但用词不同的答案可能被判未命中，反之亦然" |

**结论**：LLM 评分在本轮**不在范围内**；若未来引入，它只能作为**与离线基线对照的候选评分器**，且必须逐条给出依据、标注置信、由人工确认——离线基线就是它的对照物。

---

## 5. 实现清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/shared/src/score-center/large-question-rubric.ts` | 新增（纯，零依赖） | `RUBRIC_SCHEMA_VERSION`、`validateRubric`、`scoreLargeQuestion`、`RUBRIC_EVALUATION_BASIS` |
| `packages/shared/src/score-center/index.ts` | 修改 | 导出 |
| `test/large-question-rubric.test.js` | 新增（14 项） | Schema 校验 / 评分语义 / 两种回退 / AI 边界 / 确定性 / 无网络依赖 |

**未做（刻意）**：Prisma 字段、内容批次、端点、前端、LLM 评分。

---

## 6. 门禁证据

| 项 | 结果 |
|---|---|
| shared 构建 | exit 0 |
| 纯模块 | **14/14 pass** |
| **`npm test`** | 见 V12 最终报告（本轮提交后复跑） |

## 7. 获批后的实施路径（建议）

| 步骤 | 内容 | 前置 |
|---|---|---|
| F4-1 | Schema 变更（可空 JSONB）+ 迁移 + 回滚脚本 | **所有者批准** |
| F4-2 | 教研内容批次：为 N 道综合题编写 rubric（`totalPoints` 与采分点分值自校验） | 教研资源 |
| F4-3 | 端点：`GET /questions/:id/rubric`（只读）+ 提交主观答案 → 离线评分 | F4-1/F4-2 |
| F4-4 | 逐点遥测写入 V12-M1 证据层（`EVIDENCE_RECORDED`），使步骤证据进入能力链路 | F4-3 |
| F4-5 | LLM 评分作为**对照评分器**接入影子，与离线基线比对一致性 | F4-3 + 凭证 |
| F4-6 | 前端采分点清单 + 逐点反馈 | F4-3 |

**验收标准（对齐六指标之 Q3 大题得分）**：无 rubric 题目行为逐字节不变；逐点得分合计进入既有评分管线；掌握度/报告/错题联动零改动（除 F4-4 的新增证据写入）。
