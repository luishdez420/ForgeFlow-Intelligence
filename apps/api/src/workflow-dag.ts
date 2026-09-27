import type {
  TaskKind,
  TaskState,
  WorkflowTaskSummary,
} from "@forgeflow/schemas";

import type { Queryable } from "./database.js";

export type WorkflowTaskDefinition = {
  key: string;
  kind: TaskKind;
  dependsOn?: readonly string[];
  maxAttempts?: number;
};

type TaskRow = {
  id: string;
  kind: TaskKind;
  state: TaskState;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  last_error_code: string | null;
};

export class InvalidWorkflowGraphError extends Error {}

export function validateTaskGraph(
  definitions: readonly WorkflowTaskDefinition[],
): void {
  const definitionsByKey = new Map<string, WorkflowTaskDefinition>();
  for (const definition of definitions) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(definition.key)) {
      throw new InvalidWorkflowGraphError(
        `Task key ${definition.key} is invalid.`,
      );
    }
    if (definitionsByKey.has(definition.key)) {
      throw new InvalidWorkflowGraphError(
        `Task key ${definition.key} is duplicated.`,
      );
    }
    if (
      definition.maxAttempts !== undefined &&
      (!Number.isInteger(definition.maxAttempts) || definition.maxAttempts <= 0)
    ) {
      throw new InvalidWorkflowGraphError(
        `Task ${definition.key} has an invalid maxAttempts value.`,
      );
    }
    definitionsByKey.set(definition.key, definition);
  }

  for (const definition of definitions) {
    for (const dependency of definition.dependsOn ?? []) {
      if (!definitionsByKey.has(dependency)) {
        throw new InvalidWorkflowGraphError(
          `Task ${definition.key} depends on unknown task ${dependency}.`,
        );
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visiting.has(key)) {
      throw new InvalidWorkflowGraphError(
        `Workflow graph contains a cycle at task ${key}.`,
      );
    }
    if (visited.has(key)) {
      return;
    }
    visiting.add(key);
    for (const dependency of definitionsByKey.get(key)?.dependsOn ?? []) {
      visit(dependency);
    }
    visiting.delete(key);
    visited.add(key);
  };

  for (const key of definitionsByKey.keys()) {
    visit(key);
  }
}

export async function persistTaskGraph(
  queryable: Queryable,
  workflowId: string,
  definitions: readonly WorkflowTaskDefinition[],
): Promise<void> {
  validateTaskGraph(definitions);
  const taskIds = new Map<string, string>();

  for (const definition of definitions) {
    const state: TaskState =
      (definition.dependsOn?.length ?? 0) === 0 ? "PENDING" : "WAITING";
    const result = await queryable.query<{ id: string }>(
      `INSERT INTO forgeflow.workflow_tasks
         (workflow_run_id, kind, state, max_attempts, idempotency_key)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        workflowId,
        definition.kind,
        state,
        definition.maxAttempts ?? 3,
        `${workflowId}:${definition.key}`,
      ],
    );
    const taskId = result.rows[0]?.id;
    if (!taskId) {
      throw new Error(`Task ${definition.key} was not persisted.`);
    }
    taskIds.set(definition.key, taskId);
  }

  for (const definition of definitions) {
    const taskId = taskIds.get(definition.key);
    if (!taskId) {
      throw new Error(`Task ${definition.key} is missing after persistence.`);
    }
    for (const dependencyKey of definition.dependsOn ?? []) {
      const dependencyId = taskIds.get(dependencyKey);
      if (!dependencyId) {
        throw new Error(
          `Dependency ${dependencyKey} is missing after persistence.`,
        );
      }
      await queryable.query(
        `INSERT INTO forgeflow.workflow_task_dependencies (task_id, depends_on_task_id)
         VALUES ($1, $2)`,
        [taskId, dependencyId],
      );
    }
  }
}

export async function resolveTaskDependencies(
  queryable: Queryable,
  workflowId: string,
): Promise<{ readyTaskIds: string[]; cancelledTaskIds: string[] }> {
  const cancelledResult = await queryable.query<{ id: string }>(
    `WITH RECURSIVE blocked AS (
       SELECT dependency.task_id AS id
       FROM forgeflow.workflow_task_dependencies dependency
       JOIN forgeflow.workflow_tasks prerequisite ON prerequisite.id = dependency.depends_on_task_id
       WHERE prerequisite.workflow_run_id = $1
         AND prerequisite.state IN ('FAILED', 'CANCELLED')
       UNION
       SELECT dependency.task_id
       FROM forgeflow.workflow_task_dependencies dependency
       JOIN blocked ON blocked.id = dependency.depends_on_task_id
     )
     UPDATE forgeflow.workflow_tasks task
     SET state = 'CANCELLED',
         completed_at = now(),
         last_error_code = 'DEPENDENCY_TERMINAL',
         last_error_message = 'A prerequisite task failed or was cancelled.'
     WHERE task.id IN (SELECT id FROM blocked)
       AND task.state IN ('PENDING', 'WAITING', 'RETRYING')
     RETURNING task.id`,
    [workflowId],
  );

  const readyResult = await queryable.query<{ id: string }>(
    `UPDATE forgeflow.workflow_tasks task
     SET state = 'PENDING', available_at = now()
     WHERE task.workflow_run_id = $1
       AND task.state = 'WAITING'
       AND NOT EXISTS (
         SELECT 1
         FROM forgeflow.workflow_task_dependencies dependency
         JOIN forgeflow.workflow_tasks prerequisite ON prerequisite.id = dependency.depends_on_task_id
         WHERE dependency.task_id = task.id
           AND prerequisite.state <> 'SUCCEEDED'
       )
     RETURNING task.id`,
    [workflowId],
  );

  return {
    readyTaskIds: readyResult.rows.map((row) => row.id),
    cancelledTaskIds: cancelledResult.rows.map((row) => row.id),
  };
}

export async function getWorkflowTasks(
  queryable: Queryable,
  workflowId: string,
): Promise<WorkflowTaskSummary[]> {
  const taskResult = await queryable.query<TaskRow>(
    `SELECT id, kind, state, attempt_count, max_attempts, available_at AS next_attempt_at,
            started_at, completed_at, last_error_code
     FROM forgeflow.workflow_tasks
     WHERE workflow_run_id = $1
     ORDER BY created_at`,
    [workflowId],
  );
  const dependenciesResult = await queryable.query<{
    task_id: string;
    depends_on_task_id: string;
  }>(
    `SELECT dependency.task_id, dependency.depends_on_task_id
     FROM forgeflow.workflow_task_dependencies dependency
     JOIN forgeflow.workflow_tasks task ON task.id = dependency.task_id
     WHERE task.workflow_run_id = $1`,
    [workflowId],
  );
  const dependenciesByTask = new Map<string, string[]>();
  for (const dependency of dependenciesResult.rows) {
    dependenciesByTask.set(dependency.task_id, [
      ...(dependenciesByTask.get(dependency.task_id) ?? []),
      dependency.depends_on_task_id,
    ]);
  }

  return taskResult.rows.map((task) => ({
    id: task.id,
    kind: task.kind,
    state: task.state,
    attemptCount: task.attempt_count,
    maxAttempts: task.max_attempts,
    dependsOn: dependenciesByTask.get(task.id) ?? [],
    nextAttemptAt: task.next_attempt_at?.toISOString() ?? null,
    startedAt: task.started_at?.toISOString() ?? null,
    completedAt: task.completed_at?.toISOString() ?? null,
    lastErrorCode: task.last_error_code,
  }));
}
