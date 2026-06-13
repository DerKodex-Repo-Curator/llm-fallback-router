/**
 * In-memory metrics. Cheap counters per provider; snapshot() produces the shape
 * the dashboard and `router.metrics()` expose. Swap this out for a Prometheus
 * exporter by implementing the same record* surface.
 */

import type { MetricsSnapshot, ProviderMetrics } from "./types.js";

function empty(): ProviderMetrics {
  return {
    requests: 0,
    successes: 0,
    failures: 0,
    failovers: 0,
    skipped: 0,
    totalLatencyMs: 0,
    totalCostUsd: 0,
    promptTokens: 0,
    completionTokens: 0,
  };
}

export class Metrics {
  private byProvider = new Map<string, ProviderMetrics>();

  private get(name: string): ProviderMetrics {
    let m = this.byProvider.get(name);
    if (!m) {
      m = empty();
      this.byProvider.set(name, m);
    }
    return m;
  }

  recordAttempt(name: string): void {
    this.get(name).requests += 1;
  }

  recordSuccess(
    name: string,
    latencyMs: number,
    costUsd: number,
    promptTokens: number,
    completionTokens: number,
  ): void {
    const m = this.get(name);
    m.successes += 1;
    m.totalLatencyMs += latencyMs;
    m.totalCostUsd += costUsd;
    m.promptTokens += promptTokens;
    m.completionTokens += completionTokens;
  }

  recordFailure(name: string): void {
    this.get(name).failures += 1;
  }

  recordFailover(name: string): void {
    this.get(name).failovers += 1;
  }

  recordSkip(name: string): void {
    this.get(name).skipped += 1;
  }

  snapshot(): MetricsSnapshot {
    const byProvider: Record<string, ProviderMetrics> = {};
    const totals = empty();
    for (const [name, m] of this.byProvider) {
      byProvider[name] = { ...m };
      totals.requests += m.requests;
      totals.successes += m.successes;
      totals.failures += m.failures;
      totals.failovers += m.failovers;
      totals.skipped += m.skipped;
      totals.totalLatencyMs += m.totalLatencyMs;
      totals.totalCostUsd += m.totalCostUsd;
      totals.promptTokens += m.promptTokens;
      totals.completionTokens += m.completionTokens;
    }
    return { totals: { ...totals, providers: this.byProvider.size }, byProvider };
  }
}
