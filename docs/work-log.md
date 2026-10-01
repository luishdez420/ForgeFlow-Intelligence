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

## 2026-09-28 — Issue #13 delivered locally

- Added deterministic SHA-256 content identity, credential-free HTTPS source URL validation, idempotent source/document persistence, append-only facts, and idempotent report-item source links.
- Integration coverage proves repeated identical source content resolves to one source, provenance links remain available, and contradictory facts persist independently.
- Verification passed API type checks, API/schema unit tests (11 passed), PostgreSQL integration tests (7 passed), and formatting.

## 2026-09-28 — Issues #14–#20 delivery update

- Closed #14 through #19 after fixture, unit, integration, and type-check evidence; each implementation was committed and pushed separately.
- Delivered the Issue #20 analyst console in `88e2cb5`: ticker submission, persisted workflow display, typed report sections, source links, responsive states, and safe plain-text rendering.
- Web production build, workspace type checks/tests, and the interface detector passed. Playwright is not installed, so browser E2E and the UI-level controlled worker-recovery acceptance scenario are outstanding; #20 remains open.

## 2026-09-29 — Issue #20 browser acceptance completed

- Added Playwright/Chromium configuration and a browser acceptance test covering ticker submission, persisted retry/lease-recovery state, typed AI analysis, and source-linked evidence.
- Added the browser suite to CI. The controlled worker-recovery behavior remains covered by the Compose-backed workflow failure-injection suite.
- Verification passed browser acceptance (1 test), formatting, workspace type checks, API/schema unit tests (14 passed), PostgreSQL integration tests (8 passed), web production build, and the UI detector.
- Pushed `0598075 test(web): add browser acceptance coverage` and closed #20 with the recorded evidence.

## 2026-09-29 — Issue #21 pilot architecture completed locally

- Added pilot ADRs for managed AWS deployment, Google Workspace invite-only access, and live SEC/constrained OpenAI boundaries.
- Added the infrastructure/security review checklist required before Terraform provisioning begins.
- Formatting passed; no cloud, OAuth, SEC, or OpenAI credential was introduced.
- Pushed `09100a8 docs: define pilot release architecture` and closed #21 with the recorded evidence.

## 2026-09-29 — Issue #22 Terraform foundation delivered pending AWS activation

- Added parameterized Terraform for two-AZ VPC networking, private RDS PostgreSQL and Redis, ECS/ECR foundations, CloudWatch logs, Secrets Manager placeholders, an ECS task execution role, and optional Route53-backed ACM validation.
- Added an encrypted remote-state backend contract, example backend/environment configuration, secret-safe ignore rules, and pull-request/main-branch Terraform validation workflow.
- Verification passed Terraform 1.9.8 formatting and `terraform validate` with AWS provider 5.100.0, plus repository formatting.
- The issue remains open because no AWS account bootstrap, remote state, DNS, authorized plan review, or staging apply/smoke evidence was available locally. The operator walkthrough is in `infrastructure/README.md`.

## 2026-09-30 — Issue #23 local release artifacts delivered; cloud release deferred

- Added local Docker definitions for the API, Next.js standalone web console, and Python worker. Each accepts a build revision label; the worker uses an entrypoint so runtime flags can be supplied safely.
- Added a manual-only `workflow_dispatch` release workflow. When eventually configured and dispatched, it uses OIDC, pushes commit-SHA-tagged images to immutable ECR repositories, runs the migration task before service rollout, and rolls ECS services back to their prior task definitions on a rollout failure.
- Added ECS Fargate task-definition templates plus checks that required image revision labels and image placeholders remain present. Added a guard that rejects edits to already-applied numbered SQL migrations.
- Verification passed repository formatting; migration and container-contract checks; workspace type checks; API tests (10 passed, 8 integration tests skipped); schema tests (4 passed); local API health response; local web response; and worker command help. All three local Docker images built successfully with the `release-test` revision label.
- No ECR image was pushed, no GitHub Actions workflow was run, no AWS infrastructure was applied, and no GitHub issue was modified. Deployment is intentionally paused because the account must remain on its free plan and GitHub Actions minutes are exhausted until reset.

## 2026-09-30 — Issue #24 database lifecycle controls delivered locally

- Added configurable RDS backup retention, backup window, maintenance window, and snapshot tag copying. Staging defaults to 7 retained backup days; production defaults to 35.
- Added a controlled bootstrap command that creates a non-superuser application login and grants it only the runtime group role's DML, sequence, and schema-usage permissions; the migration owner remains separate.
- Added a restore and recovery runbook covering isolated point-in-time restoration, runtime-role smoke checks, evidence capture, and forward-only migration recovery.
- Verification passed Terraform formatting and validation in a local container, repository formatting, workspace type checks, API tests (12 passed, 8 integration tests skipped), and a local PostgreSQL role smoke test. The runtime role had schema usage and table-read access but no schema-create access.
- No Terraform apply, AWS restore, ECR push, GitHub Actions run, or GitHub issue mutation occurred. AWS restore evidence remains the required manual gate for #24.

## 2026-09-30 — Issue #25 Google Workspace SSO delivered locally

- Added Auth.js Google provider configuration, a verified-email Workspace-domain allow-list, a fail-closed sign-in page, and server-side session protection for the analyst console.
- Added environment-variable placeholders only; no OAuth client, session secret, or Workspace domain was introduced into the repository.
- Verification passed web type checks, Google-domain policy tests (2 passed), the Next.js production build, and formatting.
- Google OAuth callback/domain rejection/session-expiry browser tests remain blocked on a manually configured Google Cloud OAuth client and non-local callback URL. No GitHub Actions or external provider was invoked.

## 2026-10-01 — CI repair and release artifacts pushed

- Pushed the previously verified local commits for #23, #24, and #25 to `main`: `5db571d`, `46baf1b`, and `33e93e4`.
- Terraform's GitHub validation workflow completed successfully. The initial repository CI run failed only in the browser acceptance test because that test still expected the now-protected analyst console to be public.
- Replaced that obsolete expectation with a browser test for the intended fail-closed behavior: an unauthenticated visitor is redirected to `/sign-in` and sees the unconfigured Google Workspace state. The Playwright web server receives a test-only `AUTH_SECRET`; the application has no production fallback secret.
- Verification passed repository formatting, workspace type checks, API/schema tests, the browser suite, and `git diff --check`. The CI repair is ready to commit and push; the resulting GitHub run will be recorded before proceeding with #26.

## 2026-10-01 — CI repair verified and Issue #26 delivered locally

- Pushed `988be4e test(web): cover unauthenticated analyst redirect`. The resulting [CI run](https://github.com/luishdez420/ForgeFlow-Intelligence/actions/runs/36880526754) completed successfully; browser acceptance now tests the intended protected-route behavior.
- Added additive migration `003_access_control.sql` for users, analyst/admin role assignments, hashed invitations, audit events, and workflow ownership. No raw invitation token is stored.
- Added authorization helpers that allow analysts to act on their own workflows and administrators to act across the pilot. Audit metadata recursively redacts authorization values, tokens, cookies, credentials, passwords, and API keys before persistence.
- Verification passed formatting, workspace type checks, API/schema unit tests (21 passing non-integration tests), and Compose-backed API integration tests (9 passing), including invitation acceptance, role assignment, immediate revocation, and audit metadata verification.
- The session-to-API binding and CSRF/origin policy belong to #27. No manual AWS, Google Cloud, or browser test is needed to verify #26 locally.

## 2026-10-01 — Issue #27 secure API and web-session boundary delivered locally

- Added same-origin Next.js API routes for workflow creation, workflow retrieval, and report retrieval. They obtain the Auth.js session on the server and sign a short-lived request with the authenticated email, route, method, and exact body before forwarding to the API.
- The API now fails closed without a valid shared secret/signature/timestamp, looks up only active allow-listed users and their persisted roles, binds new workflows to the submitting user, and returns a generic 403 for cross-user workflow/report reads. The browser no longer calls the API service directly.
- Added origin enforcement for browser mutations, web security headers, no-store API responses, and signature-tampering coverage. The `FORGEFLOW_INTERNAL_API_SECRET` and `APP_ORIGIN` environment variables are documented but deliberately unset.
- Verification passed formatting, all workspace type checks, API/schema/web unit tests (26 non-integration tests), the Next.js production build, browser acceptance (1 passed), and `git diff --check`. #26's pushed CI run also completed successfully.
- A live sign-in, cross-user access, and CSRF test remains a manual pre-release gate: configure Google OAuth, an active allow-listed analyst/admin, matching web/API shared secret, and the deployed HTTPS origin before closing #27.
