import { describe, expect, it } from "vitest";

import {
  internalRequestPayload,
  signInternalRequest,
  verifyInternalSignature,
} from "../src/internal-auth.js";

describe("internal API request signatures", () => {
  it("binds signatures to the actor, route, method, timestamp, and body", () => {
    const secret = "test-internal-secret";
    const payload = internalRequestPayload(
      "2026-10-01T12:00:00.000Z",
      "POST",
      "/workflows/company-analysis",
      "analyst@example.com",
      '{"ticker":"MSFT"}',
    );
    const signature = signInternalRequest(secret, payload);
    expect(verifyInternalSignature(secret, payload, signature)).toBe(true);
    expect(
      verifyInternalSignature(
        secret,
        payload.replace("MSFT", "AAPL"),
        signature,
      ),
    ).toBe(false);
  });
});
