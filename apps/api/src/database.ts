import { Pool, type PoolClient, type QueryResultRow } from "pg";

const localDatabaseUrl =
  "postgresql://forgeflow:forgeflow@localhost:15432/forgeflow";

export const databaseUrl = process.env.DATABASE_URL ?? localDatabaseUrl;
export const pool = new Pool({ connectionString: databaseUrl });

export async function withTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type Queryable = {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
};
