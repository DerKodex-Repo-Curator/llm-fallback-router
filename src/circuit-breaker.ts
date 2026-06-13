/**
 * Per-provider circuit breaker.
 *
 *   closed     normal — requests flow, failures are counted in a rolling window
 *   open       provider is quarantined — requests are rejected instantly
 *   half_open  cooldown elapsed — a few probe requests are allowed through; if
 *              they succeed we close, if any fails we re-open
 *
 * The breaker is what turns "provider is down" from a per-request timeout tax
 * into an instant skip, which is what keeps a single bad provider from dragging
 * down the latency of every request.
 */

export interface BreakerOptions {
  /** Failure rate in [0,1] that opens the breaker once `minimumRequests` is met. */
  failureThreshold: number;
  /** Rolling window length in ms for computing the failure rate. */
  windowMs: number;
  /** How long to stay open before allowing probe traffic. */
  cooldownMs: number;
  /** Successful probes required in half-open before closing. */
  halfOpenSuccesses: number;
  /** Don't open until at least this many requests are in the window. */
  minimumRequests: number;
  /** Hard cap on retained outcomes, keeping the rolling window O(1) under load. */
  maxSamples: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

export const DEFAULT_BREAKER: BreakerOptions = {
  failureThreshold: 0.5,
  windowMs: 30_000,
  cooldownMs: 15_000,
  halfOpenSuccesses: 2,
  minimumRequests: 5,
  maxSamples: 256,
};

export type BreakerState = "closed" | "open" | "half_open";

interface Outcome {
  t: number;
  ok: boolean;
}

export class CircuitBreaker {
  private readonly opt: BreakerOptions;
  private readonly now: () => number;
  private outcomes: Outcome[] = [];
  private _state: BreakerState = "closed";
  private openedAt = 0;
  private halfOpenOk = 0;
  private halfOpenInFlight = 0;

  constructor(options: Partial<BreakerOptions> = {}) {
    this.opt = { ...DEFAULT_BREAKER, ...options };
    this.now = this.opt.now ?? Date.now;
  }

  /** Current state, after applying any time-based transition (open → half_open). */
  state(): BreakerState {
    if (this._state === "open" && this.now() - this.openedAt >= this.opt.cooldownMs) {
      this._state = "half_open";
      this.halfOpenOk = 0;
      this.halfOpenInFlight = 0;
    }
    return this._state;
  }

  /** May a request be sent right now? Half-open allows a single probe at a time. */
  canRequest(): boolean {
    const s = this.state();
    if (s === "open") return false;
    if (s === "half_open") {
      if (this.halfOpenInFlight > 0) return false;
      this.halfOpenInFlight += 1;
      return true;
    }
    return true;
  }

  onSuccess(): void {
    this.record(true);
    if (this._state === "half_open") {
      this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
      this.halfOpenOk += 1;
      if (this.halfOpenOk >= this.opt.halfOpenSuccesses) this.close();
    }
  }

  onFailure(): void {
    this.record(false);
    if (this._state === "half_open") {
      // A probe failed — straight back to open, restart the cooldown.
      this.trip();
      return;
    }
    if (this._state === "closed" && this.failureRate() >= this.opt.failureThreshold) {
      this.trip();
    }
  }

  /** Rolling failure rate over the window, in [0,1]. */
  failureRate(): number {
    this.prune();
    if (this.outcomes.length < this.opt.minimumRequests) return 0;
    const fails = this.outcomes.reduce((n, o) => n + (o.ok ? 0 : 1), 0);
    return fails / this.outcomes.length;
  }

  private record(ok: boolean): void {
    this.outcomes.push({ t: this.now(), ok });
    this.prune();
  }

  private prune(): void {
    const cutoff = this.now() - this.opt.windowMs;
    let i = 0;
    while (i < this.outcomes.length && this.outcomes[i]!.t < cutoff) i += 1;
    const overflow = this.outcomes.length - i - this.opt.maxSamples;
    if (overflow > 0) i += overflow;
    if (i > 0) this.outcomes.splice(0, i);
  }

  private trip(): void {
    this._state = "open";
    this.openedAt = this.now();
    this.halfOpenInFlight = 0;
  }

  private close(): void {
    this._state = "closed";
    this.outcomes = [];
    this.halfOpenOk = 0;
    this.halfOpenInFlight = 0;
  }
}
