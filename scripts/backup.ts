/**
 * Encrypted logical backup of the Postgres database. Runs pg_dump (custom
 * format) and pipes it through age/gpg if a recipient/passphrase is configured.
 * Prints a sha256 checksum of the artifact so restore-verify can confirm
 * integrity. Secrets are read from the environment and never logged.
 *
 * Usage: tsx scripts/backup.ts [outDir]
 *   DATABASE_URL          required
 *   BACKUP_AGE_RECIPIENT  optional — if set, encrypts with `age`
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const outDir = resolve(process.argv[2] ?? "backups");
await mkdir(outDir, { recursive: true });
// Timestamp is passed in via env so the script stays deterministic for tests.
const stamp = process.env.BACKUP_STAMP ?? new Date().toISOString().replace(/[:.]/g, "-");
const recipient = process.env.BACKUP_AGE_RECIPIENT;
const outFile = resolve(outDir, `crypto-agent-${stamp}.dump${recipient ? ".age" : ""}`);

const dump = spawn("pg_dump", ["--format=custom", "--no-owner", databaseUrl], { stdio: ["ignore", "pipe", "inherit"] });

const hash = createHash("sha256");
const sink = createWriteStream(outFile);

let pipeline = dump.stdout;
if (recipient) {
  const enc = spawn("age", ["-r", recipient], { stdio: ["pipe", "pipe", "inherit"] });
  dump.stdout.pipe(enc.stdin);
  pipeline = enc.stdout;
}

pipeline.on("data", (chunk) => hash.update(chunk));
pipeline.pipe(sink);

sink.on("finish", () => {
  console.log(`backup written: ${outFile}`);
  console.log(`sha256: ${hash.digest("hex")}`);
});

dump.on("exit", (code) => {
  if (code !== 0) {
    console.error(`pg_dump exited ${code}`);
    process.exit(code ?? 1);
  }
});
