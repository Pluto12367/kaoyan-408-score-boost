# Student Workspace UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the student workspace body so it feels like a real 408 learning dashboard, not only a navigation shell.

**Architecture:** Keep existing React state and API contracts. Improve the student launchpad markup and CSS only, with source-level UI regression tests.

**Tech Stack:** React, TypeScript, CSS, Node test runner.

## Global Constraints

- Low-token, fast progress, low bug risk.
- No large dependencies.
- No database or backend API changes.
- Verify with targeted tests and `npm run build:web`.

---

### Task 1: Student launchpad body

**Files:**
- Modify: `test/ux-redesign-ui.test.js`
- Modify: `apps/web/src/features/onboarding/StudentLaunchpad.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: existing `StudentLaunchpadProps`
- Produces: CSS classes `student-kpi-strip`, `student-action-grid`, `student-insight-card`, `student-schedule-card`

- [ ] Add failing UI source test for richer student body sections.
- [ ] Run targeted test and confirm it fails.
- [ ] Add student KPI strip, action cards, schedule card, and cleaner insight cards.
- [ ] Add responsive CSS.
- [ ] Run targeted test, `npm run build:web`, and `git diff --check`.
