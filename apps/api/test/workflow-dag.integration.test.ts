import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { pool, withTransaction } from "../src/database.js";
import {
  getWorkflowTasks,
  persistTaskGraph,
  resolveTaskDependencies,
} from "../src/workflow-dag.js";
import { claimNextTask } from "../src/task-claiming.js";

const runIntegration = process.env.INTEGRATION_TEST === "1";
const createdWorkflowIds: string[] = [];
const createdCompanyIds: string[] = [];
const createdWorkerIds: string[] = [];

describe.skipIf(!runIntegration)("workflow DAG persistence", () => {
  afterAll(async () => {
    for (const workflowId of createdWorkflowIds) {
      await pool.query("DELETE FROM forgeflow.workflow_runs WHERE id = $1", [
        workflowId,
      ]);
    }
    for (const companyId of createdCompanyIds) {
      await pool.query("DELETE FROM forgeflow.companies WHERE id = $1", [
        companyId,
      ]);
    }
    for (const workerId of createdWorkerIds) {
      await pool.query("DELETE FROM forgeflow.workers WHERE id = $1", [
        workerId,
      ]);
    }
    await pool.end();
  });

  it("releases fan-in work only after every prerequisite succeeds", async () => {
    const workflowId = randomUUID();
    const companyId = randomUUID();
    createdWorkflowIds.push(workflowId);
    createdCompanyIds.push(companyId);

    await withTransaction(async (client) => {
      await client.query(
        "INSERT INTO forgeflow.companies (id, ticker) VALUES ($1, $2)",
        [companyId, "DAGREADY"],
      );
      await client.query(
        `INSERT INTO forgeflow.workflow_runs (id, company_id, ticker, workflow_type, state)
         VALUES ($1, $2, 'DAGREADY', 'COMPANY_ANALYSIS', 'PENDING')`,
        [workflowId, companyId],
      );
      await persistTaskGraph(client, workflowId, [
        { key: "profile", kind: "FETCH_COMPANY_PROFILE" },
        { key: "filings", kind: "FETCH_SEC_FILINGS" },
        {
          key: "normalize",
          kind: "NORMALIZE_COMPANY_DATA",
          dependsOn: ["profile", "filings"],
        },
      ]);
    });

    const initialTasks = await withTransaction((client) =>
      getWorkflowTasks(client, workflowId),
    );
    const profile = initialTasks.find(
      (task) => task.kind === "FETCH_COMPANY_PROFILE",
    );
    const filings = initialTasks.find(
      (task) => task.kind === "FETCH_SEC_FILINGS",
    );
    const normalize = initialTasks.find(
      (task) => task.kind === "NORMALIZE_COMPANY_DATA",
    );
    expect(profile?.state).toBe("PENDING");
    expect(filings?.state).toBe("PENDING");
    expect(normalize?.state).toBe("WAITING");

    await withTransaction(async (client) => {
      await client.query(
        "UPDATE forgeflow.workflow_tasks SET state = 'SUCCEEDED', completed_at = now() WHERE id = $1",
        [profile?.id],
      );
      expect(
        (await resolveTaskDependencies(client, workflowId)).readyTaskIds,
      ).toEqual([]);
      await client.query(
        "UPDATE forgeflow.workflow_tasks SET state = 'SUCCEEDED', completed_at = now() WHERE id = $1",
        [filings?.id],
      );
      expect(
        (await resolveTaskDependencies(client, workflowId)).readyTaskIds,
      ).toEqual([normalize?.id]);
    });

    const updatedTasks = await withTransaction((client) =>
      getWorkflowTasks(client, workflowId),
    );
    expect(updatedTasks.find((task) => task.id === normalize?.id)?.state).toBe(
      "PENDING",
    );
  });

  it("cancels dependent work after a prerequisite reaches a terminal failure", async () => {
    const workflowId = randomUUID();
    const companyId = randomUUID();
    createdWorkflowIds.push(workflowId);
    createdCompanyIds.push(companyId);

    await withTransaction(async (client) => {
      await client.query(
        "INSERT INTO forgeflow.companies (id, ticker) VALUES ($1, $2)",
        [companyId, "DAGFAILED"],
      );
      await client.query(
        `INSERT INTO forgeflow.workflow_runs (id, company_id, ticker, workflow_type, state)
         VALUES ($1, $2, 'DAGFAILED', 'COMPANY_ANALYSIS', 'PENDING')`,
        [workflowId, companyId],
      );
      await persistTaskGraph(client, workflowId, [
        { key: "source", kind: "FETCH_SEC_FILINGS" },
        {
          key: "normalize",
          kind: "NORMALIZE_COMPANY_DATA",
          dependsOn: ["source"],
        },
        { key: "report", kind: "ASSEMBLE_REPORT", dependsOn: ["normalize"] },
      ]);
    });

    const tasks = await withTransaction((client) =>
      getWorkflowTasks(client, workflowId),
    );
    const source = tasks.find((task) => task.kind === "FETCH_SEC_FILINGS");
    await withTransaction(async (client) => {
      await client.query(
        "UPDATE forgeflow.workflow_tasks SET state = 'FAILED', completed_at = now() WHERE id = $1",
        [source?.id],
      );
      expect(
        (await resolveTaskDependencies(client, workflowId)).cancelledTaskIds,
      ).toHaveLength(2);
    });

    const resolvedTasks = await withTransaction((client) =>
      getWorkflowTasks(client, workflowId),
    );
    expect(
      resolvedTasks.filter((task) => task.state === "CANCELLED"),
    ).toHaveLength(2);
  });

  it("claims a ready task once even when workers contend for it", async () => {
    const workflowId = randomUUID();
    const companyId = randomUUID();
    const firstWorkerId = randomUUID();
    const secondWorkerId = randomUUID();
    createdWorkflowIds.push(workflowId);
    createdCompanyIds.push(companyId);
    createdWorkerIds.push(firstWorkerId, secondWorkerId);

    await withTransaction(async (client) => {
      await client.query(
        "INSERT INTO forgeflow.companies (id, ticker) VALUES ($1, $2)",
        [companyId, "CLAIMTEST"],
      );
      await client.query(
        `INSERT INTO forgeflow.workflow_runs (id, company_id, ticker, workflow_type, state)
         VALUES ($1, $2, 'CLAIMTEST', 'COMPANY_ANALYSIS', 'PENDING')`,
        [workflowId, companyId],
      );
      await client.query(
        "INSERT INTO forgeflow.workers (id, name, status) VALUES ($1, $2, 'RUNNING'), ($3, $4, 'RUNNING')",
        [
          firstWorkerId,
          `worker-${firstWorkerId}`,
          secondWorkerId,
          `worker-${secondWorkerId}`,
        ],
      );
      await persistTaskGraph(client, workflowId, [
        { key: "profile", kind: "FETCH_COMPANY_PROFILE" },
      ]);
    });

    const claims = await Promise.all([
      claimNextTask(firstWorkerId, 60, workflowId),
      claimNextTask(secondWorkerId, 60, workflowId),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claim = claims.find(Boolean);
    expect(claim?.attemptNumber).toBe(1);
    expect(claim?.leaseToken).toMatch(/^[0-9a-f-]{36}$/);

    const task = (
      await withTransaction((client) => getWorkflowTasks(client, workflowId))
    )[0];
    expect(task?.state).toBe("LEASED");
    expect(task?.attemptCount).toBe(1);
  });
});
