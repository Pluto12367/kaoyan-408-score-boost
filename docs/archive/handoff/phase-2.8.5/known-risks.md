> **ARCHIVED / HISTORICAL / SUPERSEDED — DO NOT USE AS A CURRENT RULE SOURCE.**
> Phase 2.8.5 handoff material (2026-08-30). Facts here may be obsolete and some
> instructions are known to be wrong (see `README.md` in this directory).
> Current rules: repository root `AGENTS.md`.
> Current status: `docs/current-sprint.md`.
# Known Risks

## knowledgePointId / knowledgeNodeId Confusion

Legacy `WeaknessReport.weakPoints[].knowledgePointId` was designed around `KnowledgePoint.id`.

Current mastery projection compatibility can place `knowledgeNodeId` into the legacy `knowledgePointId` field.

Risk:

- recommended practice set may interpret node IDs as knowledge point IDs
- stage assessment may select questions using the wrong ID space
- frontend keys and filters may silently work with mixed semantics

Mitigation:

- Selector output should explicitly include ID type.
- Adapter should own legacy field mapping.
- Do not make `knowledgePointId` mean different things in new contracts.

## Mastery Source Mixing

Current Overview report mixes:

- legacy `computeMasteryReport()` from `PracticeRecord` and `KnowledgePoint`
- new `UserKnowledgeMastery` from ScoreCenter/KnowledgeNode
- StudyService local `nodeMasteryByUser` cache

Risk:

- weak points may come from node mastery while speed risks and mistake reasons come from practice records
- accuracy units and semantics may differ
- report may look coherent while internally using mixed sources

Mitigation:

- Snapshot should record source metadata.
- Selector should consume facts without claiming they are canonical.
- Long-term mastery should converge on `UserKnowledgeMastery`.

## Legacy WeaknessReport Dependencies

`WeaknessReport` is used by API and web code.

Fields with current dependencies:

- `accuracyRate`
- `completionRate`
- `weakPoints`
- `speedRisks`
- `mistakeReasons`
- `estimatedGain`
- `summary`

Nested weak point fields with current dependencies:

- `knowledgePointId`
- `subject`
- `chapter`
- `title`
- `wrongCount`
- `accuracyRate`
- `weaknessScore`
- `topReason`
- `suggestion`

Risk:

- removing or renaming these fields breaks frontend report/dashboard/onboarding flows
- changing `summary` from string to object may break UI
- removing `suggestion` before adapter migration breaks report panels

Mitigation:

- Keep legacy adapter until all consumers migrate.
- Add contract tests before endpoint rewiring.

## Selector Becoming Recommendation Engine

Risk:

- selector output starts including `suggestion`, `nextAction`, `reason`, or resources
- AI Coach and Recommendation Engine receive already-biased text instead of neutral facts

Mitigation:

- Enforce pure selection output.
- Keep recommendation downstream.

## Facts Pollution

Risk:

- selection output is stored back into Snapshot or StudentFacts
- temporary scores become canonical facts

Mitigation:

- Snapshot remains source facts only.
- Selector output is ephemeral and reproducible.

## Cache Consistency

`StudyService` currently keeps node mastery read cache in memory.

Risk:

- multi-instance deployments can see stale Overview mastery data
- writes refresh local cache only

Mitigation:

- Selector should not depend on `StudyService` cache directly.
- Future projection should read canonical Prisma facts or use a deliberate cache strategy.
