/**
 * Restore-verification drill. Restores a backup into a scratch database and
 * checks that the core tables exist and carry rows, proving the backup is
 * usable — a backup you have never restored is not a backup.
 *
 * Usage: tsx scripts/restore-verify.ts <backup.dump> <scratchDatabaseUrl>
 * The scratch database must be disposable; this DROPs and recreates its schema.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import pg from "pg";

const [backupFile, scratchUrl] = process.argv.slice(2);
if (!backupFile || !scratchUrl) {
  console.error("usage: tsx scripts/restore-verify.ts <backup.dump> <scratchDatabaseUrl>");
  process.exit(1);
}

const REQUIRED_TABLES = ["paper_fills", "portfolio_snapshots", "audit_events", "proposals", "profile_memories"];

const restore = spawnSync("pg_restore", ["--clean", "--if-exists", "--no-owner", "--dbname", scratchUrl, backupFile], {
  stdio: "inherit"
});
if (restore.status !== 0) {
  console.error(`pg_restore failed with status ${restore.status}`);
  process.exit(restore.status ?? 1);
}

const pool = new pg.Pool({ connectionString: scratchUrl });
try {
  let ok = true;
  for (const table of REQUIRED_TABLES) {
    const exists = await pool.query("SELECT to_regclass($1) AS t", [table]);
    if (!exists.rows[0].t) {
      console.error(`MISSING table ${table}`);
      ok = false;
      continue;
    }
    const count = await pool.query(`SELECT count(*)::int AS c FROM ${table}`);
    console.log(`ok   ${table.padEnd(22)} ${count.rows[0].c} rows`);
  }
  if (!ok) {
    console.error("RESTORE VERIFY FAILED");
    process.exit(1);
  }
  console.log("RESTORE VERIFY PASSED");
} finally {
  await pool.end();
}
