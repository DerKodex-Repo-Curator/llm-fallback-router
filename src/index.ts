/**
 * llm-fallback-router — intelligent routing, automatic failover, latency-aware
 * model selection, and cost-controlled fallback across every major LLM provider.
 *
 * @example
 * import { Router, openai, anthropic } from "llm-fallback-router";
 *
 * const router = new Router({
 *   providers: [
 *     { provider: openai({ model: "gpt-4o" }), priority: 0 },
 *     { provider: anthropic({ model: "claude-sonnet-4-6" }), priority: 1 },
 *   ],
 * });
 *
 * const res = await router.complete({ messages: [{ role: "user", content: "Hi" }] });
 * console.log(res.text, "via", res.provider);
 */

export const VERSION = "0.1.0";

export { Router, type RouterOptions } from "./router.js";

export type {
  Role,
  Message,
  CompletionRequest,
  CompletionResponse,
  ProviderResult,
  TokenUsage,
  CallOptions,
  ProviderAdapter,
  RouteTarget,
  ProviderStatus,
  HealthSnapshot,
  MetricsSnapshot,
  ProviderMetrics,
  RouteAttempt,
  RouteDecision,
  AttemptOutcome,
  Scoreboard,
  ScoreboardRow,
} from "./types.js";

export {
  ProviderError,
  BudgetExceededError,
  AllProvidersFailedError,
  NoProvidersError,
  classifyStatus,
  shouldFailover,
  countsAgainstBreaker,
  type ErrorKind,
} from "./errors.js";

export {
  costOf,
  estimateCost,
  priceOf,
  isPriced,
  registerPrice,
  type ModelPrice,
} from "./pricing.js";

export {
  CircuitBreaker,
  DEFAULT_BREAKER,
  type BreakerOptions,
  type BreakerState,
} from "./circuit-breaker.js";

export { ProviderHealth, DEFAULT_HEALTH, type HealthOptions } from "./health.js";
export { BudgetGuard, type BudgetOptions } from "./budget.js";
export { Metrics } from "./metrics.js";

export {
  priorityStrategy,
  latencyStrategy,
  costStrategy,
  balancedStrategy,
  weightedStrategy,
  resolveStrategy,
  type Strategy,
  type StrategyName,
  type Candidate,
} from "./selection.js";

// Provider adapters + factory helpers.
export { OpenAIProvider, openai } from "./providers/openai.js";
export { AnthropicProvider, anthropic } from "./providers/anthropic.js";
export { GeminiProvider, gemini } from "./providers/gemini.js";
export { MistralProvider, mistral } from "./providers/mistral.js";
export { MockProvider, mock, type MockOptions } from "./providers/mock.js";
export { type HttpProviderConfig } from "./providers/base.js";
