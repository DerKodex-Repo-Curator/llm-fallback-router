/**
 * The routing engine.
 *
 * `Router.complete()` takes a provider-agnostic request and walks a chain of
 * providers chosen by the active strategy, applying budget gates and circuit
 * breakers, failing over on retryable errors, and recording an auditable
 * decision for every request. One API in, one normalized answer out, with the
 * full "who was tried, who was skipped, and why" attached.
 */

import { randomUUID } from "node:crypto";
import type {
  CompletionRequest,
  CompletionResponse,
  HealthSnapshot,
  MetricsSnapshot,
  ProviderAdapter,
  ProviderResult,
  RouteDecision,
  RouteTarget,
  Scoreboard,
  ScoreboardRow,
} from "./types.js";
import { ProviderHealth, type HealthOptions } from "./health.js";
import type { BreakerOptions } from "./circuit-breaker.js";
import { BudgetGuard, type BudgetOptions } from "./budget.js";
import { Metrics } from "./metrics.js";
import {
  resolveStrategy,
  type Candidate,
  type Strategy,
  type StrategyName,
} from "./selection.js";
import {
  AllProvidersFailedError,
  NoProvidersError,
  ProviderError,
  classifyStatus,
  countsAgainstBreaker,
  shouldFailover,
  type ErrorKind,
} from "./errors.js";
import { estimateCost } from "./pricing.js";

export interface RouterOptions {
  /** Providers to route across. A bare adapter is wrapped as a default target. */
  providers: Array<RouteTarget | ProviderAdapter>;
  /** Selection strategy. Default: "balanced". */
  strategy?: StrategyName | Strategy;
  breaker?: Partial<BreakerOptions>;
  health?: Partial<HealthOptions>;
  budget?: BudgetOptions;
  /** Per-attempt timeout in ms. 0/undefined = no timeout. */
  timeoutMs?: number;
  /** Max providers to try per request. Default: all of them. */
  maxAttempts?: number;
  /** Plan a route without calling any provider. Returns the would-be decision. */
  dryRun?: boolean;
  /** Injectable clock (for tests). */
  now?: () => number;
  /** Injectable RNG for the weighted strategy (for tests). */
  rng?: () => number;
  /** Keep this many recent decisions in the audit ring buffer. Default: 100. */
  auditLimit?: number;
  /** Called with every completed decision (success or failure). */
  onDecision?: (decision: RouteDecision) => void;
}

function isAdapter(x: RouteTarget | ProviderAdapter): x is ProviderAdapter {
  return typeof (x as ProviderAdapter).complete === "function";
}

function toProviderError(err: unknown, provider: string): ProviderError {
  if (err instanceof ProviderError) return err;
  const e = err as { name?: string; message?: string; status?: number; cause?: unknown };
  const name = e?.name ?? "";
  const msg = e?.message ?? String(err);
  let kind: ErrorKind = "unknown";
  if (name === "AbortError" || /abort|timed? ?out/i.test(msg)) kind = "timeout";
  else if (typeof e?.status === "number") kind = classifyStatus(e.status);
  else if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|network/i.test(msg)) kind = "network";
  const opts: ConstructorParameters<typeof ProviderError>[0] = { message: msg, kind, provider, cause: err };
  if (typeof e?.status === "number") opts.status = e.status;
  return new ProviderError(opts);
}

export class Router {
  private readonly targets: RouteTarget[] = [];
  private readonly healthByName = new Map<string, ProviderHealth>();
  private readonly metricsStore = new Metrics();
  private readonly budget: BudgetGuard;
  private readonly strategy: Strategy;
  private readonly opt: RouterOptions;
  private readonly now: () => number;
  private readonly auditLimit: number;
  private audit: RouteDecision[] = [];

  constructor(options: RouterOptions) {
    this.opt = options;
    this.now = options.now ?? Date.now;
    this.auditLimit = options.auditLimit ?? 100;
    this.strategy = resolveStrategy(options.strategy, options.rng);
    this.budget = new BudgetGuard({ ...options.budget, now: this.now });

    if (!options.providers || options.providers.length === 0) {
      throw new NoProvidersError("Router requires at least one provider.");
    }
    for (const entry of options.providers) {
      const target: RouteTarget = isAdapter(entry) ? { provider: entry } : entry;
      const name = target.provider.name;
      if (this.healthByName.has(name)) {
        throw new NoProvidersError(
          `Duplicate provider name "${name}". Give each target a unique adapter name.`,
        );
      }
      this.targets.push(target);
      this.healthByName.set(
        name,
        new ProviderHealth({ ...options.health, now: this.now }, { ...options.breaker, now: this.now }),
      );
    }
  }

  /** Route and execute one completion, failing over as needed. */
  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const start = this.now();
    const decision: RouteDecision = {
      id: randomUUID(),
      timestamp: new Date(start).toISOString(),
      strategy: this.strategy.name,
      dryRun: Boolean(this.opt.dryRun),
      attempts: [],
      totalLatencyMs: 0,
      costUsd: 0,
    };
    if (req.tier !== undefined) decision.tier = req.tier;
    if (req.region !== undefined) decision.region = req.region;

    const promptChars = req.messages.reduce((n, m) => n + m.content.length, 0);
    const eligible: Candidate[] = [];

    // ---- Phase 1: eligibility filtering (tier / region / per-target cost) ----
    for (const target of this.targets) {
      const name = target.provider.name;
      const model = req.model ?? target.provider.model;
      const health = this.healthByName.get(name)!;
      const estCostUsd = estimateCost(model, promptChars, req.maxTokens);

      if (req.tier !== undefined && target.tiers && target.tiers.length > 0 && !target.tiers.includes(req.tier)) {
        this.skip(decision, name, model, `tier "${req.tier}" not served`);
        continue;
      }
      if (req.region !== undefined && target.region !== undefined && target.region !== req.region) {
        this.skip(decision, name, model, `region "${target.region}" != "${req.region}"`);
        continue;
      }
      if (target.maxCostUsd !== undefined && estCostUsd > target.maxCostUsd) {
        this.skip(decision, name, model, `est cost $${estCostUsd.toFixed(5)} > target cap $${target.maxCostUsd}`);
        continue;
      }
      eligible.push({ target, name, model, health, estCostUsd });
    }

    // ---- Phase 2: order by strategy, then walk the chain ----
    const chain = this.strategy.order(eligible, req);
    const maxAttempts = this.opt.maxAttempts ?? chain.length;
    let realAttempts = 0;
    let hadFailure = false;

    for (const c of chain) {
      if (realAttempts >= maxAttempts) break;

      // Budget gate.
      if (this.budget.active() && !this.budget.canAfford(c.estCostUsd)) {
        this.skip(decision, c.name, c.model, `budget: est $${c.estCostUsd.toFixed(5)} > remaining $${this.fmtRemaining()}`);
        continue;
      }
      // Circuit breaker gate.
      if (!c.health.breaker.canRequest()) {
        this.skip(decision, c.name, c.model, "circuit breaker open");
        continue;
      }

      // Dry-run: select but do not execute.
      if (this.opt.dryRun) {
        decision.chosen = c.name;
        decision.attempts.push({
          provider: c.name,
          model: c.model,
          outcome: "success",
          reason: `dry-run: would call via "${this.strategy.name}"`,
          costUsd: c.estCostUsd,
          latencyMs: 0,
        });
        return this.finish(decision, start, {
          text: "",
          model: c.model,
          provider: c.name,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          costUsd: c.estCostUsd,
          latencyMs: 0,
          finishReason: "dry_run",
        });
      }

      realAttempts += 1;
      this.metricsStore.recordAttempt(c.name);
      try {
        const res = await this.callWithTimeout(c.target.provider, req);
        c.health.recordSuccess(res.latencyMs);
        if (this.budget.active()) this.budget.record(res.costUsd);
        this.metricsStore.recordSuccess(
          c.name,
          res.latencyMs,
          res.costUsd,
          res.usage.promptTokens,
          res.usage.completionTokens,
        );
        if (hadFailure) this.metricsStore.recordFailover(c.name);
        decision.chosen = c.name;
        decision.costUsd += res.costUsd;
        decision.attempts.push({
          provider: c.name,
          model: res.model,
          outcome: "success",
          reason: hadFailure ? `failover via "${this.strategy.name}"` : `selected via "${this.strategy.name}"`,
          latencyMs: res.latencyMs,
          costUsd: res.costUsd,
        });
        return this.finish(decision, start, res);
      } catch (err) {
        hadFailure = true;
        const pe = toProviderError(err, c.name);
        c.health.recordFailure(pe.message, countsAgainstBreaker(pe.kind));
        this.metricsStore.recordFailure(c.name);
        decision.attempts.push({
          provider: c.name,
          model: c.model,
          outcome: "failed",
          reason: shouldFailover(pe.kind) ? "failing over" : "non-retryable, stopping",
          errorKind: pe.kind,
          error: pe.message,
        });
        if (!shouldFailover(pe.kind)) break; // client-side error: don't burn other providers
      }
    }

    decision.totalLatencyMs = this.now() - start;
    this.commit(decision);
    throw new AllProvidersFailedError(
      `All ${decision.attempts.filter((a) => a.outcome === "failed").length} attempted provider(s) failed` +
        ` (${this.targets.length} configured). See error.decision for the full route.`,
      decision,
    );
  }

  // ---- introspection ----

  /** Live health snapshot for every configured provider. */
  health(): HealthSnapshot[] {
    return this.targets.map((t) => this.healthByName.get(t.provider.name)!.snapshot(t.provider.name));
  }

  metrics(): MetricsSnapshot {
    return this.metricsStore.snapshot();
  }

  /** Recent decisions, most recent last. */
  decisions(): RouteDecision[] {
    return this.audit.slice();
  }

  /** Combined health + metrics view used by the dashboard and CLI scoreboard. */
  scoreboard(): Scoreboard {
    const metrics = this.metricsStore.snapshot();
    const rows: ScoreboardRow[] = this.targets.map((t) => {
      const name = t.provider.name;
      const h = this.healthByName.get(name)!.snapshot(name);
      const m = metrics.byProvider[name];
      return {
        provider: name,
        model: t.provider.model,
        status: h.status,
        breaker: h.breaker,
        latencyMs: h.latencyMs,
        errorRate: h.errorRate,
        score: h.score,
        requests: m?.requests ?? 0,
        costUsd: m?.totalCostUsd ?? 0,
      };
    });
    rows.sort((a, b) => b.score - a.score || a.latencyMs - b.latencyMs);
    const last = this.audit[this.audit.length - 1];
    const board: Scoreboard = { generatedAt: new Date(this.now()).toISOString(), rows };
    if (last?.chosen) board.decision = last.chosen;
    return board;
  }

  // ---- internals ----

  private async callWithTimeout(
    provider: ProviderAdapter,
    req: CompletionRequest,
  ): Promise<ProviderResult> {
    const timeoutMs = this.opt.timeoutMs;
    if (!timeoutMs || timeoutMs <= 0) return provider.complete(req);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      return await provider.complete(req, { signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private skip(decision: RouteDecision, provider: string, model: string, reason: string): void {
    decision.attempts.push({ provider, model, outcome: "skipped", reason });
    this.metricsStore.recordSkip(provider);
  }

  private finish(decision: RouteDecision, start: number, res: ProviderResult): CompletionResponse {
    decision.totalLatencyMs = this.now() - start;
    this.commit(decision);
    return { ...res, decision };
  }

  private commit(decision: RouteDecision): void {
    this.audit.push(decision);
    if (this.audit.length > this.auditLimit) this.audit.splice(0, this.audit.length - this.auditLimit);
    this.opt.onDecision?.(decision);
  }

  private fmtRemaining(): string {
    const r = this.budget.remaining();
    return r === Infinity ? "∞" : r.toFixed(5);
  }
}
