# Database lifecycle and recovery runbook

## Operating roles

`forgeflow_migrator` owns schema changes and is used only by the controlled
migration task. `forgeflow_runtime` is a login role granted only DML and
sequence usage through the `forgeflow_runtime_access` group role. Application
tasks must use the runtime database secret, never the migration secret.

Before the first application deployment, run the runtime-role bootstrap task
with the migration connection string and a separately generated runtime-role
connection string. The bootstrap task creates or rotates the runtime login from
that URL; API and worker tasks then receive only that runtime secret. The
release also runs a transaction-scoped read/write smoke test and rolls it back,
so the check does not leave drill data behind.

The runtime URL must use `postgresql://forgeflow_runtime:<password>@<private-rds-host>:5432/forgeflow?sslmode=require`.
URL-encode the password if it contains URL-reserved characters. Do not put the
migration URL in `database-runtime`, and do not put either secret in GitHub.

## Backup policy

The currently deployed free-plan staging RDS instance retains automated backups
for 1 day; this is its actual restore-point objective until the account plan is
upgraded. Production configuration requires 7–35 days (target: 35 days).
Storage, backups, and snapshots remain encrypted; snapshots copy ForgeFlow
tags. Production deletion protection remains enabled.

## Restore drill

1. Choose a point in time in the staging RDS automated-backup window.
2. Restore to a new, isolated instance; never overwrite the source instance.
3. Attach only the application security group. Create a temporary, isolated
   Secrets Manager runtime URL for the restored endpoint; never alter the live
   `database-runtime` secret during a drill.
4. Run the `database-role-bootstrap` task against the restored migration and
   runtime secrets, then run `database-runtime-smoke`. It reads the active role,
   performs an `INSERT ... ON CONFLICT` against `forgeflow.companies`, and rolls
   the transaction back. A zero exit code proves runtime read/write access
   without retaining drill data.
5. Record restore start/end time, selected recovery point, RDS events, smoke
   result, and any schema incompatibility in the issue evidence.
6. Delete the isolated restored instance only after the evidence is captured.

## Migration guardrails

Numbered SQL migrations are immutable. The release workflow runs the
compatibility check before a migration task; the task must finish successfully
before any ECS service revision changes. A failed migration blocks rollout.
Service rollout failures return the services to their previously active task
definitions; database changes are forward-only and need an explicit follow-up
migration rather than a schema rollback.
