import { describe, expect, it } from "vitest";

import { correlationId, redactTelemetry } from "../src/observability.js";

describe("operational telemetry", () => {
  it("keeps valid correlation ids and generates invalid ones", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(correlationId(id)).toBe(id);
    expect(correlationId("not-an-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("redacts secrets recursively", () => {
    expect(
      redactTelemetry({ apiKey: "nope", nested: { token: "nope", value: 1 } }),
    ).toEqual({
      apiKey: "[REDACTED]",
      nested: { token: "[REDACTED]", value: 1 },
    });
  });
});
