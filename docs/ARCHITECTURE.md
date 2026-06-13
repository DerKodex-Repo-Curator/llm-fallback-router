# Architecture

`llm-fallback-router` is a small, in-process library. There is no proxy, no
daemon, no background thread. A `Router` owns per-provider state and exposes one
method that matters: `complete()`.

```
                         ┌──────────────────────────────────────────────┐
   CompletionRequest ──► │                   Router                      │
                         │                                               │
                         │  1. eligibility  (tier / region / cost cap)   │
                         │  2. strategy.order(candidates)  → chain       │
                         │  3. walk chain:                               │
                         │       budget gate  ──► skip (reason)          │
                         │       breaker gate ──► skip (reason)          │
                         │       call w/ timeout ──► success | failover  │
                         │  4. record decision (audit + onDecision)      │
                         └───────┬───────────────┬───────────────┬───────┘
                                 │               │               │
                          ProviderHealth   CircuitBreaker    BudgetGuard
                          (EWMA, score)    (closed/open/HO)  (windows)
                                 │
                          ProviderAdapter ──► OpenAI / Anthropic / Gemini / Mistral / Mock
```

## Request lifecycle

1. **Eligibility filtering.** Each target is checked against the request's
   `tier`, `region`, and the target's `maxCostUsd`. Rejected targets are recorded
   as `skipped` attempts (with a reason) so the decision log is complete.
2. **Ordering.** The active `Strategy` orders the eligible candidates into a
   *try chain*. Strategies are pure functions of `(candidates, request)` — no I/O,
   no mutation — which makes routing deterministic and unit-testable.
3. **Walking the chain.** For each candidate, in order:
   - **Budget gate** — if the estimated cost exceeds the remaining budget or the
     per-request cap, skip (recorded).
   - **Breaker gate** — if the circuit breaker is open, skip instantly (recorded).
     This is what avoids paying a timeout for a known-dead provider.
   - **Call** — invoke the adapter with a per-attempt timeout. On success, record
     health/metrics/cost and return. On a *retryable* error, fail over to the next
     candidate. On a *non-retryable* error (`bad_request`), stop.
4. **Decision.** Whether it succeeds or every provider fails, a `RouteDecision`
   is committed to the audit ring buffer and passed to `onDecision`.

## Error classification (`errors.ts`)

Failover is driven entirely by error *kind*, not provider-specific strings:

| Kind | HTTP | Failover? | Counts against breaker? |
|---|---|:--:|:--:|
| `rate_limit` | 429 | ✅ | ✅ |
| `overloaded` | 529 | ✅ | ✅ |
| `server_error` | 5xx | ✅ | ✅ |
| `timeout` | 408 / abort | ✅ | ✅ |
| `network` | — | ✅ | ✅ |
| `auth` | 401 / 403 | ✅ | ❌ (our key, not their health) |
| `bad_request` | 400 / 422 | ❌ (fails everywhere) | ❌ |

## Health & circuit breaker

`ProviderHealth` keeps an EWMA of latency and a rolling error rate, and fuses
them with breaker state into a single 0–100 **availability score** used for
ranking and the scoreboard. The `CircuitBreaker` is a standard three-state
machine. Both rolling windows are bounded by **time *and* sample count**, so
bookkeeping stays O(1) per request regardless of throughput.

## Extending

- **New provider:** implement `ProviderAdapter` (see `providers/openai.ts`).
- **New strategy:** implement `Strategy` (`order(candidates, req)`); pass the
  instance as `strategy`.
- **New metrics sink:** wrap `Metrics` or consume `onDecision`.
