import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderHealth } from "../dist/health.js";
import { makeClock } from "./helpers.js";

test("fresh provider is healthy with a perfect score", () => {
  const h = new ProviderHealth();
  assert.equal(h.status(), "healthy");
  assert.equal(h.score(), 100);
  assert.equal(h.errorRate(), 0);
});

test("EWMA latency smooths reported call durations", () => {
  const h = new ProviderHealth({ latencyAlpha: 0.5 });
  h.recordSuccess(100);
  assert.equal(h.latencyMs(), 100);
  h.recordSuccess(300);
  assert.equal(h.latencyMs(), 200); // 0.5*300 + 0.5*100
});

test("high latency marks provider degraded", () => {
  const h = new ProviderHealth({ degradedLatencyMs: 1000, latencyAlpha: 1 });
  h.recordSuccess(2000);
  assert.equal(h.status(), "degraded");
  assert.ok(h.score() < 100);
});

test("errors raise error rate and lower score", () => {
  const clock = makeClock();
  const h = new ProviderHealth({ windowMs: 1e6, now: clock.now });
  h.recordSuccess(100);
  h.recordFailure("boom", true);
  assert.equal(h.errorRate(), 0.5);
  assert.ok(h.score() < 70);
});

test("open breaker forces status down and score to zero", () => {
  const clock = makeClock();
  const h = new ProviderHealth(
    { windowMs: 1e6, now: clock.now },
    { failureThreshold: 0.5, minimumRequests: 2, windowMs: 1e6, now: clock.now },
  );
  h.recordFailure("a", true);
  h.recordFailure("b", true);
  assert.equal(h.breakerState(), "open");
  assert.equal(h.status(), "down");
  assert.equal(h.score(), 0);
});
