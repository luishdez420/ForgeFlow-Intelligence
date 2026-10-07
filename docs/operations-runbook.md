# Pilot operations runbook

## Correlate a workflow failure

Use the workflow ID as the primary correlation key. In CloudWatch Logs Insights,
search the worker group for `workflow_id` and the API group for the response
header `x-correlation-id`. Worker structured events are `task.claimed`,
`task.succeeded`, and `task.failed`; never paste provider headers, OAuth data,
or secrets into an incident record.

## Alerts

- **Worker task failures:** inspect the task error code/classification, then SEC
  or OpenAI provider telemetry before retrying or draining workers.
- **Database CPU:** pause release activity, inspect RDS connections/storage and
  slow queries, then scale only under the documented AWS change process.
- **Lease recovery spike:** inspect worker exits, heartbeats, and deployment
  revisions; do not mark a workflow successful manually.

## Provider outage

Confirm the provider status and configured rate policy. Transient/rate-limit
failures retry through the durable scheduler. Permanent failures remain visible
to analysts; do not fabricate a report section.

## Rollback and access revocation

Use the release runbook for the prior immutable ECS task definition. Revoke a
user through the admin flow; confirm a new API request is denied, then preserve
the audit event. Database restore procedures are in `database-recovery-runbook.md`.
