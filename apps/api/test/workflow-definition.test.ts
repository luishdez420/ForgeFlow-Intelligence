import { describe, expect, it } from "vitest";

import { validateTaskGraph } from "../src/workflow-dag.js";
import { companyAnalysisTaskGraph } from "../src/workflows.js";

describe("company analysis workflow definition", () => {
  it("is a valid server-owned graph with independent retrieval and gated publication", () => {
    expect(() => validateTaskGraph(companyAnalysisTaskGraph)).not.toThrow();
    const independent = companyAnalysisTaskGraph.filter(
      (task) => !task.dependsOn?.length,
    );
    expect(independent.map((task) => task.kind)).toEqual([
      "FETCH_COMPANY_PROFILE",
      "FETCH_SEC_FILINGS",
      "FETCH_MARKET_HISTORY",
    ]);
    expect(
      companyAnalysisTaskGraph.find((task) => task.kind === "PUBLISH_REPORT")
        ?.dependsOn,
    ).toEqual(["assemble_report", "validate_sources"]);
  });
});
