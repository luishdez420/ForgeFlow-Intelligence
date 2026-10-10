import { Client } from "pg";

export async function verifyRuntimeDatabaseAccess(
  databaseUrl: string,
): Promise<{
  role: string;
  ticker: string;
}> {
  const client = new Client({ connectionString: databaseUrl });
  const ticker = "FFDRILL";

  await client.connect();
  try {
    await client.query("BEGIN");
    const roleResult = await client.query<{ role: string }>(
      "SELECT current_user AS role",
    );
    const writeResult = await client.query<{ ticker: string }>(
      `INSERT INTO forgeflow.companies (ticker, name)
       VALUES ($1, 'ForgeFlow runtime smoke')
       ON CONFLICT (ticker) DO UPDATE SET name = EXCLUDED.name
       RETURNING ticker`,
      [ticker],
    );
    await client.query("ROLLBACK");
    return {
      role: roleResult.rows[0]?.role ?? "",
      ticker: writeResult.rows[0]?.ticker ?? "",
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const result = await verifyRuntimeDatabaseAccess(databaseUrl);
  if (result.role !== "forgeflow_runtime" || result.ticker !== "FFDRILL") {
    throw new Error(
      "Runtime database smoke did not use the expected constrained role.",
    );
  }
  console.info(
    JSON.stringify({ event: "database.runtime_smoke.succeeded", ...result }),
  );
}

if (process.argv[1]?.endsWith("database-runtime-smoke.ts")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
