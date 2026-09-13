# Development Protocol

> **Status**: authoritative detailed procedure for all agents.
> **Rule summary** (short, non-negotiable): root [`AGENTS.md`](../../AGENTS.md) §11 "Development Protocol Red Lines".
> **Where the project is**: [`docs/current-sprint.md`](../current-sprint.md).
>
> If this file conflicts with root `AGENTS.md`, **`AGENTS.md` governs**.
> This file is the *procedure*; `AGENTS.md` is the *rule*.

This is an executable operating protocol, not an essay. Every section states
**Entry condition**, **Required actions**, **Exit condition** and
**Forbidden behavior**. Follow sections in order for any non-trivial task.

---

## 0. Task Intake

**Entry condition**: a task has been assigned in natural language.

**Required actions**

1. Classify the task and write the classification down before touching files:

   | Class | Meaning | Phases required |
   |---|---|---|
   | `READ-ONLY` | audit / status / inventory | §2 only |
   | `DOC-ONLY` | documentation, governance, comments | §2, §10, §11 |
   | `CODE-BEHAVIOR` | any change to runtime behavior | §2 → §3 → §4 → §5 → §6 → §7/§8 → §9 → §10 → §11 |
   | `SCHEMA` | Prisma schema or migration | as `CODE-BEHAVIOR` + §3 Owner gate + §12 |
   | `CONFIG` | env / compose / feature flags | as `CODE-BEHAVIOR` + §12 |

2. Run the preflight and record the literal output:

   ```bash
   git status --short
   git branch --show-current
   git rev-parse HEAD
   git log -1 --oneline
   ```

3. Record every already-dirty and untracked path. These belong to other work
   streams until proven otherwise. They are **not** yours to stage, revert,
   format or delete.

4. Determine the task's **Allowed Scope** and **Forbidden Scope**, and state
   them explicitly in the first report.

5. Read [`AGENTS.md`](../../AGENTS.md), [`docs/current-sprint.md`](../current-sprint.md),
   and the design/architecture document that covers the touched area.

**Exit condition**: the task class, preflight output, dirty-path inventory,
allowed scope and forbidden scope are all written down.

**Forbidden behavior**

- Starting to edit before the preflight is recorded.
- Assuming a dirty file is yours because it looks related.
- Using this repository's chat history or a report from a previous session as
  the source of truth instead of the code (**`AGENTS.md` §1**).

---

## 1. Read-only Audit

**Entry condition**: §0 completed for a `CODE-BEHAVIOR`/`SCHEMA`/`CONFIG` task,
or the task itself is `READ-ONLY`.

**Required actions**

1. Establish facts **only** from: current source, `prisma/schema.prisma`,
   migrations, configuration, tests and `git log`. Never from memory or prose.
2. Cite evidence as `path:line`. A claim with no `path:line` is an opinion.
3. When a document and the code disagree, **the code wins**; record the
   disagreement as a finding (**`AGENTS.md` §1**).
4. Explicitly separate:
   - what already exists in code,
   - what exists only in a document,
   - what does not exist at all.
5. Identify the true gap. A "missing feature" is often already implemented and
   merely unwired - verify before proposing new code.
6. Register risks with severity and the exact evidence that supports them.

**Exit condition**: an audit artifact exists (inline report or `docs/*audit*.md`)
containing facts with `path:line`, the verified gap, and a risk list.

**Forbidden behavior**

- Proposing implementation inside the audit section.
- Silently "fixing" a document/code conflict instead of reporting it.
- Declaring something absent without a repository-wide search.

---

## 2. Design Gate

**Entry condition**: §1 audit complete and the gap is verified.

**Required actions**

1. Produce a design that states: scope, non-goals, data flow, contract
   (API/type shape), migration impact, rollback, test strategy, and milestone
   breakdown.
2. Answer the product question **"which of the four score levers does this move,
   and how will it be measured?"** If it cannot be answered, the default is
   **do not build it**.
3. Declare explicitly which sources of truth are read and which are written.
   Any new writer, second ledger, second engine, or second mastery path must be
   named and justified.
4. Mark every item that needs an **Owner Decision** (see §12) instead of
   deciding it yourself.
5. For code-affecting work, perform the open-source reference check
   (root `AGENTS.md`, "Open-source reference check before coding";
   [details](open-source-reference-check.md),
   [short checklist](pre-coding-checklist.md)).
   Applicability by task class (the §0 taxonomy governs):

   | Task class | Reference check |
   |---|---|
   | `READ-ONLY` | not required |
   | `DOC-ONLY` | not required |
   | `CODE-BEHAVIOR` | **required** |
   | `SCHEMA` | **required** |
   | `CONFIG` | **required** |
6. End the design with an explicit stop, e.g. `**STOP. Awaiting implementation approval.**`

**Exit condition**: an approved design exists, and every open decision is either
answered by the Owner or listed as blocking.

**Forbidden behavior**

- Writing production code during the Design Gate.
- Treating an inferred requirement as an approved requirement.
- Quietly changing product semantics (labels, thresholds, currencies, score
  meaning) while "designing".
- Expanding scope beyond the assigned task.

---

## 3. TDD RED

**Entry condition**: the Design Gate is approved and the change is behavioral.

**Required actions**

1. Write the failing test **first**, asserting the intended contract.
2. Run it and **capture the failure output**. The failure must be the failure
   you predicted (wrong value / missing module), not a typo or import error.
3. Record the command and the observed failure verbatim in your working notes.
4. Prefer table-driven, branch-complete tests over happy-path-only tests.
5. For a bug fix, the RED test must reproduce the reported defect.

**Exit condition**: a committed-to-working-tree failing test plus recorded
failure evidence, reproducible by re-running the exact command.

**Forbidden behavior**

- Writing implementation before the RED test.
- Claiming "RED confirmed" without a captured failure output.
- Writing a test that passes before the fix (that test proves nothing).
- Weakening or deleting an existing assertion to make room for new behavior.

---

## 4. GREEN

**Entry condition**: §3 exit condition met.

**Required actions**

1. Write the **smallest** implementation that makes the RED test pass.
2. Re-run the focused test and record `PASS`.
3. Re-run the test file's full set, not just the new case.
4. If the minimal implementation would require touching a frozen area
   (Mastery writer, Recommendation engine, Score engine, Transfer Probe
   runtime, shared engine), **stop and escalate** (§12) instead of reaching in.

**Exit condition**: focused tests green, with the exact command and result
recorded.

**Forbidden behavior**

- Broad refactors bundled into a GREEN step.
- Adjusting the test to match the implementation (**RULE-02**).
- Passing a test by adding a fallback that silently fabricates data
  (`null` -> `0`, `default 150`, `?? 0.75`). Such fallbacks are defects
  (**RULE-06**).

---

## 5. Integration Tests

**Entry condition**: §4 exit condition met.

**Required actions**

1. Run the integration suites that cover the touched area, using the real
   script that exists in the repository, for example:

   | Area | Command |
   |---|---|
   | Baseline PostgreSQL | `npm run test:integration:postgres` |
   | Score anchor | `npm run test:integration:score-anchor` |
   | Score loop | `npm run test:integration:score-loop` |
   | Transfer probe | `npm run test:integration:transfer-probe` |
   | Guidance protocol | `npm run test:integration:guidance-protocol` |
   | Effectiveness | `npm run test:integration:effectiveness` |
   | Event key | `npm run test:integration:event-key` |
   | Content import | `npm run test:integration:content-import` |

2. Record the script exit code and the step count (`N steps PASSED`).
3. A stub-only or in-memory-only run is **not** integration evidence.

**Exit condition**: the relevant integration scripts exited 0, recorded.

**Forbidden behavior**

- Reporting "integration OK" from a unit test that mocks the database.
- Editing the integration script's assertions to match observed output.
- Skipping an integration suite without labelling the omission.

---

## 6. Real PostgreSQL / HTTP E2E

**Entry condition**: the change touches the database, cross-module wiring,
auth/guards, or production-visible semantics.

**Required actions**

1. Exercise the real path: real PostgreSQL, real HTTP, real write path - not a
   sandbox stub.
2. Assert the *rejection* paths too (401/403, ownership, duplicate submit,
   idempotency), not only the happy path.
3. Assert what must **not** have changed: unrelated tables, unrelated writers,
   authoritative counts.
4. For anything named "verified", assert that no automatic
   `generated -> verified` promotion path exists.
5. Record the endpoint, the actor identity, the request, and the observed
   response.

**Exit condition**: real-stack evidence recorded, including at least one
negative assertion.

**Forbidden behavior**

- Labelling a stub run as E2E (**RULE-03**).
- Claiming a production state from a local run.
- Treating "the endpoint returned 401 instead of 404" as functional
  verification of business behavior; it proves *routing and guards* only.

---

## 7. Substitute Gate

Sometimes the real gate cannot run in the current environment. When that
happens, you must **name the substitute and downgrade the claim**.

**Allowed only when**

- the real command fails for an **environment** reason, not a product reason,
  and
- the failure is reproducible and identifiable as environmental, and
- the substitute covers the same verification dimension.

**Documented example in this repository**: restricted environments where
`node --test` per-file child process spawning and `esbuild` spawning fail with
`EPERM`. This is an environment limit, not a code defect. Recognised
substitutes:

1. Per-file tests: `node --test <file.test.js>`.
2. Type dimension only: `npx tsc -p <package>/tsconfig.json --noEmit` for
   `packages/shared`, `apps/api`, `apps/web`.

**Not allowed when**

- the real gate fails for a product reason (a genuine assertion failure,
  a genuine type error) - that must be reported as `FAIL`, not substituted;
- the dimension being verified is the one that cannot run (you cannot
  substitute a type check for an E2E assertion).

**Required labelling** (both in the report and in any ledger entry):

```
GATE: <real command>
RESULT: SUBSTITUTE GATE
SUBSTITUTE: <command actually run>
COVERAGE LOST: <what the real gate would have proven and this did not>
```

**Exit condition**: the substitute is labelled as above and the lost coverage is
stated.

**Forbidden behavior**

- Reporting `PASS` for a gate that never ran.
- Silently swapping in a weaker gate.
- Using a substitute gate to justify a release, deployment or a "verified"
  claim.

---

## 8. Regression

**Entry condition**: §4-§7 exit conditions met.

**Required actions**

1. Run the full unit/service suite: `npm test`.
2. Compare against the **current baseline** recorded in
   [`docs/current-sprint.md`](../current-sprint.md). Establish the baseline one
   of two ways, and say which:
   - if the suite runs: the counts from the run itself;
   - if the suite cannot run (substitute gate), the last recorded
     engineering-verified baseline plus its commit.
3. Report in the four-part form: `passed / total / failed / skipped` **and**
   `NEW REGRESSION = <n>`.
4. Any pre-existing failure must be attributed: reproduce it without your
   change, or state `PRE-EXISTING, ATTRIBUTION UNVERIFIED`.
5. Run the builds that apply: `npm run build:shared`, `npm run build:api`,
   `npm run build:web`.

**Exit condition**: regression numbers recorded against a named baseline, with
`NEW REGRESSION` stated.

**Forbidden behavior**

- Changing assertions until the suite is green (**RULE-02**).
- Dropping a failing test from the run.
- Reporting a delta without naming the baseline it is relative to.
- Claiming `0 regression` when the pre-existing failures were never attributed.

---

## 9. Git Verification

**Entry condition**: all gates above are done.

**Required actions**

1. Inspect exactly what you changed:

   ```bash
   git status --short
   git diff --stat
   git diff --name-only
   ```

2. Stage **precise paths only**. Never `git add .` / `git add -A`
   (**RULE-12**).
3. Confirm that no path belonging to another work stream entered the staging
   area.
4. Review the staged diff for accidental edits (formatting noise, unrelated
   files, generated artifacts).
5. Confirm that no secret, `.env` file or local log is staged.

**Exit condition**: a staging area that contains exactly the intended files.

**Forbidden behavior**

- `git add .`, `git add -A`, `git add -u`.
- `git reset --hard`, `git clean -fd`, `git checkout -- .`, `git restore .`.
- Committing or pushing without explicit authorization (**`AGENTS.md` §9**).
- Overwriting another agent's or the Owner's in-flight files.

---

## 10. Reporting

**Entry condition**: §9 exit condition met.

**Required actions**

Report with these sections, and use only the sanctioned status words:

| Status word | Meaning |
|---|---|
| `PASS` | ran, and met the stated expectation |
| `FAIL` | ran, and did not meet it |
| `SKIPPED` | deliberately not run, with a reason |
| `BLOCKED` | could not run, with the concrete blocking condition |
| `UNVERIFIED` | not checked at all |

1. Files changed (exact paths).
2. Verification evidence: command + observed result, per gate.
3. Regression statement against a named baseline.
4. Honest boundaries: what was not done, not verified, or blocked.
5. Remaining risk and the next allowed step.

For any task involving Score / Mastery / Evidence, every number quoted must
carry its class: `OBSERVED` / `DERIVED` / `PROXY` / `UNAVAILABLE`
(see [observed-derived-proxy.md](observed-derived-proxy.md)).

**Exit condition**: a report where every claimed gate maps to a command that was
actually run, and every unrun gate is labelled.

**Forbidden behavior**

- `SKIPPED -> PASS`, `BLOCKED -> PASS`, `UNVERIFIED -> PASS` (**RULE-15**).
- Reporting the *intent* of a change as if it were the *observed* effect.
- Presenting a proxy or model output as a measured score gain (**RULE-11**).
- Describing a deployment as verified when only the code was verified.

---

## 11. STOP / Owner Decision

**Entry condition**: any of the following appears.

You must **STOP and escalate** - never decide unilaterally - when the work
requires:

| Trigger | Why it is an Owner gate |
|---|---|
| Prisma schema expansion or change | irreversible blast radius, migration planning |
| Destructive migration (drop / rename / truncate) | data loss risk |
| Semantic change to Score / Mastery / Evidence | invalidates historical comparability |
| Change to production behavior or feature flags | production blast radius |
| Recommendation ranking currency switch | product decision, not engineering |
| Creating a second SoT / ledger / engine / task system | architecture decision |
| Scope expansion beyond the assigned task | authority boundary |
| Two valid rules that cannot be reconciled | governance conflict |
| Archiving something that might be another agent's live work | data loss risk |

**Required escalation format**

```
STOP CONDITION
Evidence:
Risk:
Decision Required:
```

**Exit condition**: the Owner answered, or the task is recorded as
`BLOCKED` / `PARTIAL` with the STOP item named.

**Forbidden behavior**

- Guessing the Owner's intent and proceeding.
- Implementing the "obvious" version of a gated decision.
- Reporting the task as `COMPLETE` while a STOP item is open.

---

## 12. Phase Close-out

**Entry condition**: all gates passed and the report is written.

**Required actions**

1. Update [`docs/current-sprint.md`](../current-sprint.md) - **current status
   only**. Do not paste the whole history into the current summary
   (**RULE-16**).
2. Record new landmines, new baselines, and changed file ownership.
3. If the change altered a documented contract, update the document that owns it.
4. Commit only with explicit authorization, in the structure requested for the
   task, and never mixing unrelated work streams.

**Exit condition**: ledger reflects the new reality; the handoff is reproducible
by a fresh agent.

**Forbidden behavior**

- Leaving the ledger describing a state that no longer exists.
- Growing the "current status" section into a historical log.
- Marking a milestone complete while a gate is `BLOCKED`/`UNVERIFIED`.