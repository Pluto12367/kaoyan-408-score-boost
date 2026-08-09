# Responsive Sticky Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep workspace navigation reachable while scrolling on desktop and tablet without introducing an independent content scroll container.

**Architecture:** Preserve the existing `app-shell` DOM and browser window scrolling. Add stable style hooks to the sidebar brand and role navigation, then use CSS-only breakpoints: a viewport-height sticky sidebar above `900px`, a compact horizontally scrollable sticky navigation bar from `721px` through `900px`, and the existing student bottom navigation at `720px` and below.

**Tech Stack:** React 18, TypeScript, CSS Grid/Flexbox, Vite, Node.js `node:test` source-contract tests.

## Global Constraints

- Do not modify Question Annotation, Retrieval V2, API, database, Prisma, migrations, or production Mock gates.
- Do not make `.topbar` sticky and do not add scroll listeners, animation state, hooks, Context, dependencies, or an independently scrolling `.workspace`.
- Desktop is strictly `>900px`; tablet is `721–900px`; mobile is `<=720px`.
- Preserve all navigation items, role filtering, click callbacks, active styles, `aria-current`, URL hash behavior, and the existing five-item student bottom navigation.
- Perform the repository open-source reference check before the first production-code edit and summarize its influence in the final handoff.
- Follow RED → GREEN → REFACTOR and run the repository verification gate before claiming completion.
- Do not commit, push, create/switch branches, merge, or stage files unless the user separately and explicitly authorizes that Git write operation.

---

## File Map

- Modify `apps/web/src/App.tsx`: add the `sidebar-brand` style hook to the existing sidebar brand wrapper; no behavioral changes.
- Modify `apps/web/src/layouts/RoleNavigation.tsx`: add the `role-navigation` style hook to the existing semantic `<nav>`; no item or event changes.
- Modify `apps/web/src/styles.css`: implement desktop sticky sidebar, tablet sticky horizontal navigation, and breakpoint resets while preserving mobile rules.
- Create `test/responsive-sticky-navigation.test.js`: protect the structural hooks, breakpoint contract, overflow behavior, mobile boundary, and absence of scroll listeners.
- Reference `docs/superpowers/specs/2026-08-09-responsive-sticky-navigation-design.md`: approved requirements and acceptance criteria.

---

### Task 1: Implement Responsive Sticky Navigation

**Files:**
- Create: `test/responsive-sticky-navigation.test.js`
- Modify: `apps/web/src/App.tsx:1209-1214`
- Modify: `apps/web/src/layouts/RoleNavigation.tsx:84-104`
- Modify: `apps/web/src/styles.css:617-655`
- Modify: `apps/web/src/styles.css:3065-3073`
- Modify: `apps/web/src/styles.css` near the responsive navigation rules before `@media (max-width: 720px)`

**Interfaces:**
- Consumes: existing `.app-shell`, `.sidebar`, `.sidebar-student`, `.bottom-nav`, `RoleNavigationProps`, `onNavigate(section)`, and `activeSection`.
- Produces: CSS hooks `.sidebar-brand` and `.role-navigation`; desktop sticky sidebar behavior; tablet sticky horizontal navigation behavior.
- Preserves: `RoleNavigation` and `StudentBottomNav` component signatures and all navigation data.

- [ ] **Step 1: Perform the open-source reference check**

Read 2–4 primary or mature references before editing production code:

1. MDN `position: sticky` behavior and containing-block constraints.
2. MDN overflow guidance for `overflow-y: auto` and `overflow-x: auto`.
3. WAI-ARIA guidance for navigation landmarks and `aria-current="page"`.
4. One mature responsive dashboard/navigation example using CSS-only sticky behavior.

Record a short implementation note containing:

```text
- Sticky must not sit inside an ancestor that becomes the unintended scrolling container.
- Desktop overflow belongs to the tall sidebar only; normal page content keeps window scrolling.
- Tablet overflow is horizontal and touch-scrollable; navigation items do not wrap or shrink.
- Semantic nav and aria-current remain unchanged.
```

Do not copy source code. Re-implement the patterns using this repository's existing selectors and breakpoints.

- [ ] **Step 2: Write the failing responsive navigation contract**

Create `test/responsive-sticky-navigation.test.js` with this content:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('desktop sidebar stays visible while the document keeps native scrolling', async () => {
  const app = await source('apps/web/src/App.tsx');
  const styles = await source('apps/web/src/styles.css');
  const sidebarRule = styles.match(/\.sidebar\s*\{([^}]*)\}/)?.[1] ?? '';

  assert.match(app, /<div className="sidebar-brand">/);
  assert.match(sidebarRule, /position:\s*sticky;/);
  assert.match(sidebarRule, /top:\s*0;/);
  assert.match(sidebarRule, /align-self:\s*start;/);
  assert.match(sidebarRule, /height:\s*100vh;/);
  assert.match(sidebarRule, /height:\s*100dvh;/);
  assert.match(sidebarRule, /overflow-y:\s*auto;/);
  assert.doesNotMatch(app, /addEventListener\(['"]scroll/);
  assert.doesNotMatch(styles, /\.workspace\s*\{[^}]*height:\s*100(?:d)?vh;[^}]*overflow-y:\s*auto;/);
});

test('tablet uses one sticky horizontally scrollable role navigation row', async () => {
  const navigation = await source('apps/web/src/layouts/RoleNavigation.tsx');
  const styles = await source('apps/web/src/styles.css');

  assert.match(navigation, /<nav className="role-navigation" aria-label=/);
  assert.match(styles, /@media \(min-width:\s*721px\) and \(max-width:\s*900px\)/);
  assert.match(styles, /@media \(min-width:\s*721px\) and \(max-width:\s*900px\) \{[\s\S]*?\.sidebar \{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;[\s\S]*?z-index:\s*30;/);
  assert.match(styles, /\.sidebar-brand \{[\s\S]*?display:\s*none;/);
  assert.match(styles, /\.sidebar \.role-navigation \{[\s\S]*?display:\s*flex;[\s\S]*?overflow-x:\s*auto;/);
  assert.match(styles, /\.sidebar \.role-navigation button \{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?width:\s*auto;[\s\S]*?white-space:\s*nowrap;/);
});

test('mobile student bottom navigation remains the only sticky student navigation', async () => {
  const styles = await source('apps/web/src/styles.css');

  assert.match(styles, /@media \(max-width:\s*720px\)/);
  assert.match(styles, /\.sidebar-student \{\s*display:\s*none;/);
  assert.match(styles, /\.bottom-nav \{[\s\S]*?position:\s*fixed;[\s\S]*?bottom:\s*0;/);
});
```

- [ ] **Step 3: Run the focused test and confirm RED**

Run:

```sh
node --test test/responsive-sticky-navigation.test.js
```

Expected: failures for the absent `sidebar-brand` and `role-navigation` hooks and the absent desktop/tablet sticky rules. The existing mobile assertion may already pass; do not weaken it to manufacture a failure.

- [ ] **Step 4: Add stable structural style hooks without changing behavior**

In `apps/web/src/App.tsx`, change only the brand wrapper:

```tsx
<div className="sidebar-brand">
  <p className="eyebrow">408 Score Boost</p>
  <h1>计算机考研 408 提分系统</h1>
</div>
```

In `apps/web/src/layouts/RoleNavigation.tsx`, change only the role navigation opening tag:

```tsx
<nav className="role-navigation" aria-label={`${resolvedRole}功能`}>
```

Do not alter item arrays, icon rendering, button order, `aria-current`, or `onClick`.

- [ ] **Step 5: Implement the minimal desktop sticky sidebar CSS**

Add these declarations to the existing `.sidebar` rule, retaining its current colors, layout, gap, and padding:

```css
.sidebar {
  align-self: start;
  height: 100vh;
  height: 100dvh;
  overflow-y: auto;
  position: sticky;
  top: 0;
}
```

Inside the existing `@media (max-width: 900px)` `.sidebar` rule, reset the desktop-only constraints:

```css
.sidebar {
  align-self: stretch;
  height: auto;
  overflow: visible;
  position: static;
}
```

Do not set a viewport height or vertical overflow on `.workspace` or `.app-shell`.

- [ ] **Step 6: Implement the minimal tablet sticky horizontal navigation CSS**

Add a new block after the existing `@media (max-width: 900px)` section and before the existing mobile bottom-navigation section:

```css
@media (min-width: 721px) and (max-width: 900px) {
  .sidebar {
    align-self: start;
    gap: 0;
    max-width: 100vw;
    overflow: visible;
    padding: 8px 12px;
    position: sticky;
    top: 0;
    z-index: 30;
  }

  .sidebar-brand {
    display: none;
  }

  .sidebar .role-navigation {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
  }

  .sidebar .role-navigation button {
    flex: 0 0 auto;
    padding: 10px 12px;
    white-space: nowrap;
    width: auto;
  }
}
```

Keep `z-index: 30` below the existing mobile bottom navigation's `z-index: 40` and below dialog/overlay layers. Do not hide scrollbars globally and do not add JavaScript to center the active item.

- [ ] **Step 7: Run focused navigation tests and confirm GREEN**

Run:

```sh
node --test test/responsive-sticky-navigation.test.js test/mobile-nav-ui.test.js test/auth-gate-ui.test.js test/knowledge-catalog-ui.test.js test/p2-ux-cleanup.test.js test/question-import-ui.test.js test/today-score-center-ui.test.js test/ux-redesign-ui.test.js
```

Expected: all selected navigation and workspace contract tests pass with zero failures.

- [ ] **Step 8: Refactor only duplicated responsive selectors protected by GREEN tests**

Review the new CSS beside the existing `@media (max-width: 900px)` and `@media (max-width: 720px)` blocks. Consolidate only exact duplicate declarations when doing so does not change cascade order. Re-run the focused tests after any refactor:

```sh
node --test test/responsive-sticky-navigation.test.js test/mobile-nav-ui.test.js
```

Expected: zero failures.

- [ ] **Step 9: Run Web build and complete regression tests**

Run:

```sh
npm run build:web
npm test
```

If Vite/esbuild fails with sandbox-only `spawn EPERM`, record that exact failure and rerun the same command with the required external permission; do not change production code to work around the sandbox.

Expected: Web build succeeds and the complete test suite has zero failures. Existing chunk-size or mixed static/dynamic import warnings may be reported but must not be presented as new failures.

- [ ] **Step 10: Perform responsive browser verification**

Start the existing local Web/API environment using repository-documented commands. Inspect the authenticated workspace at these viewport widths:

```text
1440px: desktop sidebar remains visible after scrolling to the page bottom.
1024px: desktop sidebar remains visible; a tall sidebar can scroll internally.
768px: brand is hidden; one-row role navigation remains at the viewport top and scrolls horizontally.
390px: student sidebar stays hidden; fixed bottom navigation remains visible and does not cover content.
```

At every width, verify:

```text
- clicking a navigation item changes the same active section as before;
- active item keeps aria-current="page";
- Tab focus reaches every visible navigation item;
- no page-level horizontal overflow appears;
- no double content scrollbar appears;
- sticky navigation does not cover dialogs or overlays.
```

Capture screenshots only if they materially help review. Do not enter or transmit production credentials during local verification.

- [ ] **Step 11: Review scope and Git boundary**

Run:

```sh
git diff --check
git status --short
git diff -- apps/web/src/App.tsx apps/web/src/layouts/RoleNavigation.tsx apps/web/src/styles.css test/responsive-sticky-navigation.test.js
```

Expected modified production/test scope:

```text
apps/web/src/App.tsx
apps/web/src/layouts/RoleNavigation.tsx
apps/web/src/styles.css
test/responsive-sticky-navigation.test.js
```

The approved design and this plan may also remain uncommitted documentation changes. Confirm that no Question Annotation or Retrieval V2 file appears. Do not stage or commit unless the user explicitly authorizes it.

- [ ] **Step 12: Final handoff**

Report:

```text
- files changed and why;
- open-source reference directions and how they influenced sticky/overflow/accessibility choices;
- focused RED and GREEN evidence;
- build and complete test results;
- desktop/tablet/mobile browser verification results;
- remaining warnings or risks;
- Git status, explicitly noting that no commit/push occurred unless separately authorized.
```
