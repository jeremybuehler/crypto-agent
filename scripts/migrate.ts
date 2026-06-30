import "dotenv/config";
import pg from "pg";
import { createPgExecutor, runMigrations } from "@agent/persistence";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url });
try {
  await runMigrations(createPgExecutor(pool));
  console.log("Migrations applied successfully.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
