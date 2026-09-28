# ForgeFlow engineering guide

## Start every work session here

Before changing code, read:

1. `PRODUCT.md` for the product boundary and intended users.
2. `docs/engineering-status.md` for the current snapshot, active issue, and blockers.
3. The newest applicable entry in `docs/work-log.md`.
4. The architecture, ADR, or implementation document relevant to the issue.

Treat PostgreSQL as authoritative state. Redis is coordination only. Workflow execution is at-least-once, so handlers must be idempotent and persistence must be effectively-once where designed. Python owns financial calculations; LLMs may produce only validated, source-grounded explanation and may not write facts or metrics.

## Work and documentation loop

`docs/engineering-status.md` is a concise, current snapshot. Keep it updated with completed work, active work, verification, blockers, and the next issue.

`docs/work-log.md` is append-only. Add an entry for every meaningful issue outcome, including what changed, what passed, what failed or was deferred, and any manual testing still needed. Do not rewrite prior entries to hide failures.

When an architecture decision changes, add or amend an ADR rather than burying it in the work log.

## Issue delivery policy

For every GitHub issue:

1. Confirm its dependencies and acceptance criteria.
2. Implement only the scoped change and add proportionate tests.
3. Run the relevant checks and record their exact outcome.
4. Update the status snapshot and append the work-log entry.
5. Create one focused commit for that issue, push it, and comment on/close the issue with the commit and verification evidence.

Leave an issue open if it needs a user decision, external credentials or vendor access, or meaningful manual testing that has not happened. Record the reason in the status snapshot and the issue comment. Never claim a provider, external integration, financial result, or test result that was not actually verified.

## Working conventions

- Preserve unrelated working-tree changes.
- Use recorded fixtures for provider tests; live-provider checks are opt-in.
- Keep API contracts and shared schemas aligned.
- Add provenance to factual and calculated report content.
- Prefer migrations for database changes; never alter an applied migration.
- Before pushing, inspect the commit and ensure secrets, local data, and generated artifacts are excluded.
