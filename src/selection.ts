/**
 * Selection strategies. A strategy takes the list of viable candidates and
 * returns them in the order the router should *try* them — element 0 is the
 * primary, the rest are the failover chain. Strategies never call providers and
 * never mutate state, which makes routing decisions easy to reason about, test,
 * and dry-run.
 */

import type { CompletionRequest, RouteTarget } from "./types.js";
import type { ProviderHealth } from "./health.js";

export interface Candidate {
  target: RouteTarget;
  name: string;
  model: string;
  health: ProviderHealth;
  /** Pre-call cost estimate in USD (0 if model price unknown). */
  estCostUsd: number;
}

export interface Strategy {
  readonly name: string;
  order(candidates: Candidate[], req: CompletionRequest): Candidate[];
}

export type StrategyName = "priority" | "latency" | "cost" | "weighted" | "balanced";

function priorityOf(t: RouteTarget): number {
  return t.priority ?? Number.MAX_SAFE_INTEGER;
}

function cmpBy(...keys: ((c: Candidate) => number)[]): (a: Candidate, b: Candidate) => number {
  return (a, b) => {
    for (const k of keys) {
      const d = k(a) - k(b);
      if (d !== 0) return d;
    }
    return 0;
  };
}

/** Follow the configured priority order; health/latency break ties. */
export const priorityStrategy: Strategy = {
  name: "priority",
  order(cands) {
    return [...cands].sort(
      cmpBy(
        (c) => priorityOf(c.target),
        (c) => -c.health.score(),
        (c) => c.health.latencyMs(),
      ),
    );
  },
};

/** Fastest provider first (by EWMA latency), score as tiebreak. */
export const latencyStrategy: Strategy = {
  name: "latency",
  order(cands) {
    return [...cands].sort(cmpBy((c) => c.health.latencyMs(), (c) => -c.health.score()));
  },
};

/** Cheapest estimated cost first; priority as tiebreak. */
export const costStrategy: Strategy = {
  name: "cost",
  order(cands) {
    return [...cands].sort(cmpBy((c) => c.estCostUsd, (c) => priorityOf(c.target)));
  },
};

/**
 * Composite of availability score and latency. The pragmatic default: prefer
 * healthy and fast, fall back gracefully, respect priority only as a tiebreak.
 */
export const balancedStrategy: Strategy = {
  name: "balanced",
  order(cands) {
    const composite = (c: Candidate) => c.health.score() - c.health.latencyMs() / 100;
    return [...cands].sort(cmpBy((c) => -composite(c), (c) => priorityOf(c.target)));
  },
};

/**
 * Weighted traffic split. The primary pick is weighted-random by `weight`; the
 * remaining providers form the fallback chain, also weighted. This powers
 * canary deploys and A/B experiments (e.g. 50/30/20). Pass a seeded `rng` for
 * deterministic tests.
 */
export function weightedStrategy(rng: () => number = Math.random): Strategy {
  return {
    name: "weighted",
    order(cands) {
      const ordered: Candidate[] = [];
      const pool = [...cands];
      while (pool.length > 0) {
        const total = pool.reduce((s, c) => s + Math.max(0, c.target.weight ?? 1), 0);
        if (total <= 0) {
          ordered.push(...pool);
          break;
        }
        let r = rng() * total;
        let idx = 0;
        for (let i = 0; i < pool.length; i++) {
          r -= Math.max(0, pool[i]!.target.weight ?? 1);
          if (r <= 0) {
            idx = i;
            break;
          }
        }
        ordered.push(pool.splice(idx, 1)[0]!);
      }
      return ordered;
    },
  };
}

export function resolveStrategy(s: StrategyName | Strategy | undefined, rng?: () => number): Strategy {
  if (s === undefined) return balancedStrategy;
  if (typeof s !== "string") return s;
  switch (s) {
    case "priority":
      return priorityStrategy;
    case "latency":
      return latencyStrategy;
    case "cost":
      return costStrategy;
    case "weighted":
      return weightedStrategy(rng);
    case "balanced":
      return balancedStrategy;
  }
}
