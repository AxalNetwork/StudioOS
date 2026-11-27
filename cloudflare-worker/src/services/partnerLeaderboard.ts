/**
 * D572 part 3b (#1183) — the partner leaderboard by metric and period, and the
 * change against an earlier standing.
 *
 * Before this, `/partnernet/leaderboard*` ranked by network score only, with
 * no period and no history, and the page drew Introductions, Referrals,
 * Commissions, "This period" and "Change" as stated absences.
 *
 * THE METRICS, each a count, never an amount:
 *   score        `users.network_score`, the platform's composite. It is a
 *                standing, not a tally, so it has no period: only 'all'.
 *   referrals    the referrals a member made (`referrals.referrer_id`),
 *                counted by when they were made.
 *   commissions  the commissions a member earned (`commissions.user_id`),
 *                counted by when they were earned, reversed ones left out.
 *                A count and not a sum: commissions are held in more than one
 *                currency (D572), and a sum would add euros to dollars and
 *                publish what each member earned.
 * Introductions stay a stated absence: no store records an introduction a
 * member made.
 *
 * THE PERIODS: 'all', or 'quarter', the current calendar quarter in UTC
 * ('2026-Q4').
 *
 * WHO IS RANKED: every member with a value above zero, except one who chose
 * not to appear in the directory (`user_settings.show_in_directory = 0`), as
 * the public board already did. Equal values share a rank, and the next rank
 * skips (1, 2, 2, 4).
 *
 * THE CHANGE is against the most recent stored standing at least
 * `CHANGE_DAYS` old for the same metric and period (`partner_leaderboard_
 * snapshots`, migration 409, written daily by `writeLeaderboardSnapshots`).
 * Positive means moved up. A member not ranked then is "new". With no
 * standing that old, the change is withheld with the reason. A quarter's
 * board compares only within its quarter, so its first week has none.
 */
import type { Env } from '../types';

export const LEADERBOARD_METRICS = ['score', 'referrals', 'commissions'] as const;
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number];
export const LEADERBOARD_PERIODS = ['all', 'quarter'] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

/** The metrics each period can rank. The score is a standing, so it has no quarter. */
export const PERIODS_FOR: Record<LeaderboardMetric, readonly LeaderboardPeriod[]> = {
  score: ['all'],
  referrals: ['all', 'quarter'],
  commissions: ['all', 'quarter'],
};

/** How old a stored standing must be to compare with: a week. */
export const CHANGE_DAYS = 7;
/** How many rows the board lists. The viewer's own standing is given wherever it falls. */
export const BOARD_LIMIT = 25;

const DAY_MS = 86_400_000;
export const dateKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** '2026-Q4', and the quarter's first instant, in UTC. */
export function quarterOf(ms: number): { key: string; startMs: number } {
  const d = new Date(ms);
  const q = Math.floor(d.getUTCMonth() / 3);
  return { key: `${d.getUTCFullYear()}-Q${q + 1}`, startMs: Date.UTC(d.getUTCFullYear(), q * 3, 1) };
}

export function periodKey(period: LeaderboardPeriod, ms: number): string {
  return period === 'all' ? 'all' : quarterOf(ms).key;
}

export type Ranked = { user_id: number; role: string | null; value: number; rank: number };

/** Rank values descending; equal values share a rank and the next one skips. Ties break by id for a stable order. Pure. */
export function rankRows(rows: Array<{ user_id: number; role: string | null; value: number }>): Ranked[] {
  const sorted = rows
    .filter((r) => Number(r.value) > 0)
    .map((r) => ({ ...r, value: Number(r.value) }))
    .sort((a, b) => b.value - a.value || a.user_id - b.user_id);
  const out: Ranked[] = [];
  sorted.forEach((r, i) => {
    const rank = i > 0 && r.value === sorted[i - 1].value ? out[i - 1].rank : i + 1;
    out.push({ ...r, rank });
  });
  return out;
}

// Visible: not opted out of the directory. A member with no settings row is
// visible, as on the public board. Written out in each query below, because a
// fragment interpolated into DB.prepare is text no binding protects.

/** The live values for one metric and period, ranked. Throws when a store cannot be read. */
export async function liveRanking(env: Env, metric: LeaderboardMetric, period: LeaderboardPeriod, nowMs: number): Promise<Ranked[]> {
  const since = period === 'quarter' ? new Date(quarterOf(nowMs).startMs).toISOString().replace('T', ' ').slice(0, 19) : '1970-01-01 00:00:00';
  let q;
  if (metric === 'score') {
    q = await env.DB.prepare(
      `SELECT u.id AS user_id, u.role, COALESCE(u.network_score, 0) AS value
         FROM users u LEFT JOIN user_settings us ON us.user_id = u.id
        WHERE COALESCE(u.network_score, 0) > 0 AND (us.show_in_directory IS NULL OR us.show_in_directory = 1)`,
    ).all<{ user_id: number; role: string | null; value: number }>();
  } else if (metric === 'referrals') {
    q = await env.DB.prepare(
      `SELECT u.id AS user_id, u.role, COUNT(r.id) AS value
         FROM referrals r JOIN users u ON u.id = r.referrer_id
         LEFT JOIN user_settings us ON us.user_id = u.id
        WHERE datetime(r.created_at) >= datetime(?) AND (us.show_in_directory IS NULL OR us.show_in_directory = 1)
        GROUP BY u.id, u.role`,
    ).bind(since).all<{ user_id: number; role: string | null; value: number }>();
  } else {
    q = await env.DB.prepare(
      `SELECT u.id AS user_id, u.role, COUNT(c.id) AS value
         FROM commissions c JOIN users u ON u.id = c.user_id
         LEFT JOIN user_settings us ON us.user_id = u.id
        WHERE c.status != 'reversed' AND datetime(c.created_at) >= datetime(?) AND (us.show_in_directory IS NULL OR us.show_in_directory = 1)
        GROUP BY u.id, u.role`,
    ).bind(since).all<{ user_id: number; role: string | null; value: number }>();
  }
  return rankRows((q.results || []).map((r) => ({ user_id: Number(r.user_id), role: r.role ?? null, value: Number(r.value) })));
}

/**
 * Write today's standings, every metric and period, once per day. Each board
 * is its own write, so one unreadable store costs only its own rows. Idempotent:
 * the primary key ignores a second write for the same day.
 */
export async function writeLeaderboardSnapshots(env: Env, nowMs: number = Date.now()): Promise<{ written: number; failed: string[] }> {
  const day = dateKey(nowMs);
  let written = 0;
  const failed: string[] = [];
  for (const metric of LEADERBOARD_METRICS) {
    for (const period of PERIODS_FOR[metric]) {
      try {
        const ranked = await liveRanking(env, metric, period, nowMs);
        const key = periodKey(period, nowMs);
        const stmts = ranked.map((r) => env.DB.prepare(
          `INSERT OR IGNORE INTO partner_leaderboard_snapshots (snapshot_date, metric, period_key, user_id, value, rank)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(day, metric, key, r.user_id, r.value, r.rank));
        for (let i = 0; i < stmts.length; i += 50) {
          const res = await env.DB.batch(stmts.slice(i, i + 50));
          written += res.reduce((n: number, x: any) => n + (Number(x?.meta?.changes) || 0), 0);
        }
      } catch (e) {
        failed.push(`${metric}/${period}: ${(e as Error)?.message || 'unknown'}`);
      }
    }
  }
  return { written, failed };
}

export type Comparison =
  | { available: true; date: string; ranks: Map<number, number> }
  | { available: false; reason: string; unreadable?: true };

/** The most recent stored standing at least `CHANGE_DAYS` old, for one board. */
export async function comparisonFor(
  env: Env, metric: LeaderboardMetric, period: LeaderboardPeriod, nowMs: number,
): Promise<Comparison> {
  const key = periodKey(period, nowMs);
  const cutoff = dateKey(nowMs - CHANGE_DAYS * DAY_MS);
  try {
    const at = await env.DB.prepare(
      `SELECT MAX(snapshot_date) AS d FROM partner_leaderboard_snapshots
        WHERE metric = ? AND period_key = ? AND snapshot_date <= ?`,
    ).bind(metric, key, cutoff).first<{ d: string | null }>();
    if (!at?.d) {
      return {
        available: false,
        reason: period === 'quarter'
          ? `No standing from at least ${CHANGE_DAYS} days ago is stored for ${key}, so there is nothing to compare with yet. Each quarter's board compares only within the quarter.`
          : `No standing from at least ${CHANGE_DAYS} days ago is stored yet, so there is nothing to compare with.`,
      };
    }
    const rows = await env.DB.prepare(
      `SELECT user_id, rank FROM partner_leaderboard_snapshots WHERE metric = ? AND period_key = ? AND snapshot_date = ?`,
    ).bind(metric, key, at.d).all<{ user_id: number; rank: number }>();
    return { available: true, date: at.d, ranks: new Map((rows.results || []).map((r) => [Number(r.user_id), Number(r.rank)])) };
  } catch (e) {
    return {
      available: false, unreadable: true,
      reason: `The earlier standings could not be read (migration 409): ${(e as Error)?.message || 'unknown'}.`,
    };
  }
}

/** A member's move against the comparison: positive is up, 'new' when not ranked then, null when there is nothing to compare. Pure. */
export function changeOf(userId: number, rank: number, cmp: Comparison): number | 'new' | null {
  if (!cmp.available) return null;
  const before = cmp.ranks.get(userId);
  return before === undefined ? 'new' : before - rank;
}
