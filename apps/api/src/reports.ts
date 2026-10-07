import type { ReportDetail, SourceReference } from "@forgeflow/schemas";

import { withTransaction } from "./database.js";
import { linkReportItemSources } from "./provenance.js";
import { parseGroundedAiOutput } from "./report-generation.js";
import { requireWorkflowAccess, type AccessActor } from "./access-control.js";

export class ReportNotFoundError extends Error {
  constructor(workflowId: string) {
    super(`Report for workflow ${workflowId} was not found.`);
  }
}

export class ValidationGateError extends Error {
  constructor() {
    super(
      "Report publication is blocked by invalid source validation findings.",
    );
  }
}

export async function assemblePersistedReport(
  workflowId: string,
): Promise<string> {
  return withTransaction(async (client) => {
    const workflow = await client.query<{ company_id: string }>(
      "SELECT company_id FROM forgeflow.workflow_runs WHERE id = $1 FOR UPDATE",
      [workflowId],
    );
    const companyId = workflow.rows[0]?.company_id;
    if (!companyId) throw new ReportNotFoundError(workflowId);
    const blocking = await client.query<{ count: string }>(
      "SELECT count(*) FROM forgeflow.workflow_validation_findings WHERE workflow_run_id = $1 AND severity = 'ERROR'",
      [workflowId],
    );
    if (Number(blocking.rows[0]?.count ?? 0) > 0)
      throw new ValidationGateError();
    const report = await client.query<{ id: string }>(
      "INSERT INTO forgeflow.reports (workflow_run_id, company_id, state) VALUES ($1, $2, 'DRAFT') ON CONFLICT (workflow_run_id) DO UPDATE SET state = 'DRAFT', published_at = NULL RETURNING id",
      [workflowId, companyId],
    );
    const reportId = report.rows[0]!.id;
    await client.query(
      "DELETE FROM forgeflow.report_items WHERE report_id = $1 AND item_kind <> 'AI_ANALYSIS'",
      [reportId],
    );
    const facts = await client.query<{
      id: string;
      field_name: string;
      normalized_value: { value?: unknown } | null;
      raw_value: { reason?: string };
    }>(
      "SELECT id, field_name, normalized_value, raw_value FROM forgeflow.facts WHERE company_id = $1 ORDER BY created_at",
      [companyId],
    );
    const nextOrder = await client.query<{ next_order: number }>(
      "SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order FROM forgeflow.report_items WHERE report_id = $1",
      [reportId],
    );
    let order = nextOrder.rows[0]?.next_order ?? 0;
    for (const fact of facts.rows) {
      const unavailable = !fact.normalized_value;
      const item = await client.query<{ id: string }>(
        "INSERT INTO forgeflow.report_items (report_id, item_kind, section, title, content, display_order) VALUES ($1, $2, 'Evidence', $3, $4, $5) RETURNING id",
        [
          reportId,
          unavailable ? "UNAVAILABLE" : "FACT",
          fact.field_name,
          unavailable
            ? (fact.raw_value.reason ?? "Unavailable")
            : String(fact.normalized_value?.value),
          order++,
        ],
      );
      if (!unavailable)
        await client.query(
          "INSERT INTO forgeflow.report_item_sources (report_item_id, source_id) SELECT $1, source_id FROM forgeflow.facts WHERE id = $2",
          [item.rows[0]!.id, fact.id],
        );
    }
    const metrics = await client.query<{
      id: string;
      metric_name: string;
      value: string | null;
      unit: string;
      calculation_status: string;
      input_snapshot: Record<string, unknown>;
    }>(
      "SELECT id, metric_name, value, unit, calculation_status, input_snapshot FROM forgeflow.financial_metrics WHERE company_id = $1 ORDER BY calculated_at",
      [companyId],
    );
    for (const metric of metrics.rows) {
      const item = await client.query<{ id: string }>(
        "INSERT INTO forgeflow.report_items (report_id, item_kind, section, title, content, display_order, financial_metric_id) VALUES ($1, $2, 'Calculations', $3, $4, $5, $6) RETURNING id",
        [
          reportId,
          metric.calculation_status === "CALCULATED"
            ? "CALCULATION"
            : "UNAVAILABLE",
          metric.metric_name,
          metric.value === null
            ? metric.calculation_status
            : `${metric.value} ${metric.unit}`,
          order++,
          metric.id,
        ],
      );
      const sourceIds = Array.isArray(metric.input_snapshot.source_ids)
        ? metric.input_snapshot.source_ids.filter(
            (sourceId): sourceId is string =>
              typeof sourceId === "string" &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                sourceId,
              ),
          )
        : [];
      if (sourceIds.length > 0) {
        await client.query(
          `INSERT INTO forgeflow.report_item_sources (report_item_id, source_id)
           SELECT $1, source_id FROM unnest($2::uuid[]) AS source_id
           ON CONFLICT DO NOTHING`,
          [item.rows[0]!.id, sourceIds],
        );
      }
    }
    return reportId;
  });
}

export async function persistGroundedAiReport(
  workflowId: string,
  rawOutput: string,
  allowedSourceIds: readonly string[],
): Promise<string> {
  const items = parseGroundedAiOutput(rawOutput, allowedSourceIds);
  return withTransaction(async (client) => {
    const blockingFindings = await client.query<{ count: string }>(
      `SELECT count(*)
       FROM forgeflow.workflow_validation_findings
       WHERE workflow_run_id = $1 AND severity = 'ERROR'`,
      [workflowId],
    );
    if (Number(blockingFindings.rows[0]?.count ?? 0) > 0) {
      throw new ValidationGateError();
    }
    const workflow = await client.query<{ company_id: string }>(
      "SELECT company_id FROM forgeflow.workflow_runs WHERE id = $1 FOR UPDATE",
      [workflowId],
    );
    const companyId = workflow.rows[0]?.company_id;
    if (!companyId) throw new ReportNotFoundError(workflowId);
    const report = await client.query<{ id: string }>(
      "INSERT INTO forgeflow.reports (workflow_run_id, company_id, state, published_at) VALUES ($1, $2, 'PUBLISHED', now()) ON CONFLICT (workflow_run_id) DO UPDATE SET state = 'PUBLISHED', published_at = now() RETURNING id",
      [workflowId, companyId],
    );
    const reportId = report.rows[0]!.id;
    await client.query(
      "DELETE FROM forgeflow.report_items WHERE report_id = $1 AND item_kind = 'AI_ANALYSIS'",
      [reportId],
    );
    for (const [displayOrder, item] of items.entries()) {
      const result = await client.query<{ id: string }>(
        "INSERT INTO forgeflow.report_items (report_id, item_kind, section, title, content, display_order) VALUES ($1, 'AI_ANALYSIS', $2, $3, $4, $5) RETURNING id",
        [reportId, item.section, item.title, item.content, displayOrder],
      );
      await linkReportItemSources(client, result.rows[0]!.id, item.sourceIds);
    }
    return reportId;
  });
}

export async function getReport(
  workflowId: string,
  actor?: AccessActor,
): Promise<ReportDetail> {
  return withTransaction(async (client) => {
    const report = await client.query<{
      id: string;
      ticker: string;
      published_at: Date;
      submitted_by_user_id: string | null;
    }>(
      "SELECT report.id, workflow.ticker, report.published_at, workflow.submitted_by_user_id FROM forgeflow.reports report JOIN forgeflow.workflow_runs workflow ON workflow.id = report.workflow_run_id WHERE report.workflow_run_id = $1 AND report.state = 'PUBLISHED'",
      [workflowId],
    );
    const row = report.rows[0];
    if (!row || !row.published_at) throw new ReportNotFoundError(workflowId);
    if (actor) requireWorkflowAccess(actor, row.submitted_by_user_id);
    const itemRows = await client.query<{
      id: string;
      item_kind: ReportDetail["items"][number]["kind"];
      section: string;
      title: string;
      content: string;
      financial_metric_id: string | null;
      formula_version: string | null;
      input_snapshot: Record<string, unknown> | null;
      calculation_status: "CALCULATED" | "UNAVAILABLE" | "INVALID_INPUT" | null;
      calculated_at: Date | null;
    }>(
      `SELECT item.id, item.item_kind, item.section, item.title, item.content,
              item.financial_metric_id, metric.formula_version, metric.input_snapshot,
              metric.calculation_status, metric.calculated_at
       FROM forgeflow.report_items item
       LEFT JOIN forgeflow.financial_metrics metric ON metric.id = item.financial_metric_id
       WHERE item.report_id = $1
       ORDER BY item.display_order`,
      [row.id],
    );
    const sources = await client.query<{
      report_item_id: string;
      id: string;
      source_type: SourceReference["sourceType"];
      provider: string;
      origin_url: string;
      retrieved_at: Date;
      document_id: string | null;
      document_section: string | null;
    }>(
      `SELECT link.report_item_id, source.id, source.source_type, source.provider,
              source.origin_url, source.retrieved_at, document.id AS document_id,
              concat_ws(' · ', document.document_type, document.external_identifier) AS document_section
       FROM forgeflow.report_item_sources link
       JOIN forgeflow.sources source ON source.id = link.source_id
       LEFT JOIN LATERAL (
         SELECT id, document_type, external_identifier
         FROM forgeflow.documents
         WHERE source_id = source.id
         ORDER BY created_at DESC
         LIMIT 1
       ) document ON true
       WHERE link.report_item_id IN (
         SELECT id FROM forgeflow.report_items WHERE report_id = $1
       )`,
      [row.id],
    );
    const findings = await client.query<{
      code: string;
      severity: "ERROR" | "WARNING" | "INFO";
      data_status: "VALID" | "AMBIGUOUS" | "UNAVAILABLE" | "INVALID";
      subject_type: string;
      subject_id: string | null;
      message: string;
      details: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT code, severity, data_status, subject_type, subject_id, message, details, created_at
       FROM forgeflow.workflow_validation_findings
       WHERE workflow_run_id = $1
       ORDER BY severity, created_at, code`,
      [workflowId],
    );
    return {
      id: row.id,
      workflowId,
      ticker: row.ticker,
      publishedAt: row.published_at.toISOString(),
      items: itemRows.rows.map((item) => ({
        id: item.id,
        kind: item.item_kind,
        section: item.section,
        title: item.title,
        content: item.content,
        sources: sources.rows
          .filter((source) => source.report_item_id === item.id)
          .map((source) => ({
            sourceId: source.id,
            sourceType: source.source_type,
            provider: source.provider,
            url: source.origin_url,
            retrievedAt: source.retrieved_at.toISOString(),
            ...(source.document_id
              ? {
                  documentId: source.document_id,
                  documentSection: source.document_section ?? "Source document",
                }
              : {}),
          })),
        ...(item.financial_metric_id
          ? { calculationId: item.financial_metric_id }
          : {}),
        ...(item.financial_metric_id &&
        item.formula_version &&
        item.input_snapshot &&
        item.calculation_status &&
        item.calculated_at
          ? {
              calculationProvenance: {
                formulaVersion: item.formula_version,
                inputSnapshot: item.input_snapshot,
                status: item.calculation_status,
                calculatedAt: item.calculated_at.toISOString(),
              },
            }
          : {}),
      })),
      validationFindings: findings.rows.map((finding) => ({
        code: finding.code,
        severity: finding.severity,
        dataStatus: finding.data_status,
        subjectType: finding.subject_type,
        subjectId: finding.subject_id,
        message: finding.message,
        details: finding.details,
        createdAt: finding.created_at.toISOString(),
      })),
    };
  });
}
