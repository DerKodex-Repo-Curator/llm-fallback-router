import { test } from "node:test";
import assert from "node:assert/strict";
import { CircuitBreaker } from "../dist/circuit-breaker.js";
import { makeClock } from "./helpers.js";

test("starts closed and allows requests", () => {
  const cb = new CircuitBreaker();
  assert.equal(cb.state(), "closed");
  assert.equal(cb.canRequest(), true);
});

test("does not open below minimumRequests even if all fail", () => {
  const clock = makeClock();
  const cb = new CircuitBreaker({ failureThreshold: 0.5, minimumRequests: 4, windowMs: 1e6, now: clock.now });
  for (let i = 0; i < 3; i++) cb.onFailure();
  assert.equal(cb.state(), "closed");
});

test("opens once failure rate crosses threshold", () => {
  const clock = makeClock();
  const cb = new CircuitBreaker({ failureThreshold: 0.5, minimumRequests: 4, windowMs: 1e6, now: clock.now });
  for (let i = 0; i < 4; i++) cb.onFailure();
  assert.equal(cb.state(), "open");
  assert.equal(cb.canRequest(), false);
});

test("transitions to half-open after cooldown and allows one probe", () => {
  const clock = makeClock();
  const cb = new CircuitBreaker({
    failureThreshold: 0.5,
    minimumRequests: 2,
    windowMs: 1e6,
    cooldownMs: 1000,
    halfOpenSuccesses: 1,
    now: clock.now,
  });
  cb.onFailure();
  cb.onFailure();
  assert.equal(cb.state(), "open");

  clock.advance(1000);
  assert.equal(cb.state(), "half_open");
  assert.equal(cb.canRequest(), true); // first probe allowed
  assert.equal(cb.canRequest(), false); // only one in flight
});

test("a successful probe closes the breaker", () => {
  const clock = makeClock();
  const cb = new CircuitBreaker({
    failureThreshold: 0.5,
    minimumRequests: 2,
    windowMs: 1e6,
    cooldownMs: 1000,
    halfOpenSuccesses: 1,
    now: clock.now,
  });
  cb.onFailure();
  cb.onFailure();
  clock.advance(1000);
  cb.canRequest();
  cb.onSuccess();
  assert.equal(cb.state(), "closed");
  assert.equal(cb.canRequest(), true);
});

test("a failed probe re-opens the breaker and restarts cooldown", () => {
  const clock = makeClock();
  const cb = new CircuitBreaker({
    failureThreshold: 0.5,
    minimumRequests: 2,
    windowMs: 1e6,
    cooldownMs: 1000,
    halfOpenSuccesses: 1,
    now: clock.now,
  });
  cb.onFailure();
  cb.onFailure();
  clock.advance(1000);
  cb.canRequest();
  cb.onFailure();
  assert.equal(cb.state(), "open");
  // still open right after re-opening
  clock.advance(500);
  assert.equal(cb.state(), "open");
  clock.advance(500);
  assert.equal(cb.state(), "half_open");
});
