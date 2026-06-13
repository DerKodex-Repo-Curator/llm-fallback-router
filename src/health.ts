/**
 * Health tracking per provider: EWMA latency, rolling error rate, and a single
 * 0–100 availability score that fuses breaker state + latency + errors. The
 * score is what the scoreboard ranks on and what latency/balanced strategies use.
 */

import { CircuitBreaker, type BreakerOptions, type BreakerState } from "./circuit-breaker.js";
import type { HealthSnapshot, ProviderStatus } from "./types.js";

export interface HealthOptions {
  /** EWMA smoothing factor for latency in (0,1]; higher = more reactive. */
  latencyAlpha: number;
  /** Latency (ms) at/above which a healthy provider is marked degraded. */
  degradedLatencyMs: number;
  /** Error rate at/above which a provider is marked degraded. */
  degradedErrorRate: number;
  windowMs: number;
  /** Hard cap on retained samples, so the window stays O(1) under high QPS. */
  maxSamples: number;
  now?: () => number;
}

export const DEFAULT_HEALTH: HealthOptions = {
  latencyAlpha: 0.3,
  degradedLatencyMs: 1500,
  degradedErrorRate: 0.05,
  windowMs: 60_000,
  maxSamples: 256,
};

interface Stamp {
  t: number;
  ok: boolean;
}

export class ProviderHealth {
  readonly breaker: CircuitBreaker;
  private readonly opt: HealthOptions;
  private readonly now: () => number;

  private ewmaLatency = 0;
  private seenLatency = false;
  private window: Stamp[] = [];
  requests = 0;
  successes = 0;
  failures = 0;
  lastError: string | undefined;

  constructor(opt: Partial<HealthOptions> = {}, breaker?: Partial<BreakerOptions>) {
    this.opt = { ...DEFAULT_HEALTH, ...opt };
    this.now = this.opt.now ?? Date.now;
    this.breaker = new CircuitBreaker({ now: this.now, ...breaker });
  }

  recordSuccess(latencyMs: number): void {
    this.requests += 1;
    this.successes += 1;
    this.ewmaLatency = this.seenLatency
      ? this.opt.latencyAlpha * latencyMs + (1 - this.opt.latencyAlpha) * this.ewmaLatency
      : latencyMs;
    this.seenLatency = true;
    this.push(true);
    this.breaker.onSuccess();
  }

  recordFailure(error: string, countAgainstBreaker: boolean): void {
    this.requests += 1;
    this.failures += 1;
    this.lastError = error;
    this.push(false);
    if (countAgainstBreaker) this.breaker.onFailure();
  }

  errorRate(): number {
    this.prune();
    if (this.window.length === 0) return 0;
    const fails = this.window.reduce((n, s) => n + (s.ok ? 0 : 1), 0);
    return fails / this.window.length;
  }

  latencyMs(): number {
    return Math.round(this.ewmaLatency);
  }

  breakerState(): BreakerState {
    return this.breaker.state();
  }

  status(): ProviderStatus {
    const b = this.breaker.state();
    if (b === "open") return "down";
    if (b === "half_open") return "degraded";
    const er = this.errorRate();
    if (er >= this.opt.degradedErrorRate) return "degraded";
    if (this.seenLatency && this.ewmaLatency >= this.opt.degradedLatencyMs) return "degraded";
    return "healthy";
  }

  /**
   * Availability score in [0,100]. Open breaker floors it; otherwise we subtract
   * penalties for error rate (heavily) and latency (gently). This is a heuristic
   * meant for ranking, not an SLA.
   */
  score(): number {
    if (this.breaker.state() === "open") return 0;
    let s = 100;
    s -= this.errorRate() * 80;
    if (this.seenLatency) {
      const over = Math.max(0, this.ewmaLatency - 250);
      s -= Math.min(30, over / 100); // ~1 pt per 100ms over 250ms, capped at 30
    }
    if (this.breaker.state() === "half_open") s = Math.min(s, 60);
    return Math.max(0, Math.round(s));
  }

  snapshot(provider: string): HealthSnapshot {
    const snap: HealthSnapshot = {
      provider,
      status: this.status(),
      breaker: this.breaker.state(),
      latencyMs: this.latencyMs(),
      errorRate: Number(this.errorRate().toFixed(4)),
      score: this.score(),
      requests: this.requests,
      successes: this.successes,
      failures: this.failures,
    };
    if (this.lastError !== undefined) snap.lastError = this.lastError;
    return snap;
  }

  private push(ok: boolean): void {
    this.window.push({ t: this.now(), ok });
    this.prune();
  }

  private prune(): void {
    const cutoff = this.now() - this.opt.windowMs;
    let i = 0;
    while (i < this.window.length && this.window[i]!.t < cutoff) i += 1;
    // Also bound by sample count so high QPS can't grow the window unboundedly.
    const overflow = this.window.length - i - this.opt.maxSamples;
    if (overflow > 0) i += overflow;
    if (i > 0) this.window.splice(0, i);
  }
}
