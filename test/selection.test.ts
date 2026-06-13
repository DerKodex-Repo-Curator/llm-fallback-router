import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../dist/router.js";
import { mock } from "../dist/providers/mock.js";
import { seededRng } from "./helpers.js";

const ask = { messages: [{ role: "user" as const, content: "hello" }] };

test("priority strategy follows the configured order", async () => {
  const r = new Router({
    providers: [
      { provider: mock({ name: "a" }), priority: 2 },
      { provider: mock({ name: "b" }), priority: 0 },
      { provider: mock({ name: "c" }), priority: 1 },
    ],
    strategy: "priority",
  });
  const res = await r.complete(ask);
  assert.equal(res.provider, "b");
});

test("cost strategy picks the cheapest model", async () => {
  const r = new Router({
    providers: [
      mock({ name: "a", model: "gpt-5" }), // expensive
      mock({ name: "b", model: "gemini-2.0-flash" }), // cheapest
      mock({ name: "c", model: "mistral-small-latest" }),
    ],
    strategy: "cost",
  });
  const res = await r.complete({ ...ask, maxTokens: 1000 });
  assert.equal(res.provider, "b");
});

test("weighted strategy splits traffic in proportion to weights", async () => {
  const r = new Router({
    providers: [
      { provider: mock({ name: "a" }), weight: 50 },
      { provider: mock({ name: "b" }), weight: 30 },
      { provider: mock({ name: "c" }), weight: 20 },
    ],
    strategy: "weighted",
    rng: seededRng(42),
  });
  const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const res = await r.complete(ask);
    counts[res.provider] = (counts[res.provider] ?? 0) + 1;
  }
  assert.ok(Math.abs(counts["a"]! / N - 0.5) < 0.04, `a=${counts["a"]! / N}`);
  assert.ok(Math.abs(counts["b"]! / N - 0.3) < 0.04, `b=${counts["b"]! / N}`);
  assert.ok(Math.abs(counts["c"]! / N - 0.2) < 0.04, `c=${counts["c"]! / N}`);
});

test("latency strategy prefers the faster provider once latencies are known", async () => {
  const slow = mock({ name: "slow", latencyMs: 1200 });
  const fast = mock({ name: "fast", latencyMs: 120 });
  const r = new Router({ providers: [slow, fast], strategy: "latency" });
  // warm up so EWMA latency reflects reality
  await r.complete(ask);
  await r.complete(ask);
  const res = await r.complete(ask);
  assert.equal(res.provider, "fast");
});
