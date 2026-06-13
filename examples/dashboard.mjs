/**
 * Live web dashboard + JSON API.
 *
 *   node examples/dashboard.mjs
 *   → open http://127.0.0.1:7575
 *
 * Spins up the zero-dependency dashboard and feeds it simulated traffic so you
 * can watch health, scores, costs, and routing decisions update in real time.
 */

import { Router, mock } from "../dist/index.js";
import { createDashboardServer } from "../dist/dashboard.js";

const jitter = (base, spread) => () => Math.round(base + (Math.random() - 0.5) * 2 * spread);

const router = new Router({
  strategy: "weighted",
  providers: [
    { provider: mock({ name: "claude", model: "claude-sonnet-4-6", latencyMs: jitter(580, 80), failRate: 0.01 }), weight: 35 },
    { provider: mock({ name: "openai", model: "gpt-4o", latencyMs: jitter(620, 100), failRate: 0.02 }), weight: 30 },
    { provider: mock({ name: "gemini", model: "gemini-2.5-flash", latencyMs: jitter(1800, 400), failRate: 0.09, failKind: "overloaded" }), weight: 20 },
    { provider: mock({ name: "mistral", model: "mistral-large-latest", latencyMs: jitter(430, 60), failRate: 0.0 }), weight: 15 },
  ],
});

createDashboardServer(router, { port: 7575 });
console.log("⚡ Dashboard live at http://127.0.0.1:7575  (Ctrl-C to stop)");

setInterval(async () => {
  try {
    await router.complete({ messages: [{ role: "user", content: "hi" }] });
  } catch {
    /* failures are part of the show */
  }
}, 150);
