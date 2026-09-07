# V10-3 Companion Loop — 设计补编（Phase A''）

> 状态：所有者已确认进入 V10-3；本文档冻结 MVP 收尾切片的范围与规则。
> 上游：宪法 §5.3（频次三闸）、§6.1（V10-3 行）、§9（诚实度量）；V10-1 后端契约、V10-2 UI 已交付。

---

## 1. 范围

1. **每日问候弹泡**：挂载后按 mood 主动问候一次（自然日 ≤1 次硬闸）。
2. **完成回应**：练习提交触发 `daily-brief:refresh` → mood 转入 celebrate/rest 时的即时回应弹泡——**与问候共享同一日额度**（总上限仍 ≤1/日）。
3. **成就反馈**：填充 `bond.milestones`（仅既有输入派生，零新查询），面板展示"成就"区。
4. **埋点**：`sprite.interact` 进 telemetry allowlist；panel_open / bubble_shown / bubble_click / action_click / milestone 不单独埋（含于 panel_open 的 state）。

不做：quest 类里程碑（需新有界查询，后置并记录）；推送渠道；对话。

## 2. 弹泡引擎（SpriteWidget）

- **形态**：orb 左上方非模态小卡（`role="status"`，不抢焦点），mood 标签 + 首条台词 + 主行动 chip + 关闭钮；8s 自动消失（cleanup 保证）。
- **资格**：`lines.length > 0 && mood ∉ {idle, focused}`（unknown 含在内——诚实的建档邀请；idle 纯在场不弹；focused 会话安静）。
- **闸门（顺序）**：muted → 永不弹（面板仍可手动开）→ 当日额度 `localStorage['kaoyan408:sprite.bubble'] === 今日 dateKey` → 已用则不弹 → 弹出即写入今日 dateKey（消费额度）+ `trackEvent('sprite.interact', { action: 'bubble_shown', mood })`。
- **触发**：① 挂载后首次 state 到达（问候）；② refresh 引起的 mood 转入 celebrate/rest（完成回应，prev→next 转移检测）。二者共用额度，先到先得。
- **点击弹泡体** → 打开面板 + `trackEvent('sprite.interact', { action: 'bubble_click', mood })`；点关闭钮只关闭不打开。
- muted 变化即时隐藏弹泡；额度写入失败（storage 不可用）→ 视为已消费（宁可少打扰）。

## 3. 成就里程碑（后端 sprite-state.ts）

`bond.milestones: SpriteMilestone[]`（类型从 `never[]` 放宽，`[]` 仍合法，向后兼容），仅从既有输入派生、固定顺序、≤3 条、每条强制 `evidenceRef`：

| kind | 条件 | label |
|---|---|---|
| `evidence_gate` | `story.gatesPassed > 0` | `${n} 个知识节点的提升通过了证据门槛` |
| `resolved` | `story.resolvedCount > 0` | `重做解决了 ${n} 道错题` |
| `streak` | `studyStreak >= 7` | `连续学习 ${streak} 天` |
| `gap_recovery` | `plan.recoveredFromGap` | `断档恢复完成，节奏已重建` |

quest 通过类里程碑需新的有界查询（StudentContext 无 quest 事实），**明确后置**，需时另立切片。前端面板在 `bond.milestones.length > 0` 时展示"成就"区（仅 label 文本）。

## 4. 埋点（一行 allowlist 增量）

`canonical-event-writer.service.ts` 的 `TELEMETRY_EVENT_TYPES` 追加 `'sprite.interact'`（纯增量，既有类型不动；payload 自由 Record）。前端 `trackEvent('sprite.interact', { action, mood })`：panel_open / bubble_shown / bubble_click / action_click。best-effort，失败静默（`api/events.ts` 既有语义）。

## 5. Phase B'' 测试计划（RED）

1. `test/sprite-state.test.js` 增补：四种里程碑各自条件触发、证据 ref 可解析、全零输入 → `milestones: []`、≤3 上限、向后兼容（无 story/plan 时字段仍为空数组）。
2. `test/sprite-ui.test.js` 增补：useSpriteState 源码含额度 key `kaoyan408:sprite.bubble`/本地 dateKey/trackEvent；SpriteWidget 源码含弹泡资格集合（排除 idle/focused）、8s 自动消失 + cleanup、muted 闸、`sprite.interact` 四 action、`role="status"`、成就区渲染；allowlist 源码含 `'sprite.interact'` 且锚点 `tutor.ask` 仍在（防整表替换）。
3. 既有测试零改动预期：canonical-event-boundary（追加型增量）、frontend-events（App.tsx 未动 trackEvent 行）。
