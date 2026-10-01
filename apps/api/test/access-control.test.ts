import { describe, expect, it } from "vitest";

import {
  AccessDeniedError,
  hashInvitationToken,
  normalizeEmail,
  redactAuditMetadata,
  requireRole,
  requireWorkflowAccess,
} from "../src/access-control.js";

describe("pilot access-control boundary", () => {
  const analyst = { id: "analyst-id", roles: ["ANALYST"] as const };
  const administrator = { id: "admin-id", roles: ["ADMIN"] as const };

  it("enforces the analyst/admin role matrix", () => {
    expect(() => requireRole(analyst, "ANALYST")).not.toThrow();
    expect(() => requireRole(administrator, "ANALYST")).not.toThrow();
    expect(() => requireRole(analyst, "ADMIN")).toThrow(AccessDeniedError);
  });

  it("allows only an owner or administrator to read an analysis", () => {
    expect(() => requireWorkflowAccess(analyst, "analyst-id")).not.toThrow();
    expect(() =>
      requireWorkflowAccess(administrator, "analyst-id"),
    ).not.toThrow();
    expect(() => requireWorkflowAccess(analyst, "another-analyst")).toThrow(
      "belongs to another analyst",
    );
  });

  it("normalizes email and stores only a one-way invitation token identity", () => {
    expect(normalizeEmail(" Analyst@Example.com ")).toBe("analyst@example.com");
    expect(hashInvitationToken("plain-invite-token")).toHaveLength(64);
    expect(hashInvitationToken("plain-invite-token")).not.toBe(
      "plain-invite-token",
    );
  });

  it("redacts secrets recursively before audit persistence", () => {
    expect(
      redactAuditMetadata({
        allowed: "present",
        authorization: "Bearer confidential",
        nested: { apiKey: "secret", retained: true },
        entries: [{ password: "hidden" }],
      }),
    ).toEqual({
      allowed: "present",
      authorization: "[REDACTED]",
      nested: { apiKey: "[REDACTED]", retained: true },
      entries: [{ password: "[REDACTED]" }],
    });
  });
});
