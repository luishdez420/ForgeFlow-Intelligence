import { describe, expect, it } from "vitest";

import { isAllowedWorkspaceIdentity } from "../auth-policy";

describe("Google Workspace access policy", () => {
  it("allows a verified identity from the configured domain", () => {
    expect(
      isAllowedWorkspaceIdentity(
        "analyst@forgeflow.example",
        true,
        "forgeflow.example",
      ),
    ).toBe(true);
  });

  it("rejects unverified, missing, and external identities", () => {
    expect(
      isAllowedWorkspaceIdentity(
        "analyst@forgeflow.example",
        false,
        "forgeflow.example",
      ),
    ).toBe(false);
    expect(
      isAllowedWorkspaceIdentity(undefined, true, "forgeflow.example"),
    ).toBe(false);
    expect(
      isAllowedWorkspaceIdentity(
        "outside@example.com",
        true,
        "forgeflow.example",
      ),
    ).toBe(false);
  });

  it("allows one explicit verified test identity only during local development", () => {
    expect(
      isAllowedWorkspaceIdentity(
        "lahr730@gmail.com",
        true,
        undefined,
        "lahr730@gmail.com",
        true,
      ),
    ).toBe(true);
    expect(
      isAllowedWorkspaceIdentity(
        "other@gmail.com",
        true,
        undefined,
        "lahr730@gmail.com",
        true,
      ),
    ).toBe(false);
    expect(
      isAllowedWorkspaceIdentity(
        "lahr730@gmail.com",
        true,
        undefined,
        "lahr730@gmail.com",
        false,
      ),
    ).toBe(false);
  });
});
