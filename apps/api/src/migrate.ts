import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { pool } from "./database.js";

const migrationDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

async function migrate(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("CREATE SCHEMA IF NOT EXISTS forgeflow");
    await client.query(`CREATE TABLE IF NOT EXISTS forgeflow.schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

    const files = (await readdir(migrationDirectory))
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .sort();
    const appliedResult = await client.query<{ filename: string }>(
      "SELECT filename FROM forgeflow.schema_migrations",
    );
    const applied = new Set(appliedResult.rows.map((row) => row.filename));

    for (const filename of files) {
      if (applied.has(filename)) {
        continue;
      }

      const sql = await readFile(join(migrationDirectory, filename), "utf8");
      await client.query(sql);
      await client.query(
        "INSERT INTO forgeflow.schema_migrations (filename) VALUES ($1)",
        [filename],
      );
      console.info(`Applied ${filename}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
