import { withTransaction, type Queryable } from "./database.js";
import { resolveTaskDependencies } from "./workflow-dag.js";

export type FailureClass =
  "TRANSIENT" | "RATE_LIMIT" | "VALIDATION" | "AUTHENTICATION" | "PERMANENT";

export type RetryPolicy = {
  maxAttempts: number;
  initialDelaySeconds: number;
  maxDelaySeconds: number;
  backoffMultiplier: number;
};

type LeasedTaskRow = RetryPolicy & {
  id: string;
  workflow_run_id: string;
  attemptNumber: number;
  leaseToken: string;
};

export type TaskFailure = {
  classification: FailureClass;
  code: string;
  message: string;
};

export type TaskFailureResult = {
  retried: boolean;
  retryDelaySeconds: number | null;
  workflowId: string;
};

const retryableFailures = new Set<FailureClass>(["TRANSIENT", "RATE_LIMIT"]);

export function calculateRetryDelaySeconds(
  attemptNumber: number,
  policy: RetryPolicy,
): number {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error("Attempt number must be a positive integer.");
  }
  const delay =
    policy.initialDelaySeconds *
    policy.backoffMultiplier ** (attemptNumber - 1);
  return Math.min(policy.maxDelaySeconds, Math.ceil(delay));
}

function shouldRetry(
  task: LeasedTaskRow,
  classification: FailureClass,
): boolean {
  return (
    retryableFailures.has(classification) &&
    task.attemptNumber < task.maxAttempts
  );
}

async function finalizeFailure(
  queryable: Queryable,
  task: LeasedTaskRow,
  failure: TaskFailure,
): Promise<TaskFailureResult> {
  const retry = shouldRetry(task, failure.classification);
  const retryDelaySeconds = retry
    ? calculateRetryDelaySeconds(task.attemptNumber, task)
    : null;

  await queryable.query(
    `UPDATE forgeflow.task_attempts
     SET state = 'FAILED', completed_at = now(), error_class = $3, error_code = $4, error_message = $5
     WHERE task_id = $1 AND lease_token = $2::uuid AND state IN ('LEASED', 'RUNNING')`,
    [
      task.id,
      task.leaseToken,
      failure.classification,
      failure.code,
      failure.message,
    ],
  );

  await queryable.query(
    `UPDATE forgeflow.workflow_tasks
     SET state = CASE WHEN $3::boolean THEN 'RETRYING' ELSE 'FAILED' END,
         available_at = CASE WHEN $3::boolean THEN now() + make_interval(secs => $4::integer) ELSE available_at END,
         lease_token = NULL,
         lease_expires_at = NULL,
         leased_by_worker_id = NULL,
         completed_at = CASE WHEN $3::boolean THEN NULL ELSE now() END,
         last_error_code = $5,
         last_error_message = $6
     WHERE id = $1 AND lease_token = $2::uuid`,
    [
      task.id,
      task.leaseToken,
      retry,
      retryDelaySeconds ?? 0,
      failure.code,
      failure.message,
    ],
  );

  if (!retry) {
    await resolveTaskDependencies(queryable, task.workflow_run_id);
  }

  return {
    retried: retry,
    retryDelaySeconds,
    workflowId: task.workflow_run_id,
  };
}

export async function recordTaskFailure(
  taskId: string,
  leaseToken: string,
  failure: TaskFailure,
): Promise<TaskFailureResult | null> {
  return withTransaction(async (client) => {
    const taskResult = await client.query<LeasedTaskRow>(
      `SELECT id, workflow_run_id, attempt_count AS "attemptNumber", max_attempts AS "maxAttempts", lease_token AS "leaseToken",
              retry_initial_delay_seconds AS "initialDelaySeconds",
              retry_max_delay_seconds AS "maxDelaySeconds",
              retry_backoff_multiplier::float8 AS "backoffMultiplier"
       FROM forgeflow.workflow_tasks
       WHERE id = $1 AND lease_token = $2::uuid AND state IN ('LEASED', 'RUNNING')
       FOR UPDATE`,
      [taskId, leaseToken],
    );
    const row = taskResult.rows[0];
    if (!row) {
      return null;
    }

    return finalizeFailure(client, row, failure);
  });
}

export async function recoverExpiredTaskLeases(): Promise<number> {
  return withTransaction(async (client) => {
    const expiredResult = await client.query<LeasedTaskRow>(
      `SELECT id, workflow_run_id, attempt_count AS "attemptNumber", max_attempts AS "maxAttempts", lease_token AS "leaseToken",
              retry_initial_delay_seconds AS "initialDelaySeconds",
              retry_max_delay_seconds AS "maxDelaySeconds",
              retry_backoff_multiplier::float8 AS "backoffMultiplier"
       FROM forgeflow.workflow_tasks
       WHERE state = 'LEASED' AND lease_expires_at <= now()
       FOR UPDATE SKIP LOCKED`,
    );
    for (const row of expiredResult.rows) {
      await finalizeFailure(client, row, {
        classification: "TRANSIENT",
        code: "LEASE_EXPIRED",
        message: "Task lease expired before completion was recorded.",
      });
    }
    return expiredResult.rows.length;
  });
}
