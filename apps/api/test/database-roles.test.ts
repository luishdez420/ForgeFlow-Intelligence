import { describe, expect, it } from "vitest";

import {
  quoteDatabaseIdentifier,
  runtimeRoleGrants,
} from "../src/database-roles.js";

describe("database runtime role contract", () => {
  it("creates only safe quoted role identifiers", () => {
    expect(quoteDatabaseIdentifier("forgeflow_runtime")).toBe(
      '"forgeflow_runtime"',
    );
    expect(() => quoteDatabaseIdentifier("admin; drop role")).toThrow(
      "lowercase identifiers",
    );
  });

  it("grants application DML without schema ownership", () => {
    const grants = runtimeRoleGrants("forgeflow_migrator", "forgeflow_runtime");
    expect(grants.join("\n")).toContain("SELECT, INSERT, UPDATE, DELETE");
    expect(grants.join("\n")).toContain("ALTER DEFAULT PRIVILEGES");
    expect(grants.join("\n")).not.toContain("GRANT CREATE");
  });
});
