import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { pool } from "../src/database.js";
import { recordSource } from "../src/provenance.js";
import {
  assemblePersistedReport,
  getReport,
  persistGroundedAiReport,
  ValidationGateError,
} from "../src/reports.js";
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
    await pool.query("DELETE FROM forgeflow.facts WHERE company_id = $1", [
      companyId,
    ]);
    await pool.query(
      "DELETE FROM forgeflow.financial_metrics WHERE company_id = $1",
      [companyId],
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

  it("assembles idempotent fact, calculation, and unavailable report items", async () => {
    await pool.query(
      `INSERT INTO forgeflow.facts
       (company_id, source_id, field_name, raw_value, normalized_value, normalization_status, observed_at)
       VALUES ($1, $2, 'revenue', '{"unit":"USD","val":100}', '{"value":100,"unit":"USD"}', 'NORMALIZED', '2025-06-30'),
              ($1, $2, 'market_history', '{"reason":"NO_APPROVED_VENDOR"}', NULL, 'UNAVAILABLE', NULL)`,
      [companyId, sourceId],
    );
    await pool.query(
      `INSERT INTO forgeflow.financial_metrics
       (company_id, metric_name, period_end, value, unit, formula_version, input_snapshot, calculation_status)
       VALUES ($1, 'operating_margin', '2025-06-30', 25, 'PERCENT', 'v1', $2::jsonb, 'CALCULATED')`,
      [companyId, JSON.stringify({ source_ids: [sourceId] })],
    );
    const reportId = await assemblePersistedReport(workflowId);
    expect(await assemblePersistedReport(workflowId)).toBe(reportId);
    const rows = await pool.query<{ item_kind: string; title: string }>(
      "SELECT item_kind, title FROM forgeflow.report_items WHERE report_id = $1 ORDER BY title",
      [reportId],
    );
    expect(rows.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ item_kind: "FACT", title: "revenue" }),
        expect.objectContaining({
          item_kind: "CALCULATION",
          title: "operating_margin",
        }),
        expect.objectContaining({
          item_kind: "UNAVAILABLE",
          title: "market_history",
        }),
      ]),
    );
    expect(rows.rows.filter((row) => row.title === "revenue")).toHaveLength(1);
    await pool.query(
      "UPDATE forgeflow.reports SET state = 'PUBLISHED', published_at = now() WHERE id = $1",
      [reportId],
    );
    const published = await getReport(workflowId);
    expect(published.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "CALCULATION",
          calculationProvenance: expect.objectContaining({
            formulaVersion: "v1",
            inputSnapshot: { source_ids: [sourceId] },
          }),
          sources: [expect.objectContaining({ sourceId })],
        }),
      ]),
    );
  });

  it("blocks publication when provenance validation has an error", async () => {
    await pool.query(
      `INSERT INTO forgeflow.workflow_validation_findings
       (workflow_run_id, company_id, finding_key, code, severity, data_status, subject_type, message)
       VALUES ($1, $2, 'report-gate-test', 'MISSING_PROVENANCE', 'ERROR', 'INVALID', 'FACT', 'A fact is missing provenance.')`,
      [workflowId, companyId],
    );
    await expect(
      persistGroundedAiReport(
        workflowId,
        JSON.stringify({
          items: [
            {
              section: "Outlook",
              title: "Blocked",
              content: "This must not publish.",
              sourceIds: [sourceId],
            },
          ],
        }),
        [sourceId],
      ),
    ).rejects.toBeInstanceOf(ValidationGateError);
  });
});
