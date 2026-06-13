/**
 * Error classification. The router's failover logic is driven entirely by the
 * *kind* of failure, not by provider-specific error strings.
 */

export type ErrorKind =
  | "rate_limit" // 429 — provider throttled us
  | "overloaded" // 529 / explicit capacity errors
  | "server_error" // 5xx
  | "timeout" // we gave up waiting
  | "network" // DNS / connection / fetch failed
  | "auth" // 401 / 403 — bad or missing key
  | "bad_request" // 400 / 422 — our payload is wrong
  | "unknown";

/**
 * Should we try a *different* provider on this error?
 *
 * `bad_request` is the only non-failover error: if the payload is malformed it
 * will be malformed for every provider, so retrying elsewhere just burns money.
 */
export function shouldFailover(kind: ErrorKind): boolean {
  return kind !== "bad_request";
}

/** Should this failure count against the provider's circuit breaker? */
export function countsAgainstBreaker(kind: ErrorKind): boolean {
  // Client mistakes (bad_request, auth) are our fault, not the provider being
  // unhealthy — don't trip the breaker on them.
  return (
    kind === "rate_limit" ||
    kind === "overloaded" ||
    kind === "server_error" ||
    kind === "timeout" ||
    kind === "network"
  );
}

export function classifyStatus(status: number): ErrorKind {
  if (status === 429) return "rate_limit";
  if (status === 529) return "overloaded";
  if (status === 408) return "timeout";
  if (status === 401 || status === 403) return "auth";
  if (status === 400 || status === 422) return "bad_request";
  if (status >= 500) return "server_error";
  if (status >= 400) return "bad_request";
  return "unknown";
}

export class ProviderError extends Error {
  readonly kind: ErrorKind;
  readonly provider: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(opts: {
    message: string;
    kind: ErrorKind;
    provider: string;
    status?: number;
    cause?: unknown;
  }) {
    super(opts.message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "ProviderError";
    this.kind = opts.kind;
    this.provider = opts.provider;
    if (opts.status !== undefined) this.status = opts.status;
    this.retryable = shouldFailover(opts.kind);
  }
}

/** Raised when the budget guard blocks every viable provider. */
export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

/** Raised when every provider in the chain failed or was skipped. */
export class AllProvidersFailedError extends Error {
  readonly decision: import("./types.js").RouteDecision;
  constructor(message: string, decision: import("./types.js").RouteDecision) {
    super(message);
    this.name = "AllProvidersFailedError";
    this.decision = decision;
  }
}

export class NoProvidersError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoProvidersError";
  }
}
