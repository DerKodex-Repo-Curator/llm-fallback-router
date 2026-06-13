# Contributing

Thanks for helping make LLM apps more reliable. 🙏

## Dev setup

```bash
npm install
npm test        # build src + tests, then run 28 offline tests
npm run demo    # terminal scoreboard
npm run bench   # routing overhead
```

No API keys are needed — the suite, demo, and examples all run against mock providers.

## Project layout

```
src/
  router.ts          routing engine (failover, gates, audit)
  selection.ts       strategies (priority/latency/cost/weighted/balanced)
  circuit-breaker.ts per-provider breaker (closed/open/half-open)
  health.ts          EWMA latency, error rate, availability score
  budget.ts          per-request / daily / monthly spend guard
  metrics.ts         in-memory counters
  pricing.ts         model price table + cost estimation
  errors.ts          error classification (drives failover)
  dashboard.ts       terminal scoreboard + live web dashboard
  providers/         openai, anthropic, gemini, mistral, mock, base
test/                node:test suites (deterministic, offline)
examples/            runnable .mjs examples
bench/               microbenchmark
```

## Adding a provider

Implement the `ProviderAdapter` interface (~40 lines — see `src/providers/openai.ts`):

```ts
interface ProviderAdapter {
  readonly name: string;
  readonly model: string;
  complete(req: CompletionRequest, opts?: CallOptions): Promise<ProviderResult>;
}
```

Map the agnostic `CompletionRequest` to the provider's wire format, parse the response into a `ProviderResult` (text, usage, cost via `costOf()`, latency), and throw `ProviderError` with the right `ErrorKind` on failure. Add a factory helper and export it from `src/index.ts`.

## Guidelines

- **Zero runtime dependencies.** Keep it that way.
- **Tests are deterministic and offline.** Inject the clock/RNG; never hit the network in tests.
- Run `npm run typecheck` and `npm test` before opening a PR.
- Keep strategies pure (no side effects, no I/O).
