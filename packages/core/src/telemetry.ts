/**
 * Minimal Prometheus text-exposition formatter. Keeping it dependency-free and
 * pure makes the metrics endpoint deterministic and unit-testable. Samples are
 * produced on demand from durable state (fills, heartbeats), not accumulated in
 * a mutable global registry.
 */

export interface MetricSample {
  name: string;
  help: string;
  type: "counter" | "gauge";
  value: number;
  labels?: Record<string, string>;
}

function renderLabels(labels?: Record<string, string>): string {
  const entries = Object.entries(labels ?? {});
  if (entries.length === 0) return "";
  const inner = entries
    .map(([key, value]) => `${key}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",");
  return `{${inner}}`;
}

/** Render samples to Prometheus text format, emitting HELP/TYPE once per name. */
export function renderPrometheus(samples: MetricSample[]): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const sample of samples) {
    if (!seen.has(sample.name)) {
      seen.add(sample.name);
      lines.push(`# HELP ${sample.name} ${sample.help}`);
      lines.push(`# TYPE ${sample.name} ${sample.type}`);
    }
    lines.push(`${sample.name}${renderLabels(sample.labels)} ${sample.value}`);
  }
  return lines.join("\n") + "\n";
}
