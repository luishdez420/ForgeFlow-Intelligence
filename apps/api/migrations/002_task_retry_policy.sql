BEGIN;

ALTER TABLE forgeflow.workflow_tasks
  ADD COLUMN retry_initial_delay_seconds integer NOT NULL DEFAULT 5 CHECK (retry_initial_delay_seconds > 0),
  ADD COLUMN retry_max_delay_seconds integer NOT NULL DEFAULT 300 CHECK (retry_max_delay_seconds >= retry_initial_delay_seconds),
  ADD COLUMN retry_backoff_multiplier numeric NOT NULL DEFAULT 2 CHECK (retry_backoff_multiplier >= 1);

COMMIT;
