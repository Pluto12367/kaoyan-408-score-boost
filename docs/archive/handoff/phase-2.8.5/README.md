# ARCHIVED — Phase 2.8.5 Handoff Package

> **ARCHIVED / SUPERSEDED. DO NOT USE AS A CURRENT RULE SOURCE.**

This directory contains historical handoff materials from Phase 2.8.5
(CQRS read-path migration: `OverviewReportSelector` / `OverviewReportAdapter`),
produced around 2026-08-30. The original package entry document is preserved as
`ORIGINAL-README.md`.

These documents do **not** define current project architecture, status,
deployment state, or development rules.

## Current entrypoints

| Purpose | Authoritative file |
|---|---|
| Agent rules (HOW) | `AGENTS.md` (repository root) |
| Project status (WHERE) | `docs/current-sprint.md` |
| Development procedure | `docs/development/development-protocol.md` |
| Verification gates | `docs/development/verification-gates.md` |

## Why this package is dangerous if read as current

Its documents still use imperative rule language (`Forbidden Actions`,
`How To Continue`, `Do Not Claim Completion Unless`) bound to facts that are
**no longer true**. Verified example:

- `agent-context.md` states that `OverviewReportSelector` "exists (pure,
  contract-tested) and is intentionally not wired yet".
- Repository fact: `apps/api/src/study/overview-report-projection.service.ts`
  already imports and calls `OverviewReportSelector`
  (`overview-report-projection.service.ts:10` import, `:191` call).

An agent that reads this package as current would be instructed to avoid work
that is already finished, and to treat a completed phase as not started.

## Original content preserved

Content is preserved verbatim; only this notice file was added and the original
`README.md` was renamed to `ORIGINAL-README.md`. Historical facts in these files
are **not** rewritten, so that they remain auditable against the commits they
describe.