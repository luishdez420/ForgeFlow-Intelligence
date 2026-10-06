import { createHash } from "node:crypto";

import { withTransaction } from "./database.js";
import {
  parseGroundedAiOutput,
  SourceGroundingError,
} from "./report-generation.js";

const responsesUrl = "https://api.openai.com/v1/responses";
const maxSources = 8;
const maxExcerptCharacters = 500;
const maxTotalContextCharacters = 3_000;

export type GroundingSource = {
  sourceId: string;
  provider: string;
  url: string;
  retrievedAt: string;
  excerpt: string;
};

export type OpenAiUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

export type OpenAiResponsesClient = {
  create(
    request: unknown,
  ): Promise<{ outputText?: string; refusal?: string; usage?: OpenAiUsage }>;
};

export class OpenAiAnalysisError extends Error {
  constructor(
    readonly code:
      | "OPENAI_DISABLED"
      | "OPENAI_REFUSAL"
      | "OPENAI_MALFORMED_OUTPUT"
      | "OPENAI_PROVIDER_FAILURE",
    message: string,
  ) {
    super(message);
  }
}

export function createOpenAiResponsesClient(
  apiKey = process.env.OPENAI_API_KEY,
): OpenAiResponsesClient {
  if (!apiKey) {
    throw new OpenAiAnalysisError(
      "OPENAI_DISABLED",
      "OpenAI analysis is not configured for this environment.",
    );
  }
  return {
    async create(request) {
      let response: Response;
      try {
        response = await fetch(responsesUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new OpenAiAnalysisError(
          "OPENAI_PROVIDER_FAILURE",
          "OpenAI did not respond before the configured timeout.",
        );
      }
      if (!response.ok) {
        throw new OpenAiAnalysisError(
          "OPENAI_PROVIDER_FAILURE",
          `OpenAI returned HTTP ${response.status}.`,
        );
      }
      const payload = (await response.json()) as {
        output_text?: unknown;
        output?: Array<{
          content?: Array<{ type?: string; text?: string; refusal?: string }>;
        }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const content =
        payload.output?.flatMap((item) => item.content ?? []) ?? [];
      const refusal = content.find((item) => item.type === "refusal")?.refusal;
      const outputText =
        typeof payload.output_text === "string"
          ? payload.output_text
          : content.find((item) => item.type === "output_text")?.text;
      return {
        outputText,
        refusal,
        usage: {
          inputTokens: payload.usage?.input_tokens,
          outputTokens: payload.usage?.output_tokens,
        },
      };
    },
  };
}

function boundedSources(
  sources: readonly GroundingSource[],
): GroundingSource[] {
  if (sources.length === 0 || sources.length > maxSources) {
    throw new OpenAiAnalysisError(
      "OPENAI_MALFORMED_OUTPUT",
      "Analysis requires between one and eight approved source excerpts.",
    );
  }
  let remaining = maxTotalContextCharacters;
  return sources.map((source) => {
    if (!source.sourceId || !source.url.startsWith("https://")) {
      throw new OpenAiAnalysisError(
        "OPENAI_MALFORMED_OUTPUT",
        "Every model source must have an approved HTTPS provenance reference.",
      );
    }
    const excerpt = source.excerpt.slice(
      0,
      Math.min(maxExcerptCharacters, remaining),
    );
    remaining -= excerpt.length;
    return { ...source, excerpt };
  });
}

export function buildConstrainedAnalysisRequest(
  model: string,
  sources: readonly GroundingSource[],
): {
  model: string;
  store: false;
  input: unknown[];
  text: unknown;
  max_output_tokens: number;
} {
  const bounded = boundedSources(sources);
  return {
    model,
    store: false,
    input: [
      {
        role: "system",
        content:
          "You write concise analyst explanations. Use only supplied source excerpts. Do not create facts, metrics, or citations. Return JSON matching the supplied schema.",
      },
      {
        role: "user",
        content: JSON.stringify({ approved_sources: bounded }),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "source_grounded_analysis",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["items"],
          properties: {
            items: {
              type: "array",
              maxItems: 8,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["section", "title", "content", "sourceIds"],
                properties: {
                  section: { type: "string" },
                  title: { type: "string" },
                  content: { type: "string" },
                  sourceIds: {
                    type: "array",
                    items: { type: "string" },
                    minItems: 1,
                  },
                },
              },
            },
          },
        },
      },
    },
    max_output_tokens: 1_200,
  };
}

export async function generateConstrainedAnalysis(
  client: OpenAiResponsesClient,
  model: string,
  sources: readonly GroundingSource[],
): Promise<{ output: string; usage: OpenAiUsage }> {
  let response:
    Awaited<ReturnType<OpenAiResponsesClient["create"]>> | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await client.create(
        buildConstrainedAnalysisRequest(model, sources),
      );
      break;
    } catch (error) {
      if (
        attempt === 1 ||
        !(error instanceof OpenAiAnalysisError) ||
        error.code !== "OPENAI_PROVIDER_FAILURE"
      ) {
        throw error;
      }
    }
  }
  if (!response) {
    throw new OpenAiAnalysisError(
      "OPENAI_PROVIDER_FAILURE",
      "OpenAI did not return a response.",
    );
  }
  if (response.refusal) {
    throw new OpenAiAnalysisError(
      "OPENAI_REFUSAL",
      "OpenAI refused the requested analysis.",
    );
  }
  if (!response.outputText) {
    throw new OpenAiAnalysisError(
      "OPENAI_MALFORMED_OUTPUT",
      "OpenAI returned no structured analysis.",
    );
  }
  try {
    parseGroundedAiOutput(
      response.outputText,
      sources.map((source) => source.sourceId),
    );
  } catch (error) {
    const message =
      error instanceof SourceGroundingError
        ? error.message
        : "OpenAI returned invalid structured analysis.";
    throw new OpenAiAnalysisError("OPENAI_MALFORMED_OUTPUT", message);
  }
  return { output: response.outputText, usage: response.usage ?? {} };
}

function estimatedCost(usage: OpenAiUsage): number | null {
  const inputRate = Number.parseFloat(
    process.env.OPENAI_INPUT_TOKEN_USD_PER_MILLION ?? "",
  );
  const outputRate = Number.parseFloat(
    process.env.OPENAI_OUTPUT_TOKEN_USD_PER_MILLION ?? "",
  );
  if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate)) return null;
  return (
    ((usage.inputTokens ?? 0) * inputRate +
      (usage.outputTokens ?? 0) * outputRate) /
    1_000_000
  );
}

export async function persistConstrainedAnalysisRun(input: {
  workflowTaskId: string;
  model: string;
  sources: readonly GroundingSource[];
  client: OpenAiResponsesClient;
}): Promise<string> {
  const allowedSourceIds = input.sources.map((source) => source.sourceId);
  return withTransaction(async (client) => {
    const run = await client.query<{ id: string }>(
      `INSERT INTO forgeflow.agent_runs (workflow_task_id, purpose, model, state, allowed_source_ids)
       VALUES ($1, 'SOURCE_GROUNDED_EXPLANATION', $2, 'RUNNING', $3::jsonb)
       RETURNING id`,
      [input.workflowTaskId, input.model, JSON.stringify(allowedSourceIds)],
    );
    const runId = run.rows[0]?.id;
    if (!runId) throw new Error("Agent run was not persisted.");
    try {
      const result = await generateConstrainedAnalysis(
        input.client,
        input.model,
        input.sources,
      );
      await client.query(
        `UPDATE forgeflow.agent_runs
         SET state = 'SUCCEEDED', structured_output = $2::jsonb, input_token_count = $3,
             output_token_count = $4, estimated_cost = $5, completed_at = now()
         WHERE id = $1`,
        [
          runId,
          JSON.stringify({
            output: JSON.parse(result.output),
            prompt_fingerprint: promptFingerprint(input.sources),
          }),
          result.usage.inputTokens ?? null,
          result.usage.outputTokens ?? null,
          estimatedCost(result.usage),
        ],
      );
    } catch (error) {
      await client.query(
        `UPDATE forgeflow.agent_runs
         SET state = 'FAILED', structured_output = $2::jsonb, completed_at = now()
         WHERE id = $1`,
        [
          runId,
          JSON.stringify({
            error_code:
              error instanceof OpenAiAnalysisError
                ? error.code
                : "OPENAI_PROVIDER_FAILURE",
          }),
        ],
      );
      throw error;
    }
    return runId;
  });
}

export function promptFingerprint(sources: readonly GroundingSource[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        sources.map(({ sourceId, provider, url, retrievedAt }) => ({
          sourceId,
          provider,
          url,
          retrievedAt,
        })),
      ),
    )
    .digest("hex");
}
