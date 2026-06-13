/**
 * Cost budgets. Tracks rolling spend over a day and a month plus an optional
 * hard per-request ceiling. The router consults `remaining()` before each call
 * and records actual spend after, so a runaway loop can't blow past the cap.
 */

export interface BudgetOptions {
  /** Max USD per single request (across all attempts). */
  perRequestUsd?: number;
  /** Rolling 24h budget in USD. */
  dailyUsd?: number;
  /** Rolling 30d budget in USD. */
  monthlyUsd?: number;
  now?: () => number;
}

interface Spend {
  t: number;
  usd: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

export class BudgetGuard {
  private readonly opt: BudgetOptions;
  private readonly now: () => number;
  private spends: Spend[] = [];

  constructor(opt: BudgetOptions = {}) {
    this.opt = opt;
    this.now = opt.now ?? Date.now;
  }

  /** Is any budget configured at all? */
  active(): boolean {
    return (
      this.opt.perRequestUsd !== undefined ||
      this.opt.dailyUsd !== undefined ||
      this.opt.monthlyUsd !== undefined
    );
  }

  spentSince(ms: number): number {
    const cutoff = this.now() - ms;
    let total = 0;
    for (const s of this.spends) if (s.t >= cutoff) total += s.usd;
    return total;
  }

  spentToday(): number {
    return this.spentSince(DAY_MS);
  }

  spentThisMonth(): number {
    return this.spentSince(MONTH_MS);
  }

  /**
   * Max additional USD that may be spent right now, considering daily/monthly
   * windows. `Infinity` if no day/month budget is set.
   */
  remaining(): number {
    let r = Infinity;
    if (this.opt.dailyUsd !== undefined) r = Math.min(r, this.opt.dailyUsd - this.spentToday());
    if (this.opt.monthlyUsd !== undefined)
      r = Math.min(r, this.opt.monthlyUsd - this.spentThisMonth());
    return r;
  }

  /** Can a single attempt estimated at `estUsd` be afforded under all limits? */
  canAfford(estUsd: number): boolean {
    if (this.opt.perRequestUsd !== undefined && estUsd > this.opt.perRequestUsd) return false;
    return estUsd <= this.remaining();
  }

  record(usd: number): void {
    if (usd > 0) this.spends.push({ t: this.now(), usd });
    this.prune();
  }

  private prune(): void {
    const cutoff = this.now() - MONTH_MS;
    let i = 0;
    while (i < this.spends.length && this.spends[i]!.t < cutoff) i += 1;
    if (i > 0) this.spends.splice(0, i);
  }
}
