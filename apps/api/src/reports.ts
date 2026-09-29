import type { ReportDetail, SourceReference } from "@forgeflow/schemas";

import { withTransaction } from "./database.js";
import { linkReportItemSources } from "./provenance.js";
import { parseGroundedAiOutput } from "./report-generation.js";

export class ReportNotFoundError extends Error {
  constructor(workflowId: string) {
    super(`Report for workflow ${workflowId} was not found.`);
  }
}

export async function persistGroundedAiReport(
  workflowId: string,
  rawOutput: string,
  allowedSourceIds: readonly string[],
): Promise<string> {
  const items = parseGroundedAiOutput(rawOutput, allowedSourceIds);
  return withTransaction(async (client) => {
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

export async function getReport(workflowId: string): Promise<ReportDetail> {
  return withTransaction(async (client) => {
    const report = await client.query<{
      id: string;
      ticker: string;
      published_at: Date;
    }>(
      "SELECT report.id, workflow.ticker, report.published_at FROM forgeflow.reports report JOIN forgeflow.workflow_runs workflow ON workflow.id = report.workflow_run_id WHERE report.workflow_run_id = $1 AND report.state = 'PUBLISHED'",
      [workflowId],
    );
    const row = report.rows[0];
    if (!row || !row.published_at) throw new ReportNotFoundError(workflowId);
    const itemRows = await client.query<{
      id: string;
      item_kind: ReportDetail["items"][number]["kind"];
      section: string;
      title: string;
      content: string;
      financial_metric_id: string | null;
    }>(
      "SELECT id, item_kind, section, title, content, financial_metric_id FROM forgeflow.report_items WHERE report_id = $1 ORDER BY display_order",
      [row.id],
    );
    const sources = await client.query<{
      report_item_id: string;
      id: string;
      source_type: SourceReference["sourceType"];
      provider: string;
      origin_url: string;
      retrieved_at: Date;
    }>(
      "SELECT link.report_item_id, source.id, source.source_type, source.provider, source.origin_url, source.retrieved_at FROM forgeflow.report_item_sources link JOIN forgeflow.sources source ON source.id = link.source_id WHERE link.report_item_id IN (SELECT id FROM forgeflow.report_items WHERE report_id = $1)",
      [row.id],
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
          })),
        ...(item.financial_metric_id
          ? { calculationId: item.financial_metric_id }
          : {}),
      })),
    };
  });
}
