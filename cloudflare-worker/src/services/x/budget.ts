/**
 * D8815 (#8815, part 3a of #2403) — the per-founder monthly X read budget (owner decision 2: the founders app has
 * its own spend cap at X, and StudioOS caps each founder below it).
 *
 * COUNTED IN WHAT X BILLS FOR. Pay-per-use bills each resource a read returns: one user for `users/me`, one post per
 * post a timeline page returns (#2403, Access plans and prices; UNVERIFIED until the owner's first live sync). The
 * budget is `X_FOUNDER_MONTHLY_READS` resources per founder per UTC month, in `x_founder_usage`.
 *
 * RESERVED BEFORE THE CALL. `reserve` takes up to `want` from what is left, atomically (a compare-and-set on the
 * month's row), before the billed call is sent; nothing left is 0 and the caller refuses
 * `x_monthly_cap_reached` without calling X. `refund` gives back what the call did not use: the posts a page did not
 * return, or everything when the call failed.
 *
 * Per founder, not per connection: disconnecting deletes the Grow facts, never this row, so reconnecting does not
 * reset a spent month.
 */
import type { Env } from '../../types';

/** Resources a founder may read from X in one UTC month: about five full syncs of the newest 200 posts. */
export const X_FOUNDER_MONTHLY_READS = 1000;

/** The UTC month a read is counted in, `YYYY-MM`. */
export const usagePeriod = (now = new Date()) => now.toISOString().slice(0, 7);

export interface XBudget {
  /** Take up to `want` resources, at least `min`; the number taken, or 0 when fewer than `min` are left. */
  reserve(want: number, min?: number): Promise<number>;
  /** Give back `n` resources a call did not use. */
  refund(n: number): Promise<void>;
}

/** What the founder has used this month, and what is left. */
export async function budgetLeft(env: Env, userId: number, period = usagePeriod()): Promise<{ used: number; left: number; cap: number; recorded: boolean }> {
  const row = await env.DB.prepare('SELECT reads FROM x_founder_usage WHERE user_id = ? AND period = ?').bind(userId, period).first<{ reads: number }>();
  const used = Number(row?.reads ?? 0);
  return { used, left: Math.max(0, X_FOUNDER_MONTHLY_READS - used), cap: X_FOUNDER_MONTHLY_READS, recorded: !!row };
}

export function founderBudget(env: Env, userId: number, period = usagePeriod()): XBudget {
  return {
    async reserve(want, min = 1) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const { used, left, recorded } = await budgetLeft(env, userId, period);
        if (left < Math.max(1, min)) return 0;
        const take = Math.min(want, left);
        // The row is created at its first reservation; a concurrent first one loses the insert and retries.
        const r = !recorded
          ? await env.DB.prepare('INSERT INTO x_founder_usage (user_id, period, reads) VALUES (?, ?, ?) ON CONFLICT(user_id, period) DO NOTHING')
            .bind(userId, period, take).run()
          : await env.DB.prepare("UPDATE x_founder_usage SET reads = ?, updated_at = datetime('now') WHERE user_id = ? AND period = ? AND reads = ?")
            .bind(used + take, userId, period, used).run();
        if (Number(r.meta?.changes ?? 0) === 1) return take;
      }
      // Lost every race: refuse rather than call X without a reservation.
      return 0;
    },
    async refund(n) {
      if (!(n > 0)) return;
      await env.DB.prepare("UPDATE x_founder_usage SET reads = MAX(0, reads - ?), updated_at = datetime('now') WHERE user_id = ? AND period = ?")
        .bind(n, userId, period).run();
    },
  };
}
