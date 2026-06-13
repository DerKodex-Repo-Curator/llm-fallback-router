/**
 * Model pricing table (USD per 1M tokens).
 *
 * Prices are approximate, change often, and are NOT authoritative — they exist
 * so cost-aware routing has a number to compare. Override anything via
 * `registerPrice()` or per-target `maxCostUsd`. Unknown models cost 0 and are
 * flagged by `isPriced()` so you can tell estimated-zero from actually-free.
 */

export interface ModelPrice {
  /** USD per 1,000,000 input tokens. */
  inputPer1M: number;
  /** USD per 1,000,000 output tokens. */
  outputPer1M: number;
}

const PRICES: Record<string, ModelPrice> = {
  // OpenAI
  "gpt-5": { inputPer1M: 1.25, outputPer1M: 10 },
  "gpt-5-mini": { inputPer1M: 0.25, outputPer1M: 2 },
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4.1": { inputPer1M: 2, outputPer1M: 8 },
  "gpt-4.1-mini": { inputPer1M: 0.4, outputPer1M: 1.6 },

  // Anthropic
  "claude-opus-4-8": { inputPer1M: 15, outputPer1M: 75 },
  "claude-opus-4-1": { inputPer1M: 15, outputPer1M: 75 },
  "claude-sonnet-4-6": { inputPer1M: 3, outputPer1M: 15 },
  "claude-sonnet-4-5": { inputPer1M: 3, outputPer1M: 15 },
  "claude-haiku-4-5": { inputPer1M: 1, outputPer1M: 5 },
  "claude-3-5-haiku": { inputPer1M: 0.8, outputPer1M: 4 },

  // Google
  "gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 10 },
  "gemini-2.5-flash": { inputPer1M: 0.3, outputPer1M: 2.5 },
  "gemini-2.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4 },

  // Mistral
  "mistral-large-latest": { inputPer1M: 2, outputPer1M: 6 },
  "mistral-small-latest": { inputPer1M: 0.2, outputPer1M: 0.6 },

  // xAI
  "grok-4": { inputPer1M: 3, outputPer1M: 15 },
  "grok-3-mini": { inputPer1M: 0.3, outputPer1M: 0.5 },
};

/** Register or override the price for a model. */
export function registerPrice(model: string, price: ModelPrice): void {
  PRICES[model] = price;
}

export function isPriced(model: string): boolean {
  return model in PRICES;
}

export function priceOf(model: string): ModelPrice | undefined {
  return PRICES[model];
}

/** Estimated USD cost of a call. Unknown models return 0. */
export function costOf(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICES[model];
  if (!p) return 0;
  return (promptTokens * p.inputPer1M + completionTokens * p.outputPer1M) / 1_000_000;
}

/**
 * Rough pre-call cost estimate used by budget gating, before we know the real
 * token counts. Approximates prompt tokens from char length (~4 chars/token)
 * and assumes the response fills `maxTokens` (defaulting to 512).
 */
export function estimateCost(model: string, promptChars: number, maxTokens = 512): number {
  const promptTokens = Math.ceil(promptChars / 4);
  return costOf(model, promptTokens, maxTokens);
}
