/**
 * The shareable scoreboard demo — no API keys, runs entirely on mock providers.
 *
 *   npm run demo
 *
 * Simulates a fleet of providers (one of them degraded), routes a burst of
 * traffic through the balanced strategy, and prints the live scoreboard plus a
 * real failover event. This is the screenshot.
 */

import { Router, mock } from "../dist/index.js";
import { renderScoreboard } from "../dist/dashboard.js";

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const jitter = (base, spread, rng) => () => Math.round(base + (rng() - 0.5) * 2 * spread);

// Weighted split so every provider takes real traffic — which is what makes
// gemini's degraded error rate and the resulting failovers visible.
const router = new Router({
  strategy: "weighted",
  rng: seeded(7),
  providers: [
    { provider: mock({ name: "claude", model: "claude-sonnet-4-6", latencyMs: jitter(580, 70, seeded(1)), failRate: 0.004, rng: seeded(11) }), weight: 35 },
    { provider: mock({ name: "openai", model: "gpt-4o", latencyMs: jitter(610, 90, seeded(2)), failRate: 0.012, rng: seeded(22) }), weight: 30 },
    { provider: mock({ name: "gemini", model: "gemini-2.5-flash", latencyMs: jitter(2100, 300, seeded(3)), failRate: 0.09, rng: seeded(33), failKind: "overloaded" }), weight: 20 },
    { provider: mock({ name: "mistral", model: "mistral-large-latest", latencyMs: jitter(430, 50, seeded(4)), failRate: 0.0, rng: seeded(44) }), weight: 15 },
  ],
});

const ask = { messages: [{ role: "user", content: "Summarize the quarterly report." }] };
for (let i = 0; i < 250; i++) {
  try {
    await router.complete(ask);
  } catch {
    /* swallowed: even total failure is just a data point here */
  }
}

console.log("\n  \x1b[1m⚡ llm-fallback-router — real-time provider scoreboard\x1b[0m\n");
console.log(renderScoreboard(router.scoreboard(), { color: true }));

// Surface one real failover from the audit log.
const failover = router.decisions().find((d) => d.attempts.some((a) => a.outcome === "failed") && d.chosen);
if (failover) {
  console.log("\n  \x1b[1mexample failover event\x1b[0m \x1b[90m(from the audit log)\x1b[0m");
  for (const a of failover.attempts) {
    const icon = a.outcome === "success" ? "\x1b[32m✓\x1b[0m" : a.outcome === "failed" ? "\x1b[31m✗\x1b[0m" : "\x1b[90m–\x1b[0m";
    const detail = a.outcome === "failed" ? `${a.errorKind} → ${a.reason}` : a.reason;
    console.log(`    ${icon} ${a.provider.padEnd(9)} ${detail}`);
  }
  const served = failover.attempts.find((a) => a.outcome === "success");
  console.log(`  \x1b[36m→ recovered on "${failover.chosen}" in ${served?.latencyMs ?? 0}ms, the request never failed\x1b[0m`);
}

const m = router.metrics().totals;
console.log(
  `\n  \x1b[90m${m.requests} requests · ${((m.successes / m.requests) * 100).toFixed(1)}% served · ` +
    `${m.failovers} failovers · $${m.totalCostUsd.toFixed(4)} spent\x1b[0m\n`,
);
