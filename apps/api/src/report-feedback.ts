import type {
  CreateReportItemFeedback,
  ReportItemFeedback,
} from "@forgeflow/schemas";

import {
  recordAuditEvent,
  requireRole,
  requireWorkflowAccess,
  type AccessActor,
} from "./access-control.js";
import { withTransaction } from "./database.js";

export class ReportFeedbackNotFoundError extends Error {
  constructor(message = "Report feedback was not found.") {
    super(message);
  }
}

type FeedbackRow = {
  id: string;
  report_id: string;
  report_item_id: string;
  report_version: Date;
  classification: ReportItemFeedback["classification"];
  comment: string | null;
  state: ReportItemFeedback["state"];
  created_at: Date;
  submitted_by_email?: string;
  ticker?: string;
  report_item_title?: string;
};

function serializeFeedback(row: FeedbackRow): ReportItemFeedback {
  return {
    id: row.id,
    reportId: row.report_id,
    reportItemId: row.report_item_id,
    reportVersion: row.report_version.toISOString(),
    classification: row.classification,
    comment: row.comment,
    state: row.state,
    createdAt: row.created_at.toISOString(),
    ...(row.submitted_by_email
      ? { submittedByEmail: row.submitted_by_email }
      : {}),
    ...(row.ticker ? { ticker: row.ticker } : {}),
    ...(row.report_item_title
      ? { reportItemTitle: row.report_item_title }
      : {}),
  };
}

export async function submitReportItemFeedback(
  actor: AccessActor,
  reportItemId: string,
  feedback: CreateReportItemFeedback,
): Promise<ReportItemFeedback> {
  requireRole(actor, "ANALYST");
  return withTransaction(async (client) => {
    const item = await client.query<{
      report_id: string;
      workflow_run_id: string;
      published_at: Date | null;
      submitted_by_user_id: string | null;
    }>(
      `SELECT item.report_id, report.workflow_run_id, report.published_at,
              workflow.submitted_by_user_id
       FROM forgeflow.report_items item
       JOIN forgeflow.reports report ON report.id = item.report_id
       JOIN forgeflow.workflow_runs workflow ON workflow.id = report.workflow_run_id
       WHERE item.id = $1 AND report.state = 'PUBLISHED'`,
      [reportItemId],
    );
    const reportItem = item.rows[0];
    if (!reportItem || !reportItem.published_at) {
      throw new ReportFeedbackNotFoundError(
        "Published report item was not found.",
      );
    }
    requireWorkflowAccess(actor, reportItem.submitted_by_user_id);
    const result = await client.query<FeedbackRow>(
      `INSERT INTO forgeflow.report_item_feedback
         (report_id, report_item_id, report_version, submitted_by_user_id, classification, comment)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, report_id, report_item_id, report_version, classification,
                 comment, state, created_at`,
      [
        reportItem.report_id,
        reportItemId,
        reportItem.published_at,
        actor.id,
        feedback.classification,
        feedback.comment ?? null,
      ],
    );
    const persisted = result.rows[0];
    if (!persisted)
      throw new Error("Feedback persistence did not return a row.");
    await recordAuditEvent(client, actor.id, {
      action: "REPORT_ITEM_FEEDBACK_SUBMITTED",
      subjectType: "REPORT_ITEM_FEEDBACK",
      subjectId: persisted.id,
      metadata: {
        classification: persisted.classification,
        reportId: persisted.report_id,
        reportItemId: persisted.report_item_id,
        reportVersion: persisted.report_version.toISOString(),
      },
    });
    return serializeFeedback(persisted);
  });
}

export async function getReportFeedback(
  workflowId: string,
  actor: AccessActor,
): Promise<ReportItemFeedback[]> {
  return withTransaction(async (client) => {
    const report = await client.query<{
      id: string;
      submitted_by_user_id: string | null;
    }>(
      `SELECT report.id, workflow.submitted_by_user_id
       FROM forgeflow.reports report
       JOIN forgeflow.workflow_runs workflow ON workflow.id = report.workflow_run_id
       WHERE report.workflow_run_id = $1 AND report.state = 'PUBLISHED'`,
      [workflowId],
    );
    const row = report.rows[0];
    if (!row)
      throw new ReportFeedbackNotFoundError("Published report was not found.");
    requireWorkflowAccess(actor, row.submitted_by_user_id);
    const feedback = await client.query<FeedbackRow>(
      `SELECT id, report_id, report_item_id, report_version, classification,
              comment, state, created_at
       FROM forgeflow.report_item_feedback
       WHERE report_id = $1 AND submitted_by_user_id = $2
       ORDER BY created_at DESC`,
      [row.id, actor.id],
    );
    return feedback.rows.map(serializeFeedback);
  });
}

export async function getOpenFeedbackForReview(
  actor: AccessActor,
): Promise<ReportItemFeedback[]> {
  requireRole(actor, "ADMIN");
  return withTransaction(async (client) => {
    const result = await client.query<FeedbackRow>(
      `SELECT feedback.id, feedback.report_id, feedback.report_item_id,
              feedback.report_version, feedback.classification, feedback.comment,
              feedback.state, feedback.created_at, users.email AS submitted_by_email,
              workflow.ticker, item.title AS report_item_title
       FROM forgeflow.report_item_feedback feedback
       JOIN forgeflow.users users ON users.id = feedback.submitted_by_user_id
       JOIN forgeflow.reports report ON report.id = feedback.report_id
       JOIN forgeflow.workflow_runs workflow ON workflow.id = report.workflow_run_id
       LEFT JOIN forgeflow.report_items item ON item.id = feedback.report_item_id
       WHERE feedback.state = 'OPEN'
       ORDER BY feedback.created_at DESC`,
    );
    return result.rows.map(serializeFeedback);
  });
}

export async function resolveReportItemFeedback(
  actor: AccessActor,
  feedbackId: string,
): Promise<ReportItemFeedback> {
  requireRole(actor, "ADMIN");
  return withTransaction(async (client) => {
    const result = await client.query<FeedbackRow>(
      `UPDATE forgeflow.report_item_feedback
       SET state = 'RESOLVED', resolved_by_user_id = $2, resolved_at = now()
       WHERE id = $1 AND state = 'OPEN'
       RETURNING id, report_id, report_item_id, report_version, classification,
                 comment, state, created_at`,
      [feedbackId, actor.id],
    );
    const feedback = result.rows[0];
    if (!feedback) throw new ReportFeedbackNotFoundError();
    await recordAuditEvent(client, actor.id, {
      action: "REPORT_ITEM_FEEDBACK_RESOLVED",
      subjectType: "REPORT_ITEM_FEEDBACK",
      subjectId: feedback.id,
      metadata: {
        reportId: feedback.report_id,
        reportItemId: feedback.report_item_id,
        reportVersion: feedback.report_version.toISOString(),
      },
    });
    return serializeFeedback(feedback);
  });
}
