import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { pool } from "../src/database.js";
import { recordSource } from "../src/provenance.js";
import { getReport, persistGroundedAiReport } from "../src/reports.js";
import { SourceGroundingError } from "../src/report-generation.js";

const runIntegration = process.env.INTEGRATION_TEST === "1";

describe.skipIf(!runIntegration)("source-grounded reports", () => {
  const workflowId = randomUUID();
  const companyId = randomUUID();
  let sourceId = "";

  afterAll(async () => {
    await pool.query(
      "DELETE FROM forgeflow.reports WHERE workflow_run_id = $1",
      [workflowId],
    );
    if (sourceId)
      await pool.query("DELETE FROM forgeflow.sources WHERE id = $1", [
        sourceId,
      ]);
    await pool.query("DELETE FROM forgeflow.workflow_runs WHERE id = $1", [
      workflowId,
    ]);
    await pool.query("DELETE FROM forgeflow.companies WHERE id = $1", [
      companyId,
    ]);
    await pool.end();
  });

  it("persists only grounded AI analysis and returns typed cited report items", async () => {
    await pool.query(
      "INSERT INTO forgeflow.companies (id, ticker) VALUES ($1, 'REPORTTEST')",
      [companyId],
    );
    await pool.query(
      "INSERT INTO forgeflow.workflow_runs (id, company_id, ticker, workflow_type, state) VALUES ($1, $2, 'REPORTTEST', 'COMPANY_ANALYSIS', 'PENDING')",
      [workflowId, companyId],
    );
    const source = await recordSource(pool, {
      companyId,
      sourceType: "SEC_FILING",
      provider: "SEC EDGAR",
      originUrl: "https://www.sec.gov/Archives/report-test",
      retrievedAt: "2026-09-28T00:00:00.000Z",
      content: "fixture",
    });
    sourceId = source.sourceId;
    await persistGroundedAiReport(
      workflowId,
      JSON.stringify({
        items: [
          {
            section: "Outlook",
            title: "Grounded observation",
            content: "The filing provides the cited context.",
            sourceIds: [sourceId],
          },
        ],
      }),
      [sourceId],
    );
    const report = await getReport(workflowId);
    expect(report.items).toMatchObject([
      { kind: "AI_ANALYSIS", sources: [{ sourceId }] },
    ]);
    await expect(
      persistGroundedAiReport(
        workflowId,
        JSON.stringify({
          items: [
            {
              section: "Outlook",
              title: "Unsupported",
              content: "No evidence.",
              sourceIds: [randomUUID()],
            },
          ],
        }),
        [sourceId],
      ),
    ).rejects.toBeInstanceOf(SourceGroundingError);
    expect(
      (
        await pool.query(
          "SELECT count(*) FROM forgeflow.report_items WHERE report_id = $1",
          [report.id],
        )
      ).rows[0]?.count,
    ).toBe("1");
  });
});
