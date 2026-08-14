# 学习路径“下一步入口”统一强化设计

## 1. 背景

学生端已经具备今日任务、题目训练、错题本、学习报告、学习目标感等多个学习闭环模块。当前主要问题不是“没有功能”，而是学生在完成一个动作后，仍可能不知道下一步应该去哪里。

本设计目标是把已有功能串成更连续的自主学习路径，让学生在任意关键学习节点都能看到明确的下一步入口。

## 2. 功能落点

### 2.1 学生端首页 / 学习中控台

位置：`dashboard` 里的学习中控台区域。

方向：首页不只展示学习状态，还要明确告诉学生“当前最该去哪里”。

示例：

- 今日任务未完成：优先去今日任务或题目训练。
- 今日任务已完成但有待复盘错题：优先去错题本。
- 今日任务和错题都处理完：建议查看学习报告或继续专项训练。

### 2.2 今日任务

位置：学生端“计划 / 今日任务”区域。

方向：任务完成前后都给下一步，降低学生在任务列表里的停顿。

示例：

- 未开始：开始最高优先级任务。
- 进行中：继续完成当前任务。
- 已完成：复盘错题、查看报告或继续训练。

### 2.3 题目训练 / 专项训练结果

位置：单题答题反馈与专项训练结果区域。

方向：答完后不让学生停在解析页，而是进入下一步行动。

示例：

- 单题答错：去错题本复盘，或继续下一题。
- 单题答对：继续下一题，或查看目标推进。
- 专项训练结束：再练同考点、复盘错题、查看报告。

### 2.4 错题本

位置：错题本首页、错题详情或复盘结果区域。

方向：复盘不是终点，复盘后引导学生进入“再练同考点”或“看掌握变化”。

示例：

- 仍有待复盘错题：继续复盘下一题。
- 当前知识点复盘完成：再练同考点。
- 错题压力降低：查看报告确认变化。

### 2.5 学习报告

位置：报告结论与下一步学习建议区域。

方向：报告不只是数据展示，而是把结论落到下一步行动。

示例：

- 有薄弱点：去题目训练。
- 有待复盘错题：去错题本。
- 今日任务未完成：回首页或今日任务。

## 3. 方案

新增统一前端组件：

```text
NextLearningStepCard
```

组件职责：

- 显示当前推荐下一步。
- 说明为什么推荐这一步。
- 提供主行动按钮。
- 提供一个备用行动按钮。
- 复用已有页面数据，不创造新的学习数据源。

建议展示字段：

```text
title              // 下一步建议
reason             // 推荐原因
primaryAction      // 主按钮文案 + 目标 section
secondaryAction    // 备用按钮文案 + 目标 section
contextLabel       // 可选：当前来自首页 / 今日任务 / 训练结果 / 报告 / 错题本
```

## 4. 数据来源

只使用前端当前已有数据：

- `todayPlan`
- `wrongQuestionSummary`
- `report`
- `masteryMap`
- `practiceAnswerResult`
- `practiceSetResult`
- 当前 task context

不新增：

- 数据库表
- 后端接口
- 推荐算法
- mock 数据
- 独立状态源

## 5. 行为规则

推荐优先级建议保持简单、可解释：

1. 如果当前今日任务未完成，优先推进今日任务。
2. 如果今日任务已完成且存在待复盘错题，优先复盘错题。
3. 如果存在薄弱知识点，优先专项训练。
4. 如果当前页面是报告，则优先把报告结论落到练习或复盘。
5. 如果没有明显压力，建议继续训练或查看报告。

这些规则只用于前端解释与导航，不改变后端计划生成逻辑。

## 6. 组件接线

### 6.1 首页

在 `StudentLearningConsole` 中渲染 `NextLearningStepCard`。

输入：

- `todayPlan`
- `wrongQuestionSummary`
- `report`
- `masteryMap`

输出：

- 主按钮跳转到 `plan` / `question` / `wrong-book` / `report`
- 备用按钮跳转到另一个合理路径

### 6.2 今日任务

在 `TodayPlan` 中渲染 `NextLearningStepCard`。

输入：

- `plan`
- 当前优先任务

输出：

- 任务未完成时强调继续任务
- 任务完成后强调复盘或报告

### 6.3 训练结果

在 `PracticePanel` 的答题结果与专项训练结果中渲染 `NextLearningStepCard`。

输入：

- `answerResult`
- `practiceSetResult`
- `taskContext`
- `targetWeakPointTitle`

输出：

- 答错优先错题复盘
- 答对优先下一题或继续训练
- 专项结束优先再练同考点 / 复盘 / 报告

### 6.4 错题本

在 `MistakeWorkspace` 或错题详情区域渲染 `NextLearningStepCard`。

输入：

- `wrongQuestions`
- `wrongQuestionSummary`
- 当前筛选知识点

输出：

- 继续复盘
- 再练同考点
- 查看报告

### 6.5 学习报告

在 `ReportSummaryPanel` 中渲染 `NextLearningStepCard`。

输入：

- `report`
- `stageReport`

输出：

- 去练薄弱点
- 去错题本
- 回今日任务

## 7. 非目标

本轮不做：

- 后端推荐算法改造
- 数据库 schema 变更
- 学习计划生成逻辑变更
- AI 自动推荐
- 新页面
- 新导航结构
- 大规模视觉重构

## 8. 测试策略

采用 TDD。

先新增 RED 测试，覆盖：

- `NextLearningStepCard` 组件存在并暴露明确 contract。
- 首页接入下一步入口。
- 今日任务接入下一步入口。
- 训练结果接入下一步入口。
- 错题本接入下一步入口。
- 学习报告接入下一步入口。
- 按钮目标只跳转到已有 section。
- 不出现 mock / fabricated / fake 文案。

然后实现最小前端改动。

验证命令：

```powershell
npm test -- test/next-learning-step-ui.test.js
npm test -- test/student-learning-console-ui.test.js test/today-plan-ui.test.js test/practice-set-action-ui.test.js test/wrong-question-ui.test.js
npm run build:web
npm test
```

## 9. 验收标准

- 学生在首页能看到明确下一步。
- 学生在今日任务区域能看到当前最合理下一步。
- 学生答题后能从反馈页继续行动。
- 学生复盘错题后能继续复盘、再练同考点或查看报告。
- 学生看完报告后能直接进入练习、错题本或今日任务。
- 不新增 mock 数据。
- 不破坏已有导航和 API。
- `npm run build:web` 通过。
- `npm test` 通过，0 failure。

