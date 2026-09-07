# V9 Phase 3 设计：Learning Progress Dashboard（进度叙事读模型）

> 开源参考检查：进度叙事采用"周报增量"模式（GitHub Pulse / Strava Week-in-Review）：只陈述**有可比基线的增量**，基线缺失的一律 no_data，绝不硬凑。

## 1. 现状审计

报告页有六 tab 的原始数据（趋势图/测评史/效果），但都是"数据自己说话"——没有教练把**周环比增量**讲成人话；且部分比较（正确率 vs baseline）散在 ReportSummaryPanel 内部，未成体系。

## 2. ProgressStory 读模型（纯派生）

输入：
- `masterySeries`：14 天整体掌握度日快照（含 null 日，V8 #4 已保证）；
- `accuracyTrend`：StudentContext practice.recentAccuracy（value/baseline/status）；
- `gatesPassed`：effectiveness outcomes 中 gate 通过数；
- `resolvedCount`：错题重做解决数；
- `streak`：连续学习天数。

裁决：
- **weekDelta** = 本周 7 日均值 − 上周 7 日均值；任一半区有效值 <2 → null；
- 掌握度行：delta ≥ +1 → gain「本周平均掌握度较上周 +N 点」；≤ −1 → decline「回落 N 点」；|delta| < 1 且有数据 → flat「与上周基本持平」；null → no_data「快照不足，暂无法对比」；
- 里程碑行（各自独立，有证据才出现）：gatesPassed>0 →「N 个知识节点通过证据门槛」；resolvedCount>0 →「重做解决 N 道错题」；streak≥7 →「连续学习 N 天」；
- 输出 `lines[]`（gain/decline/milestone/no_data 分型）+ `weekDelta`。

## 3. 接线

`GET /coach/progress-narrative`（复用 coach controller，注入 ScoreCenterService 取 masteryTrend(14)）+ 报告页总览 tab 新增「本周进步叙事」卡（自取数，demo 隐藏）。

## 4. 边界

零迁移零新表；所有行可追溯到 trend/context/effectiveness 事实；无历史基线的指标（如错题本历史快照）不参与。
