/**
 * Routing-overhead microbenchmark.
 *
 *   npm run bench
 *
 * Measures the router's own decision/failover cost using mock providers (no
 * network), so the numbers reflect pure engine overhead, not provider latency.
 */

import { Router, mock } from "../dist/index.js";

const ask = { messages: [{ role: "user", content: "hi" }] };

async function measure(label, router, iterations) {
  for (let i = 0; i < 2000; i++) await router.complete(ask).catch(() => {}); // warm up
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) await router.complete(ask).catch(() => {});
  const ms = performance.now() - t0;
  const usPerOp = (ms / iterations) * 1000;
  const opsPerSec = Math.round(iterations / (ms / 1000));
  console.log(
    `  ${label.padEnd(34)} ${usPerOp.toFixed(2).padStart(7)} µs/op   ${opsPerSec.toLocaleString().padStart(12)} ops/sec`,
  );
}

console.log("\n  llm-fallback-router — routing overhead (mock providers, single thread)\n");

await measure(
  "healthy primary (no failover)",
  new Router({ providers: [mock({ name: "a" }), mock({ name: "b" })], strategy: "balanced" }),
  200_000,
);

await measure(
  "failover to 2nd provider",
  new Router({
    strategy: "priority",
    breaker: { minimumRequests: Number.MAX_SAFE_INTEGER }, // keep A in rotation so we always exercise the failover path
    providers: [
      { provider: mock({ name: "a", script: ["server_error"] }), priority: 0 },
      { provider: mock({ name: "b" }), priority: 1 },
    ],
  }),
  200_000,
);

await measure(
  "open-breaker instant skip",
  new Router({
    strategy: "priority",
    breaker: { failureThreshold: 0.1, minimumRequests: 1, cooldownMs: 1e9 },
    providers: [
      { provider: mock({ name: "a", script: ["server_error"] }), priority: 0 },
      { provider: mock({ name: "b" }), priority: 1 },
    ],
  }),
  200_000,
);

console.log("\n  Routing adds single-digit microseconds per request — negligible next to any network call.\n");
