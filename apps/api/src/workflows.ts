import type {
  CreateCompanyAnalysisWorkflowRequest,
  CreateCompanyAnalysisWorkflowResponse,
  WorkflowDetail,
  WorkflowState,
} from "@forgeflow/schemas";

import { withTransaction, type Queryable } from "./database.js";
import {
  getWorkflowTasks,
  persistTaskGraph,
  type WorkflowTaskDefinition,
} from "./workflow-dag.js";

export const companyAnalysisTaskGraph: readonly WorkflowTaskDefinition[] = [
  { key: "profile", kind: "FETCH_COMPANY_PROFILE" },
  { key: "sec_filings", kind: "FETCH_SEC_FILINGS" },
  { key: "market_history", kind: "FETCH_MARKET_HISTORY" },
  {
    key: "normalize_company",
    kind: "NORMALIZE_COMPANY_DATA",
    dependsOn: ["profile", "sec_filings"],
  },
  {
    key: "normalize_financials",
    kind: "NORMALIZE_FINANCIAL_DATA",
    dependsOn: ["sec_filings"],
  },
  {
    key: "calculate_financials",
    kind: "CALCULATE_FINANCIAL_METRICS",
    dependsOn: ["normalize_financials"],
  },
  {
    key: "calculate_market",
    kind: "CALCULATE_MARKET_METRICS",
    dependsOn: ["market_history"],
  },
  {
    key: "validate_sources",
    kind: "VALIDATE_SOURCES",
    dependsOn: ["normalize_company", "normalize_financials", "market_history"],
  },
  {
    key: "generate_analysis",
    kind: "GENERATE_ANALYSIS",
    dependsOn: ["calculate_financials", "calculate_market", "validate_sources"],
  },
  {
    key: "assemble_report",
    kind: "ASSEMBLE_REPORT",
    dependsOn: ["generate_analysis", "validate_sources"],
  },
  {
    key: "publish_report",
    kind: "PUBLISH_REPORT",
    dependsOn: ["assemble_report", "validate_sources"],
  },
];

const terminalWorkflowStates = new Set<WorkflowState>([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);

const permittedTransitions: Readonly<
  Record<WorkflowState, readonly WorkflowState[]>
> = {
  PENDING: ["RUNNING", "CANCELLED", "FAILED"],
  RUNNING: ["WAITING", "RETRYING", "SUCCEEDED", "FAILED", "CANCELLED"],
  WAITING: ["RUNNING", "CANCELLED", "FAILED"],
  RETRYING: ["RUNNING", "FAILED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
};

type WorkflowRow = {
  id: string;
  ticker: string;
  state: WorkflowState;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
};

export class WorkflowNotFoundError extends Error {
  constructor(workflowId: string) {
    super(`Workflow ${workflowId} was not found.`);
  }
}

export class InvalidWorkflowTransitionError extends Error {
  constructor(currentState: WorkflowState, nextState: WorkflowState) {
    super(`Workflow cannot transition from ${currentState} to ${nextState}.`);
  }
}

export function isValidWorkflowTransition(
  current: WorkflowState,
  next: WorkflowState,
): boolean {
  return permittedTransitions[current].includes(next);
}

function toWorkflowResponse(
  row: Pick<WorkflowRow, "id" | "state" | "created_at">,
): CreateCompanyAnalysisWorkflowResponse {
  return {
    workflowId: row.id,
    state: row.state,
    createdAt: row.created_at.toISOString(),
  };
}

function toWorkflowDetail(
  row: WorkflowRow,
  tasks: WorkflowDetail["tasks"],
): WorkflowDetail {
  return {
    id: row.id,
    ticker: row.ticker,
    state: row.state,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    tasks,
  };
}

export async function createCompanyAnalysisWorkflow(
  request: CreateCompanyAnalysisWorkflowRequest,
): Promise<CreateCompanyAnalysisWorkflowResponse> {
  return withTransaction(async (client) => {
    const companyResult = await client.query<{ id: string }>(
      `INSERT INTO forgeflow.companies (ticker)
       VALUES ($1)
       ON CONFLICT (ticker) DO UPDATE SET ticker = EXCLUDED.ticker
       RETURNING id`,
      [request.ticker],
    );

    const companyId = companyResult.rows[0]?.id;
    if (!companyId) {
      throw new Error("Company persistence did not return an identifier.");
    }

    const workflowResult = await client.query<WorkflowRow>(
      `INSERT INTO forgeflow.workflow_runs (company_id, ticker, workflow_type, state, idempotency_key)
       VALUES ($1, $2, 'COMPANY_ANALYSIS', 'PENDING', $3)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id, ticker, state, created_at, started_at, completed_at`,
      [companyId, request.ticker, request.idempotencyKey ?? null],
    );

    const created = workflowResult.rows[0];
    if (created) {
      await persistTaskGraph(client, created.id, companyAnalysisTaskGraph);
      return toWorkflowResponse(created);
    }

    if (!request.idempotencyKey) {
      throw new Error("Workflow insert was not persisted.");
    }

    const existingResult = await client.query<WorkflowRow>(
      `SELECT id, ticker, state, created_at, started_at, completed_at
       FROM forgeflow.workflow_runs
       WHERE idempotency_key = $1`,
      [request.idempotencyKey],
    );
    const existing = existingResult.rows[0];
    if (!existing) {
      throw new Error("Idempotent workflow lookup did not return a workflow.");
    }

    return toWorkflowResponse(existing);
  });
}

export async function getWorkflow(workflowId: string): Promise<WorkflowDetail> {
  return withTransaction(async (client) => {
    const result = await client.query<WorkflowRow>(
      `SELECT id, ticker, state, created_at, started_at, completed_at
       FROM forgeflow.workflow_runs
       WHERE id = $1`,
      [workflowId],
    );
    const workflow = result.rows[0];
    if (!workflow) {
      throw new WorkflowNotFoundError(workflowId);
    }

    return toWorkflowDetail(
      workflow,
      await getWorkflowTasks(client, workflowId),
    );
  });
}

export async function transitionWorkflowState(
  queryable: Queryable,
  workflowId: string,
  nextState: WorkflowState,
): Promise<WorkflowDetail> {
  const currentResult = await queryable.query<WorkflowRow>(
    `SELECT id, ticker, state, created_at, started_at, completed_at
     FROM forgeflow.workflow_runs
     WHERE id = $1
     FOR UPDATE`,
    [workflowId],
  );
  const current = currentResult.rows[0];
  if (!current) {
    throw new WorkflowNotFoundError(workflowId);
  }
  if (!isValidWorkflowTransition(current.state, nextState)) {
    throw new InvalidWorkflowTransitionError(current.state, nextState);
  }

  const updatedResult = await queryable.query<WorkflowRow>(
    `UPDATE forgeflow.workflow_runs
     SET state = $2,
         started_at = CASE WHEN $2 = 'RUNNING' AND started_at IS NULL THEN now() ELSE started_at END,
         completed_at = CASE WHEN $2 = ANY($3::text[]) THEN now() ELSE NULL END
     WHERE id = $1
     RETURNING id, ticker, state, created_at, started_at, completed_at`,
    [workflowId, nextState, [...terminalWorkflowStates]],
  );
  const updated = updatedResult.rows[0];
  if (!updated) {
    throw new Error("Workflow state update did not return a workflow.");
  }

  return toWorkflowDetail(updated, []);
}
