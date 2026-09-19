# 大题（综合题）内容生产指南

> 面向教研。目标：把四类 408 大题从「架构就绪、真实内容 = 0」推进到「trainable ≥ 每类最低量」。
> 本文只讲**怎么填、怎么验**；题型子类字典与评分语义以代码为准（Owner 冻结）。

## 1. 现状与目标

- 系统已支持大题的：定价（maxScore）、题型子类、判分标准（rubric）、整卷自评失分（PROXY）、离线 rubric 评分（F4）。
- 审计命令：`npm run audit:large-question-content` —— 实时输出四类大题的 trainable 计数与缺口清单（trainable = 有题型子类 + 有分值 + 有 rubric 的当前版本题）。
- 验收目标（建议，Owner 可调）：四类各 ≥ 5 题（含 rubric 与分值），即 `audit` 的 verdict 从 NOT READY → READY。

## 2. 四类大题与冻结子类码

| 题型子类码 | 中文 | 对应科目知识点（starter 库） | 参考分值 |
|---|---|---|---|
| `ALGORITHM` | 算法大题 | ds-sort / ds-graph / ds-tree | 8–12 |
| `CO_COMPUTATION` | 组成原理计算题 | co-cache / co-cpu / co-instruction | 6–10 |
| `OS_PV` | OS PV 题 | os-sync / os-process | 5–8 |
| `CN_ROUTING` | CN 路由计算题 | net-ip / net-tcp | 5–8 |

分值 = 该题在 408 卷面上的最高可得分值（与真实卷面一致；无法确认时留空 = 未定价，系统不计分）。

## 3. CSV 模板与列规范

模板文件：`imports/large-question-template.csv`（四类各一条**格式样例**——题面/解析/rubric 内容均为占位，**不得直接导入**，必须由教研重写内容）。

列规范（加粗为综合题特有）：

| 列 | 必填 | 说明 |
|---|---|---|
| stem | ✅ | 题干。**不得含英文逗号**（用中文逗号/顿号），否则破坏 CSV 分列 |
| options | 综合题可空 | 选择题用 `A.xx\|B.xx\|C.xx\|D.xx`；综合题留空（系统存「作答区」） |
| answer | 选择题必填 | 选择题填 `A`–`H`；**综合题留空**（大题无答案字母，按采分点判分） |
| analysis | ✅ | 参考解析（给学生的复盘材料） |
| knowledgePointIds | ✅ | 上表中的知识点 ID，多个用 `\|` 分隔 |
| difficulty | ✅ | 基础 / 中等 / 困难 |
| type | ✅ | **综合题**（大题固定填这个） |
| source | ✅ | 来源。**真实真题须写明出处**（如 `2017-408-真题-43`）；自编写 `自编-教研名` |
| year | 建议 | 真题年份；自编可写计划年份或留空 |
| expectedTimeSec | 建议 | 大题建议 600–900 |
| questionSubtype | ✅（大题） | 上表四码之一 |
| maxScore | ✅（大题） | 参考分值列 |
| **判分标准** | ✅（大题） | rubric JSON（见 §4），整列用英文双引号包裹，内部双引号写成两个 `""` |

## 4. 判分标准（rubric）JSON 规范

```json
{
  "version": 1,                       // 从 1 开始；内容修订必须 +1
  "totalPoints": 10,                  // 必须等于各采分点分值之和（校验硬卡）
  "criteria": [
    {
      "id": "c1",                     // 采分点稳定标识（同一题内唯一）
      "description": "学生可见：这条采分点要求什么",
      "points": 4,                    // > 0
      "required": true,               // 必答采分点：未命中 = 关键失分（criticalMiss）
      "evidenceHint": "人工评分依据：什么算命中",
      "matchAny": ["关键词1", "关键词2"],  // 机器可判定依据（离线评分用）
      "knowledgeNodeIds": []          // 可选：该采分点关联的知识节点
    }
  ]
}
```

写 rubric 的质量标准（审核按此卡）：

1. **采分点可独立判分**：每条 description 是一个可单独打分的要求，不与其他条耦合。
2. **required 谨慎**：只给"这题不答这个就不及格"的核心采分点（一般 ≤ 2 条）。
3. **matchAny 双向不冤枉**：关键词太宽（命中垃圾答案）或太窄（正确表述未命中）都不行；离线评分是关键词匹配，**不是语义判定**，系统对每次离线评分都明示此局限。
4. **分值合计 = totalPoints**（校验硬卡，不一致 = 导入被拒）。
5. 真题 rubric 须与官方评分口径一致；无法确认官方口径时按自编处理并如实标注 source。

## 5. 工作流（提交 → 入库 → 审计）

```bash
# 1) 填写 CSV（复制模板，重写内容；删除样例行）
# 2) 本地校验（不碰数据库）
node scripts/import-questions.mjs kaoyan-408-content-starter/imports/<你的文件>.csv --dry-run

# 3) 教研互审：按 docs/review-checklist.md 逐题过，重点 = rubric 质量（§4）
# 4) 导入（需要 DATABASE_URL；同 stem+source+year 重复默认跳过，加 --replace 版本化更新）
node scripts/import-questions.mjs kaoyan-408-content-starter/imports/<你的文件>.csv

# 5) 审计 trainable 就绪度
npm run audit:large-question-content
```

导入器对综合题的规则：options/answer 可空（自动按「作答区」+ 空答案入库）；**判分标准列非法 = 整行硬拒**（缺 version / 分值和不符 / matchAny 为空都会被拒，报错带原因）。

## 6. 评分语义边界（为什么这些字段重要）

- 学生在整卷中自评作答大题 → 系统按 自评分/满分 推导 **PROXY 失分**（自评口径，永不与客观题 OBSERVED 失分混算）。
- rubric 离线评分（`POST /questions/:id/subjective-attempt`）当前仅记录证据事件，其分数**不宣称权威**（`authoritative: false`），最终分数须人工复核。
- 真实成绩（OBSERVED）只能来自真实考试或教师人工判分——任何内容字段都无法"升级"证据等级。

## 7. 红线

- 不得把 AI 生成内容直接当真题导入；真题必须有可核查出处（year + source）。
- 未经 §5 第 3 步互审的 CSV 不得直接导入主库。
- 模板文件本身（`large-question-template.csv`）是格式示例，**不入正式题库**。
