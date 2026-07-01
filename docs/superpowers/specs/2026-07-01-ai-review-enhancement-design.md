# AI Review Enhancement Design

## Goal

Enhance AI answer review so admins can inspect AI-generated tutoring content with clearer risk context, review guidance, and a "needs recheck" workflow.

This keeps the platform's principle clear: AI can explain and suggest practice, but standard answers and teacher-reviewed content remain authoritative.

## Scope

The first implementation will cover:

- Extend review queue items with review reasons and suggested reviewer actions.
- Add a `needs_recheck` review status for AI-generated content.
- Add a backend endpoint to mark a review item as needing recheck.
- Improve the admin review panel to show risk reasons and review suggestions.
- Add a visible AI safety note in the student AI tutoring area.
- Add static fallback data for GitHub Pages.
- Add smoke coverage for AI review metadata and recheck status.

Out of scope for this step:

- Real LLM safety classification.
- Human moderation assignment queues.
- Fine-grained policy categories.
- Automatic content blocking.
- Persistent review tables.

## User Experience

Admins should be able to open the content review area and quickly understand:

- Whether the item is a teacher question or AI reply.
- Why it needs review.
- What risk level it has.
- What action the reviewer should take.
- Whether it is approved, pending, or needs recheck.

For AI content, the admin should be able to mark it as `needs_recheck` when the answer needs teacher review before being trusted.

Students should also see a short AI tutoring note: AI explanations are auxiliary, and standard answers plus teacher-reviewed explanations are the final reference.

## Data Shape

Extend review items:

```ts
type ReviewItem = {
  id: string;
  contentType: 'question' | 'ai_reply';
  relatedId: string;
  title: string;
  summary: string;
  status: 'pending' | 'approved' | 'needs_recheck';
  riskLevel: 'low' | 'medium' | 'high';
  reviewReason: string;
  suggestedAction: string;
  createdAt: string;
  reviewerId?: string;
  reviewedAt?: string;
};
```

Add endpoint:

```http
POST /admin/review-queue/:reviewItemId/recheck
{ "reviewerId": "admin-001" }
```

The response returns the updated review item.

## Backend Design

Update the shared review item shape used by question review and AI review queues.

When AI tutor or follow-up content is generated, include:

- `reviewReason`: why this AI content should be checked.
- `suggestedAction`: what the reviewer should verify.

Add `markReviewItemNeedsRecheck(reviewItemId, reviewerId)` in the study service. It should update review items owned by the study service and delegate question review items to the questions service when needed.

Update review queue summary counts to keep `pendingCount` and `approvedCount`, and allow individual item status to be `needs_recheck`.

## Frontend Design

Update frontend types to include `needs_recheck`, `reviewReason`, and `suggestedAction`.

Update the admin review panel:

- Show risk level and status.
- Show review reason.
- Show suggested action.
- Provide buttons for `通过` and `标记复查`.

Update the AI tutoring section with a visible note explaining that AI is an auxiliary explanation source.

## Error Handling

- If recheck submission fails, keep the queue as-is and show a short failure status.
- If older review items do not have `reviewReason` or `suggestedAction`, display a safe fallback string.
- Invalid review item ids should return `BadRequestException`.

## Tests

Update `scripts/smoke-migration.mjs` to verify:

- AI review items include `reviewReason` and `suggestedAction`.
- `POST /admin/review-queue/:reviewItemId/recheck` marks an AI item as `needs_recheck`.
- The review queue returns the updated status.

Existing verification should still pass:

- `npm test`
- `npm run smoke:migration`

## Review Notes

This feature improves trust and reviewability without pretending to solve full AI moderation. It gives admins enough information to decide whether an AI answer can be trusted, needs revision, or should wait for teacher review.
