# Engineering status

Last updated: 2026-09-30

## Product state

ForgeFlow is an internal analyst-team MVP for durable, source-grounded company analysis. The repository is in the workflow-engine phase. PostgreSQL is the authoritative store; Redis is limited to coordination.

## Completed and closed

- #1–#9: architecture, ADRs, monorepo/tooling, Compose, shared contracts, initial schema, persisted workflow creation, DAG resolution, and atomic task claiming. Delivered in `0e2917e` and closed with verification evidence.
- #10: worker runtime, registration, heartbeats, capability advertisement, draining, graceful shutdown, and PostgreSQL task claims. Delivered in `e13658e` and closed with automated and local smoke-test evidence.
- #11: persisted retry policy, failure classification, stale-lease safety, and expired-lease recovery. Delivered in `b2d33d3` and closed with unit and PostgreSQL integration evidence.
- #12: failure-injection coverage for crash-after-claim, duplicate delivery, retry timing, DAG propagation, and recovery. Delivered in `08e8d0d` and closed with Compose-backed integration evidence.
- #13: immutable provenance persistence, deterministic content hashes, safe source URL validation, and contradiction-preserving facts. Delivered in `3abe886` and closed.
- #14–#19: SEC/market ingestion, normalization, deterministic metrics, company-analysis DAG, and source-grounded report persistence. Delivered and closed through `b7b9919`.

## In delivery

- #22: Terraform foundation for isolated staging and production pilot environments is implemented and statically validated. AWS account bootstrap, remote-state setup, DNS selection, `terraform plan` review, and apply/smoke evidence remain required before the issue can close.
- #23: local release artifacts are implemented: API/web/worker Docker images, immutable revision labels, migration compatibility guard, ECS task-definition templates, and a manual-only release workflow. No image was pushed, workflow run was triggered, AWS deployment was attempted, or GitHub issue was updated.
- #24: local database lifecycle controls are implemented: configurable RDS backup/maintenance windows, snapshot tags, a constrained runtime role bootstrap, and a recovery runbook. AWS backup restoration and production-role verification remain external tests.

## Verified working locally

- Docker Compose starts healthy PostgreSQL on `127.0.0.1:15432` and Redis on `127.0.0.1:16379`.
- The API persists and retrieves workflows, supports idempotency keys, validates DAGs, and atomically claims tasks.
- Migrations `001_initial_schema.sql` and `002_task_retry_policy.sql` are applied to the local development database.
- Worker registration and one-shot graceful shutdown were smoke-tested against local PostgreSQL; the synthetic worker record was removed afterward.
- The CI workflow starts Compose PostgreSQL and Redis, applies migrations, and runs the API integration suite.

## Known deferred work and blockers

- No approved market-data vendor, credentials, or license exists; market-derived information remains explicitly unavailable.
- No live SEC EDGAR or OpenAI credentials are configured. Those integrations remain disabled until their production-hardening issues.
- Issue #22 cannot close until an authorized operator completes the documented AWS bootstrap and staging apply/smoke test.
- #23 cannot close until an operator chooses a paid AWS environment, configures the documented GitHub environment variables/OIDC role/ECS services, and completes a staging deployment, failed-migration, and rollback drill. GitHub Actions work is intentionally paused until the account's minutes reset.
- #24 cannot close until an authorized operator applies the RDS controls and performs the documented staged point-in-time restore drill against AWS.

## Next planned issue

#24 — preserve local database recovery work while awaiting the explicitly deferred AWS deployment decision and restore drill.
