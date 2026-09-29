import { describe, expect, it } from "vitest";

import {
  parseGroundedAiOutput,
  SourceGroundingError,
} from "../src/report-generation.js";

const sourceId = "11111111-1111-4111-8111-111111111111";

describe("source-grounded AI output", () => {
  it("accepts structured analysis with only allowed citations", () => {
    expect(
      parseGroundedAiOutput(
        JSON.stringify({
          items: [
            {
              section: "Outlook",
              title: "Trend",
              content: "Revenue increased.",
              sourceIds: [sourceId],
            },
          ],
        }),
        [sourceId],
      ),
    ).toHaveLength(1);
  });

  it("rejects malformed JSON and unsupported citations", () => {
    expect(() => parseGroundedAiOutput("not json", [sourceId])).toThrow(
      SourceGroundingError,
    );
    expect(() =>
      parseGroundedAiOutput(
        JSON.stringify({
          items: [
            {
              section: "Outlook",
              title: "Trend",
              content: "Unsupported.",
              sourceIds: ["22222222-2222-4222-8222-222222222222"],
            },
          ],
        }),
        [sourceId],
      ),
    ).toThrow("outside");
  });
});
