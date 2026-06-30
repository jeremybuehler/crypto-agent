/**
 * Operational alerting. Alerts are deduplicated by a caller-supplied id so a
 * repeated condition (kill switch still engaged, drift still over threshold)
 * pages once, not every loop. Delivery is best-effort across sinks: a failing
 * sink is logged but never blocks the others, so one broken webhook can't
 * silence stdout.
 *
 * Sinks deliberately take injectable fetch/sleep/writer so retry and backoff
 * are deterministic under test.
 */

export type AlertSeverity = "info" | "warning" | "critical";

export interface Alert {
  /** Idempotency key — dedupes repeated deliveries of the same condition. */
  id: string;
  /** kill_switch | daily_loss_halt | reconciliation_drift | live_order | ... */
  kind: string;
  severity: AlertSeverity;
  summary: string;
  at: Date;
  metadata?: Record<string, unknown>;
}

export interface AlertSink {
  deliver(alert: Alert): Promise<void>;
}

/** Writes a single JSON line per alert (default: process stdout). */
export class StdoutAlertSink implements AlertSink {
  constructor(private readonly write: (line: string) => void = (line) => process.stdout.write(line + "\n")) {}

  async deliver(alert: Alert): Promise<void> {
    this.write(
      JSON.stringify({
        type: "alert",
        id: alert.id,
        kind: alert.kind,
        severity: alert.severity,
        summary: alert.summary,
        at: alert.at.toISOString(),
        ...(alert.metadata ? { metadata: alert.metadata } : {})
      })
    );
  }
}

export interface WebhookAlertSinkOptions {
  url: string;
  token?: string;
  maxAttempts?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** POSTs alerts to a webhook with optional bearer auth, bounded retry/backoff. */
export class WebhookAlertSink implements AlertSink {
  private readonly url: string;
  private readonly token?: string;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: WebhookAlertSinkOptions) {
    this.url = options.url;
    if (options.token !== undefined) this.token = options.token;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async deliver(alert: Alert): Promise<void> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.token) headers["authorization"] = `Bearer ${this.token}`;
    const body = JSON.stringify({
      id: alert.id,
      kind: alert.kind,
      severity: alert.severity,
      summary: alert.summary,
      at: alert.at.toISOString(),
      ...(alert.metadata ? { metadata: alert.metadata } : {})
    });

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchFn(this.url, { method: "POST", headers, body, signal: controller.signal });
        if (res.ok) return;
        // 4xx are caller errors and not retryable; 5xx are.
        if (res.status < 500) throw new Error(`alert webhook rejected: ${res.status}`);
        lastError = new Error(`alert webhook HTTP ${res.status}`);
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timer);
      }
      if (attempt < this.maxAttempts) await this.sleep(200 * attempt);
    }
    throw lastError instanceof Error ? lastError : new Error("alert webhook failed");
  }
}

/**
 * Fans an alert out to every sink, exactly once per id. A sink that throws is
 * isolated (logged via onSinkError) so the others still fire.
 */
export class AlertDispatcher {
  private readonly delivered = new Set<string>();

  constructor(
    private readonly sinks: AlertSink[],
    private readonly onSinkError: (error: unknown, alert: Alert) => void = () => {}
  ) {}

  async dispatch(alert: Alert): Promise<void> {
    if (this.delivered.has(alert.id)) return;
    this.delivered.add(alert.id);
    await Promise.all(
      this.sinks.map(async (sink) => {
        try {
          await sink.deliver(alert);
        } catch (error) {
          this.onSinkError(error, alert);
        }
      })
    );
  }
}
