import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { upsertActiveUser } from "../src/access-control.js";
import { pool } from "../src/database.js";
import {
  getOpenFeedbackForReview,
  getReportFeedback,
  ReportFeedbackNotFoundError,
  resolveReportItemFeedback,
  submitReportItemFeedback,
} from "../src/report-feedback.js";

const runIntegration = process.env.INTEGRATION_TEST === "1";

describe.skipIf(!runIntegration)("report-item feedback", () => {
  const suffix = randomUUID();
  const companyId = randomUUID();
  const workflowId = randomUUID();
  let reportId = "";
  let reportItemId = "";
  let analystId = "";
  let adminId = "";

  afterAll(async () => {
    if (reportId) {
      await pool.query(
        "DELETE FROM forgeflow.report_item_feedback WHERE report_id = $1",
        [reportId],
      );
      await pool.query("DELETE FROM forgeflow.reports WHERE id = $1", [
        reportId,
      ]);
    }
    await pool.query("DELETE FROM forgeflow.workflow_runs WHERE id = $1", [
      workflowId,
    ]);
    await pool.query("DELETE FROM forgeflow.companies WHERE id = $1", [
      companyId,
    ]);
    await pool.query(
      "DELETE FROM forgeflow.audit_events WHERE actor_user_id = ANY($1::uuid[])",
      [[analystId, adminId].filter(Boolean)],
    );
    await pool.query("DELETE FROM forgeflow.users WHERE id = ANY($1::uuid[])", [
      [analystId, adminId].filter(Boolean),
    ]);
    await pool.end();
  });

  it("ties feedback to an immutable published item/version without changing evidence", async () => {
    const analyst = await upsertActiveUser(
      `feedback-analyst-${suffix}@example.com`,
    );
    const admin = await upsertActiveUser(
      `feedback-admin-${suffix}@example.com`,
    );
    analystId = analyst.id;
    adminId = admin.id;
    await pool.query(
      "INSERT INTO forgeflow.user_roles (user_id, role) VALUES ($1, 'ANALYST'), ($2, 'ADMIN')",
      [analystId, adminId],
    );
    await pool.query(
      "INSERT INTO forgeflow.companies (id, ticker) VALUES ($1, 'FDBKTEST')",
      [companyId],
    );
    await pool.query(
      `INSERT INTO forgeflow.workflow_runs
       (id, company_id, ticker, workflow_type, state, submitted_by_user_id)
       VALUES ($1, $2, 'FDBKTEST', 'COMPANY_ANALYSIS', 'PENDING', $3)`,
      [workflowId, companyId, analystId],
    );
    const report = await pool.query<{ id: string }>(
      `INSERT INTO forgeflow.reports (workflow_run_id, company_id, state, published_at)
       VALUES ($1, $2, 'PUBLISHED', now()) RETURNING id`,
      [workflowId, companyId],
    );
    reportId = report.rows[0]!.id;
    const item = await pool.query<{ id: string }>(
      `INSERT INTO forgeflow.report_items
       (report_id, item_kind, section, title, content, display_order)
       VALUES ($1, 'FACT', 'Evidence', 'Revenue', 'Persisted source value.', 0)
       RETURNING id`,
      [reportId],
    );
    reportItemId = item.rows[0]!.id;

    const saved = await submitReportItemFeedback(
      { id: analystId, roles: ["ANALYST"] },
      reportItemId,
      { classification: "UNSUPPORTED", comment: "Please clarify the period." },
    );
    expect(saved).toMatchObject({
      reportId,
      reportItemId,
      classification: "UNSUPPORTED",
      comment: "Please clarify the period.",
      state: "OPEN",
    });
    expect(
      await getReportFeedback(workflowId, {
        id: analystId,
        roles: ["ANALYST"],
      }),
    ).toEqual([expect.objectContaining({ id: saved.id, reportItemId })]);
    await expect(
      getReportFeedback(workflowId, { id: adminId, roles: ["ANALYST"] }),
    ).rejects.toThrow("another analyst");

    const review = await getOpenFeedbackForReview({
      id: adminId,
      roles: ["ADMIN"],
    });
    expect(review).toEqual([
      expect.objectContaining({
        id: saved.id,
        submittedByEmail: `feedback-analyst-${suffix}@example.com`,
        ticker: "FDBKTEST",
        reportItemTitle: "Revenue",
      }),
    ]);
    await expect(
      getOpenFeedbackForReview({ id: analystId, roles: ["ANALYST"] }),
    ).rejects.toThrow("not permitted");

    const resolved = await resolveReportItemFeedback(
      { id: adminId, roles: ["ADMIN"] },
      saved.id,
    );
    expect(resolved.state).toBe("RESOLVED");
    await expect(
      resolveReportItemFeedback({ id: adminId, roles: ["ADMIN"] }, saved.id),
    ).rejects.toBeInstanceOf(ReportFeedbackNotFoundError);
    const authoritativeItem = await pool.query<{ content: string }>(
      "SELECT content FROM forgeflow.report_items WHERE id = $1",
      [reportItemId],
    );
    expect(authoritativeItem.rows[0]?.content).toBe("Persisted source value.");
    const audit = await pool.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM forgeflow.audit_events
       WHERE subject_id = $1 AND action = 'REPORT_ITEM_FEEDBACK_SUBMITTED'`,
      [saved.id],
    );
    expect(audit.rows[0]?.metadata).toMatchObject({
      classification: "UNSUPPORTED",
      reportItemId,
    });
    expect(JSON.stringify(audit.rows[0]?.metadata)).not.toContain("clarify");
  });
});
