import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../dist/router.js";
import { mock } from "../dist/providers/mock.js";
import { AllProvidersFailedError } from "../dist/errors.js";
import { makeClock } from "./helpers.js";

const ask = { messages: [{ role: "user" as const, content: "hello" }] };

test("happy path returns a normalized response with a decision", async () => {
  const r = new Router({ providers: [mock({ name: "a", model: "gpt-4o" })] });
  const res = await r.complete(ask);
  assert.equal(res.provider, "a");
  assert.equal(res.model, "gpt-4o");
  assert.ok(res.usage.totalTokens > 0);
  assert.equal(res.decision.chosen, "a");
  assert.equal(res.decision.attempts.length, 1);
  assert.equal(res.decision.attempts[0]!.outcome, "success");
});

test("fails over to the next provider on a retryable error", async () => {
  const a = mock({ name: "a", model: "gpt-4o", script: ["server_error"] });
  const b = mock({ name: "b", model: "claude-sonnet-4-6" });
  const r = new Router({
    providers: [
      { provider: a, priority: 0 },
      { provider: b, priority: 1 },
    ],
    strategy: "priority",
  });
  const res = await r.complete(ask);
  assert.equal(res.provider, "b");
  assert.equal(res.decision.attempts[0]!.outcome, "failed");
  assert.equal(res.decision.attempts[0]!.errorKind, "server_error");
  assert.equal(res.decision.attempts[1]!.outcome, "success");
  assert.equal(r.metrics().byProvider["b"]!.failovers, 1);
});

test("does NOT fail over on a non-retryable bad_request", async () => {
  const a = mock({ name: "a", script: ["bad_request"] });
  const b = mock({ name: "b" });
  const r = new Router({
    providers: [
      { provider: a, priority: 0 },
      { provider: b, priority: 1 },
    ],
    strategy: "priority",
  });
  await assert.rejects(() => r.complete(ask), (e: unknown) => e instanceof AllProvidersFailedError);
  assert.equal(b.calls, 0); // second provider must not be burned
});

test("throws AllProvidersFailedError with the full decision when every provider fails", async () => {
  const a = mock({ name: "a", script: ["server_error"] });
  const b = mock({ name: "b", script: ["overloaded"] });
  const r = new Router({ providers: [a, b], strategy: "priority" });
  await assert.rejects(
    () => r.complete(ask),
    (e: unknown) => {
      assert.ok(e instanceof AllProvidersFailedError);
      assert.equal(e.decision.attempts.filter((x) => x.outcome === "failed").length, 2);
      return true;
    },
  );
});

test("dry-run selects a route without calling any provider", async () => {
  const a = mock({ name: "a" });
  const r = new Router({ providers: [a], dryRun: true });
  const res = await r.complete(ask);
  assert.equal(res.decision.dryRun, true);
  assert.equal(res.finishReason, "dry_run");
  assert.equal(res.decision.chosen, "a");
  assert.equal(a.calls, 0);
});

test("opens a breaker after repeated failures and then skips the provider", async () => {
  const clock = makeClock();
  const a = mock({ name: "a", model: "gpt-4o", script: ["server_error"] });
  const b = mock({ name: "b", model: "claude-sonnet-4-6" });
  const r = new Router({
    providers: [
      { provider: a, priority: 0 },
      { provider: b, priority: 1 },
    ],
    strategy: "priority",
    now: clock.now,
    breaker: { failureThreshold: 0.5, minimumRequests: 3, windowMs: 1e6, cooldownMs: 1000 },
  });
  for (let i = 0; i < 3; i++) await r.complete(ask);
  assert.equal(a.calls, 3);

  const res = await r.complete(ask); // 4th: breaker open, A skipped instantly
  assert.equal(a.calls, 3); // not called again
  const aAttempt = res.decision.attempts.find((x) => x.provider === "a");
  assert.ok(aAttempt);
  assert.equal(aAttempt!.outcome, "skipped");
  assert.match(aAttempt!.reason, /circuit breaker open/);
  assert.equal(res.provider, "b");
  assert.equal(r.health().find((h) => h.provider === "a")!.breaker, "open");
});

test("tier routing skips providers that don't serve the requested tier", async () => {
  const prem = mock({ name: "prem", model: "gpt-5" });
  const cheap = mock({ name: "cheap", model: "gemini-2.0-flash" });
  const r = new Router({
    providers: [
      { provider: prem, tiers: ["premium"] },
      { provider: cheap, tiers: ["standard", "low"] },
    ],
  });
  const res = await r.complete({ ...ask, tier: "low" });
  assert.equal(res.provider, "cheap");
  const skipped = res.decision.attempts.find((a) => a.provider === "prem");
  assert.ok(skipped);
  assert.equal(skipped!.outcome, "skipped");
  assert.match(skipped!.reason, /tier/);
});

test("budget gate skips providers whose estimated cost blows the per-request cap", async () => {
  const expensive = mock({ name: "exp", model: "gpt-5" });
  const cheap = mock({ name: "chp", model: "gemini-2.0-flash" });
  const r = new Router({
    providers: [
      { provider: expensive, priority: 0 },
      { provider: cheap, priority: 1 },
    ],
    strategy: "priority",
    budget: { perRequestUsd: 0.1 },
  });
  const res = await r.complete({ messages: [{ role: "user", content: "x".repeat(40) }], maxTokens: 100_000 });
  assert.equal(res.provider, "chp");
  const exp = res.decision.attempts.find((a) => a.provider === "exp");
  assert.ok(exp);
  assert.equal(exp!.outcome, "skipped");
  assert.match(exp!.reason, /budget/);
});

test("rejects duplicate provider names", () => {
  assert.throws(() => new Router({ providers: [mock({ name: "dup" }), mock({ name: "dup" })] }), /Duplicate/);
});
