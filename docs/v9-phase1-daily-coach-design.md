# V9 Phase 1 设计：Daily Coach 2.0（DailyBrief 读模型）

> 开源参考检查：教练式"每日简报"采用事实合成叙述模式——Strava 周报、Duolingo 每日讯息的共同点：**先聚合已核实事实，再用固定口径组织语言**，绝不生成事实。本设计沿用该模式，slice 1 纯派生模板（零 LLM）；LLM 语言润色列为后续可选项且必须以简报事实为 prompt 全集。

## 1. 现状审计（为什么需要 DailyBrief）

V8 之后"第一件事"已统一（#9 仲裁），但教练叙述仍碎在四处：Hero 副标题（剩余天数/今日目标）、canonical 卡（一件事+理由）、AIInsight 卡（最弱点）、路线摘要（时长）。学生要自己拼出"我今天状态如何、为什么是这件事"。

## 2. DailyBrief 读模型（纯派生，可重建）

输入（全部来自既有读模型，零新查询表）：
- `todayPlan`（getTodayPlan：summary/priorityTasks/reviewDue）
- `StudentContext`（canonical：review.overdueCount、momentum.studyStreak、practice.recentAccuracy 趋势、exam.remainingDays）

输出：
```ts
interface DailyBrief {
  dateKey: string;
  headline: string;                       // 一句话：现在做什么
  stateLines: string[];                   // 2-4 条事实行（考试倒计时/复习债/正确率/连击）
  priorities: Array<{                     // 最多 3 条
    title: string; minutes: number | null;
    reason: string; kind: 'task' | 'review';
  }>;
  followUpNote: string | null;            // 完成后的跟进
}
```

裁决规则（确定性模板，insufficient_data 贯穿）：
1. headline：有未完成任务 → `先完成「title」`；否则逾期>0 → `先清逾期复习`；否则到期>0 → `先做今天到期的复习`；否则 → `今日计划已清空，做一组推荐练习保持手感`。
2. stateLines：考试倒计时（缺失不显示该行）；复习债三态（逾期/今日到期/已清零）；正确率（trend status=sufficient → 百分比，否则 **"练习量还不足以评估正确率"**）；连击。
3. priorities：前 3 个未完成任务；不足 3 且有逾期复习 → 追加"清 N 道逾期复习"（minutes=null，不伪造时长估计）。
4. followUpNote：部分完成 → 进度+复盘引导；全部完成 → 指向"努力与效果"；全空 → null。
5. 顶层风险引用留待 Phase 5（主动教练），本期不掺入。

## 3. 接线

- 纯模块 `apps/api/src/study/daily-brief.ts`（零依赖）；
- `GET /coach/daily-brief`（study 模块新 controller，学生仅本人/教师授权/管理员全量——沿用 resolveUserId 模式）；service 组合 getTodayPlan + StudentContext.getContext；
- 前端：StudentHome 主列顶部 `DailyBriefCard`（自取数、demo 模式诚实隐藏、cancelled guard）。

## 4. 红线自查

无新表、无迁移、无第二套状态；叙述全部来自已核实派生事实；端点只读。
