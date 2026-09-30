import { Client } from "pg";

const roleNamePattern = /^[a-z][a-z0-9_]{0,62}$/;

export type RuntimeRoleConfig = {
  migratorDatabaseUrl: string;
  migratorUsername: string;
  runtimePassword: string;
  runtimeUsername: string;
};

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
  const statement = await client.query<{ statement: string }>(
    "SELECT format($1::text, $2::text, $3::text) AS statement",
    [
      `${action} ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION PASSWORD %L`,
      username,
      password,
    ],
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
    const existing = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [config.runtimeUsername],
    );
    await client.query(
      await passwordRoleStatement(
        client,
        existing.rowCount === 0 ? "CREATE" : "ALTER",
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
  const migratorDatabaseUrl = process.env.DATABASE_MIGRATOR_URL;
  const migratorUsername = process.env.DATABASE_MIGRATOR_USERNAME;
  const runtimePassword = process.env.DATABASE_RUNTIME_PASSWORD;
  const runtimeUsername =
    process.env.DATABASE_RUNTIME_USERNAME ?? "forgeflow_runtime";

  if (!migratorDatabaseUrl || !migratorUsername || !runtimePassword) {
    throw new Error(
      "DATABASE_MIGRATOR_URL, DATABASE_MIGRATOR_USERNAME, and DATABASE_RUNTIME_PASSWORD are required.",
    );
  }
  await configureRuntimeDatabaseRole({
    migratorDatabaseUrl,
    migratorUsername,
    runtimePassword,
    runtimeUsername,
  });
}

if (process.argv[1]?.endsWith("database-roles.ts")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
