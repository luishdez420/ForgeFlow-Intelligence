import { randomUUID } from "node:crypto";

import type { TaskKind } from "@forgeflow/schemas";

import { withTransaction } from "./database.js";

export type ClaimedTask = {
  taskId: string;
  workflowId: string;
  kind: TaskKind;
  attemptId: string;
  attemptNumber: number;
  leaseToken: string;
  leaseExpiresAt: string;
};

type ClaimedTaskRow = {
  id: string;
  workflow_run_id: string;
  kind: TaskKind;
  attempt_count: number;
  lease_expires_at: Date;
};

export async function claimNextTask(
  workerId: string,
  leaseDurationSeconds = 60,
  workflowId?: string,
): Promise<ClaimedTask | null> {
  if (
    !Number.isInteger(leaseDurationSeconds) ||
    leaseDurationSeconds < 1 ||
    leaseDurationSeconds > 3600
  ) {
    throw new Error(
      "Lease duration must be an integer between 1 and 3600 seconds.",
    );
  }

  return withTransaction(async (client) => {
    const leaseToken = randomUUID();
    const claimResult = await client.query<ClaimedTaskRow>(
      `WITH candidate AS (
         SELECT id
         FROM forgeflow.workflow_tasks
         WHERE state IN ('PENDING', 'RETRYING')
           AND available_at <= now()
           AND ($4::uuid IS NULL OR workflow_run_id = $4::uuid)
         ORDER BY available_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE forgeflow.workflow_tasks task
       SET state = 'LEASED',
           attempt_count = attempt_count + 1,
           leased_by_worker_id = $1,
           lease_token = $2::uuid,
           lease_expires_at = now() + make_interval(secs => $3::integer)
       FROM candidate
       WHERE task.id = candidate.id
       RETURNING task.id, task.workflow_run_id, task.kind, task.attempt_count, task.lease_expires_at`,
      [workerId, leaseToken, leaseDurationSeconds, workflowId ?? null],
    );
    const claimed = claimResult.rows[0];
    if (!claimed) {
      return null;
    }

    const attemptResult = await client.query<{ id: string }>(
      `INSERT INTO forgeflow.task_attempts (task_id, worker_id, attempt_number, lease_token, state)
       VALUES ($1, $2, $3, $4::uuid, 'LEASED')
       RETURNING id`,
      [claimed.id, workerId, claimed.attempt_count, leaseToken],
    );
    const attemptId = attemptResult.rows[0]?.id;
    if (!attemptId) {
      throw new Error("Claimed task attempt was not persisted.");
    }

    return {
      taskId: claimed.id,
      workflowId: claimed.workflow_run_id,
      kind: claimed.kind,
      attemptId,
      attemptNumber: claimed.attempt_count,
      leaseToken,
      leaseExpiresAt: claimed.lease_expires_at.toISOString(),
    };
  });
}
