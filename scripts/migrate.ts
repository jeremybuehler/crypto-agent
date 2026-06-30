import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../packages/persistence/migrations");

const pool = new pg.Pool({ connectionString: url });
try {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     );`
  );
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  const applied = await pool.query("SELECT version FROM schema_migrations");
  const done = new Set(applied.rows.map((row) => row.version as string));

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (done.has(version)) {
      console.log(`skip   ${version} (already applied)`);
      continue;
    }
    const sql = await readFile(resolve(migrationsDir, file), "utf8");
    await pool.query(sql);
    await pool.query("INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING", [version]);
    console.log(`apply  ${version}`);
  }
  console.log("Migrations applied successfully.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
