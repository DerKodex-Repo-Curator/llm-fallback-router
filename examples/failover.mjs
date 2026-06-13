/**
 * Automatic failover during a provider outage.
 *
 *   node examples/failover.mjs
 *
 * OpenAI returns 503 for its first two calls (simulated outage). The router
 * transparently fails over to Claude; the caller never sees an error.
 */

import { Router, mock } from "../dist/index.js";

const router = new Router({
  strategy: "priority",
  providers: [
    { provider: mock({ name: "openai", model: "gpt-4o", script: ["server_error", "server_error", "ok"] }), priority: 0 },
    { provider: mock({ name: "claude", model: "claude-sonnet-4-6" }), priority: 1 },
  ],
});

for (let i = 1; i <= 3; i++) {
  const res = await router.complete({ messages: [{ role: "user", content: "hi" }] });
  console.log(`request ${i}: served by "${res.provider}"`);
  for (const a of res.decision.attempts) {
    const mark = a.outcome === "success" ? "✓" : a.outcome === "failed" ? "✗" : "–";
    console.log(`   ${mark} ${a.provider.padEnd(7)} ${a.outcome}${a.errorKind ? ` (${a.errorKind})` : ""} — ${a.reason}`);
  }
}
