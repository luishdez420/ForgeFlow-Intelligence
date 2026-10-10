import { describe, expect, it } from "vitest";

import {
  quoteDatabaseIdentifier,
  runtimeRoleConfigFromEnvironment,
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

  it("derives a constrained runtime role from its separate connection URL", () => {
    expect(
      runtimeRoleConfigFromEnvironment({
        DATABASE_MIGRATOR_URL: "postgresql://migrator:secret@db/forgeflow",
        DATABASE_MIGRATOR_USERNAME: "forgeflow_migrator",
        DATABASE_RUNTIME_URL:
          "postgresql://forgeflow_runtime:runtime%2Fsecret@db/forgeflow",
      }),
    ).toEqual({
      migratorDatabaseUrl: "postgresql://migrator:secret@db/forgeflow",
      migratorUsername: "forgeflow_migrator",
      runtimeUsername: "forgeflow_runtime",
      runtimePassword: "runtime/secret",
    });
  });

  it("rejects a non-PostgreSQL runtime URL", () => {
    expect(() =>
      runtimeRoleConfigFromEnvironment({
        DATABASE_MIGRATOR_URL: "postgresql://migrator:secret@db/forgeflow",
        DATABASE_MIGRATOR_USERNAME: "forgeflow_migrator",
        DATABASE_RUNTIME_URL: "mysql://forgeflow_runtime:secret@db/forgeflow",
      }),
    ).toThrow("PostgreSQL protocol");
  });
});
