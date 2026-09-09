# Product Evolution Report — V11-M4 Learning Impact Measurement Layer

> 格式：V11 §八 阶段报告。日期：2026-09-09。
> 状态：M4.1/M4.2/M4.3 全部完成（M4.1 核心 FSRS 已于 ad718e8 落地，本轮补 reviewPriority 出口）。完成后暂停，不进 F4。

---

## 1. 学生问题

系统此前只能回答"学生应该学什么"（F1-F3），无法回答更关键的问题：**"推荐和训练是否真的帮助学生提升？"**——干预事件（推荐动作/训练任务）发生前后，学生的能力有没有变化、变化多少、证据是什么，全部不可见。

## 2. Before / After

**Before**：学生完成推荐任务后，系统只记录"任务完成了"——学习行为与能力变化之间没有证据链；掌握度与真实做题表现之间是否一致，无从知晓。

**After**：
- 每道复习题有 FSRS 预测的可提取性与紧急度（reviewPriority：urgency = 1−R）；
- 每个常练节点有校准影子：存储掌握度 vs 真实做题正确率的差异（±15pt 阈值）与置信度（样本量），以及"建议上调/下调/维持"的方向；
- 每个近期推荐干预有前后 14 天窗口的对照：正确率变化、掌握度变化、错误练习减少，样本 <3 次诚实标注 insufficient_data。

## 3. 产品价值

| 指标 | 作用 |
|---|---|
| 知识保持率（M3 指标） | FSRS 预测 vs 观测的影子对比管线就绪（review-shadow.ts 已有旧算法基线，预测器同构输出） |
| 单位学习时间收益（M6 指标） | outcome tracking 直接回答"这个推荐是否有效"——干预前后正确率/掌握度/错误练习对照 |
| 校准（新增维度） | mastery-calibration 让"练了但系统高估/低估"可见——诚信体系从"数字真实"走向"模型可信" |

## 4. 技术价值

- **新增文件**：`packages/shared/src/score-center/fsrs-scheduler.ts`（FSRS-4.5 纯实现：recallProbability/nextInterval/nextStability 等零依赖）、`packages/shared/src/score-center/decay-defense.selector.ts`（遗忘防线选择器：mastered 节点快照回落 → 保温候选，读投影）、`apps/api/src/study/mastery-calibration.ts`?? 修正：`mastery-calibration.ts`（纯）+ `learning-impact.service.ts`（只读装配）+ 3 端点（GET /coach/mastery-calibration、/coach/outcome-tracking、reviewPriority 出口）。
- **架构**：全部 Selector/Projection/Service 只读派生，零迁移零 SoT 触碰；FSRS 权重显式标注 UNTRAINED（fsrs4anki 公开默认值），权重优化留待影子数据支持。
- **测试**：定向 15 项（property/inverse/monotone 为主），全量 2049/2047/0。

## 5. 验证

- 定向：v11-m4-fsrs-decay 7/7、learning-impact 6/6（RED→GREEN）。
- 全量：2049/2047/0，零新增失败；build:shared/api/web PASS。
- 数学性质：R(0,S)=1；R 随 t 单调降、随 S 单调增；I(r,S) 为 R 的精确逆（±0.01）；遗忘分支收缩稳定度、成功回忆增长稳定度；难度全程 clamp [1,10]。

## 6. 遗留与下一阶段

1. FSRS 权重 golden 对照 ts-fsrs（需 devDependency 决策）——当前以数学性质测试替代。
2. decay-defense 候选的学生端呈现（保温复习卡）——纯投影已就绪，推荐层接入待设计。
3. F4 大题训练闭环：content-blocked（rubric 内容批次）。
4. 推送/部署：本轮提交本地，推送时机由所有者决定。
