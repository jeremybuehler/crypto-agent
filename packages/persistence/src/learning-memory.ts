/**
 * Inspectable user memory. Every learned item carries provenance (source +
 * observedAt + version), confidence, scope (explicit operator facts vs derived
 * inferences), retention, and a status. Operators can view, correct, reject,
 * and delete; corrections use optimistic concurrency on the version.
 *
 * Secrets are never stored: keys or values that look like credentials are
 * rejected before they reach the database (CLAUDE.md rule 11).
 */

export type MemoryScope = "explicit" | "derived";
export type MemoryStatus = "active" | "pending" | "rejected" | "deleted";

export interface LearnedMemory {
  id: string;
  key: string;
  value: string;
  scope: MemoryScope;
  confidence: number;
  source: string;
  observedAt: Date;
  version: number;
  retentionUntil: Date | null;
  status: MemoryStatus;
}

export interface UpsertMemoryInput {
  key: string;
  value: string;
  scope: MemoryScope;
  confidence: number;
  source: string;
  observedAt: Date;
  status: MemoryStatus;
  retentionUntil?: Date | null;
  actor: "operator" | "worker" | "system";
}

export interface CorrectMemoryInput {
  id: string;
  value: string;
  expectedVersion: number;
  actor: "operator" | "worker" | "system";
}

export type CorrectReason = "not_found" | "version_conflict";
export type CorrectResult = { ok: true; version: number } | { ok: false; reason: CorrectReason };

export class SecretRejectedError extends Error {
  constructor(message = "Refusing to store a value that looks like a secret.") {
    super(message);
    this.name = "SecretRejectedError";
  }
}

const SECRET_KEY = /(secret|token|api[_-]?key|private[_-]?key|password|passphrase|seed|mnemonic)/i;
const SECRET_VALUE = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private keys
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWTs
  /\bsk-[A-Za-z0-9]{16,}\b/, // common API secret prefix
  /\b[a-f0-9]{40,}\b/i // long hex blobs (keys/hashes)
];

/** Throw if a key or value looks like a credential. */
export function assertNoSecret(key: string, value: string): void {
  if (SECRET_KEY.test(key)) throw new SecretRejectedError(`Refusing to store secret-like key "${key}".`);
  if (SECRET_VALUE.some((re) => re.test(value))) throw new SecretRejectedError();
}
