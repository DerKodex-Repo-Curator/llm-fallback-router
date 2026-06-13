/**
 * Cost-aware, tier-based routing under a budget.
 *
 *   node examples/cost-aware.mjs
 *
 * Premium users get top models; standard/low users get cheaper ones. The "cost"
 * strategy always picks the cheapest *eligible* provider, and a daily budget
 * caps total spend.
 */

import { Router, mock } from "../dist/index.js";

const router = new Router({
  strategy: "cost",
  budget: { dailyUsd: 50, perRequestUsd: 0.5 },
  providers: [
    { provider: mock({ name: "opus", model: "claude-opus-4-8" }), tiers: ["premium"] },
    { provider: mock({ name: "sonnet", model: "claude-sonnet-4-6" }), tiers: ["premium", "standard"] },
    { provider: mock({ name: "flash", model: "gemini-2.0-flash" }), tiers: ["standard", "low"] },
  ],
});

for (const tier of ["premium", "standard", "low"]) {
  const res = await router.complete({
    messages: [{ role: "user", content: "Draft a reply." }],
    tier,
    maxTokens: 500,
  });
  console.log(`${tier.padEnd(9)} → ${res.provider.padEnd(7)} (${res.model.padEnd(20)}) est $${res.costUsd.toFixed(6)}`);
}
