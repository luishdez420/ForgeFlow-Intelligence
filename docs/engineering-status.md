# Engineering status

Last updated: 2026-10-10

## Product state

ForgeFlow is an internal analyst-team MVP for durable, source-grounded company analysis. The repository is in the workflow-engine phase. PostgreSQL is the authoritative store; Redis is limited to coordination.

## Completed and closed

- #1–#9: architecture, ADRs, monorepo/tooling, Compose, shared contracts, initial schema, persisted workflow creation, DAG resolution, and atomic task claiming. Delivered in `0e2917e` and closed with verification evidence.
- #22: closed. Staging pilot infrastructure was applied from reviewed remote Terraform state. The private VPC/subnets, RDS PostgreSQL, Redis, ECS cluster, ECR repositories, CloudWatch logs/alarms, IAM task-execution role, and Secrets Manager placeholders are operational. AWS verification confirms RDS is encrypted and non-public, private subnets do not assign public IPs, Redis/database ingress is limited to the application security group, and S3 state/DynamoDB locking are present.
- #23: closed. Staging deployment is verified end-to-end: immutable ECR digest publication, migration before service update, private ECS API/web/worker rollout, an intentional pre-rollout migration failure, and an API revision rollback drill. The renderer validates structured task definitions before AWS registration and releases run through the scoped GitHub OIDC role.
- #10: worker runtime, registration, heartbeats, capability advertisement, draining, graceful shutdown, and PostgreSQL task claims. Delivered in `e13658e` and closed with automated and local smoke-test evidence.
- #11: persisted retry policy, failure classification, stale-lease safety, and expired-lease recovery. Delivered in `b2d33d3` and closed with unit and PostgreSQL integration evidence.
- #12: failure-injection coverage for crash-after-claim, duplicate delivery, retry timing, DAG propagation, and recovery. Delivered in `08e8d0d` and closed with Compose-backed integration evidence.
- #13: immutable provenance persistence, deterministic content hashes, safe source URL validation, and contradiction-preserving facts. Delivered in `3abe886` and closed.
- #14–#19: SEC/market ingestion, normalization, deterministic metrics, company-analysis DAG, and source-grounded report persistence. Delivered and closed through `b7b9919`.

## In delivery

- #24: release deployment now separates the migration secret from a constrained `forgeflow_runtime` application secret. The release bootstraps/rotates the runtime role after migrations and verifies its transaction-scoped read/write access before service rollout. RDS retention/windows, snapshot tags, and the recovery runbook are in place; an isolated AWS point-in-time restore drill remains the closure gate.
- #25: Auth.js Google sign-in is configured locally with verified Workspace-domain enforcement and a server-side protected analyst route. The browser acceptance suite now verifies that an unauthenticated visitor is redirected to the fail-closed sign-in screen. OAuth credentials and a real Google callback test remain external setup work.
- #26: persisted pilot access-control records are implemented: normalized users, analyst/admin roles, hashed invitation tokens, user revocation, workflow ownership helpers, and redacted audit events. Session-to-API enforcement is intentionally sequenced for #27; the data model and authorization rules are ready for it.
- #27: same-origin authenticated web routes now sign API requests with a shared internal secret. The API rejects unsigned/stale/tampered requests, resolves active allow-listed roles, records workflow ownership, and enforces ownership for workflow/report reads. Local Google sign-in, allow-list persistence, owned workflow creation, and cross-user denial have been manually verified. A single verified personal Google email may be enabled only under local development with `GOOGLE_ALLOWED_TEST_EMAIL`; staging/production still require a Workspace domain.
- #28: SEC EDGAR now has an opt-in live adapter with contactable User-Agent validation, shared request pacing, bounded ticker cache, timeouts, retryable provider failure classes, safe telemetry, and a two-request local smoke command. Fixture checks and the controlled local MSFT smoke check passed; a compliant live staging smoke test remains required before closure.
- #29: selected SEC primary-document retrieval, company-facts/XBRL retrieval, conservative raw-fact extraction, and idempotent PostgreSQL source/document/fact persistence are implemented and locally verified. Production task-handler wiring and live/staging fixture evidence remain for #32 and the pilot environment.
- #30: versioned canonical SEC taxonomy mappings now preserve every raw source observation, unit, period, source/document identity, and mapping version. The live worker now activates this mapping before source validation and report assembly, so the analyst report reads canonical facts while competing raw observations remain queryable.
- #31: worker-side task success is lease-token guarded, finalizes the matching attempt, and releases ready waiting dependents transactionally. A stale or duplicate completion becomes a harmless no-op.
- #32: the worker now registers the complete company-analysis handler graph, persists SEC evidence through durable repository operations, records market history as explicitly unavailable until a vendor is approved, and now assembles then publishes a typed evidence report before marking a run successful. Fixture verification is complete; live staging evidence remains required.
- #33: deterministic Python metric results persist authoritatively with formula version, input snapshot, status, period, and calculation timestamp; duplicate delivery is idempotent and invalid inputs are explicit records.
- #34: deterministic source-data validation now detects stale evidence, missing provenance or periods, unsupported canonical units, conflicting values, and missing financial inputs. Findings persist per workflow, are exposed in workflow/report responses, and ERROR findings block report publication while warning-level ambiguity/unavailability remains visible.
- #35: a disabled-by-default OpenAI Responses adapter uses strict structured output, bounded allow-listed source context, local citation validation, timeout/retry classification, and safe agent-run token/cost telemetry. It has mocked contract coverage; an OpenAI credential in Secrets Manager and opt-in staging smoke remain external gates.
- #36: report assembly now reads persisted facts and financial metrics, emits typed FACT/CALCULATION/UNAVAILABLE items, preserves cited AI items, and blocks publication on ERROR validation findings.
- #37: closed. The analyst console shows owned analysis history, polls active workflows, explains retry/recovery state, surfaces validation findings, filters typed report items, and exposes persisted calculation/source-document provenance. An allow-listed analyst completed the signed-in, live-SEC workflow and report-evidence walkthrough locally on 2026-10-07.
- #38: closed. Analyst feedback is append-only and tied to its exact published report item/version. Analysts can mark an item useful, unclear, unsupported, or incorrect with an optional comment; administrators have an open-only review queue and may resolve an item without changing any authoritative evidence. The analyst/admin browser walkthrough passed locally on 2026-10-07.
- #39: structured API/worker lifecycle telemetry, correlation IDs, safe redaction, initial CloudWatch failure/capacity alarms, and an operations runbook are implemented. Terraform formatting and validation now pass against the installed local CLI; AWS alert-route/provider-outage/worker-termination drills remain required before closure.

## Verified working locally

- Docker Compose starts healthy PostgreSQL on `127.0.0.1:15432` and Redis on `127.0.0.1:16379`.
- The API persists and retrieves workflows, supports idempotency keys, validates DAGs, and atomically claims tasks.
- Migrations through `005_report_feedback.sql` are applied to the local development database.
- Worker registration and one-shot graceful shutdown were smoke-tested against local PostgreSQL; the synthetic worker record was removed afterward.
- The CI workflow starts Compose PostgreSQL and Redis, applies migrations, and runs the API integration suite.

## Known deferred work and blockers

- No approved market-data vendor, credentials, or license exists; market-derived information remains explicitly unavailable.
- No live SEC EDGAR or OpenAI credentials are configured. The local SEC smoke command remains disabled unless an operator explicitly supplies a contactable User-Agent; it persists no response content.
- The local SEC smoke check is verified for MSFT. It returned Microsoft CIK `0000789019`, 80 supported filings, and a sample of `8-K`, `10-K`, and `8-K`; no response content was persisted.
- #24 cannot close until an authorized operator applies the RDS controls and performs the documented staged point-in-time restore drill against AWS.
- #25 cannot close until a Google Cloud OAuth client, `AUTH_SECRET`, and an approved Workspace domain are configured in a non-local environment and the sign-in/callback/session-expiry browser tests run.
- Redis at-rest encryption is not enabled in the deployed cache. Redis is private, token-protected, and encrypted in transit; enabling at-rest encryption requires a planned cache replacement and should be tracked as a pilot hardening follow-up before sensitive coordination payloads are permitted.
- Terraform currently uses the still-working DynamoDB lock-table backend option, which Terraform reports as deprecated. Migrate deliberately to S3 native lockfiles after documenting state-lock compatibility; do not remove the existing table during active infrastructure work.

## Next planned issue

#24 — apply the separate runtime database-secret placeholder, run the constrained-role release smoke, and complete the isolated staged point-in-time restore drill.
