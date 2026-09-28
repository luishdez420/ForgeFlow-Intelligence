# Engineering work log

This is an append-only record of delivery evidence, decisions, failures, and deferred work.

## 2026-09-26 — Planning and foundation

- Created the ForgeFlow MVP milestone, eight epics-as-labels, and dependency-ordered GitHub issues #1–#20.
- Established the internal analyst-team product boundary in `PRODUCT.md`.
- Implemented the initial monorepo, local Compose dependencies, contracts, PostgreSQL schema, workflow creation, DAG resolution, and task claiming.

## 2026-09-27 — Issues #1–#9 delivered

- Pushed `0e2917e feat: establish durable workflow foundation`.
- Verified TypeScript checks and tests, PostgreSQL integration coverage, Compose health, API workflow creation/retrieval/idempotency, and a synthetic task claim.
- Closed #1–#9 with commit and verification evidence.

## 2026-09-28 — Workflow engine delivery in progress

- Delivered Issue #10: worker registration, capability advertisement, polling, heartbeats, drain behavior, signal-aware graceful shutdown, PostgreSQL claims, and a one-shot local worker smoke test.
- Delivered Issue #11 locally: retry policy persistence, exponential backoff, failure classification, stale-lease protection, expired-lease recovery, and worker-side failure persistence.
- Verification passed TypeScript type checks, API unit tests (5 passed), PostgreSQL integration tests (4 passed), schema tests (4 passed), worker-runtime tests (3 passed), and formatting.
- Pushed `b2d33d3 feat(workflow): persist retry and lease recovery` and closed #11 with the recorded evidence.
- No manual testing or external credential is currently required to deliver #10 or #11.

## 2026-09-28 — Issue #12 delivered locally

- Added PostgreSQL failure-injection coverage for crash-after-claim recovery, stale-worker outcome rejection, duplicate delivery with one authoritative report write, deterministic retry-clock advancement, fan-in release, dependency cancellation, and claim contention.
- Added a CI integration job that starts Compose PostgreSQL/Redis, applies migrations, and runs the integration suite.
- Verification passed type checks; API integration tests (6 passed); API and schema unit tests (9 passed); Python worker/financial tests (4 passed); and formatting.
- No manual testing, credentials, or live-provider access is required for this issue.
- Pushed `08e8d0d test(workflow): add failure injection coverage` and closed #12 with the recorded evidence.
