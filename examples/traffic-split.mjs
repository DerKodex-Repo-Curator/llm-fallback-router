/**
 * Weighted traffic splitting — canary / A-B deploys.
 *
 *   node examples/traffic-split.mjs
 *
 * Send 80% of traffic to the stable model and 20% to a canary. Each provider
 * still has the full chain as failover, so a canary blip never drops requests.
 */

import { Router, mock } from "../dist/index.js";

const router = new Router({
  strategy: "weighted",
  providers: [
    { provider: mock({ name: "stable", model: "gpt-4o" }), weight: 80 },
    { provider: mock({ name: "canary", model: "gpt-4.1" }), weight: 20 },
  ],
});

const counts = {};
const N = 1000;
for (let i = 0; i < N; i++) {
  const res = await router.complete({ messages: [{ role: "user", content: "hi" }] });
  counts[res.provider] = (counts[res.provider] ?? 0) + 1;
}

console.log(`over ${N} requests:`);
for (const [name, n] of Object.entries(counts)) {
  console.log(`  ${name.padEnd(7)} ${((n / N) * 100).toFixed(1)}%  ${"▇".repeat(Math.round((n / N) * 40))}`);
}
