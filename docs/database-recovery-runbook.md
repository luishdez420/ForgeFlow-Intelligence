# Database lifecycle and recovery runbook

## Operating roles

`forgeflow_migrator` owns schema changes and is used only by the controlled
migration task. `forgeflow_runtime` is a login role granted only DML and
sequence usage through the `forgeflow_runtime_access` group role. Application
tasks must use the runtime database secret, never the migration secret.

Before the first application deployment, run the runtime-role bootstrap task
with the migration connection string and a separately generated runtime-role
password. Store the resulting runtime connection string in Secrets Manager.

## Backup policy

RDS automated backups are retained for 7 days in staging and 35 days in
production. Storage, backups, and snapshots remain encrypted; snapshots copy
ForgeFlow tags. Production deletion protection remains enabled.

## Restore drill

1. Choose a point in time in the staging RDS automated-backup window.
2. Restore to a new, isolated instance; never overwrite the source instance.
3. Attach only the application security group, use a temporary restore database
   secret, and run the migration status check.
4. Start a read/write smoke test using the runtime role. Verify a workflow and
   report can be read and a disposable workflow can be created.
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
