import { readFileSync } from "node:fs";
import pg from "pg";

export function createDatabase(config) {
  const parsed = new URL(config.databaseUrl);
  // TLS is configured explicitly. URI sslmode must not silently override it.
  for (const name of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) parsed.searchParams.delete(name);
  const pool = new pg.Pool({
    connectionString: parsed.href,
    ssl: config.databaseTls ? {
      rejectUnauthorized: true,
      ...(config.databaseCaFile ? { ca: readFileSync(config.databaseCaFile, "utf8") } : {}),
    } : false,
    max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
  });
  return {
    query: (text, values = []) => pool.query(text, values),
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work({ query: (text, values = []) => client.query(text, values) });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },
    end: () => pool.end(),
  };
}
