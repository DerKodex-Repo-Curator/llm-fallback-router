/**
 * Core types for llm-fallback-router.
 *
 * The request/response shape is provider-agnostic on purpose: you write to one
 * interface and the router maps it onto whichever provider it ends up calling.
 */

export type Role = "system" | "user" | "assistant";

export interface Message {
  role: Role;
  content: string;
}

/** A provider-agnostic completion request. */
export interface CompletionRequest {
  messages: Message[];
  /** Explicit model override. If unset, each provider uses its configured default. */
  model?: string;
  maxTokens?: number;
  temperature?: number;

  // ---- routing hints (optional) ----
  /** Logical tier, e.g. "premium" | "standard" | "low". Targets can opt into tiers. */
  tier?: string;
  /** Preferred region, e.g. "us" | "eu". Targets tagged with a region must match. */
  region?: string;
  /** Free-form tags for custom routing rules. */
  tags?: Record<string, string>;
  /** Caller metadata, echoed into the decision log. Never sent to providers. */
  metadata?: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** What a provider adapter returns: a normalized answer with call telemetry. */
export interface ProviderResult {
  text: string;
  /** Concrete model that produced the answer. */
  model: string;
  /** Provider name that produced the answer. */
  provider: string;
  usage: TokenUsage;
  /** Estimated USD cost for this single call (0 if model pricing unknown). */
  costUsd: number;
  /** Wall-clock latency of the successful call, in milliseconds. */
  latencyMs: number;
  finishReason?: string;
  /** Raw provider payload, for debugging. Omitted in dry-run. */
  raw?: unknown;
}

/** A provider result plus the full routing decision the router attaches. */
export interface CompletionResponse extends ProviderResult {
  /** Which providers were tried, skipped, and why. */
  decision: RouteDecision;
}

export interface CallOptions {
  signal?: AbortSignal;
}

/**
 * A provider adapter. Implement this to add a new backend. The router only ever
 * talks to providers through `complete()`.
 */
export interface ProviderAdapter {
  readonly name: string;
  /** Default model for this adapter. */
  readonly model: string;
  complete(req: CompletionRequest, opts?: CallOptions): Promise<ProviderResult>;
}

/**
 * A routing target = an adapter plus the policy metadata the engine routes on.
 * `priority` is ascending (0 is tried first). `weight` drives traffic splitting.
 */
export interface RouteTarget {
  provider: ProviderAdapter;
  priority?: number;
  weight?: number;
  region?: string;
  /** Tiers this target serves. Empty/undefined = serves every tier. */
  tiers?: string[];
  /** Per-call estimated cost ceiling. Targets above the request budget are skipped. */
  maxCostUsd?: number;
}

export type ProviderStatus = "healthy" | "degraded" | "down";

export interface HealthSnapshot {
  provider: string;
  status: ProviderStatus;
  /** Circuit breaker state. */
  breaker: "closed" | "open" | "half_open";
  /** EWMA latency in ms over recent successful calls. */
  latencyMs: number;
  /** Rolling error rate in [0,1]. */
  errorRate: number;
  /** Availability score in [0,100]; higher is healthier. */
  score: number;
  requests: number;
  successes: number;
  failures: number;
  lastError?: string;
}

export interface MetricsSnapshot {
  totals: ProviderMetrics & { providers: number };
  byProvider: Record<string, ProviderMetrics>;
}

export interface ProviderMetrics {
  requests: number;
  successes: number;
  failures: number;
  failovers: number;
  skipped: number;
  totalLatencyMs: number;
  totalCostUsd: number;
  promptTokens: number;
  completionTokens: number;
}

export type AttemptOutcome = "success" | "failed" | "skipped";

export interface RouteAttempt {
  provider: string;
  model: string;
  outcome: AttemptOutcome;
  /** Human-readable reason. For success: strategy that selected it. */
  reason: string;
  latencyMs?: number;
  costUsd?: number;
  errorKind?: string;
  error?: string;
}

/** The full, auditable story of how one request was routed. */
export interface RouteDecision {
  id: string;
  timestamp: string;
  strategy: string;
  tier?: string;
  region?: string;
  dryRun: boolean;
  /** The provider that ultimately answered, if any. */
  chosen?: string;
  attempts: RouteAttempt[];
  totalLatencyMs: number;
  costUsd: number;
}

export interface Scoreboard {
  generatedAt: string;
  decision?: string;
  rows: ScoreboardRow[];
}

export interface ScoreboardRow {
  provider: string;
  model: string;
  status: ProviderStatus;
  breaker: "closed" | "open" | "half_open";
  latencyMs: number;
  errorRate: number;
  score: number;
  requests: number;
  costUsd: number;
}
