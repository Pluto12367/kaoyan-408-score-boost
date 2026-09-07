# V10-3 Companion Loop — Final Report

> 状态：COMPLETE（含真实浏览器弹泡目检；未提交，等待所有者审查）。**V10 MVP 线（V10-0~V10-3）至此全部完成。**
> 日期：2026-09-07
> 上游：`docs/v10-3-companion-loop-design.md`（Phase A'' 设计补编）、宪法 §5.3/§6.1/§9

---

## 1. 交付摘要

V10-3 补齐陪伴闭环的最后三块：

1. **主动弹泡（每日一次硬闸）**：问候（挂载后首次 state 到达）与完成回应（`daily-brief:refresh` 引起 mood 转入 celebrate/rest）共用同一自然日额度；`localStorage['kaoyan408:sprite.bubble']` 记当日 dateKey，额度写入失败视为已消费（宁可少打扰）；muted 即时隐藏且永不弹；`idle`/`focused` 永不问候；8s 自动消失（timer cleanup 保证）；`role="status"` 非模态不抢焦点。
2. **成就反馈**：`bond.milestones` 从 `never[]` 放宽为 `SpriteMilestone[]`，仅从精灵既有输入派生（零新查询）——`evidence_gate`（效果门槛）/`resolved`（错题解决）/`streak`（≥7 天）/`gap_recovery`（断档恢复），固定顺序、≤3 条、每条强制 evidenceRef；面板新增"成就"区。quest 类里程碑需新的有界查询，明确后置。
3. **埋点**：`sprite.interact` 追加进 `TELEMETRY_EVENT_TYPES`（一行纯增量，既有类型零改动）；前端四种 action——`panel_open` / `bubble_shown`（含 mood + greeting/completion 种类）/ `bubble_click` / `action_click`，经既有 `trackEvent` best-effort 上报。

## 2. 修改文件（精确清单）

| 文件 | 变更 | 内容 |
|---|---|---|
| `apps/api/src/study/sprite-state.ts` | 增量 | `SpriteMilestone` 契约 + `deriveMilestones` 纯派生（`bond.milestones` 落地） |
| `apps/api/src/study/canonical-event-writer.service.ts` | +1 行 | `TELEMETRY_EVENT_TYPES` 追加 `'sprite.interact'` |
| `apps/web/src/features/sprite/useSpriteState.ts` | 增量 | `spriteDateKey`/`readBubbleQuotaUsed`/`consumeBubbleQuota` 额度助手；`SpriteStateView.bond.milestones` 类型落地 |
| `apps/web/src/features/sprite/SpriteWidget.tsx` | 增量 | 弹泡引擎（资格/双触发/额度/mute 闸/8s 自匿/cleanup）、成就区、`trackEvent` 四 action（面板打开、行动点击、弹泡展示/点击） |
| `apps/web/src/features/sprite/sprite.css` | 增量 | `.sprite-bubble*` / `.sprite-milestones*`（纯 token） |
| `test/sprite-state.test.js` | +2 测试 | 里程碑四条件各自触发 + 证据可解析；全零输入空数组 + ≤3 上限 |
| `test/sprite-ui.test.js` | +3 测试 | 弹泡额度 key/资格集合/自匿 cleanup/mute 闸/role=status；`sprite.interact` allowlist（含 `'tutor.ask'` 锚点防整表替换）；成就区渲染 |
| `docs/v10-3-companion-loop-design.md` | 新增 | Phase A'' 设计补编 |
| `docs/current-sprint.md` | 账本 | V10-3 完成条目 |

## 3. 验证结果

| 门禁 | 命令 | 结果 |
|---|---|---|
| 定向 | `node --test test/sprite-state.test.js test/sprite-ui.test.js` | **31/31 PASS**（18+13；V10-3 新增 5 项先 RED 后 GREEN） |
| 全量 | `npm test` | **1956 总 / 1954 pass / 0 fail / 2 skipped**（V10-2 基线 1951/1949/0 + 5 项，零新增失败） |
| 构建 | `npm run build:api` / `npm run build:web` | 双 PASS |

## 4. 真实目检（dev 栈 + 浏览器，全部实证）

1. **问候弹泡**：挂载后首次 state 到达自动弹出（"星野 · 值得庆祝 / 连续学习 5 天…"），orb 呈 spark 面孔 + 绿色状态点。
2. **8s 自匿**：弹泡在超时窗口后自动消失（第一轮截图恰在窗口后，DOM 查证已关闭）——准时自匿即设计行为。
3. **日额度硬闸**：同日第二次触发被正确抑制（清额度前 reload，弹泡不出现）；消费后 `localStorage['kaoyan408:sprite.bubble'] === '2026-09-07'` 与本地日期逐字一致。
4. **庆祝弹泡**：清额度后 celebrate mood 弹泡完整呈现——标题/证据台词（"这周平均掌握度 +1.4 点——不是感觉，是快照算出来的。"）/`查看` CTA/关闭钮，位于 orb 上方不遮挡内容。
5. **成就区**：开面板后"成就"条显示"3 个知识节点的提升通过了证据门槛"。
6. 弹泡点击体→开面板、点关闭钮→仅关闭的路径在代码层分离（源码断言钉死）。
7. dev 栈已清理（5174 无监听、孤儿进程已杀、临时日志已删）。

## 5. 遗留风险与备注

1. 弹泡频次效果（静音率/关闭率）需生产埋点数据——`sprite.interact` 已进 allowlist，V10 MVP 上线后 2 周观察期出基线（宪法 §9.3），本阶段无生产数据不下结论。
2. quest 类成就里程碑未做（需有界 quest 查询），已在设计补编声明后置。
3. 完成回应依赖既有 `daily-brief:refresh` 事件在练习提交路径上的触发——该机制为 V9 既有行为，本轮未改动其触发点。
4. 预存问题沿用 V10-1 报告 §5（集成脚本 review-scheduler 断言），本轮无新增。

## 6. 开源参考方向

延续 V10-1/V10-2（XState 守卫转移、Duo"表情映射状态"）；弹泡频次闸采用"自然日配额 + 静音优先 + 存储失败宁缺"的保守策略，对齐 Duolingo 研究中"罪感化/骚扰是留存反效果"的结论与宪法 §5.3 三闸。

## 7. MVP 收官状态与下一步

**V10 MVP（V10-0 Product Freeze → V10-1 Sprite Core → V10-2 Sprite UI → V10-3 Companion Loop）全部完成。** 端到端链路：真实学习事实 → 纯派生 SpriteState（9 态 mood + 证据台词 + 成就）→ 常驻 ambient 呈现 + 每日一次主动触达 → `sprite.interact` 遥测回流。

候选下一步（由所有者决策，不自动启动）：
1. **V10 MVP 生产部署**：腾讯云部署 + 冒烟（对齐 V9 部署 runbook；显式 refspec 更新法）。
2. **V10-4 Memory / V10-5 Real AI Companion**（后置线，均需单独批准）。
3. **独立小任务**：PostgreSQL 集成脚本 review-scheduler 断言收口（V8/V9 预存债）。
