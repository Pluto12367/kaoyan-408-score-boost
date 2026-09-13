# Verification Gates

> **Status**: authoritative gate catalogue.
> **Rule summary**: root [`AGENTS.md`](../../AGENTS.md) §7 and §11.
> **Procedure**: [development-protocol.md](development-protocol.md).
>
> If this file conflicts with root `AGENTS.md`, **`AGENTS.md` governs**.

A **gate** is a named, runnable check with a binary outcome and recorded
evidence. "I looked at it" is not a gate. "It should work" is not a gate.

Every gate result must be reported with one of exactly five words:

| Result | Meaning |
|---|---|
| `PASS` | the command ran and met the stated expectation |
| `FAIL` | the command ran and did not meet it |
| `SKIPPED` | deliberately not run; a reason is required |
| `BLOCKED` | could not run; the concrete blocking condition is required |
| `UNVERIFIED` | not checked at all |

---

## The three separations that must never collapse

```text
Release-ready   !=  Deployed
Deployed        !=  Deployed and Verified
Engineering Verified  !=  Score Verified
```

### Release-ready != Deployed

`release-ready` means the code passes Gates V0-V7 in a local or CI
environment. Nothing about the production server is implied. Deployment is
Owner-controlled (see Gate V8).

### Deployed != Deployed and Verified

`deployed` means new code is running on the target. It does **not** mean the
behavior works. Deployment is verified only by external, non-invasive
observation after the fact: health endpoint, migration status, route
registration and guard behavior, and a real authenticated smoke against real
data.

A deploy script printing "Deployment succeeded" proves the script finished. It
does not prove the feature works.

### Engineering Verified != Score Verified

`engineering verified` means the system behaves as specified. It says nothing
about whether students learn better or score higher.

The project North Star is `Verified Score Gain / 30d`. It is **not implemented**,
because it requires matched before/after measurements in the `PRIMARY`
calibration layer, and that sample is currently zero. Engineering verification
of a feature is **never** evidence of score gain (**RULE-11**).

---

## Gate V0 - Repository integrity

**Purpose**: know exactly what state you are verifying.

| Field | Value |
|---|---|
| Command | `git status --short` / `git branch --show-current` / `git rev-parse HEAD` / `git log -1 --oneline` |
| PASS | branch and HEAD recorded; every dirty and untracked path enumerated and attributed (yours / another work stream / unknown) |
| BLOCKED | cannot distinguish which dirty paths belong to this task |
| UNVERIFIED | preflight not run |

Notes: an unattributed dirty path is a governance finding, not a nuisance.
In this repository `.zcode/` and in-flight S1 files are known examples of
another work stream's material.

---

## Gate V1 - Build / typecheck

**Purpose**: the change compiles on all affected surfaces.

| Field | Value |
|---|---|
| Commands | `npm run build:shared`, `npm run build:api`, `npm run build:web`, and/or `npx tsc -p <pkg>/tsconfig.json --noEmit` |
| PASS | exit code 0 on every applicable surface |
| FAIL | any real type or build error |
| SUBSTITUTE GATE | `tsc --noEmit` alone when the bundler cannot spawn; coverage lost = bundling/bundling-time resolution |

Notes: choose the surfaces the change actually touches. A frontend change
requires `build:web`; a shared-domain change requires all three.

---

## Gate V2 - Unit / service tests

**Purpose**: the behavioral contract holds.

| Field | Value |
|---|---|
| Command | `npm test` (`npm run build:shared && node --test`) |
| PASS | no new failures relative to the named baseline |
| FAIL | any new failure |
| SUBSTITUTE GATE | `node --test <file.test.js>` per file; coverage lost = cross-file isolation and aggregate run |
| BLOCKED | runner cannot spawn (`EPERM`), and no substitute executed |

Report as `passed / total / failed / skipped` plus `NEW REGRESSION = <n>`.

---

## Gate V3 - Integration

**Purpose**: the change works against a real database through the project's own
scripts.

| Field | Value |
|---|---|
| Commands | see the integration table in [development-protocol.md](development-protocol.md) §5 |
| PASS | script exit code 0 and all steps reported `PASSED` |
| FAIL | any step failed |
| BLOCKED | Docker/PostgreSQL unavailable - state the concrete condition |
| NOT A GATE | a unit test with a mocked database |

---

## Gate V4 - Real PostgreSQL / HTTP E2E

**Purpose**: prove the real path, including the paths that must reject.

| Field | Value |
|---|---|
| Command | the task-specific E2E script, or a documented real-stack manual run |
| PASS | happy path **and** at least one negative assertion (401/403, ownership, duplicate submit, idempotency) pass on a real stack |
| FAIL | happy path passes but a rejection path does not |
| BLOCKED | no real database or no reachable HTTP surface |
| NOT A GATE | stub/sandbox service tests; route-exists checks alone |

Required when the change touches: database, cross-module wiring, auth/guards,
production-visible semantics, or anything whose honesty depends on the real
write path.

---

## Gate V5 - Regression

**Purpose**: the change did not break what already worked.

| Field | Value |
|---|---|
| Command | full `npm test` (or the labelled substitute), plus the builds |
| PASS | `NEW REGRESSION = 0`, with the baseline named and its commit stated |
| FAIL | any new failure |
| UNVERIFIED | pre-existing failures were observed but never attributed |

Baseline discipline: a delta without a named baseline is not a result. If the
suite cannot run, the baseline is the last recorded engineering-verified count
in [`docs/current-sprint.md`](../current-sprint.md), and that fact must be
stated explicitly.

---

## Gate V6 - Git verification

**Purpose**: the change set is exactly what you intended.

| Field | Value |
|---|---|
| Command | `git status --short`, `git diff --stat`, `git diff --name-only` |
| PASS | staged set equals the intended set; no unrelated path; no secret; no generated artifact |
| FAIL | any unintended path staged, or any Owner/other-agent in-flight file touched |
| NOT A GATE | `git add .` (forbidden - RULE-12) |

---

## Gate V7 - Release-ready

**Purpose**: the change may be handed to the Owner for deployment.

| Field | Value |
|---|---|
| Requires | V0-V6 `PASS`, plus a complete report, plus the ledger updated |
| PASS | every required gate `PASS`; any unavoidable substitute labelled with coverage lost |
| BLOCKED | any required gate is `BLOCKED`/`UNVERIFIED` |

`Release-ready` is a statement about code and evidence only. It is **not** a
deployment and **not** a verification of production.

---

## Gate V8 - Deployment (Owner-controlled, outside agent authority)

**Purpose**: sequence the production transition honestly.

The agent does **not** execute production server operations. The agent may
prepare and verify the runbook; the Owner executes it.

State vocabulary - use exactly one, never blur them:

```text
CODE READY            code + evidence complete; nothing deployed
DEPLOYMENT PENDING    Owner approval or execution outstanding
DEPLOYED              new code observed running on the target
DEPLOYED AND VERIFIED external observation confirms the intended behavior
FAILED                deployment attempted and did not succeed
```

Rules:

- `CODE READY` may never be reported as `DEPLOYED`.
- `DEPLOYED` may never be reported as `DEPLOYED AND VERIFIED`.
- Route registration (a route answering `401` instead of `404`) verifies routing
  and guards only. It is not evidence of business behavior.
- A production feature flag left at its safe default is a correct outcome, not
  an incomplete one.

---

## Gate V9 - Score verification (NOT IMPLEMENTED)

**Purpose**: measure actual score improvement. This gate does not exist yet.

| Field | Value |
|---|---|
| Status | `NOT IMPLEMENTED` |
| Blocker | `PRIMARY`-layer calibration sample is currently zero; `ScoreOutcome` has no automatic source (manual/teacher entry only) |
| Consequence | `Verified Score Gain / 30d` must **not** be computed or claimed |

Until this gate exists, every claim about improvement must be phrased as a
`PROXY` or `DERIVED` statement with its basis, and never as a verified score
gain (**RULE-11**, [observed-derived-proxy.md](observed-derived-proxy.md)).

---

## Quick reference

| Gate | Dimension | Typical substitution allowed |
|---|---|---|
| V0 | repository integrity | none |
| V1 | build / typecheck | `tsc --noEmit` (label coverage lost) |
| V2 | unit / service | per-file `node --test` |
| V3 | integration | none |
| V4 | real DB / HTTP E2E | none |
| V5 | regression | per-file runner, labelled |
| V6 | git | none |
| V7 | release-ready | inherits V1/V2/V5 substitutions, all labelled |
| V8 | deployment | Owner-only, not an agent gate |
| V9 | score verification | does not exist yet |