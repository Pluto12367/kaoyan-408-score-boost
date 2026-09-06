# V9 Phase 2 设计：Adaptive Weekly Planner（周计划效果自适应）

> 开源参考检查：自适应计划借鉴 Spaced-repetition 系统（Anki 的 workload 调度）与训练负荷管理（运动科学 ACWR 急慢性负荷比）的共识：**强度调整必须有上周证据支撑，证据不足时维持现状**——不因感觉加码。落地为纯派生 + 计划重建钩子。

## 1. 现状审计

- 7 天计划在窗口过期时整体重建（V8 #13 已补断档结转），但重建**从不看上周效果**——效率高低一个样；
- V6.3 EffectivenessService 已能产出窗口内各节点 outcome（attempts/gain/evidenceGate），但只服务于读端点，未回馈计划。

## 2. WeeklyAdjustment 读模型（纯派生）

输入：`outcomes[]`（{attemptsInWindow, masteryGain, gatePassed}，来自 EffectivenessService.getOutcomes(userId, 7)）、`openDebt`（carryOver.length，断档结转数）。

裁决（诚实优先）：
- **evaluated = attempts ≥ 2 的节点**；evaluated=0 → `maintain`，note"上周证据不足，维持现有计划强度"；
- avgGain ≥ 0.1 且 gatePassed ≥ 1 → `intensity_up`（factor 1.2）note 含"加码 20%"与证据数；
- avgGain < 0 → `intensity_down`（factor 0.8）note"降载 20%，先稳节奏"；
- 其余（含 openDebt 高但效果中性）→ `maintain`。

## 3. 应用点

计划重建链（getTodayPlan 窗口过期分支）：
```
buildSevenDayPlan → applyCarryOver → applyWeeklyIntensity（跳过 carry-* 任务）→ save
```
- 强度作用于 minutes/questionCount（minutes 下限 15）；
- 计划态与响应新增 `weeklyAdjustment: { verdict, factor, note, evidence }`（可空，附加式）；
- 效果数据经 EffectivenessService（EffectivenessModule 导出，StudyModule 导入，@Optional 注入于构造器末尾——遵守地雷清单）。

## 4. 边界

无迁移、无新表、不改既有响应形状（新增可选字段）；insufficient → maintain（不自作聪明）。
