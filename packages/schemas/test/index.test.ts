import { describe, expect, it } from "vitest";

import {
  createCompanyAnalysisWorkflowRequestSchema,
  invitationStatusSchema,
  pilotRoleSchema,
  reportItemSchema,
  SCHEMA_PACKAGE_VERSION,
  tickerSchema,
} from "../src/index.js";

describe("schema package", () => {
  it("exposes its initial contract version", () => {
    expect(SCHEMA_PACKAGE_VERSION).toBe("0.1.0");
  });

  it("defines invite-only pilot roles and invitation states", () => {
    expect(pilotRoleSchema.parse("ADMIN")).toBe("ADMIN");
    expect(invitationStatusSchema.parse("PENDING")).toBe("PENDING");
    expect(() => pilotRoleSchema.parse("OWNER")).toThrow();
  });

  it("normalizes a valid ticker and rejects malformed symbols", () => {
    expect(tickerSchema.parse(" msft ")).toBe("MSFT");
    expect(tickerSchema.safeParse("MSFT;DROP TABLE").success).toBe(false);
  });

  it("accepts an optional opaque idempotency key", () => {
    expect(
      createCompanyAnalysisWorkflowRequestSchema.parse({
        ticker: "msft",
        idempotencyKey: "request-42",
      }),
    ).toEqual({ ticker: "MSFT", idempotencyKey: "request-42" });
  });

  it("requires provenance for fact report items", () => {
    const item = {
      id: "2e57f3b1-1e3d-44c5-9fab-f3482f8c969c",
      kind: "FACT",
      section: "Company Overview",
      title: "Headquarters",
      content: "Redmond, Washington",
      sources: [],
    };

    expect(reportItemSchema.safeParse(item).success).toBe(false);
    expect(
      reportItemSchema.parse({
        ...item,
        sources: [
          {
            sourceId: "5aa7ef93-d5f8-4b03-93c5-813bb6e1c356",
            sourceType: "SEC_FILING",
            provider: "sec-edgar",
            url: "https://www.sec.gov/Archives/example",
            retrievedAt: "2026-09-26T17:00:00Z",
          },
        ],
      }).kind,
    ).toBe("FACT");
  });
});
