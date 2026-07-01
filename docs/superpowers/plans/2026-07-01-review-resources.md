# Review Resources Recommendation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a student-facing review resource recommendation feature that turns weak points into concept cards, mistake checklists, example walkthroughs, and focused practice entries.

**Architecture:** Add one derived recommendation endpoint to the existing NestJS study service, one typed API/mock layer in the React app, and one compact student panel in the existing dashboard. Recommendations are deterministic and derived from current weak point, mastery, wrong-question, and knowledge-point data so the feature works in the memory API and remains compatible with the future PostgreSQL migration.

**Tech Stack:** React, TypeScript, NestJS, existing in-memory study service, existing smoke script, GitHub Pages static fallback.

---

## File Structure

- Modify `scripts/smoke-migration.mjs`: add contract checks for `GET /review-resources/recommended`.
- Modify `apps/api/src/study/study.controller.ts`: expose the recommendation endpoint.
- Modify `apps/api/src/study/study.service.ts`: derive recommendation resources and define local resource interfaces.
- Modify `apps/web/src/api.ts`: add frontend types, mock data, and fetch helper.
- Modify `apps/web/src/App.tsx`: load and render the resource recommendation panel.
- Modify `apps/web/src/App.css`: add compact card styles for the new panel.

## Task 1: Smoke Test Contract

**Files:**
- Modify: `scripts/smoke-migration.mjs`

- [ ] **Step 1: Add a failing endpoint contract check**

Insert this block after the `updatedOverview` assertion that checks `co-cache` appears as the updated weak point:

```js
  const reviewResources = await waitForJson(`${apiUrl}/review-resources/recommended?userId=u-001`, (data) =>
    data.items?.length >= 3 && data.items.some((item) => item.knowledgePointId === 'co-cache'),
  );
  assert(reviewResources.weakPointCount >= 1, 'review resources should expose weak point count');
  assert(
    reviewResources.items.every((item) =>
      item.knowledgePointId && item.resourceType && item.estimatedMinutes > 0 && item.actionAnchor,
    ),
    'review resources should include actionable metadata',
  );
```

- [ ] **Step 2: Run smoke to verify the contract fails**

Run:

```powershell
npm run smoke:migration
```

Expected: FAIL because `/review-resources/recommended` is not implemented yet.

## Task 2: Backend Recommendation Endpoint

**Files:**
- Modify: `apps/api/src/study/study.controller.ts`
- Modify: `apps/api/src/study/study.service.ts`

- [ ] **Step 1: Add the controller route**

Add this method near the existing recommendation endpoints:

```ts
  @Get('review-resources/recommended')
  getRecommendedReviewResources(@Query('userId') userId?: string) {
    return this.studyService.getRecommendedReviewResources(userId);
  }
```

- [ ] **Step 2: Add the service method**

Add this method in `StudyService`, near `getRecommendedPracticeSet`:

```ts
  getRecommendedReviewResources(userId = this.student.id): ReviewResourceRecommendation {
    const report = this.getOverviewReport();
    const masteryMap = this.getMasteryMap(userId);
    const wrongQuestions = this.listWrongQuestions(userId);
    const weakPointCandidates = report.weakPoints.length
      ? report.weakPoints.map((point) => ({
        knowledgePointId: point.knowledgePointId,
        title: point.title,
        subject: point.subject,
        accuracyRate: point.accuracyRate,
      }))
      : masteryMap.weakestPoints.map((point) => ({
        knowledgePointId: point.knowledgePointId,
        title: point.title,
        subject: point.subject,
        accuracyRate: point.accuracyRate,
      }));
    const selectedPoints = weakPointCandidates.slice(0, 3);
    const fallbackPoint = this.knowledgePoints[0];
    const items = (selectedPoints.length ? selectedPoints : [{
      knowledgePointId: fallbackPoint.id,
      title: fallbackPoint.title,
      subject: fallbackPoint.subject,
      accuracyRate: 70,
    }]).flatMap((point, index) => {
      const wrongQuestion = wrongQuestions.find((item) => item.knowledgePointId === point.knowledgePointId);
      const knowledgePoint = this.knowledgePoints.find((item) => item.id === point.knowledgePointId);
      const title = knowledgePoint?.title ?? point.title;
      const subject = knowledgePoint?.subject ?? point.subject ?? '408';
      const chapter = knowledgePoint?.chapter ?? '高频章节';
      const baseMinutes = point.accuracyRate < 50 ? 18 : 12;

      return [
        {
          id: `resource-${point.knowledgePointId}-concept`,
          knowledgePointId: point.knowledgePointId,
          knowledgePointTitle: title,
          subject,
          resourceType: 'concept_card' as const,
          title: `${title} 核心概念卡`,
          summary: `先复述 ${chapter} 中 ${title} 的定义、适用条件和常见题干关键词。`,
          estimatedMinutes: baseMinutes,
          difficulty: index === 0 ? '基础' as const : '中等' as const,
          actionText: '看完后做一组同考点题',
          actionAnchor: '#question',
        },
        {
          id: `resource-${point.knowledgePointId}-mistake`,
          knowledgePointId: point.knowledgePointId,
          knowledgePointTitle: title,
          subject,
          resourceType: 'mistake_checklist' as const,
          title: `${title} 错因检查清单`,
          summary: wrongQuestion
            ? `该考点已有 ${wrongQuestion.wrongCount} 次错误，优先检查：${wrongQuestion.latestMistakeReason ?? '概念混淆'}。`
            : `按概念不清、条件遗漏、计算失误、审题偏差四类检查最近错因。`,
          estimatedMinutes: 8,
          difficulty: '基础' as const,
          actionText: '去错题本复盘',
          actionAnchor: '#wrong-book',
        },
        {
          id: `resource-${point.knowledgePointId}-practice`,
          knowledgePointId: point.knowledgePointId,
          knowledgePointTitle: title,
          subject,
          resourceType: 'practice_set' as const,
          title: `${title} 专项验证训练`,
          summary: `完成 3 到 5 道同知识点题目，用正确率和耗时判断是否已经补上。`,
          estimatedMinutes: 15,
          difficulty: point.accuracyRate < 60 ? '中等' as const : '提高' as const,
          actionText: '进入专项训练',
          actionAnchor: '#question',
        },
      ];
    }).slice(0, 6);

    return {
      source: process.env.DATABASE_URL ? 'postgres-ready-api' : 'memory-api',
      userId,
      generatedAt: new Date().toISOString(),
      weakPointCount: report.weakPoints.length,
      items,
    };
  }
```

- [ ] **Step 3: Add service interfaces**

Add these interfaces near the other exported interfaces at the bottom of `study.service.ts`:

```ts
export interface ReviewResourceRecommendation {
  source: 'memory-api' | 'postgres-ready-api';
  userId: string;
  generatedAt: string;
  weakPointCount: number;
  items: ReviewResource[];
}

export interface ReviewResource {
  id: string;
  knowledgePointId: string;
  knowledgePointTitle: string;
  subject: string;
  resourceType: 'concept_card' | 'mistake_checklist' | 'example_walkthrough' | 'practice_set';
  title: string;
  summary: string;
  estimatedMinutes: number;
  difficulty: '基础' | '中等' | '提高';
  actionText: string;
  actionAnchor: string;
}
```

- [ ] **Step 4: Run backend build**

Run:

```powershell
npm run build:api
```

Expected: PASS with TypeScript compilation complete.

## Task 3: Frontend API and Mock Data

**Files:**
- Modify: `apps/web/src/api.ts`

- [ ] **Step 1: Add frontend types**

Add these interfaces near other student learning interfaces:

```ts
export interface ReviewResourceRecommendation {
  source: 'memory-api' | 'postgres-ready-api' | 'mock';
  userId: string;
  generatedAt: string;
  weakPointCount: number;
  items: ReviewResource[];
}

export interface ReviewResource {
  id: string;
  knowledgePointId: string;
  knowledgePointTitle: string;
  subject: string;
  resourceType: 'concept_card' | 'mistake_checklist' | 'example_walkthrough' | 'practice_set';
  title: string;
  summary: string;
  estimatedMinutes: number;
  difficulty: '基础' | '中等' | '提高';
  actionText: string;
  actionAnchor: string;
}
```

- [ ] **Step 2: Add mock data**

Add this function near the other `createMock...` helpers:

```ts
export function createMockReviewResourceRecommendations(): ReviewResourceRecommendation {
  return {
    source: 'mock',
    userId: student.id,
    generatedAt: new Date().toISOString(),
    weakPointCount: 1,
    items: [
      {
        id: 'resource-co-cache-concept',
        knowledgePointId: 'co-cache',
        knowledgePointTitle: 'Cache 映射与替换',
        subject: '计算机组成原理',
        resourceType: 'concept_card',
        title: 'Cache 映射与替换核心概念卡',
        summary: '先复述直接映射、全相联、组相联的地址划分和替换策略适用条件。',
        estimatedMinutes: 12,
        difficulty: '基础',
        actionText: '看完后做一组同考点题',
        actionAnchor: '#question',
      },
      {
        id: 'resource-co-cache-mistake',
        knowledgePointId: 'co-cache',
        knowledgePointTitle: 'Cache 映射与替换',
        subject: '计算机组成原理',
        resourceType: 'mistake_checklist',
        title: 'Cache 映射与替换错因检查清单',
        summary: '重点检查地址位数拆分、块号映射、替换策略和命中率计算是否混淆。',
        estimatedMinutes: 8,
        difficulty: '基础',
        actionText: '去错题本复盘',
        actionAnchor: '#wrong-book',
      },
      {
        id: 'resource-co-cache-practice',
        knowledgePointId: 'co-cache',
        knowledgePointTitle: 'Cache 映射与替换',
        subject: '计算机组成原理',
        resourceType: 'practice_set',
        title: 'Cache 映射与替换专项验证训练',
        summary: '完成 3 到 5 道同知识点题目，用正确率和耗时判断是否已经补上。',
        estimatedMinutes: 15,
        difficulty: '中等',
        actionText: '进入专项训练',
        actionAnchor: '#question',
      },
    ],
  };
}
```

- [ ] **Step 3: Add fetch helper**

Add this helper near `fetchRecommendedPracticeSet`:

```ts
export async function fetchReviewResourceRecommendations(userId: string): Promise<ReviewResourceRecommendation> {
  const response = await fetch(`${API_BASE_URL}/review-resources/recommended?userId=${encodeURIComponent(userId)}`);
  if (!response.ok) {
    throw new Error(`Review resources request failed with ${response.status}`);
  }

  return response.json() as Promise<ReviewResourceRecommendation>;
}
```

- [ ] **Step 4: Run web build**

Run:

```powershell
npm run build:web
```

Expected: PASS with Vite build output.

## Task 4: Frontend Panel

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: Import API helpers and type**

Add `createMockReviewResourceRecommendations`, `fetchReviewResourceRecommendations`, and `type ReviewResourceRecommendation` to the existing imports from `./api`.

- [ ] **Step 2: Add state and loading**

Add this state near the other student analytics state:

```tsx
  const [reviewResources, setReviewResources] = useState<ReviewResourceRecommendation>(() => createMockReviewResourceRecommendations());
```

Add `fetchReviewResourceRecommendations('u-001')` to the existing `Promise.all` list, add a matching `resources` variable in the `.then` tuple, and call:

```tsx
        setReviewResources(resources);
```

In the `.catch` block, call:

```tsx
        setReviewResources(createMockReviewResourceRecommendations());
```

- [ ] **Step 3: Refresh resources after learning data changes**

Add this helper near the existing refresh helpers:

```tsx
  async function refreshReviewResources(userId = student.id) {
    const nextReviewResources = await fetchReviewResourceRecommendations(userId);
    setReviewResources(nextReviewResources);
  }
```

Call `await refreshReviewResources(student.id)` after successful diagnostic submission, practice answer submission, practice set submission, task completion, wrong-question review, paper submission, and stage assessment submission where nearby refresh helpers are already called.

- [ ] **Step 4: Render the panel**

Insert this section near the existing report and assessment history panels:

```tsx
        <section id="review-resources" className="panel review-resources-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">复习资源推荐</p>
              <h3>把薄弱点变成下一步复习动作</h3>
            </div>
            <span>{reviewResources.weakPointCount} 个薄弱点</span>
          </div>
          <p className="task-status">
            更新时间 {new Date(reviewResources.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}，
            优先处理当前报告和错题本里最容易提分的知识点。
          </p>
          <div className="review-resource-grid">
            {reviewResources.items.map((item) => (
              <article key={item.id} className={`review-resource-card resource-${item.resourceType}`}>
                <div>
                  <span>{reviewResourceTypeLabel[item.resourceType]}</span>
                  <small>{item.subject} / {item.difficulty} / {item.estimatedMinutes} 分钟</small>
                </div>
                <strong>{item.title}</strong>
                <p>{item.summary}</p>
                <a href={item.actionAnchor}>{item.actionText}</a>
              </article>
            ))}
          </div>
        </section>
```

Add this label map near the other label maps:

```tsx
const reviewResourceTypeLabel = {
  concept_card: '概念卡片',
  mistake_checklist: '错因清单',
  example_walkthrough: '例题拆解',
  practice_set: '专项训练',
};
```

- [ ] **Step 5: Add CSS**

Add this CSS:

```css
.review-resources-panel {
  scroll-margin-top: 24px;
}

.review-resource-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.review-resource-card {
  border: 1px solid #d8e2ee;
  border-radius: 8px;
  padding: 14px;
  background: #ffffff;
  display: grid;
  gap: 10px;
}

.review-resource-card div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}

.review-resource-card span {
  font-size: 12px;
  font-weight: 700;
  color: #0f766e;
}

.review-resource-card small {
  font-size: 12px;
  color: #64748b;
  text-align: right;
}

.review-resource-card strong {
  font-size: 15px;
  color: #0f172a;
}

.review-resource-card p {
  margin: 0;
  color: #475569;
  line-height: 1.6;
}

.review-resource-card a {
  color: #2563eb;
  font-weight: 700;
  text-decoration: none;
}
```

- [ ] **Step 6: Run web build**

Run:

```powershell
npm run build:web
```

Expected: PASS with Vite build output.

## Task 5: Verification and Commit

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run full verification**

Run:

```powershell
npm test
npm run build:api
npm run build:web
npm run smoke:migration
```

Expected: all commands PASS.

- [ ] **Step 2: Inspect git diff**

Run:

```powershell
git diff --stat
git diff -- scripts/smoke-migration.mjs apps/api/src/study/study.controller.ts apps/api/src/study/study.service.ts apps/web/src/api.ts apps/web/src/App.tsx apps/web/src/App.css
```

Expected: only review resource recommendation changes are present.

- [ ] **Step 3: Commit**

Run:

```powershell
git add scripts/smoke-migration.mjs apps/api/src/study/study.controller.ts apps/api/src/study/study.service.ts apps/web/src/api.ts apps/web/src/App.tsx apps/web/src/App.css docs/superpowers/plans/2026-07-01-review-resources.md
git commit -m "feat: add review resource recommendations"
```

Expected: one commit containing the implementation plan and feature changes.

## Task 6: Deployment Check

**Files:**
- No source edits expected.

- [ ] **Step 1: Push branch**

Run:

```powershell
git push origin codex/deployment-ready
```

Expected: push succeeds and GitHub Actions starts.

- [ ] **Step 2: Check GitHub Actions**

Run the existing workflow polling command for branch `codex/deployment-ready`.

Expected: latest Pages deployment completes successfully.

- [ ] **Step 3: Check the deployed bundle**

Fetch the GitHub Pages HTML, locate the latest JS bundle, and verify it contains:

- `复习资源推荐`
- `概念卡片`
- `错因清单`

Expected: all strings are present in the deployed bundle.

## Self-Review

- Spec coverage: backend endpoint, service derivation, frontend panel, static fallback data, smoke coverage, and deployment check are all mapped to tasks.
- Placeholder scan: no unresolved placeholder markers or open-ended implementation steps remain.
- Type consistency: `ReviewResourceRecommendation`, `ReviewResource`, `fetchReviewResourceRecommendations`, `createMockReviewResourceRecommendations`, and `reviewResources` use the same names across backend, frontend, and tests.
