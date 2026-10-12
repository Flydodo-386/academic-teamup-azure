import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { loadConfig } from "./config.mjs";
import { createDatabase } from "./database.mjs";

export async function migrate(db) {
  const directory = new URL("../migrations/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(74631824)");
    await tx.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    for (const name of files) {
      const sql = await readFile(new URL(name, directory), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const previous = await tx.query("SELECT checksum FROM schema_migrations WHERE name = $1", [name]);
      if (previous.rows.length) {
        if (previous.rows[0].checksum !== checksum) throw new Error(`Applied migration was changed: ${name}. Add a new migration instead.`);
        continue;
      }
      await tx.query(sql);
      await tx.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [name, checksum]);
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = createDatabase(loadConfig());
  try { await migrate(db); console.log("PostgreSQL migrations applied."); }
  finally { await db.end(); }
}
