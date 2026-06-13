import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetGuard } from "../dist/budget.js";
import { makeClock } from "./helpers.js";

test("per-request cap blocks oversized single calls", () => {
  const b = new BudgetGuard({ perRequestUsd: 0.1 });
  assert.equal(b.canAfford(0.05), true);
  assert.equal(b.canAfford(0.2), false);
});

test("daily budget depletes and blocks further spend", () => {
  const clock = makeClock();
  const b = new BudgetGuard({ dailyUsd: 1, now: clock.now });
  assert.equal(b.remaining(), 1);
  b.record(0.6);
  assert.equal(Number(b.remaining().toFixed(4)), 0.4);
  assert.equal(b.canAfford(0.5), false);
  assert.equal(b.canAfford(0.4), true);
});

test("rolling daily window frees budget after 24h", () => {
  const clock = makeClock();
  const b = new BudgetGuard({ dailyUsd: 1, now: clock.now });
  b.record(1);
  assert.equal(b.canAfford(0.1), false);
  clock.advance(24 * 60 * 60 * 1000 + 1);
  assert.equal(b.remaining(), 1);
  assert.equal(b.canAfford(1), true);
});

test("no configured budget means unlimited", () => {
  const b = new BudgetGuard();
  assert.equal(b.active(), false);
  assert.equal(b.remaining(), Infinity);
  assert.equal(b.canAfford(999), true);
});
