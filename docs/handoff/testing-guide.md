# Testing Guide

## Standard Commands

From repository root:

```bash
npm test
npm run build:api
npm run build:web
npm run check:local
npm run test:integration:postgres
```

Useful targeted commands:

```bash
npm run build:shared
node --test
npm run validate:env:development
```

## Current Handoff Verification

This handoff package was generated as a documentation-only change.

No tests were run during handoff generation.

Reason: the user requested a handoff package and no business-code change. Running the full verification chain is still required before claiming a code implementation is complete.

## Required Verification For Phase 2.8.5

After implementing `OverviewReportSelector`, run at least:

```bash
npm test
npm run build:api
```

If frontend types or shared DTOs are touched, also run:

```bash
npm run build:web
```

If any Prisma-backed projection or query service is changed, also run:

```bash
npm run test:integration:postgres
```

## Suggested Contract Tests

Selector tests should verify:

- empty snapshot -> empty selections
- practice-only snapshot -> weak points and mistake patterns are deterministic
- mastery snapshot -> weak point ranking prefers mastery facts when available
- speed risk selection is based on slow answers
- no UI/recommendation fields appear in selection output
- stable tie-breaking by ID
- `knowledgePointId` and `knowledgeNodeId` semantics are explicit

## Do Not Claim Completion Unless

- tests pass
- build passes
- no unrelated files were modified
- legacy `/reports/overview` compatibility is preserved
- no Prisma schema change was made without explicit approval
