# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com); versioning is [SemVer](https://semver.org).

## [0.1.0] - 2026-06-14

Initial release.

### Added
- Routing engine with automatic failover across providers.
- Selection strategies: `priority`, `latency`, `cost`, `weighted`, `balanced`.
- Per-provider circuit breakers (closed → open → half-open recovery).
- Health monitoring: EWMA latency, rolling error rate, 0–100 availability score.
- Cost-aware routing with a model pricing table and per-request / daily / monthly budgets.
- Tier- and region-based eligibility filtering.
- Deterministic, per-request decision audit (`response.decision`, `router.decisions()`).
- Dry-run mode.
- Provider adapters: OpenAI (+ OpenAI-compatible), Anthropic, Gemini, Mistral, and a scriptable Mock.
- Observability: terminal scoreboard + zero-dependency live web dashboard with JSON API.
- 28 deterministic, offline tests; routing-overhead benchmark.
- Bounded rolling windows (capped by sample count) so health/breaker bookkeeping stays O(1) under high QPS.
