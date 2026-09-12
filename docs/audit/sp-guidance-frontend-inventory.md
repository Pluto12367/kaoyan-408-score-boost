# SP Guidance — Frontend Inventory (student-facing guidance mechanisms)

Scope: `apps/web/src/**` @ commit working tree. Code is the only source of truth. `api/mocks/` noted only where mock substitutes for guidance.
Audience model: first-time student, zero knowledge of internals.

---

## 0. What "guidance" resolves to in code (orientation)

| Layer | Carrier | Where |
|---|---|---|
| Pre-login | `RegisterWizard` 4-step profile | `features/auth/RegisterWizard.tsx:15` |
| Post-register ceremony | `InitializationCore` + `WelcomeHero` | `features/onboarding/OnboardingFlow.tsx:8` |
| First-run gate | `OnboardingWizard` (4 steps) | `components/OnboardingWizard.tsx:12` |
| Per-day arbitration | canonical next action | `features/student/actions/canonicalNextAction.ts:4` |
| Explanation | `RecommendationEvidence`, `WhyRecommendedDrawer`, `RecommendationReasonCard` | §2 |
| Honesty/refusal | ledger, anchors, evidence gates | §2, §5 |
| Ambient nudge | `SpriteWidget`, `ProactiveCoachCard`, `DailyBriefCard` | §4, §8 |

---

## 1. Onboarding / first-run

### 1.1 Two DISJOINT first-run tracks (critical structure)

**Track A — post-registration ceremony.** `App.tsx:1363` computes `shouldShowRegistrationActivation = lastAuthAction === 'registered' && sessionUser?.role === 'student' && !activationDismissed`; `App.tsx:1369-1371` returns `<OnboardingFlow …/>` as the **entire page** (no nav, no dashboard). Dismissed only by the button inside `WelcomeHero`.

- `features/onboarding/OnboardingFlow.tsx:8-14` — `phase: 'initializing' | 'welcome'`; renders `InitializationCore` then `WelcomeHero`. **Steps: 0 inputs.** Not skippable except by finishing the 3 s animation.
- `features/onboarding/InitializationCore.tsx:8` — `const stages = ['正在加载408知识体系','正在建立 Student State','正在分析知识掌握模型','生成个性化学习计划','AI 学习空间创建完成']`; `:18-19` timers `(index+1)*550` ms and `onComplete` at `3000` ms. Comment `:16` admits: *"The stages are presentation only; nothing here gates real initialization work."* → **teaches nothing; it is theatre.**
- `features/onboarding/WelcomeHero.tsx:15-19` — `Welcome back, {userName || profile.name || 'Explorer'}`, `你的专属学习空间已创建…`, three capability chips `知识地图 / 学习计划 / AI 推荐`, CTA `进入学习空间`, footer `每天从一条清晰的下一步开始。`. Persists nothing; it is a *display* of the localStorage profile.

**Track B — the real first-run gate.** `App.tsx:338-354`: on `authKey` presence, `fetchOnboardingStatus()`; `if (!status.completed) setShowOnboarding(true)` (`:350`). In static demo mode `App.tsx:339` short-circuits (`setOnboardingChecked(true)`) so **the real wizard is unreachable in the GitHub-Pages demo**.

- `components/OnboardingWizard.tsx:12-162` — **4 steps**, `steps` array at `:61-122`, header `首次使用 · {step+1}/{steps.length} 步生成学习计划` (`:131`), progress dots `:135-139`.
  - Step 1 考试目标: 考试年份, 目标分数（建议 100-130）`(:71)`.
  - Step 2 当前基础: 当前估分, 最薄弱科目 (4 subjects) — copy `诚实评估才能生成有效计划` `(:80)`.
  - Step 3 学习节奏: 距离考试天数, 每日学习小时 — copy `根据可用时间安排每日任务` `(:95)`.
  - Step 4 确认计划: read-only summary of all 6 values `(:112-119)`.
  - Validation gates in `goNext()` `:31-42`: `408 目标分数需要在 60 到 150 分之间。`, `当前估分不能高于目标分数。`, `请检查剩余天数和学习天数。`(actual: `请检查剩余天数和每日学习时间。`).
  - **Skip: NOT FOUND.** Only 上一步 / 下一步 / 生成我的学习计划 (`:148-157`). No close, no dismiss.
  - Persists: `completeOnboarding(form)` → `POST /onboarding/complete` (`api/endpoints/onboarding.ts:76-91`); result used by `App.tsx:378-385` (`setShowOnboarding(false)`, seed `todayPlan`, refresh overview/progress/context).
- Mount point: `features/onboarding/StudentLaunchpad.tsx:127` — `if (showOnboarding) return <OnboardingWizard onComplete={onOnboardingComplete} />;` → the wizard **replaces the whole launchpad**, which itself is rendered inside `StudentSections.tsx:342`. So the student is dropped into the dashboard section and immediately has that section's body swapped for the wizard.

### 1.2 Registration asks 4 steps but persists almost none of it

`features/auth/RegisterWizard.tsx:12` `steps = ['账号信息','考研目标','当前状态','学习习惯']`; progress `Step {step+1} / 4` `:74`.
- Step 0 账号信息: 邀请码, 昵称, 邮箱, 密码, 确认密码 (`:85-89`); password equality/empty gate `:48-51`.
- Step 1 考研目标: 目标院校, 考试类型 (11408 / 自命题), 目标分数 `min=1 max=500` `:96`.
- Step 2 当前状态: 4 subject self-levels 基础/熟悉/进阶 `:102`.
- Step 3 学习习惯: 每天学习时间, 学习方式 — plus the only durability disclosure: `auth-wizard-note` `你的学习档案仅保存在当前浏览器，之后可在系统内继续完善。` `:110`.
- What actually reaches the server: only the hidden inputs `inviteCode, name, email, password, confirmPassword` (`:111-115`). `saveOnboardingProfile(profile)` writes localStorage key `408-os-onboarding-profile` (`onboardingProfile.ts:16,34`).
- **Gap:** `loadOnboardingProfile` is consumed **only** by `OnboardingFlow.tsx:9` → `InitializationCore`/`WelcomeHero`. `targetSchool`, `targetScore`, `examType`, the 4 level answers, `dailyStudyTime`, `studyMode` are **never** read by any dashboard, plan, advice or API call. The student answers 4 steps of "let AI know your goals" and only 目标院校/目标分数 briefly appear on the welcome screen (`WelcomeHero.tsx:17`). Compare `OnboardingWizard` (Track B), which does persist equivalent fields.

### 1.3 Where a first-time student lands after auth

| Condition | Landing |
|---|---|
| `lastAuthAction==='registered'` (student) | `OnboardingFlow` full-screen → (3 s) → `WelcomeHero` → button → then §1.4 |
| `mustChangePassword` | `AuthExperience` gate, `App.tsx:1362` |
| `fetchOnboardingStatus().completed === false` | section `dashboard` → `StudentHome` + `LearningProfileCard` (`StudentSections.tsx:341`) + **`OnboardingWizard` in place of `StudentLaunchpad`** (`:342`, `:127`) |
| onboarding complete | same section, full `StudentLaunchpad` + `TodayLearningRouteView` |
| static demo (github.io, no API) | `showOnboarding` never true → straight to dashboard; nav `#/dashboard`; no wizard, no real guidance |

Default section: `layouts/RoleNavigation.tsx:76-80` → student `'dashboard'`; hash primary, sessionStorage fallback (`useRoleSectionNavigation.ts:17-30`).

### 1.4 `StudentLaunchpad` (the post-onboarding dashboard body)

`features/onboarding/StudentLaunchpad.tsx` — pure assembly, no persistence. Teaches via labeled panel headings only:
- `TodayLearningRouteView` (`:131`), `408 科目模块 / 按科目推进题库训练` + `数据用于后续提分报告和错题复盘` (`:146-147`), `薄弱知识点 TOP5 / 优先复盘这些考点` (`:165`), `最近错题 / 复盘后再进入同考点训练` (`:179`), `本周学习节奏 / 每天只盯一个重点` (`:192`), `掌握度趋势 / 近 7 天练习节奏` (`:206`), exam config `:224-257`.
- `firstDayLearning.ts:24-85` exists and encodes a student's **first day** decision tree (`完成入学诊断` → `开始今日优先任务` → `复盘错题` → `查看学习变化`), with `reason` strings e.g. `登录后系统需要先完成入学诊断…` (`:38`) and secondary action `稍后完成` (`:40`).
  - **NOT FOUND (dead code / unmounted):** `grep -rn "firstDayLearning" apps/web/src` → only `features/student/firstDayLearning.ts` itself. The first-day guidance model is **never rendered**.
- **NOT FOUND (dead code):** `grep -rn "StudentLearningConsole" apps/web/src` → only `features/student/StudentLearningConsole.tsx` (own definition). It contains richer guidance (`:242` `RecommendationEvidence`, `:250` next-step copy, `:185` streak) but is not mounted anywhere.

---

## 2. Explanation surfaces ("why")

| Component | Mount | Props/fields consumed | Source API field |
|---|---|---|---|
| `features/student/RecommendationEvidence.tsx:27` | `PracticePanel.tsx:202` (per-answer), `:311` (per-set); `ReportSummaryPanel.tsx:315`; `MistakeWorkspace.tsx:240`; `StudentLearningConsole.tsx:242` (unmounted) | `title, reason, evidence, impact, confidence, nextDataHint` | client-composed; inputs = `answerResult.correct/knowledgePointTitle`, `practiceSetResult.accuracyRate`, `canonicalOverview.weaknesses.*`, `summaryData.pendingCount/reviewedCount/resolvedCount` |
| `features/today-score-center/WhyRecommendedDrawer.tsx:18` | `TodaysScoreCenter.tsx:163` | `item.scoreBreakdown`, `item.reasonCodes`, `item.score`, `item.title` | `ScoreCenterItem.scoreBreakdown.* / reasonCodes` |
| `features/today-score-center/RecommendationCard.tsx:10` | `TodaysScoreCenter.tsx:148,156` | `item.subject/action/reasonCodes/score/estimatedMinutes`; CTA `为什么推荐` `:41` | same |
| `features/today-score-center/reason-copy.ts:1-26` | — | code→copy map | `HIGH_RECENT_FREQUENCY` 近 3 年高频考查, `LOW_MASTERY`, `LOW_ACCURACY`, `REPEATED_WRONG`, `REVIEW_DUE`, `RISING_TREND`, `PREREQUISITE_GAP`, `EXAM_NEAR`, `LOW_EVIDENCE`(个人数据较少，当前为冷启动建议) |
| `features/practice/exam-aligned/RecommendationReasonCard.tsx:10` | `PracticePanel.tsx:286` (inside `<details>展开逐题推荐理由`) | `item.stars, recent5Frequency, lastSeenYear, mastery, predictedGainEstimate, examHits, primaryNode` | `PracticeSetExamAlignmentItem.*` |
| `features/student/NextLearningStepCard.tsx:25` | `PracticePanel.tsx:219,327`; `ReportSummaryPanel.tsx:308`; `MistakeWorkspace.tsx:252` | `step.contextLabel/title/reason/primaryAction/secondaryAction`; literal label `为什么推荐` `:31` | client-computed from `report`, `todayPlan`, `wrongQuestionSummary` |
| `features/student/actions/StudentActionCard.tsx:9` | `StudentHome.tsx:91`; `TrainingSummary.tsx:37` | `action.source, action.title, action.reason`; prints `来源：{action.source}` `:12` | `StudentAction.reason` |
| `components/TodayPlan.tsx:264-281` | `StudentHome.tsx:102` (inside `<details>展开完整今日计划`) | `task.reason` rendered 3× under labels `为什么做` / `完成标准` / `完成收益` / `做不完怎么办` | `TodayPlan.priorityTasks[].reason` |
| `features/student/home/components/TodayMission.tsx:69` | `StudentHome.tsx:94` | `task.source.reasonCodes` → `REASON_LABELS` (2 max) else `task.reason`; prefix `为什么：` | `priorityTasks[].reasonCodes / reason` |
| `features/student/home/components/DailyBriefCard.tsx:60` | `StudentHome.tsx:86` | `brief.headline, stateLines[], priorities[].{title,minutes,reason,kind}, followUpNote` | `GET /coach/daily-brief` |
| `components/ContextualCoach.tsx:60-77` | `StudentSections.tsx:457`; `TestSection.tsx:99` | `summary, replySteps[], misconceptionTips[], reviewCards[], nextActions[]`, `source`, `fallbackReason` | `ContextualCoachResponse` |
| `components/ErrorReasonSelector.tsx:68-74` | `App.tsx:1744` | static copy `系统会根据你的自评 + 实际用时 + 历史正确率来安排下次复习时间。`; `系统判断本次错因为「{normalizedInferred}」` | `inferredReason` (= `record.mistakeReason`) |
| Sprite evidence | `SpriteWidget.tsx:206-217`, `:246` | `line.evidenceRefs[].{source,field,detail}` under `依据` toggle; label map `:31-38` 学习档案/今日计划/风险提醒/进步叙事/断档恢复/练习会话 | `GET /sprite/state` |
| `features/student/RecommendationEvidence.tsx:21-25` confidence | — | `high` 已有学习记录支撑 / `medium` 有部分记录，建议继续练习验证 / `low` 数据还少，先完成几道题再判断 | prop |

**NOT FOUND:** `grep -rn "Tooltip\|tooltip\|info-icon" apps/web/src --include=*.tsx` → no tooltip/info-icon component exists. Explanation is always an inline block, drawer, or `<details>`. Only `title=` browser tooltips exist (`ApiStateIndicator.tsx:25`, `MasteryTrendPanel.tsx:110,115`, `ExamDiagnosisPanel.tsx:60`). `reportTopFocus.ts:21` carries a `basis` caliber field (`'today-plan+node-weakness' | 'node-weakness' | 'mastery-map' | 'maintenance'`) but **it is never rendered** (`grep -rn "\.basis" apps/web/src` → consumed only inside `ReportSummaryPanel.tsx:154` via `topFocus.headline/afterLine`; the basis string is dropped).

---

## 3. Empty / loading / error / insufficient states

### 3.1 Shared primitives
| Pattern | Location | Copy |
|---|---|---|
| Loading | `ModuleResourceState.tsx:47` | `正在加载{title}` + `其他模块仍可正常使用。` |
| Error | `ModuleResourceState.tsx:47-52` | `{title}暂时不可用` + `resource.error ?? '请稍后重新加载本模块。'` + 重新加载 |
| Inline error | `ModuleResourceState.tsx:73-77` | `{title}暂时不可用` / `不影响当前模块的其他功能。` |
| Sync meta | `ModuleResourceState.tsx:16-19` | `API 数据 · {time} 同步` / `本地演示数据` / `正在同步` / `同步失败，保留上次数据` |
| Empty | `components/ui/EmptyState.tsx:10` | `role="status"`, `title` + optional `description`, `action` |
| API pill | `ApiStateIndicator.tsx:14-17` | `连接中...` / `API · {source}` / `API 异常` (+重试) / `演示数据 · {source}` |

### 3.2 "数据不足 / 暂无 / 未测量 / 无法计算" inventory
| `path:line` | Copy |
|---|---|
| `features/report/ReportSummaryPanel.tsx:22` | verdict `insufficient: '数据不足'` |
| `features/report/ReportSummaryPanel.tsx:115` | `暂无足够对比数据，坚持一周学习后自动生成` |
| `features/report/ReportSummaryPanel.tsx:138` | `当前无明显风险，保持现有节奏即可` |
| `features/report/ReportSummaryPanel.tsx:247` | predicted `--` + `完成练习后基于正确率、掌握度与剩余天数生成` |
| `features/report/ReportSummaryPanel.tsx:273` | `暂无薄弱点数据，完成诊断与练习后自动生成` |
| `features/report/StageReportPanel.tsx:7` | `insufficient: '数据不足'`; `:24` `阶段报告需要测评历史、掌握度与错题数据…`; `:45,48,54,57,72,80` `--` / `上一阶段暂无答题记录` / `暂无两次以上测评记录` / `暂无掌握度数据` / `暂无错题数据` |
| `features/report/ScoreAnchorPanel.tsx:25` | `证据不足：有成对记录，但未达到预注册门槛（每组 ≥5 对且中位误差 <15 分）` |
| `features/report/ScoreAnchorPanel.tsx:24,26,27` | `尚未开始…` / `已有初步校准证据…` / `已达到校准门槛…` |
| `features/report/ScoreAnchorPanel.tsx:96` | `数据存储未就绪，因此不显示任何成绩记录。` |
| `features/report/ScoreAnchorPanel.tsx:116-119` | `还没有任何成绩记录。…系统才会建立你的第一个可信成绩锚点——未测之前系统不会替你编造分数。` |
| `features/report/ScoreAnchorPanel.tsx:129,136,169` | `最近测评（尚无已验证成绩）` / `还没有持久化的预测记录。` / `…验证前不参与校准。` |
| `features/report/ScoreAnchorPanel.tsx:37,112` | `normalizedScore == null → '—'`; `未设置（可在个人信息中录入…）` |
| `features/report/LearningEvidenceLedger.tsx:54` | `学习证据暂时不可用（数据存储未就绪），因此不显示任何能力判断。` |
| `features/report/LearningEvidenceLedger.tsx:62-63` | `只有被系统观测到的作答才能支撑能力判断；自评数字与完成标记会被记录，但不作为能力依据。` |
| `features/report/LearningEvidenceLedger.tsx:72` | `没有可支撑能力推断的观测证据，系统拒绝据此判断能力变化。` |
| `features/report/LearningEvidenceLedger.tsx:76,127` | `还没有任何学习证据记录…` / `未观测到任何表现数据。` |
| `features/report/LearningEvidenceLedger.tsx:113-115` | `观测证据` / `自评证据` / `仅活动` |
| `features/report/TaskEvidencePanel.tsx:53` | `能力提升` / `已练习` / `已练习·未见提升` / `证据不足` |
| `features/report/TaskEvidencePanel.tsx:44` | `完成标记不等于能力提升——…`; `:62` `（快照不足）` |
| `features/report/EffectivenessPanel.tsx:35,114,144,156` | `数据不足` / `个节点证据不足` / `证据不足 ≠ 没进步，只是还不能证明` / `相关不等于因果…不承诺分数变化` |
| `features/report/EffectivenessPanel.tsx:93-95,137-138` | `最近 N 天还没有练习记录…` / `…在此之前系统不会假装知道你提升了多少。` |
| `features/report/MasteryTrendPanel.tsx:48,85,95,105,110` | `暂无掌握度快照…` / `暂无` / `无快照` |
| `features/report/ExamDiagnosisPanel.tsx:56,75,81,91,101` | `本场练习未携带分值口径，无法估算 150 分制得分。` / `暂无真题数据` / `另有 N 道失分题未能归因到知识点。` / `未设置目标分数，暂不进行差距对比。` / `尚未生成恢复计划…` |
| `features/practice/exam-aligned/examAlignmentView.ts:23,29,34,44` | `尚未练习`; estimate null → **no line at all**; `暂无真题数据`; reason null if `stars===0` |
| `features/practice/exam-aligned/RecommendationReasonCard.tsx:16,21` | `暂无真题数据`; `你的当前掌握度：尚未练习` |
| `features/practice/training-room/trainingRoomViewModel.ts:101` | `target: input.target?.trim() \|\| '暂无数据'` |
| `features/practice/training-room/TrainingProgress.tsx:13-14` | `训练进度暂不可用` / `当前训练尚未提供可确认的题目进度。` |
| `features/mistakes/components/PriorityReviewCard.tsx:32,33,46` | `错误 暂无数据 次` / `暂无复习时间` / `当前没有可优先恢复的项目` |
| `features/knowledge-catalog/KnowledgePointDetailDrawer.tsx:232` | `尚未练习该知识点` |
| `StudentLaunchpad.tsx:158,174,187,201,211,214` | `暂无科目掌握度数据…` / `暂无薄弱知识点…` / `暂无近期错题…` / `暂无本周安排…` / `暂无趋势数据` / `完成练习后展示平均掌握度` |
| `StudentSections.tsx:476-477` | `暂无可用题目` / `题库暂未就绪，请先完成入学诊断，或等待教研更新题目后重试。` |
| `TodayLearningRouteView.tsx:52,66,123-126` | `完成入学引导和诊断后生成今日路线。` / `当前没有可执行任务…` / `任务时间暂不可用` |
| `today-score-center/TodaysScoreCenter.tsx:100,135` | `当前展示上一次有效计划，新的推荐计算暂时不可用。` / `还没有今日提分计划。` |
| `displayFormat.ts:8,35,43` | `未评估`; unknown either side → `--`; gap 0 → `'--'` + `目标分与当前估分持平：建议在学习画像里把目标分调到更有挑战的水平…` |
| `TrainingSummary.tsx:49`, `StudentHome.tsx:80-82`, `TodayMission.tsx:71`, `DailyBriefCard.tsx:63-65`, `ProgressStoryCard.tsx:63-65` | `暂无下一步建议` / `学生状态摘要暂不可用，当前保留兼容视图：` / `完成入学引导后，这里会显示你的今日任务。` / `今日简报加载失败：` / `本周进步叙事加载失败：` |

### 3.3 Where `null` is rendered as `0` (dishonest default)
| `path:line` | Detail |
|---|---|
| `features/student/home/components/StudentStateCard.tsx:10` | `const value = subject.value ?? 0;` drives the **ring geometry** (`dash`), while the numeric label correctly shows `'--'` (`:17`). Unknown mastery renders as an empty ring — visually "0%". |
| `features/report/ReportSummaryPanel.tsx:67,71` | `currentScore: student.currentScore ?? 0`, `remainingDays: student.remainingDays ?? 0` fed into `estimatePredictedScore` → a missing diagnostic silently becomes a real-looking prediction input. |
| `features/report/ReportSummaryPanel.tsx:112,130,328` | `stageReport?.streakDays ?? 0`, `wrong.pendingCount ?? 0` → `0` false-negatives in prose ("暂无风险"). |
| `features/today-score-center/RecommendationCard.tsx:22-23`, `WhyRecommendedDrawer.tsx:33,44` | `item.score ?? 0` and `Math.round(breakdown[key] ?? 0)` → a missing priority score/breakdown renders as a literal `0`. |
| `features/report/EffectivenessPanel.tsx:129` | `Math.round((outcome.masteryGain ?? 0) * 100)` → missing gain prints `+0` (inside a gate-passed row, so bounded, but still a zero). |
| `features/student/home/components/TodayMission.tsx:67` | `width: ${model.completionRate ?? 0}%` — bar defaults to empty while the label shows `'--'`. |
| `features/dashboard/StudentProgressOverview.tsx:118,188,191` | `sprint.remainingDays ?? 0 天`, `目标分 {student.targetScore ?? 0}`, `剩余天数 {student.remainingDays ?? 0} 天`, `每日 … ?? 0 小时`. |
| `features/diagnostic/DiagnosticSummary.tsx:59-60` | `student.currentScore ?? 0`, `student.targetScore ?? 0` as headline numbers. |
| `components/WrongQuestionDetail.tsx:168,226` | `连续正确 {masteryCriteria?.consecutiveCorrect ?? 0} 次` inside the literal `系统判定：{masteryStatus}（依据：…）` sentence. |

---

## 4. Correction / guardrail / warning affordances

| # | Surface | `path:line` | Re-routes or only notifies? |
|---|---|---|---|
| 1 | **Submit confirm with unanswered list** — `确认提交{sessionLabel}` + `还有 N 道题未作答：` + up-to-5 `unanswered-jump` buttons that close the modal and `goToQuestion(...)`; per-subject `自评分 / 10`; blocks submit while `missingSubjectiveScores.length > 0` | `ExamSession.tsx:516`, `:528-531`, `:537-544`, `:577-578`, `:583` | **Re-routes** (jump-to-question) and **hard-blocks** (`disabled` + early return at `:277`). The only true pre-submit interception in the app. |
| 2 | Timer pressure | `ExamSession.tsx:306` | Notify only: `remainingSec < 300 ? 'timer-danger' : < 600 ? 'timer-warning'`; `:322` `超时` badge after `isOvertime`. |
| 3 | Autosave state | `ExamSession.tsx:327-334` | Notify + retry: `保存中...` / `保存失败，重试` (button) / `已自动保存` / `等待首次保存`. |
| 4 | Session save/exit failure | `ExamSession.tsx:285-289`, `:298-300` | Notify: `提交失败：…你的作答已自动保存，不会丢失。`; on exit-save failure the comment says `Keep the exam open when the final save fails.` → **silent block** (no copy). |
| 5 | Learning-mode unavailable | `ExamSession.tsx:210` | Notify: `学习模式暂不可用，请稍后重试。` |
| 6 | **错因自评 modal** — `这道题为什么做错了？` + 8 reasons each with hint; `跳过` button; auto-prefill from `inferredReason` | `ErrorReasonSelector.tsx:58-74`, `:65` | **Blocks the flow** (modal, focus-trapped via `useOverlayDialog`), but `跳过` **re-routes out**: `App.tsx:1751-1759` clears the queue and sets `已跳过错因自评，系统仍会保留本次练习记录。` → skipping is honest, not punitive; review spacing is simply not adjusted. |
| 7 | Quest settle without answers | `App.tsx:913-915` | Hard block: `尚未作答，无法结算闯关`. |
| 8 | Today-task launch preflight | `todayLearningRoute.ts:161-168`, `:205-209` | **Re-routes**: on empty knowledge point → `该知识点暂无可用题目，请先调整今日计划。`; then `resolveLaunchableTodayTask` **skips dead tasks and auto-starts the next viable one**, reporting `已跳过暂无内容的任务，自动开始：…` (`App.tsx:816-818`). |
| 9 | Task completion draft validation | `features/plan/taskCompletionDraft.ts:20-33` | Hard block with field-specific copy: `请填写实际完成题数、正确题数、学习分钟和掌握自评。`, `正确题数不能超过实际完成题数。`, `请选择 1-5 级掌握自评。` Surfaced at `TodayPlan.tsx:87-90`. |
| 10 | Rescheduling without a date | `TodayPlan.tsx:135` | Hard block: `请先选择要重新安排的日期。` |
| 11 | **ProactiveCoachCard** | `features/student/home/components/ProactiveCoachCard.tsx:62-82` | **Notifies only — and is inert.** Each item is an `<li>` with a decorative `<ArrowRight>` (`:79`); there is **no `onClick`, no link, no button**. Severity labels `需要处理 / 建议关注 / 可以稍后` (`:22-26`). Fails silently by design (`:46` `proactive surface must never become an error banner`). |
| 12 | **SpriteWidget bubble** | `SpriteWidget.tsx:551-577` | Notifies, then **re-routes**: bubble is a `<button>` (`:564`) that closes the bubble and opens the panel; per-line `line.action.kind === 'deep_link'` renders a chip that sets `window.location.hash = target` (`:233-243`). Quota: ≤1 bubble/day, muted gated, never greets when `idle`/`focused` (`:298-306`); auto-hides after 8 s (`:316`). Mute toggle `免打扰（不主动弹泡）` `:546`. |
| 13 | **ResumeSessionBanner** | `components/ResumeSessionBanner.tsx:52-79` | Re-routes (`继续` → `onResume(session)`) and is dismissible per session (`X`, `:69-75`). Copy: `进度 {progressRate}% · {answeredCount}/{totalQuestions} 题 · {minutes} 分钟`. Mounted `StudentLaunchpad.tsx:218-223` for `practice_set / stage_assessment / paper`. |
| 14 | Today-route terminal warnings | `TodayLearningRouteView.tsx:107-126` | Terminal cards `今日任务已完成` / `当前任务正在等待` (+ exact 可开始时间) / `任务时间暂不可用`; launch errors go to an `aria-live` region `:103-105`. Notify + offer 查看报告 / 复习错题 (`:111-112`). |
| 15 | Streak warnings | — | **NOT FOUND.** `grep -rn "确定要\|确认要\|跳过复习\|警告" apps/web/src` → no streak-loss warning, no "确定要跳过复习吗". Streak appears only as a positive stat: `TodayPlan.tsx:212` `连续 {summary.streakDays} 天`; `StudentHome.tsx:124` `{model.studyStreak ?? '--'} 天连续学习`; `ReportSummaryPanel.tsx:112-113` (counted as an *improvement*); `spriteMood.ts:46` mood `streak / 节奏成型`. |
| 16 | Confirmation dialogs (native) | — | **NOT FOUND.** `grep -rn "window\.confirm\|confirm(" apps/web/src` → no native confirm; the only `confirm` symbols are `CandidateReview.tsx:144` (admin import) and `confirmQuestionImport` (admin API). Student-facing confirmations are all custom `role="dialog"` panels. |
| 17 | Practice-answer double-submit | `App.tsx:650-653`, `features/practice/practiceSubmissionGate.ts` | Technical guard (token gate), **no student-facing copy** — the option buttons simply go `disabled` (`PracticePanel.tsx:136`). |
| 18 | Demo-mode banner | `App.tsx:1427-1431` | Notify: `演示模式：数据保存在本地，未连接真实后端；生产环境不会出现此提示。` |
| 19 | Safety notes on AI | `ContextualCoach.tsx:44` `AI 教练只解释当前学习事实，不会修改你的学习状态或自动生成计划。`; `TutorPanel.tsx:62` `AI 解释仅作辅助，最终以标准答案、标准解析和教师审核内容为准。`; `PracticePanel.tsx:342` `答案解析会由标准解析优先提供，AI 只负责补充讲解和相似题推荐。` | Notify (expectation-setting). |

---

## 5. Progress / result interpretation (numbers → language)

| Component | `path:line` | Language it uses |
|---|---|---|
| `ProgressStoryCard` | `features/report/ProgressStoryCard.tsx:24-71` | Coach-voiced weekly narrative lines from `GET /coach/progress-narrative`; badge `+N 点 / 上周` (`:56-60`); line kinds `gain/decline/flat/milestone/no_data` (`:6`) |
| `TaskEvidencePanel` | `features/report/TaskEvidencePanel.tsx:41-70` | `完成标记不等于能力提升——…` (`:44`); per-task verdict `能力提升/已练习/已练习·未见提升/证据不足`; facts `练习 N 次 · 正确率 X% · {nodeId} ±delta / （快照不足）`; `task.verdictBasis` (`:67`) |
| `LearningEvidenceLedger` | `features/report/LearningEvidenceLedger.tsx:60-90` | `观测证据 / 自评证据 / 仅活动` badges; `共 N 条记录 · 观测证据 a · 自评证据 b · 仅活动 c`; refusal path `系统拒绝据此判断能力变化` (`:72`); `未观测到任何表现数据。` (`:127`); `（不作为能力依据）` (`:128`) |
| `ScoreAnchorPanel` | `features/report/ScoreAnchorPanel.tsx:134,145,155-172` | `系统预测（估算，不是成绩）` section header; four honest calibration states; provenance per row `系统模考/入学诊断/教师判分/采分点评分/真实考试/外部导入/来源未记录/系统预测` (`:12-21`); `· 已验证 / · 待验证` (`:215`); mandate `未测之前系统不会替你编造分数` (`:118`) |
| `MasteryTrendPanel` | `features/report/MasteryTrendPanel.tsx:38-97` | `平均掌握度 {x}%` per subject, `提升最快 +N%`, `需要关注 {delta}%`, `无快照` columns |
| `ExamDiagnosisPanel` | `features/report/ExamDiagnosisPanel.tsx:44-104` | `估算` badge + `score150Estimate.basis` + `（置信度：中）` (`:47,53`); `失分知识点（按 丢题数 × 考频 排序）`; `距目标 N 分：预计 X 分，差 Y 分（估算）`; `恢复计划闭环：a/b（c%）` |
| `GoalProgressInsight` | `features/student/GoalProgressInsight.tsx:57-98` | `这一步如何接近目标`; `当前估分 / 目标分 / 还差 / 剩余天数`; `本周推进`; `今天任务贡献`; disclaimer `本卡只解释学习方向，不承诺单题立即涨分。` (`:96`) |
| `TrainingSummary` | `features/practice/training-room/TrainingSummary.tsx:17-51` | `训练已完成`; metrics `完成题数 / 答对题数 / 正确率`; `下一步行动` (structured actions) vs `补充建议` (strings) |
| `PracticePanel` verdicts | `features/practice/PracticePanel.tsx:61-65`, `:102-104`, `:179-182`, `:294-318` | `本组训练基本达标，可以继续加速巩固。` (≥85) / `本组训练接近达标，建议补齐错题后再练一组。` (≥70) / `本组训练还不稳，先复盘错题，再回到同知识点训练。`; per-answer `下一步建议`; `学习影响与推荐依据` `<details>` with `本次学习影响` |
| `ExamReport` | `components/ExamReport.tsx:74-98`, `:116-174` | Raw-heavy: `正确率 %`, `答对 n/m 题`, `未答 n 题`, `客观题 a/b · c%`, `综合题自评 x/y · z%` / `综合题 N 题未作答或未自评`; `知识点失分 -N`; `考后 3 天复习计划` with `reviewTasks.recommendation` (`:150`); trend `scoreHistory.trendLabel` |
| `StudentProgressOverview` | `features/dashboard/StudentProgressOverview.tsx:118,188-191` | Sprint/trial/reminder metrics incl. `差 {scoreGap} 分 · 剩余 {remainingDays} 天` |
| `LearningProfilePanel` / `LearningProfileCard` | `features/report/LearningProfilePanel.tsx:12`; `features/dashboard/LearningProfileCard.tsx:24` | `{currentStage} · 连续 N 天`; profile metric grid |
| `ProgressRing` | `components/ui/ProgressRing.tsx` | Generic ring primitive; **grep shows no student-facing usage** outside `ui/index.ts` re-export — mastery rings are hand-rolled in `StudentStateCard.tsx:12-18` |
| `TrainingProgress` | `features/practice/training-room/TrainingProgress.tsx:13-14` | `训练进度暂不可用` fallback |
| `WrongQuestionDetail` | `components/WrongQuestionDetail.tsx:168,226` | `{masteryStatus} · 连续正确 N 次`; `系统判定：{masteryStatus}（依据：连续正确 a 次 + 变式答对 b 次）` |
| Transfer/`迁移` language | only `features/transfer-probe/TransferProbeCard.tsx` (§7) | No transfer narrative in report/mastery surfaces |

---

## 6. Navigation and information architecture

### 6.1 Student sections
`layouts/RoleNavigation.tsx:46-53` `studentItems` — **6 visible sections**:

| # | id | label | icon |
|---|---|---|---|
| 1 | `dashboard` | 首页 | Home |
| 2 | `question` | 题库 | BookOpenCheck |
| 3 | `knowledge-catalog` | 知识 | Network |
| 4 | `wrong-book` | 错题 | ShieldCheck |
| 5 | `test` | 测试 | ClipboardCheck |
| 6 | `ai` | AI 答疑 | Brain |

`studentBottomItems` (`:55-62`) duplicates exactly the same 6 for mobile (`StudentBottomNav` `:125`).
`studentCompatSections` (`:64-74`) allows **9** ids: the 6 above + `plan`, `score-center`, `report`.
`normalizeRoleSection` (`:82-86`): `plan`/`score-center` → `dashboard`; `report` → `test`. So `plan` (今日计划) and `report` (提分报告) are **not addressable nav entries** — they are aliases folded into `dashboard` and `test`. `ReportWorkspace` therefore lives inside the `测试` section (`StudentSections.tsx:373` `visibleSection === 'test' || visibleSection === 'report'` → `TestSection`, `TestSection.tsx:109`). `plan` renders nowhere as its own page except `StudyPlanOverview` in mock fallback (`StudentSections.tsx:336-340` `!props.todayPlan && isMockAllowed()`).

Also `AdminLayout`/`TeacherLayout` sections exist (`:32-44`) — out of student scope.

### 6.2 How "the one next action" is decided
`features/student/actions/canonicalNextAction.ts:4-13` — strict precedence waterfall, first match wins:

```
1 continue_session          (input.session)
2 today_task                (input.today)
3 review_due                (input.review)
4 redo_wrong_question       (input.wrongQuestion, source === 'wrong-summary' only)
5 assessment | report action (input.assessment)
6 assessment | report action (input.report)
```

Every candidate must pass `isCanonicalAction` (`:26-28`): `action.type !== 'coach_explain' && action.destination !== 'ai'` — i.e. **the AI surface can never be the canonical next action**.
Candidates are assembled in `StudentSections.tsx:228-233` from `buildTodayAction`, `buildReviewActions` (filtered `review_due` / `redo_wrong_question`), `buildAssessmentActions`, then de-duplicated by id in `actionCandidates.ts:54-63`.
Rendering: `StudentHome.tsx:89-93` under `aria-label="首页核心行动"` → `StudentActionCard`. Consumption of click intent: `StudentSections.tsx:234-304` (per-type switch).
Home dedupes against the today route: `StudentLaunchpad` gets `hideFirstStepAction={canonicalAction?.type === 'today_task'}` (`StudentSections.tsx:357`) → `TodayLearningRouteView.tsx:79-83` prints `这一步已显示在页面上方「首页核心行动」，直接在那里开始即可。` instead of a second start button.
Report-side arbitration mirrors it: `features/student/actions/reportTopFocus.ts:29-76` — open today task wins the headline, weakness becomes the `afterLine`; explicit ordering comment `:34-35`; `ReportSummaryPanel.tsx:145-154` consumes `headline`/`afterLine`.
Other next-step builders (`NextLearningStepCard.tsx:53,102,131,158,183`) are surface-local variants of the same idea (`buildDashboardNextLearningStep`, `buildPlanNextLearningStep`, `buildPracticeNextLearningStep`, `buildWrongBookNextLearningStep`, `buildReportNextLearningStep`) — **note their precedence differs** from the canonical one (dashboard builder offers 直接练题 as secondary; plan builder ignores sessions).
`studentAction*.ts`: `studentAction.ts` (type), `studentActionCommand.ts` (`toCommandDescriptor`), `studentActionDestination.ts` (`toRoleSection`), adapters `todayActionAdapter / reviewActionAdapter / assessmentActionAdapter / trainingActionAdapter / knowledgeActionAdapter / reportActionAdapter / sessionActionAdapter`.
Student-facing loop teaching: `features/student/StudentLoopGuide.tsx:24-33` renders 4 numbered steps `首页/今日任务 → 题库训练 → 错题复盘 → 学习报告` with `不知道下一步做什么时，按这条路走。` (`:12`); mounted for every student section at `App.tsx:1433-1435` (aria `学生学习闭环导航`).

---

## 7. Transfer probe UI

`features/transfer-probe/TransferProbeCard.tsx`
- **Mount site:** `features/report/ReportWorkspace.tsx:124` `<TransferProbeCard />`, inside `role="tabpanel" id="report-panel-overview"` (`:102-107`), i.e. the **总览 tab, which is the default** (`ReportWorkspace.tsx:81` `useState<ReportTab>('overview')`). The report workspace is inside the `测试` nav section (`TestSection.tsx:109`).
- **Visible by default?** Conditionally. Returns `null` when: static demo (`:61`), API error path renders an error section (`:89-95`), `featureEnabled === false` or `storeAvailable === false` (`:39` — silently returns, card stays empty), or `cards.length === 0` (`:146`). So it is **the first thing under the report summary whenever a probe is due and the feature is on**; otherwise it is invisible.
- **Exact student copy:**
  - Idle/available: `迁移复测 · 检验学习是否迁移到新题` (`:150`) + node name (`:153`) + button `开始复测（约 5 分钟）` (`:155`).
  - Running: `迁移复测 · 一道从未见过的新题 · 这不是普通练习` (`:101`), node (`:102`), stem, option buttons, `提交复测` (`:123`, disabled until selected).
  - Result: `本次复测：答对 / 答错` (`:132`) + `这道新题的结果已计入你的学习记录。` (`:133`). **No TransferRate/Gap shown** — doc-comment `:24` states those are teacher/evidence-gate only, and `grep -rn "TransferRate\|transferRate" apps/web/src` confirms no such field is rendered.
  - Expired: `本次复测窗口已过期——这不是失败，下次学习后还会有新的复测。` (`:141`).
  - Error: raw `error` string only (`:92`).
- No persistence to student state; refresh via a `window` event `transfer-probe:refresh` (`:53-58`).

---

## 8. AI coach UI

| Surface | `path:line` | What the student can ask/do | Actionable deep links? | Failure surfacing |
|---|---|---|---|---|
| **TutorPanel** (`ai` section) | `features/tutor/TutorPanel.tsx:21-121` | `讲解当前题` (`:53`); quick modes from `AI_TUTOR_FOLLOW_UP_MODES` (`:64-66`); free-text input placeholder `输入你的问题，例如：这道题为什么选 B？` (`:74`). Renders `answerCheck`, collapsible `分层提示` (`:84-103`), `思路拆解`, `相似题推荐` (`:107`), `下一步` (`:108`), follow-up `易错点提醒` + `reviewCards` (`:111-119`) | **No.** `nextActions` / `reviewCards[].nextAction` / `similarQuestions` render as plain `<li>` / `<span>` text — no buttons, no links | `:56-61` `role="alert"` block: `AI 请求超时或失败，你的其他学习数据不受影响。可稍后重试，或先查看标准解析。` + `重试`. Status line `:55` carries `App.tsx:985` `AI 答疑超时或不可用，可稍后重试，或先查看标准解析。` / `:1006` `AI 追问超时或不可用…`; timeout enforced by `withTimeout(…, 25000)` (`App.tsx:974,995`), error text `AI 请求超时，请稍后重试。` (`useRoleSectionNavigation.ts:116`) |
| **ContextualCoach** | `components/ContextualCoach.tsx:12-80` | `开始辅导` button, free-text input prefilled with `prompt`; contexts: `question` (`StudentSections.tsx:457-467`), `assessment` (`TestSection.tsx:99-103`) | **No.** `nextActions[].` are `<li>` strings (`:72`) | `role="alert"` `:59` `AI 教练暂时无法响应，请稍后重试。`; provenance line `来源：{response.source}` + `当前回答使用备用方案。原因：{response.fallbackReason}` (`:74-75`) |
| **SpriteWidget** (星野) | `features/sprite/SpriteWidget.tsx:251-593` | Full companion panel: mood + `moodReason.detail` (`:434`), tone-tagged `lines` with per-line `依据` evidence toggle (`:219-248`), achievements (`:440-449`), `星野记得` memory add/forget (`:450-478`), `问星野` free chat routed through `POST /agent/supervisor/run` (`:387-393`), mute toggle (`:539-548`) | **Yes — the only AI surface with deep links.** Per-line `action.kind === 'deep_link'` → chip sets `window.location.hash` (`:233-243`, tracked as `sprite.interact/action_click`). Chat replies carry `meta.link` for `tutor-agent → #/ai 去 AI 答疑`, `planner-agent → #/dashboard 看今日计划`, `exam-agent → #/test 去测试` (`:82,90,98`) plus `meta.citations` `依据节点：…` (`:502`) | Degrades in-band, never a banner (`:20-22` comment; `useSpriteState.ts:124-126`): transport failure keeps the sprite hidden entirely; chat failure text `对话失败：{error}。稍后再试一次。` (`:71`), network path `对话失败：暂时连不上星野的大脑，稍后再试试。` (`:397`); deterministic fallback labelled `确定性模式（AI 暂不可用，回答仍基于你的真实数据）` (`:492`); memory failure `记忆暂不可用，稍后再试。` (`:452`). Mounted only for role student with no active session (`App.tsx:1654-1656`) |

---

## 9. Existing telemetry for guidance

`api/events.ts:4-14` — `trackEvent(type, payload?)` → `POST /events`, **best-effort, failures swallowed** (`:11-13`).

| Event name | `path:line` | Feature / what it proves |
|---|---|---|
| `practice.set_start` | `App.tsx:742` | 专项练习 started (训练模式) |
| `practice.set_restart` | `App.tsx:757` | 再来一组 |
| `practice.bank_restart` | `App.tsx:767` | 题库 restarted |
| `practice.learning_mode_start` | `App.tsx:780` | 学习模式 entered |
| `task.start` | `App.tsx:838` (`{taskId, mode}`), `TodayPlan.tsx:110` (`{taskId}`) | Today-task launch, both paths |
| `wrong.open_review` | `App.tsx:850` | 错题复盘 opened per question |
| `quest.start` | `App.tsx:901` | Knowledge-node 闯关 started |
| `quest.complete` | `App.tsx:931` (`{nodeId, accuracy, passed}`) | 闯关 settlement + outcome |
| `assessment.generate` | `App.tsx:940` | 阶段测评 requested |
| `tutor.ask` | `App.tsx:971` | AI 答疑 requested |
| `task.manual_complete` | `TodayPlan.tsx:96` | Manual completion with self-report |
| `task.postpone` | `TodayPlan.tsx:124` | Task deferred (guardrail-adjacent: measures "做不完怎么办" usage) |
| `task.reschedule` | `TodayPlan.tsx:143` (`{taskId, scheduledDate}`) | Task rescheduled |
| `task.rebalance` | `TodayPlan.tsx:157` (`{mode}`) | Plan reduction (`reduce`/`priority_only`) |
| `recommendation.exposed` | `features/recommendation/recommendationExposure.ts:49,57`; **call sites** `TodaysScoreCenter.tsx:77` (surface `score_center`), `TodayMission.tsx:57` (surface `today_mission`) | The surface **actually rendered** the recommendation; payload `{surface, actionId, taskId}`; de-duped per day/surface/item (`:46-48`); suppressed in static demo (`:43`) |
| `recommendation.viewed` | `recommendationExposure.ts:49,62`; call site `TodaysScoreCenter.tsx:83` | Student opened "why recommended" (currently **only** the score-center drawer) |
| `sprite.interact` | `SpriteWidget.tsx:238` (`action_click` + target), `:307` (`bubble_shown` + mood + kind greeting/completion), `:414` (`panel_open`), `:568` (`bubble_click`) | Ambient-nudge funnel: shown → clicked → panel → deep-link taken |

**Coverage gaps (from grep, not inference):**
- `ExposureSurface` declares `'review_queue' | 'exam_aligned'` (`recommendationExposure.ts:25`) but `grep -rn "reportRecommendationExposed\|reportRecommendationViewed" apps/web/src` returns only `TodaysScoreCenter.tsx:77,83` and `TodayMission.tsx:57` → **no exposure telemetry for the review queue or the exam-aligned recommendation cards**, i.e. the two surfaces that carry the richest "why" explanation cannot be measured.
- **NOT FOUND:** `grep -rn "trackEvent(" apps/web/src | grep -i "why\|explain\|evidence\|skip\|dismiss"` → no event for opening `WhyRecommendedDrawer` outside score-center, for `RecommendationEvidence` render/expand, for `依据` (sprite evidence) expands, for `ErrorReasonSelector` skip vs. submit reason breakdown, for `ResumeSessionBanner` continue/dismiss, or for `ProactiveCoachCard` (which has no interaction at all).
- `ContextualCoach` has **no** telemetry (only `tutor.ask` covers `handleAskTutor`; `handleAskFollowUp` is untracked).

---

## 10. Mock data substituting for guidance (noted, not audited)

- `api/env.ts:9-24`: `isMockAllowed()` = static demo OR `import.meta.env.DEV`; `isStaticDemoMode()` requires `hostname.endsWith('github.io') && !VITE_API_BASE_URL`.
- In static demo: guidance components that return `null` and therefore **silently vanish** — `ProactiveCoachCard.tsx:58`, `SpriteWidget.tsx:404`, `DailyBriefCard.tsx:57`, `ProgressStoryCard.tsx:50`, `TaskEvidencePanel.tsx:34`, `LearningEvidenceLedger.tsx:43`, `ScoreAnchorPanel.tsx:74`, `ExamDiagnosisPanel.tsx:35`, `TransferProbeCard.tsx:61`, `TodaysScoreCenter` (skipped at `StudentHome.tsx:97`).
- Conversely, demo mode replaces real guidance with mock *content*: `api/mocks/dashboard.ts:106` `streakDays: 3`, `:379` `accuracyRate: 42.9, streakDays: 1`; `App.tsx:224,232` seed `createMockAiFollowUp()` / `createMockPaperSubmitResult()`; `StudentSections.tsx:336` renders `StudyPlanOverview` only when `!todayPlan && isMockAllowed()`.
- `MasteryTrendPanel.tsx:33` and `EffectivenessPanel.tsx:72` are the two panels that state this explicitly: `演示模式不展示掌握度趋势；登录后按每日快照自动积累。` / `演示模式不展示学习效果；登录后系统会用你的真实练习记录按周评估。`

---

## 11. Consolidated NOT FOUND register (exact patterns)

| Absence | grep pattern | Result |
|---|---|---|
| Onboarding skip / dismiss | `grep -rn "跳过\|skip" apps/web/src --include=*.tsx` | only `ErrorReasonSelector.tsx:65` (错因 skip) and admin `CandidateReview` — **no skip for `OnboardingWizard` or `OnboardingFlow`** |
| Skip-review confirmation | `grep -rn "确定要\|确认要\|跳过复习" apps/web/src` | 0 matches |
| Streak warning | `grep -rn "streak" apps/web/src` | 0 warning paths; display-only (§4 #15) |
| Native confirm | `grep -rn "window\.confirm\|confirm(" apps/web/src` | 0 student-facing |
| Tooltip/info-icon | `grep -rn "Tooltip\|info-icon" apps/web/src --include=*.tsx` | 0 |
| `firstDayLearning` wiring | `grep -rn "firstDayLearning" apps/web/src` | unmounted (dead) |
| `StudentLearningConsole` wiring | `grep -rn "StudentLearningConsole" apps/web/src` | unmounted (dead) |
| `ProgressRing` student usage | `grep -rn "ProgressRing" apps/web/src` | only `components/ui/index.ts` re-export |
| `reportTopFocus.basis` rendering | `grep -rn "\.basis" apps/web/src` | produced (`reportTopFocus.ts:21`) but never rendered |
| Transfer aggregate metrics | `grep -rn "TransferRate\|transferRate" apps/web/src` | 0 (student side by design) |
| Exposure telemetry for review queue / exam-aligned | `grep -rn "reportRecommendationExposed" apps/web/src` | only `TodaysScoreCenter.tsx:77`, `TodayMission.tsx:57` |

---

### Summary judgments

**Guidance that exists:** a real, persisted 4-step onboarding form with inline validation (Track B); a rich, unusually honest reporting stack that refuses to invent numbers (`LearningEvidenceLedger`, `ScoreAnchorPanel`, `TaskEvidencePanel`, `EffectivenessPanel` all print explicit refusal copy and label evidence strength); a single arbitrated "one next action" with mirrored arbitration on the report page; per-answer and per-set "why" evidence blocks; a submit-confirmation modal that actually re-routes to unanswered questions; deep-linked ambient nudges in `SpriteWidget`; and an exposure/viewed funnel for score-center and today-mission recommendations.

**Three biggest gaps:** (1) **Onboarding is theatre plus a discarded questionnaire** — `InitializationCore` is an admitted fake (`:16`), `WelcomeHero` is display-only, and the 4-step `RegisterWizard` profile (target school, levels, daily time, study mode) is written to localStorage and never read by any plan, report or API call, while the *real* onboarding is a separate, unrelated 4-step backend form that replaces the dashboard with no skip and no explanation of what it will do. (2) **Explanations that exist cannot be measured or acted on** — no tooltips, no telemetry on `RecommendationEvidence`/`RecommendationReasonCard`/evidence expands/错因 skip, `reportTopFocus.basis` computed but dropped, no exposure tracking for review-queue or exam-aligned surfaces, and `ProactiveCoachCard` renders warnings as inert `<li>`s with a decorative arrow; every AI `nextAction` in `TutorPanel`/`ContextualCoach` is plain text with no deep link. (3) **`null` degrades to `0` in exactly the places a beginner trusts most** — `StudentStateCard.tsx:10` draws an unknown subject as an empty ring, `ReportSummaryPanel.tsx:67,71` feeds `?? 0` into score prediction, `RecommendationCard.tsx:22` prints a literal `0` priority score, and `StudentProgressOverview.tsx:188` shows `目标分 0` — a first-time student sees zeros where the system's own honesty layer elsewhere says "未评估/尚未测量".
