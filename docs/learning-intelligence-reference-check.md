# Learning Intelligence hardening — reference check

2026-09-05, before code changes. Re-implement patterns within current architecture; no copied source.

- Prisma transactions: https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions — publish derived in-memory state after durable commit; group dependent facts in one transaction; uniqueness is necessary but does not replace transactional consistency. Repository uses Prisma 5; only existing transaction-client APIs are considered, no upgrade.
- PostgreSQL transaction isolation: https://www.postgresql.org/docs/current/transaction-iso.html — distinguish in-process serialization from database isolation; independently committed reads are not a consistent historical snapshot. Database concurrency claims require real integration evidence.
- React useEffect: https://react.dev/reference/react/useEffect — asynchronous replies may arrive out of order; clean up or ignore obsolete requests on dependency changes and unmount. Apply to StudentContext refresh without adding a client cache or changing canonical timestamps.

First bounded fix: `StudyService.reportWrongReason` must not update schedule/attempt maps before repository persistence succeeds. Failure-injection tests cover first submission, subsequent submission and reason-only changes. Keep response/algorithm/schema unchanged.

Next bounded checks: review mastery transaction boundary, direct assessment feedback, StudentContext request ordering. Any broader identity/contract decision is recorded separately before dependent implementation.

API startup blocker reference check: Nest [common errors](https://docs.nestjs.com/faq/common-errors) and upstream [type-only dependency issue](https://github.com/nestjs/nest/issues/5421) explain erased interface tokens. `LearningSessionActionService` needs an explicit `@Inject(LearningSessionRepository)` while retaining its narrow structural type for compatibility. Verify using an actual Nest application context, not direct constructor invocation alone.
