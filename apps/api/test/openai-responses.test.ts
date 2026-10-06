import { describe, expect, it } from "vitest";

import {
  buildConstrainedAnalysisRequest,
  generateConstrainedAnalysis,
  OpenAiAnalysisError,
  type GroundingSource,
} from "../src/openai-responses.js";

const sources: GroundingSource[] = [
  {
    sourceId: "11111111-1111-4111-8111-111111111111",
    provider: "SEC EDGAR",
    url: "https://www.sec.gov/Archives/example",
    retrievedAt: "2026-10-06T00:00:00.000Z",
    excerpt: "Revenue rose in the reported period.",
  },
];
const validOutput = JSON.stringify({
  items: [
    {
      section: "Outlook",
      title: "Filing context",
      content: "The filing reports revenue context.",
      sourceIds: [sources[0]!.sourceId],
    },
  ],
});

describe("constrained OpenAI Responses analysis", () => {
  it("sends only bounded allow-listed sources with strict schema output", () => {
    const request = buildConstrainedAnalysisRequest("gpt-6-astra", sources);
    expect(request.store).toBe(false);
    expect(JSON.stringify(request)).toContain("json_schema");
    expect(JSON.stringify(request)).toContain(sources[0]!.sourceId);
    expect(JSON.stringify(request)).not.toContain("OPENAI_API_KEY");
  });

  it("rejects a refusal, malformed output, and unsupported citations", async () => {
    await expect(
      generateConstrainedAnalysis(
        { create: async () => ({ refusal: "Cannot comply." }) },
        "gpt-6-astra",
        sources,
      ),
    ).rejects.toMatchObject({ code: "OPENAI_REFUSAL" });
    await expect(
      generateConstrainedAnalysis(
        { create: async () => ({ outputText: "not json" }) },
        "gpt-6-astra",
        sources,
      ),
    ).rejects.toMatchObject({ code: "OPENAI_MALFORMED_OUTPUT" });
    await expect(
      generateConstrainedAnalysis(
        {
          create: async () => ({
            outputText: validOutput.replace(
              sources[0]!.sourceId,
              "22222222-2222-4222-8222-222222222222",
            ),
          }),
        },
        "gpt-6-astra",
        sources,
      ),
    ).rejects.toBeInstanceOf(OpenAiAnalysisError);
  });

  it("retries a transient provider failure once", async () => {
    let calls = 0;
    const client = {
      create: async () => {
        calls += 1;
        if (calls === 1) {
          throw new OpenAiAnalysisError(
            "OPENAI_PROVIDER_FAILURE",
            "Timed out.",
          );
        }
        return { outputText: validOutput };
      },
    };
    await expect(
      generateConstrainedAnalysis(client, "gpt-6-astra", sources),
    ).resolves.toMatchObject({ output: validOutput });
    expect(calls).toBe(2);
  });

  it("returns validated structured output and usage telemetry", async () => {
    await expect(
      generateConstrainedAnalysis(
        {
          create: async () => ({
            outputText: validOutput,
            usage: { inputTokens: 12, outputTokens: 8 },
          }),
        },
        "gpt-6-astra",
        sources,
      ),
    ).resolves.toEqual({
      output: validOutput,
      usage: { inputTokens: 12, outputTokens: 8 },
    });
  });
});
