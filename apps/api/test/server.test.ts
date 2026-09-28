import { describe, expect, it } from "vitest";

import {
  InvalidWorkflowGraphError,
  validateTaskGraph,
} from "../src/workflow-dag.js";
import { claimNextTask } from "../src/task-claiming.js";
import { calculateRetryDelaySeconds } from "../src/task-retry.js";
import { isValidWorkflowTransition } from "../src/workflows.js";

describe("API bootstrap", () => {
  it("allows only legal workflow lifecycle transitions", () => {
    expect(isValidWorkflowTransition("PENDING", "RUNNING")).toBe(true);
    expect(isValidWorkflowTransition("RUNNING", "SUCCEEDED")).toBe(true);
    expect(isValidWorkflowTransition("SUCCEEDED", "RUNNING")).toBe(false);
  });

  it("rejects DAG definitions with unknown prerequisites and cycles", () => {
    expect(() =>
      validateTaskGraph([
        {
          key: "normalize",
          kind: "NORMALIZE_COMPANY_DATA",
          dependsOn: ["missing"],
        },
      ]),
    ).toThrow(InvalidWorkflowGraphError);
    expect(() =>
      validateTaskGraph([
        { key: "first", kind: "FETCH_COMPANY_PROFILE", dependsOn: ["second"] },
        { key: "second", kind: "NORMALIZE_COMPANY_DATA", dependsOn: ["first"] },
      ]),
    ).toThrow("cycle");
  });

  it("accepts a fan-out and fan-in graph", () => {
    expect(() =>
      validateTaskGraph([
        { key: "profile", kind: "FETCH_COMPANY_PROFILE" },
        { key: "filings", kind: "FETCH_SEC_FILINGS" },
        {
          key: "normalize",
          kind: "NORMALIZE_COMPANY_DATA",
          dependsOn: ["profile", "filings"],
        },
      ]),
    ).not.toThrow();
  });

  it("rejects unsafe lease durations before claiming", async () => {
    await expect(claimNextTask("not-a-worker-id", 0)).rejects.toThrow(
      "Lease duration",
    );
  });

  it("calculates capped exponential retry delays", () => {
    const policy = {
      maxAttempts: 3,
      initialDelaySeconds: 5,
      maxDelaySeconds: 20,
      backoffMultiplier: 2,
    };
    expect(calculateRetryDelaySeconds(1, policy)).toBe(5);
    expect(calculateRetryDelaySeconds(2, policy)).toBe(10);
    expect(calculateRetryDelaySeconds(4, policy)).toBe(20);
  });
});
