/**
 * In-memory mock provider for tests, demos, and the offline scoreboard.
 *
 * Failures are fully scriptable so circuit-breaker / failover behaviour can be
 * tested deterministically with no network and no real timers — the configured
 * `latencyMs` is *reported*, not slept, so suites run instantly.
 */

import type { CallOptions, CompletionRequest, ProviderAdapter, ProviderResult } from "../types.js";
import { ProviderError, type ErrorKind } from "../errors.js";
import { costOf } from "../pricing.js";

export interface MockOptions {
  name: string;
  model?: string;
  /** Reported latency (ms). Number or a thunk (e.g. jittered). */
  latencyMs?: number | (() => number);
  /** Probability of failure in [0,1] (ignored where `script` decides). */
  failRate?: number;
  /** Error kind used for scripted/random failures. Default: "server_error". */
  failKind?: ErrorKind;
  /** Fail the first N calls, then behave normally. */
  failFirst?: number;
  /**
   * Exact per-call outcome sequence: "ok" or an ErrorKind. The last element is
   * repeated once exhausted. Overrides failRate/failFirst.
   */
  script?: Array<"ok" | ErrorKind>;
  /** Build the response text from the request. */
  respond?: (req: CompletionRequest) => string;
  /** Override estimated cost per call (USD). */
  costPerCall?: number;
  promptTokens?: number;
  completionTokens?: number;
  /** Injectable RNG for failRate (default Math.random). */
  rng?: () => number;
}

export class MockProvider implements ProviderAdapter {
  readonly name: string;
  readonly model: string;
  private readonly opt: MockOptions;
  private readonly rng: () => number;
  calls = 0;

  constructor(opt: MockOptions) {
    this.opt = opt;
    this.name = opt.name;
    this.model = opt.model ?? "mock-1";
    this.rng = opt.rng ?? Math.random;
  }

  private outcome(idx: number): "ok" | ErrorKind {
    if (this.opt.script && this.opt.script.length > 0) {
      return this.opt.script[Math.min(idx, this.opt.script.length - 1)]!;
    }
    if (this.opt.failFirst !== undefined && idx < this.opt.failFirst) {
      return this.opt.failKind ?? "server_error";
    }
    if (this.opt.failRate !== undefined && this.rng() < this.opt.failRate) {
      return this.opt.failKind ?? "server_error";
    }
    return "ok";
  }

  async complete(req: CompletionRequest, opts: CallOptions = {}): Promise<ProviderResult> {
    if (opts.signal?.aborted) {
      throw new ProviderError({ message: `${this.name} aborted`, kind: "timeout", provider: this.name });
    }
    const idx = this.calls;
    this.calls += 1;
    const result = this.outcome(idx);
    if (result !== "ok") {
      throw new ProviderError({
        message: `${this.name} simulated ${result}`,
        kind: result,
        provider: this.name,
      });
    }

    const model = req.model ?? this.model;
    const latencyMs = typeof this.opt.latencyMs === "function" ? this.opt.latencyMs() : this.opt.latencyMs ?? 100;
    const promptTokens = this.opt.promptTokens ?? Math.ceil(req.messages.reduce((n, m) => n + m.content.length, 0) / 4);
    const completionTokens = this.opt.completionTokens ?? 24;
    const text = this.opt.respond ? this.opt.respond(req) : `[${this.name}] ok`;
    return {
      text,
      model,
      provider: this.name,
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
      costUsd: this.opt.costPerCall ?? costOf(model, promptTokens, completionTokens),
      latencyMs,
      finishReason: "stop",
    };
  }
}

export function mock(opt: MockOptions): MockProvider {
  return new MockProvider(opt);
}
