import "dotenv/config";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sqlPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../packages/persistence/migrations/001_trading_audit.sql"
);

const pool = new pg.Pool({ connectionString: url });
try {
  const sql = await readFile(sqlPath, "utf8");
  await pool.query(sql);
  console.log("Migration applied successfully.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
