# V10-2 Sprite UI — 设计补编（Phase A'）

> 状态：依据宪法 §6.1 V10-2 行与 `docs/ai-learning-sprite-design.md` §4.3 落地；实现前冻结。
> 上游：`docs/v10-sprite-product-constitution.md`、`docs/v10-1-sprite-core-design.md`（后端契约已实现，`GET /sprite/state` 可用）。

---

## 1. 范围（V10-2 = MVP 终点线）

悬浮精灵（orb + 展开面板）+ mood 视觉映射 + 挂载与适配。**不含**：主动弹泡（V10-3，含频次闸）、对话（V10-5）、埋点（V10-3 度量线）、羁绊（V10-4）。

## 2. 文件与挂载

```
apps/web/src/features/sprite/
  spriteMood.ts       # 纯映射：mood → { face, dot, motion, orbClass, moodLabel }（零依赖，沙箱可测）
  useSpriteState.ts   # 拉取 GET /sprite/state；账号切换清态 + 请求序号守卫；daily-brief:refresh/focus/visibilitychange 重算
  SpriteWidget.tsx    # 悬浮球 + 面板（自取数，不进 App 顶层 state 扇出）
  sprite.css          # 仅语义 token；独立文件，零触碰 styles.css / theme-optimizations.css
```

挂载（App.tsx，`</section>` 之后、全屏考试层之前，与 StudentBottomNav 平级，≤6 行）：

```tsx
{(sessionUser?.role ?? 'student') === 'student' && !learningSessionType ? (
  <SpriteWidget accountKey={sessionUser?.id ?? null} />
) : null}
```

## 3. 交互与诚实规则

1. **ambient surface 先例**（V9 ProactiveCoachCard）：`isStaticDemoMode()` → 渲染 null；fetch 硬失败/非 2xx → 渲染 null（精灵永不变错误横幅）；**API 级降级**（`degraded.contextAvailable=false`）由后端台词诚实表达，前端原样渲染。
2. **orb**：`aria-expanded` + `aria-label="AI 学习精灵 星野"`；`presence.mode==='quiet'`（会话中不可能挂载，但保守支持）→ 缩小类。点击开合面板。
3. **面板**：`role="dialog"`；关闭 = Escape / 关闭钮 / 点击面板外；mood 标签 + 台词列表（每条含"依据"展开钮 `aria-expanded`，展示 evidenceRefs 的中文来源 + detail）；deep-link 行动 = `location.hash = action.target` 后收起。
4. **静音**：面板底部"免打扰（不主动弹泡）"切换，持久化 localStorage `kaoyan408:sprite.muted`，`aria-pressed`；V10-2 仅持久化偏好（弹泡闸 V10-3 消费）。
5. **账号切换**：`accountKey` 变化 → 清 state 重新拉取；requestId 序号守卫防过期响应覆盖（`useStudentContextData` 先例）。

## 4. 视觉映射（spriteMood.ts 冻结）

| mood | face | 状态点 | motion | 标签 |
|---|---|---|---|---|
| recovery | welcoming | none | breath | 欢迎回来 |
| concern | worried | warning | none | 温和提醒 |
| celebrate | joy | success | pulse | 值得庆祝 |
| rest | restful | success | none | 今日收官 |
| streak | spark | success | none | 节奏成型 |
| encourage | happy | none | breath | 平和推进 |
| focused | thinking | none | none | 专注陪伴 |
| idle | breathing | none | breath | 安静在场 |
| unknown | curious | none | none | 还不熟悉 |

未知/缺失 mood → 回退 idle 视觉。面孔为参数化 SVG（眼睛/嘴形由 face 决定）；颜色只用 token：orb 核心 `--primary` 系，状态点 `--success`/`--warning`；动效仅 breath/pulse 两档。

## 5. 样式红线（sprite.css）

- 只消费语义 token（`--primary`/`--success`/`--warning`/`--surface`/`--line`/`--shadow-*`/`--space-*`/`--radius-*`）；**零 hex/rgb 字面量**（测试断言）。
- `z-index: 60`（>底部导航 40，<全屏层 1000/错因层 1100）。
- 桌面 `right/bottom: 18px`；`@media (max-width: 720px)` → `bottom: calc(84px + env(safe-area-inset-bottom) + 8px)`（避开底部导航）。
- `@media (prefers-reduced-motion: reduce)` → 关停 breath/pulse 动画。
- 面板宽 `min(320px, calc(100vw - 32px))`；触控目标 ≥40px（DESIGN.md §8）。

## 6. DESIGN.md 同步

§4 新增"精灵组件"小节（挂载层级/z-index/token/透明→信任/静音持久化/ambient 失败先例），维持本文件作为唯一视觉契约。

## 7. Phase B' 测试计划（test/sprite-ui.test.js）

1. **spriteMood 行为测试**（沙箱转译，零依赖强制）：9 态全映射非空；concern→worried+warning；celebrate→joy+success+pulse；focused→motion none；非法 mood→idle 回退。
2. **useSpriteState 源码契约**：`/sprite/state` 调用、`isStaticDemoMode` 门、`cancelled` + 请求序号守卫、`accountKey` 变更清态、三类刷新监听 + `removeEventListener`。
3. **SpriteWidget 源码契约**：demo null、`aria-expanded`/`aria-label`、Escape 关闭、`kaoyan408:sprite.muted`、`location.hash` deep-link、"依据"展开、TSX 零 hex。
4. **App.tsx 挂载契约**：import + 学生角色 && `!learningSessionType` 条件挂载。
5. **sprite.css 契约**：零 hex、`var(--primary`、`z-index: 60`、`calc(84px + env(safe-area-inset-bottom)`、`prefers-reduced-motion`、`max-width: 720px`。
