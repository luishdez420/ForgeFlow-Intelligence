# Engineering work log

This is an append-only record of delivery evidence, decisions, failures, and deferred work.

## 2026-10-10 — Issue #23 validated task-definition rendering repair

- The private release reached the ECS service-registration phase after successfully publishing immutable images and completing its migration task. AWS then rejected the web definition because global text replacement changed the literal `GOOGLE_WORKSPACE_DOMAIN` environment-variable name to an empty string when the optional private-bootstrap value was blank.
- Replaced the `sed` renderer with a JSON-aware Node renderer using unique placeholders. It validates required inputs, rejects unresolved placeholders and blank environment names, and removes the optional Workspace-domain entry entirely when it has no value.
- Extended the release container-contract check to render every task definition with the private-bootstrap inputs before CI can dispatch AWS work. This is a local/preflight guardrail; it requires no AWS configuration or secret changes.
- The subsequent run exposed a duplicate inline migration renderer that had not yet adopted this guardrail. It could corrupt the task-role placeholder and produced AWS's misleading `Role is not valid` error. The release workflow now invokes the shared renderer and CI asserts that the migration path cannot regress to global text substitution.

## 2026-10-08 — Issue #22 staging apply partially completed

- Terraform initialized against the encrypted, versioned staging S3 backend with the DynamoDB lock table and produced a reviewed 41-resource staging plan.
- The initial apply created the VPC, two public and two private subnets, NAT gateway, private Redis replication group, ECS cluster, immutable ECR repositories, log groups, Secrets Manager placeholders, task-execution role, and initial worker/RDS CloudWatch alarms.
- RDS creation was rejected by the account's free-plan restriction because staging requested seven days of backup retention. Terraform preserved the successfully created resources and remote state.
- The Terraform variable rule now allows a one-day retention only for staging, which is the documented RDS minimum and accommodates this constrained account. Production continues to require seven through thirty-five days. A new staging plan and the remaining RDS apply/verification are required before #22 can close.
- Terraform formatting and provider-backed validation now pass locally with Terraform 1.16.4. This also supersedes #39's earlier local-Terraform availability blocker; AWS alert and failure-recovery drills remain outstanding.
- The one-day staging retry reached the RDS API but the account rejected `db.t4g.medium` as unavailable on its free plan. Staging now selects the free-plan-eligible `db.t4g.micro` with 20 GiB fixed storage; production retains `db.t4g.medium`, 50 GiB initial storage, and 200 GiB autoscaling maximum. A fresh plan is required before retrying RDS creation.
- The free-plan-sized RDS retry then reached instance creation but rejected a base64-generated master password because RDS disallows some base64 punctuation. The operator must generate a new hexadecimal password and create a fresh saved plan; no database was created and no existing resource changed.
- The hexadecimal-password retry reached the RDS placement step but encountered live capacity exhaustion for `db.t4g.micro` with the default `gp2` storage. A read-only AWS RDS catalog query confirmed that `db.t3.micro` with `gp3` supports PostgreSQL 17 across the selected region's availability zones. Staging now explicitly selects that alternative; capacity is still an AWS runtime condition, but this avoids the rejected family/storage combination.
- The final staging RDS apply succeeded using `db.t3.micro`, `gp3` storage, 20 GiB allocation, and one-day retention. Terraform then created the RDS capacity alarm; no resource was changed or destroyed in the final apply.
- Read-only AWS verification confirmed the database is available, storage-encrypted, and non-public; both private subnets disable public-IP assignment; database and Redis ingress comes only from the application security group; the Redis replication group is available with token authentication and transit encryption; ECS, immutable scanning ECR repositories, service log groups, the remote state object, and the `LockID` DynamoDB table are present.
- Redis at-rest encryption is currently disabled. This does not change the verified #22 private-network acceptance result, but enabling it requires a replacement cache and is explicitly recorded as a pilot hardening follow-up. Terraform's DynamoDB-lock warning is also deferred for a deliberate S3-native-lockfile migration rather than an in-place state-lock change.
- Issue #22 was closed on GitHub with the applied staging and verification evidence. The next active delivery target is #23: build/publish immutable images, run a migration task, deploy ECS revisions, and demonstrate rollback behavior.

## 2026-10-08 — Issue #23 staging deployment hardening in progress

- Added Terraform prerequisites for ECS task-role separation, execution-role access to only ForgeFlow runtime secrets, private Service Connect API discovery, and the missing `internal-api` and `web-auth` secret placeholders.
- The release workflow now injects typed runtime secrets into API/web task definitions and validates all required staging environment configuration before assuming the GitHub OIDC role.
- Added a rollback-aware deployment script that creates missing private ECS services on first release, registers digest-pinned task definitions, uses Service Connect for the API, restores prior task definitions on a later rollout failure, and scales a first-release partial service back to zero if bootstrapping fails.
- The operator runbook documents the secret contract, OIDC boundary, GitHub environment variables, and controlled staging migration/rollback drills. No AWS task, secret value, GitHub environment, or image has been created by this implementation step.

## 2026-10-08 — Issue #23 private-bootstrap release alignment

- Made public-origin and Workspace-domain values optional only for the first private ECS bootstrap; analyst access still requires both.
- Corrected the ECS Service Connect shorthand used to create the internal API service before its first AWS deployment.
- Added a Terraform-managed GitHub Actions OIDC provider/deployment role. Its trust policy permits only this repository's `staging` environment and its permissions are constrained to ForgeFlow image publication, the staging ECS cluster, service discovery, and the two ECS task roles.

## 2026-10-10 — Issue #23 OIDC subject compatibility repair

- The first private release correctly stopped at OIDC authentication before any image, migration, or ECS mutation. CloudTrail showed this repository emits GitHub's ID-based `sub` claim rather than the legacy name-only format.
- Added a Terraform input for the exact trusted OIDC subject. It preserves a precise repository/environment trust boundary instead of accepting a wildcard claim.

## 2026-10-10 — Issue #23 verified RDS certificate-chain repair

- The next private migration reached the RDS endpoint but correctly failed TLS verification because Node's bundled trust store did not include the AWS RDS root chain. The deployment is no longer retried blindly.
- API and worker images now install the official AWS RDS global trust bundle; Node receives it through `NODE_EXTRA_CA_CERTS` while Python/libpq uses the updated OS trust store. Failed migration tasks now emit their stop reason and CloudWatch log stream in the Actions log.

## 2026-10-10 — Issue #23 private migration connectivity finding

- The first authenticated private release built and published all immutable images, then stopped before ECS service creation because the migration task could not reach a local-development database address stored in the staging database secret.
- No migration was applied and no service rollout began. The staging secret must be replaced with an RDS endpoint URL before a fresh release is dispatched.

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
- Local manual evidence: both personal Google test accounts completed OAuth sign-in after explicit development allow-listing. The first analyst created workflow `32c6af3e-9291-4b18-8fd8-8e3443e6d554`; the second analyst received `403 {"error":{"code":"FORBIDDEN","message":"Access denied."}}` when requesting it. This confirms session binding and cross-user ownership enforcement. A deployed HTTPS origin/CSRF test remains a pre-release gate.

## 2026-10-01 — Local personal-account SSO test path

- Added a development-only explicit Google email allow-list for a personal-account test. It is ignored outside `NODE_ENV=development`; staging and production remain fail-closed without a configured Workspace domain.

## 2026-10-02 — Issue #27 closed; Issue #28 live SEC hardening delivered locally

- Closed #27 with three successful CI runs and manual evidence: two allow-listed Google test users completed sign-in, the owner created a workflow, and the other user received `403 FORBIDDEN` on that workflow.
- Added opt-in SEC EDGAR live-provider controls: required contactable User-Agent, configurable timeout, process-shared rate limiter, bounded TTL ticker cache, explicit live enablement, and safe telemetry that omits headers, response bodies, and credentials.
- Provider 429, 5xx, reachability, and timeout conditions now yield classified retryable failures. Fixture tests cover normal SEC retrieval, cache hits, request pacing, timeout mapping, malformed input, and the disabled-by-default live-provider guard.
- Verification passed worker tests (11 passed), repository formatting, workspace type checks, API/schema/web tests (26 non-integration tests), and `git diff --check`. A live SEC staging smoke test is deferred until staging exists and an operator configures `SEC_EDGAR_LIVE_ENABLED=true` plus a contactable `SEC_EDGAR_USER_AGENT`; #28 remains open.

## 2026-10-05 — Local SEC smoke path prepared

- Added `python -m forgeflow_worker.sec_smoke --ticker MSFT`, an explicit opt-in local diagnostic that performs only the SEC ticker-index and company-submissions reads, then prints a sanitized company/filing-count summary. It neither writes to ForgeFlow nor emits request headers, credentials, or SEC response bodies.
- The command requires both `SEC_EDGAR_LIVE_ENABLED=true` and a contactable `SEC_EDGAR_USER_AGENT`; its fixture-backed contract test verifies the expected two-step provider flow. A real operator run is pending. This is supplementary local evidence, not a substitute for the required staging smoke test before #28 closes.

## 2026-10-05 — Local SEC smoke endpoint defect found

- The first opt-in live smoke attempt received HTTP 404 during ticker resolution. The adapter incorrectly requested the SEC ticker directory from `data.sec.gov`; that public directory belongs at `www.sec.gov/files/company_tickers.json`. The repair makes that host explicit and adds an exact-URL regression assertion for the ticker-index and company-submissions requests.
- No ForgeFlow data was written and no SEC response content was persisted. A successful operator retry remains required after the repair is verified and pushed.

## 2026-10-05 — Local SEC smoke compression defect found

- The repaired live smoke reached the SEC ticker directory but failed decoding a gzip-compressed response. The adapter had advertised `Accept-Encoding: gzip, deflate` without implementing decompression. It now advertises only the required contactable User-Agent, and a regression assertion prevents reintroducing the unsupported compression capability.
- No ForgeFlow data was written and no SEC response content was persisted. A successful operator retry remains required after the repair is verified and pushed.

## 2026-10-05 — Local SEC smoke check passed

- An operator ran the explicit live SEC smoke command for `MSFT` after the endpoint and compression repairs. It completed successfully and returned CIK `0000789019`, company name `MICROSOFT CORP`, 80 supported filings, and sample forms `8-K`, `10-K`, and `8-K`.
- The test made only the intended ticker-index and company-submissions reads and printed a sanitized summary. No response content was stored in ForgeFlow. This satisfies the local live-provider evidence; #28 remains open for its required staging smoke test.

## 2026-10-05 — Issue #29 SEC evidence ingestion delivered locally

- Added rate-limited retrieval for one selected primary document per supported SEC form (`10-K`, `10-Q`, and `8-K`) plus the SEC company-facts/XBRL payload. Each retrieved object retains its SEC URL, retrieval time, filing context, and immutable content hash when persisted.
- Added conservative raw XBRL extraction for the initial US-GAAP observation set. It retains competing and amended observations, carries period/unit/form/accession/raw value context, and emits explicit unavailable records for absent concepts. Canonical concept selection remains deliberately deferred to #30.
- Added idempotent PostgreSQL persistence for SEC sources, documents, and facts. The Compose-backed check proves a repeated delivery produces four immutable document records and eight raw/unavailable fact records only once. Recorded fixtures and tests cover normal, amended/duplicate, and malformed payload paths; the retrieval test exercises a missing-document response.
- Verification passed 18 worker tests including PostgreSQL integration, repository formatting, all workspace type checks, API/schema/web tests (26 non-integration tests), and `git diff --check`. Production workflow-handler wiring and staging evidence remain before #29 can close.

## 2026-10-05 — Issue #30 SEC taxonomy mapping delivered

- Added a reviewed, versioned deterministic taxonomy for revenue, operating income, net income, assets, operating cash flow, and share count. Mapping records retain the SEC concept, original raw value, unit, fiscal period, source/document identity, and mapping version.
- Mapping is append-only and idempotent: competing concepts and conflicting values remain separate queryable records, while missing concepts become explicit unavailable entries. PostgreSQL integration proves repeated mapping delivery creates no duplicates.
- Verification passed 21 worker tests including local PostgreSQL integration, repository formatting, and `git diff --check`.

## 2026-10-05 — Issue #31 task-success persistence delivered

- Added the worker success path: only a task holding its current lease token can transition to succeeded; its matching attempt is finalized and waiting dependents are released when every prerequisite has succeeded. Stale and duplicate completion deliveries are harmless no-ops.
- Verification passed 21 worker tests including local PostgreSQL integration, repository formatting, and `git diff --check`.

## 2026-10-06 — Issue #32 company-analysis handlers delivered locally

- Activated the full company-analysis handler graph in the real worker entry point. SEC profile/filing tasks retrieve and persist filing documents, company facts, and raw XBRL evidence via the durable repository; market history writes an explicit unavailable record because no approved vendor exists.
- Successful completion now makes the workflow terminal only after every task has succeeded. Fixture-backed handler coverage verifies SEC persistence dispatch and market unavailability; the live provider remains explicit opt-in.
- Verification passed 22 worker tests (one external integration test intentionally skipped), repository formatting, all workspace type checks, API/schema/web tests (26 non-integration tests), and `git diff --check`. An opt-in live staging run remains required before #32 can close.

## 2026-10-06 — Issue #33 metric persistence delivered

- Added idempotent authoritative persistence for Python financial-engine results, retaining metric value, unit, period, formula version, exact input snapshot, calculation status, and timestamp. Report readers can use these stored results without recalculating them.
- Local PostgreSQL integration verifies calculated and invalid-input records, retry idempotency, and source-ID input snapshots. Formula-version changes produce distinct history because version is part of the persistence identity.
- Verification passed 24 worker tests including local PostgreSQL integration, repository formatting, and `git diff --check`.

## 2026-10-06 — Issue #34 workflow data-quality gates delivered

- Added additive migration `004_validation_findings.sql` and a deterministic validator for source freshness, provenance, filing periods, canonical units, conflicting observations, and required financial inputs. Findings are persisted idempotently and do not mutate raw evidence.
- Activated the `VALIDATE_SOURCES` worker task. Validation findings appear in the typed workflow and report read models. ERROR findings block report publication; warning-level ambiguity and unavailable inputs support a clearly labeled partial report.
- Verification passed the migration runner, 28 Python worker tests including local PostgreSQL persistence coverage, all workspace type checks, 26 non-integration workspace tests, formatting, and `git diff --check`.

## 2026-10-06 — Issue #35 constrained OpenAI Responses adapter delivered locally

- Added a disabled-by-default Responses API adapter using `text.format` JSON Schema with strict output, `store: false`, a bounded eight-source/3,000-character allow-listed context, and a source-grounded prompt that cannot write facts or metrics.
- Model refusals, malformed output, unsupported citations, provider failures, and timeout behavior produce explicit explainable errors. One transient provider failure is retried; successful and failed agent runs preserve safe structured output/error codes, token telemetry, optional configured cost estimates, and a prompt fingerprint without storing credentials or raw prompt content.
- Verification passed formatting, workspace type checks, and 31 non-integration workspace tests, including mocked Responses API contract coverage for source bounds, strict schema, refusal, malformed/unsupported citations, and retry behavior. No OpenAI key or live provider request was used. A Secrets Manager-configured, opt-in staging smoke test remains required before #35 can close.

## 2026-10-06 — Issue #36 persisted typed-report assembly delivered

- Added transactional report assembly from authoritative persisted facts and financial metrics. It preserves AI analysis, produces FACT/CALCULATION/UNAVAILABLE item types, maintains source links for facts, and respects validation gates.
- The assembler is idempotent, including when rebuilding an existing published report with retained AI items; it resets the published timestamp correctly and allocates non-conflicting display positions.
- Verification passed 11 API PostgreSQL integration tests, workspace type checks, 32 non-integration workspace tests, formatting, and diff checks.

## 2026-10-07 — Issue #37 analyst workflow and evidence experience delivered locally

- Added a same-origin, ownership-scoped analysis-history route. The history is deliberately limited to the signed-in analyst's own workflows, including for administrators, so the console never turns an operational convenience into cross-analyst browsing.
- The console now polls active workflows every 2.5 seconds, identifies later attempts as recovered/retried, shows retry codes and next-attempt timestamps, and renders persisted data-quality findings with their severity and status.
- Typed report filtering is keyboard-accessible and has an explicit empty state. Calculation report items now expose their persisted formula version, calculation status, timestamp, exact input snapshot, and linked source evidence. Source links include persisted document metadata when a source has a document record.
- Verification passed repository formatting, all workspace type checks, 29 non-integration workspace tests, 11 PostgreSQL API integration tests (including report calculation provenance and source-link retrieval), the Impeccable UI detector, and `git diff --check`.
- The issue remains open pending the meaningful manual acceptance gate: sign in as an allow-listed analyst, create/select an analysis, observe live polling and recovery presentation, filter a published report, inspect evidence links and calculation details, then repeat the console review at a narrow/mobile viewport with keyboard navigation. No live SEC, market-data, or OpenAI request is required for this UI acceptance.

## 2026-10-07 — Persistent local-development environment loading

- `npm run dev:web` and `npm run dev:api` now load the ignored repository-root `.env` file before starting. This keeps local OAuth and internal API configuration out of Git while removing the need to re-export values for every terminal session.

## 2026-10-07 — CI worker test dependency repair

- The Python worker CI job now installs the local financial-engine package before collecting worker tests. The worker metric-persistence integration test imports deterministic metric functions from that package, and the former isolated install caused `ModuleNotFoundError` during GitHub Actions test collection.
- Local verification passed 25 worker tests with 3 opt-in integration tests skipped, repository formatting, and diff checks.

## 2026-10-07 — Local workflow report-publication repair

- Corrected a real worker-handler gap found during the signed-in local workflow walkthrough: `ASSEMBLE_REPORT` and `PUBLISH_REPORT` had been no-ops, allowing a workflow to reach `SUCCEEDED` without creating a report.
- The worker now idempotently assembles typed FACT/UNAVAILABLE/CALCULATION report items from persisted evidence, links non-unavailable items to their sources, blocks assembly on ERROR validation findings, and publishes the assembled report before completing the workflow. The console's validation-list key now includes its position so repeated warning text is rendered safely.
- Verification passed 26 worker unit tests (4 opt-in integration tests skipped), all 30 worker tests with local PostgreSQL enabled, repository formatting, workspace type checks, 29 non-integration TypeScript tests, and diff checks. Existing succeeded workflows are immutable historical records; submit a new analysis after updating the worker to exercise report publication.

## 2026-10-07 — Live canonical SEC-report repair

- The signed-in local GOOG workflow exposed raw `us-gaap:*` observations in the published report. Those records are correct audit evidence but are not the intended analyst-facing view.
- Activated the versioned SEC taxonomy mapping in the live `NORMALIZE_FINANCIAL_DATA` worker task. Report assembly now omits raw XBRL observation rows and instead reads the persisted canonical records (for example Revenue, Operating income, and Total assets), while preserving the raw observations and their source/document identity in PostgreSQL.
- Added canonical-mapping handler coverage and updated database integration coverage so an assembled report is verified from canonical evidence. The report UI formats canonical field names for analyst readability.
- Verification passed 27 worker unit tests (4 opt-in integration tests skipped), 31 worker tests against local PostgreSQL, workspace formatting/type checks, 29 non-integration TypeScript tests, the Impeccable detector, and diff checks. A new workflow is required to use the revised task graph; historical succeeded runs retain their original evidence report.

## 2026-10-07 — Issue #37 manual analyst acceptance passed

- An allow-listed analyst completed the local Google OAuth sign-in flow and ran a live SEC EDGAR-backed company workflow through terminal publication. The console refreshed the durable workflow state, displayed its typed persisted report, and exposed source-linked evidence and data-quality findings for review.
- This satisfies the meaningful authenticated-browser acceptance gate for #37. The test was intentionally scoped to the available MVP path: market data remains explicitly unavailable without an approved vendor, and OpenAI analysis remains unconfigured and absent rather than fabricated.
- #37 can now close. The next implementation target is #38, item-level analyst feedback and an administrator review queue.

## 2026-10-07 — Issue #38 analyst feedback and review workflow delivered locally

- Added migration `005_report_feedback.sql` and append-only report-item feedback persistence. Every record captures the exact published report ID, item ID, and report version the analyst reviewed; it is intentionally not a foreign key to the mutable report-item read model so rebuilding a report cannot erase feedback history.
- Analysts can submit Useful, Unclear, Unsupported, or Incorrect feedback with an optional 2,000-character comment through the same-origin authenticated API. Feedback is audit-recorded without copying free-form comments into audit metadata. Submission is limited to the workflow owner (or an administrator), and it never updates sources, facts, metrics, or report items.
- Administrators can retrieve the unresolved review queue and resolve an item. The console reveals that queue only to authorized administrators; it shows an inline, keyboard-accessible feedback form on every persisted report item for analysts.
- Verification passed migration application, the focused PostgreSQL feedback integration test, all four API PostgreSQL integration files (12 tests), workspace type checks, API/web/schema tests (29 non-integration tests), formatting, diff checks, and the Impeccable UI detector. Manual closure gate: sign in as an analyst to submit feedback, then as an administrator to resolve it and confirm the report evidence remains unchanged.

## 2026-10-07 — Issue #38 manual feedback acceptance passed

- An operator submitted feedback from the persisted report and confirmed that the review path works. The raw SEC Company Facts source was also inspected; it remains an official machine-readable XBRL evidence artifact rather than an analyst-oriented document.
- The feedback workflow is now eligible for closure. A follow-up UI clarity improvement will label the raw SEC evidence link and explain its purpose so analysts do not mistake it for a rendered report.

## 2026-10-07 — Issue #39 observability foundation delivered locally

- Added safe JSON operational events to the API with per-request `x-correlation-id`, duration, route, and status. Correlation IDs are accepted only in UUID form or generated afresh, and recursive telemetry redaction removes values for secret-bearing keys.
- Worker lifecycle telemetry now emits registered, claimed, succeeded, and failed task events with workflow/task/attempt correlation, but never lease tokens or provider credentials.
- Added CloudWatch log-to-metric transformation for worker failures, configurable optional SNS alert routing, worker-failure and RDS CPU alarms, and a concise operator runbook for correlation, outages, recovery, rollback, and revocation.
- Verification passed formatting, all workspace type checks, 35 API tests (23 passing and 12 intentional integration skips), and 3 worker-runtime tests. Terraform `fmt`/`validate` could not run because the Terraform binary is not installed in this local environment. AWS deployment and alert-route/provider/worker drills remain required before #39 can close.
