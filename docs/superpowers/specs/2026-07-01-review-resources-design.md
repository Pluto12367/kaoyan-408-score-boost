# Review Resources Recommendation Design

## Goal

Add a student-facing review resource recommendation feature for the 408 score-boost platform. The feature should turn weak point detection into concrete review actions: concept cards, mistake checklists, example walkthroughs, and focused practice entries.

This strengthens the current score-improvement loop:

1. Diagnose weak points.
2. Generate a plan.
3. Practice and produce records.
4. Review mistakes.
5. Recommend targeted review resources.
6. Return to focused practice.

## Scope

The first implementation will cover:

- A backend endpoint that recommends review resources for the current student.
- Resource recommendations derived from existing weak points, wrong questions, mastery data, and knowledge points.
- A frontend panel titled `复习资源推荐`.
- Static fallback data for the GitHub Pages demo.
- Smoke coverage proving recommendations include actionable metadata and reflect newly detected weak points.

Out of scope for this step:

- Teacher-uploaded files, videos, or external links.
- Full resource library management.
- Paid content, downloads, or document hosting.
- Real LLM-generated learning materials.
- Persistent PostgreSQL resource tables.

## User Experience

Students should see a compact resource recommendation panel near the learning report and weak point area. The panel should answer:

- Which knowledge point should I review now?
- What kind of review should I do?
- How long will it probably take?
- What should I do after reading it?

Each card should be short and action-oriented. It should not feel like a document library. The first version should guide students back into the existing study loop through concept review, mistake review, example walkthrough, or focused practice.

## Data Shape

Use a compact recommendation object:

```ts
type ReviewResource = {
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
};

type ReviewResourceRecommendation = {
  source: 'memory-api' | 'postgres-ready-api' | 'mock';
  userId: string;
  generatedAt: string;
  weakPointCount: number;
  items: ReviewResource[];
};
```

`actionAnchor` should point to an existing section or flow in the prototype, such as `#wrong-book`, `#practice`, or `#report`. It is an internal navigation hint, not an external URL.

## Backend Design

Add `GET /review-resources/recommended?userId=u-001` in the study controller.

In `StudyService`, add `getRecommendedReviewResources(userId?: string)`. It should derive recommendations from existing in-memory data:

- `getOverviewReport()` for current weak points.
- `getMasteryMap()` as fallback when weak point data is sparse.
- `listWrongQuestions()` for mistake-oriented resources.
- Existing knowledge points for subject and chapter metadata.

The service should prioritize the highest-risk weak points. For each selected weak point, generate one or more resource cards:

- `concept_card`: review the core definition, formula, or rule.
- `mistake_checklist`: check recurring error causes and confusion points.
- `example_walkthrough`: walk through a representative problem-solving pattern.
- `practice_set`: return to focused practice for verification.

The first version can generate deterministic template resources rather than storing full teaching content. This keeps the feature useful while staying compatible with the current memory API and future PostgreSQL migration.

## Frontend Design

Add API helpers:

- `fetchReviewResourceRecommendations(userId?: string)`
- `createMockReviewResourceRecommendations()`

Add React state:

- `reviewResources`

Render a student panel titled `复习资源推荐`. It should show:

- A small summary line with weak point count and generated time.
- 3 to 6 resource cards.
- Resource type, subject, knowledge point, estimated minutes, and next action.

The panel should use the existing dashboard style: dense but readable cards, restrained colors, and no marketing-style hero section.

If the backend is unavailable, use mock data so the deployed static GitHub Pages demo remains complete.

## Error Handling

- If the recommendation endpoint fails, keep mock recommendations and keep the page usable.
- If there are no weak points, return a small set of maintenance resources for high-frequency 408 topics.
- If a weak point cannot be matched to a knowledge point, use the weak point title and subject from the report as fallback.
- Invalid or missing `userId` should not break the prototype; default to the current demo student.

## Tests

Update `scripts/smoke-migration.mjs` to verify:

- `GET /review-resources/recommended?userId=u-001` returns recommendation items.
- Each item includes `knowledgePointId`, `resourceType`, `estimatedMinutes`, and `actionAnchor`.
- After submitting a practice record that creates a weak point, recommendations include that weak knowledge point.

Existing verification should still pass:

- `npm test`
- `npm run smoke:migration`

## Review Notes

This design intentionally avoids a full content management system. The immediate value is helping students move from "I know I am weak here" to "I know what to review next and how to verify it." The data shape leaves room for future teacher-managed resources and PostgreSQL persistence without making this step too large.
