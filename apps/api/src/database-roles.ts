import { Client } from "pg";

const roleNamePattern = /^[a-z][a-z0-9_]{0,62}$/;

export type RuntimeRoleConfig = {
  migratorDatabaseUrl: string;
  migratorUsername: string;
  runtimePassword: string;
  runtimeUsername: string;
};

export function runtimeRoleConfigFromEnvironment(
  environment: NodeJS.ProcessEnv,
): RuntimeRoleConfig {
  const migratorDatabaseUrl = environment.DATABASE_MIGRATOR_URL;
  const migratorUsername = environment.DATABASE_MIGRATOR_USERNAME;
  const runtimePassword = environment.DATABASE_RUNTIME_PASSWORD;
  const runtimeUsername = environment.DATABASE_RUNTIME_USERNAME;
  const runtimeDatabaseUrl = environment.DATABASE_RUNTIME_URL;

  if (runtimeDatabaseUrl) {
    let parsed: URL;
    try {
      parsed = new URL(runtimeDatabaseUrl);
    } catch {
      throw new Error("DATABASE_RUNTIME_URL must be a valid PostgreSQL URL.");
    }
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      throw new Error("DATABASE_RUNTIME_URL must use the PostgreSQL protocol.");
    }
    if (!parsed.username || !parsed.password) {
      throw new Error(
        "DATABASE_RUNTIME_URL must include the runtime username and password.",
      );
    }
    if (
      runtimeUsername &&
      runtimeUsername !== decodeURIComponent(parsed.username)
    ) {
      throw new Error(
        "DATABASE_RUNTIME_USERNAME must match the username in DATABASE_RUNTIME_URL.",
      );
    }
    if (!migratorDatabaseUrl || !migratorUsername) {
      throw new Error(
        "DATABASE_MIGRATOR_URL and DATABASE_MIGRATOR_USERNAME are required.",
      );
    }
    return {
      migratorDatabaseUrl,
      migratorUsername,
      runtimePassword: decodeURIComponent(parsed.password),
      runtimeUsername: decodeURIComponent(parsed.username),
    };
  }

  if (!migratorDatabaseUrl || !migratorUsername || !runtimePassword) {
    throw new Error(
      "DATABASE_MIGRATOR_URL, DATABASE_MIGRATOR_USERNAME, and DATABASE_RUNTIME_PASSWORD are required.",
    );
  }
  return {
    migratorDatabaseUrl,
    migratorUsername,
    runtimePassword,
    runtimeUsername: runtimeUsername ?? "forgeflow_runtime",
  };
}

export function quoteDatabaseIdentifier(value: string): string {
  if (!roleNamePattern.test(value)) {
    throw new Error("Database role names must be lowercase identifiers.");
  }
  return `"${value}"`;
}

export function runtimeRoleGrants(
  migratorUsername: string,
  runtimeUsername: string,
): string[] {
  const migrator = quoteDatabaseIdentifier(migratorUsername);
  const runtime = quoteDatabaseIdentifier(runtimeUsername);

  return [
    "REVOKE CREATE ON SCHEMA forgeflow FROM PUBLIC",
    `GRANT USAGE ON SCHEMA forgeflow TO ${runtime}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA forgeflow TO ${runtime}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA forgeflow TO ${runtime}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} IN SCHEMA forgeflow GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${runtime}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} IN SCHEMA forgeflow GRANT USAGE, SELECT ON SEQUENCES TO ${runtime}`,
  ];
}

async function passwordRoleStatement(
  client: Client,
  action: "CREATE" | "ALTER",
  username: string,
  password: string,
): Promise<string> {
  const roleAttributes =
    action === "CREATE"
      ? "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION"
      : "LOGIN NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION";
  const statement = await client.query<{ statement: string }>(
    "SELECT format($1::text, $2::text, $3::text) AS statement",
    [`${action} ROLE %I ${roleAttributes} PASSWORD %L`, username, password],
  );
  return statement.rows[0]?.statement ?? "";
}

export async function configureRuntimeDatabaseRole(
  config: RuntimeRoleConfig,
): Promise<void> {
  const client = new Client({ connectionString: config.migratorDatabaseUrl });
  const runtime = quoteDatabaseIdentifier(config.runtimeUsername);

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DO $$ BEGIN
      CREATE ROLE forgeflow_runtime_access NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$`);
    const existing = await client.query<{
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolreplication: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
       FROM pg_roles WHERE rolname = $1`,
      [config.runtimeUsername],
    );
    const existingRole = existing.rows[0];
    if (
      existingRole &&
      (existingRole.rolsuper ||
        existingRole.rolcreatedb ||
        existingRole.rolcreaterole ||
        existingRole.rolreplication ||
        existingRole.rolbypassrls)
    ) {
      throw new Error(
        "The existing runtime database role has elevated PostgreSQL privileges.",
      );
    }
    await client.query(
      await passwordRoleStatement(
        client,
        existingRole ? "ALTER" : "CREATE",
        config.runtimeUsername,
        config.runtimePassword,
      ),
    );
    await client.query(`GRANT forgeflow_runtime_access TO ${runtime}`);
    for (const statement of runtimeRoleGrants(
      config.migratorUsername,
      "forgeflow_runtime_access",
    )) {
      await client.query(statement);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  await configureRuntimeDatabaseRole(
    runtimeRoleConfigFromEnvironment(process.env),
  );
}

if (process.argv[1]?.endsWith("database-roles.ts")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
