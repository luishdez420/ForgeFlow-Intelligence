import { createHash } from "node:crypto";

import { sourceTypeSchema, type SourceReference } from "@forgeflow/schemas";

import type { Queryable } from "./database.js";

export type JsonValue =
  boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

export type SourceInput = {
  companyId?: string;
  sourceType: SourceReference["sourceType"];
  provider: string;
  originUrl: string;
  retrievedAt: string;
  content: string | Buffer;
  metadata?: Record<string, JsonValue>;
};

export type DocumentInput = {
  sourceId: string;
  documentType: string;
  content: string | Buffer;
  externalIdentifier?: string;
  filingDate?: string;
  contentLocation?: string;
  metadata?: Record<string, JsonValue>;
};

export type FactInput = {
  companyId: string;
  sourceId: string;
  documentId?: string;
  fieldName: string;
  rawValue: JsonValue;
  normalizedValue?: JsonValue;
  normalizationStatus: "NORMALIZED" | "UNAVAILABLE" | "AMBIGUOUS" | "REJECTED";
  observedAt?: string;
};

function canonicalize(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key]!)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashContent(content: string | Buffer | JsonValue): string {
  const serialized =
    typeof content === "string" || Buffer.isBuffer(content)
      ? content
      : canonicalize(content);
  return createHash("sha256").update(serialized).digest("hex");
}

export function validateOriginUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Source URLs must use HTTPS.");
  if (url.username || url.password)
    throw new Error("Source URLs must not include credentials.");
  if (!url.hostname) throw new Error("Source URLs must include a hostname.");
  return url.toString();
}

type SourceRow = {
  id: string;
  source_type: SourceReference["sourceType"];
  provider: string;
  origin_url: string;
  retrieved_at: Date;
};

export async function recordSource(
  queryable: Queryable,
  input: SourceInput,
): Promise<SourceReference> {
  const provider = input.provider.trim();
  if (!provider || provider.length > 100)
    throw new Error("Source provider must contain 1 to 100 characters.");
  const originUrl = validateOriginUrl(input.originUrl);
  const retrievedAt = new Date(input.retrievedAt);
  if (Number.isNaN(retrievedAt.valueOf()))
    throw new Error("Source retrieval time must be an ISO timestamp.");
  const contentHash = hashContent(input.content);
  const inserted = await queryable.query<SourceRow>(
    `INSERT INTO forgeflow.sources (company_id, source_type, provider, origin_url, retrieved_at, content_hash, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (provider, origin_url, content_hash) DO NOTHING
     RETURNING id, source_type, provider, origin_url, retrieved_at`,
    [
      input.companyId ?? null,
      sourceTypeSchema.parse(input.sourceType),
      provider,
      originUrl,
      retrievedAt,
      contentHash,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  const row =
    inserted.rows[0] ??
    (
      await queryable.query<SourceRow>(
        "SELECT id, source_type, provider, origin_url, retrieved_at FROM forgeflow.sources WHERE provider = $1 AND origin_url = $2 AND content_hash = $3",
        [provider, originUrl, contentHash],
      )
    ).rows[0];
  if (!row)
    throw new Error("Source persistence did not return a source record.");
  return {
    sourceId: row.id,
    sourceType: row.source_type,
    provider: row.provider,
    url: row.origin_url,
    retrievedAt: row.retrieved_at.toISOString(),
  };
}

export async function recordDocument(
  queryable: Queryable,
  input: DocumentInput,
): Promise<string> {
  const contentHash = hashContent(input.content);
  const inserted = await queryable.query<{ id: string }>(
    `INSERT INTO forgeflow.documents (source_id, document_type, external_identifier, filing_date, content_location, content_hash, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT (source_id, content_hash) DO NOTHING RETURNING id`,
    [
      input.sourceId,
      input.documentType,
      input.externalIdentifier ?? null,
      input.filingDate ?? null,
      input.contentLocation ?? null,
      contentHash,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  const row =
    inserted.rows[0] ??
    (
      await queryable.query<{ id: string }>(
        "SELECT id FROM forgeflow.documents WHERE source_id = $1 AND content_hash = $2",
        [input.sourceId, contentHash],
      )
    ).rows[0];
  if (!row)
    throw new Error("Document persistence did not return a document record.");
  return row.id;
}

export async function recordFact(
  queryable: Queryable,
  input: FactInput,
): Promise<string> {
  const result = await queryable.query<{ id: string }>(
    `INSERT INTO forgeflow.facts (company_id, source_id, document_id, field_name, raw_value, normalized_value, normalization_status, observed_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8) RETURNING id`,
    [
      input.companyId,
      input.sourceId,
      input.documentId ?? null,
      input.fieldName,
      JSON.stringify(input.rawValue),
      input.normalizedValue === undefined
        ? null
        : JSON.stringify(input.normalizedValue),
      input.normalizationStatus,
      input.observedAt ?? null,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Fact persistence did not return a fact record.");
  return id;
}

export async function linkReportItemSources(
  queryable: Queryable,
  reportItemId: string,
  sourceIds: readonly string[],
): Promise<void> {
  for (const sourceId of new Set(sourceIds)) {
    await queryable.query(
      "INSERT INTO forgeflow.report_item_sources (report_item_id, source_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [reportItemId, sourceId],
    );
  }
}
