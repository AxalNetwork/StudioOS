/**
 * D481 — token anomalies, from `ai_usage_logs` and nothing else.
 *
 * WHAT IT WAS. The one clause of D152's three-clause refusal that survived:
 * "Nothing watches per-account token consumption for a spike." True, and it
 * stayed true because nothing computed one — every figure it needs has been
 * in `ai_usage_logs` since migration 040 (`user_id`, `prompt_tokens`,
 * `completion_tokens`, `created_at`, one row per router call).
 *
 * WHAT COUNTS AS AN ANOMALY, and it is a judgement stated here and on the
 * card, not a measured threshold: an account whose last 24 hours used at
 * least TOKEN_ANOMALY_MULTIPLE times its own average day over the seven days
 * before, AND at least TOKEN_ANOMALY_FLOOR tokens — so a near-idle account
 * going from 200 tokens to 900 is not paged as a spike.
 *
 * AN ACCOUNT WITH NO BASELINE IS NOT AN ANOMALY AND IS NOT DROPPED. Heavy use
 * from an account with no usage in the seven days before has no "usual" to be
 * a multiple of; it is counted apart as `no_baseline`, because folding it in
 * would page every new account and leaving it out would hide the exact case
 * a stolen dormant account produces.
 *
 * CACHE HITS ARE LEFT OUT. A cached answer spends no tokens; counting its
 * recorded figures would make a page of cache hits look like consumption.
 *
 * READ DIRECTLY, NOT THROUGH `services/aiSpend.ts` — that module is another
 * slot's (S12), and the spend caps it enforces are a different fact: a cap
 * reached is a limit, recorded as a refusal, not an anomaly detected.
 *
 * Unreadable is its own state with its reason and NO count. A zero here would
 * claim nothing spiked; a failed read has not looked.
 */
import type { Env } from '../types';

export const TOKEN_ANOMALY_MULTIPLE = 4;
export const TOKEN_ANOMALY_FLOOR = 20000;
export const TOKEN_ANOMALY_BASELINE_DAYS = 7;
/** How many flagged accounts the card names; the count covers all of them. */
export const TOKEN_ANOMALY_LIST = 10;

export type TokenAnomalyRow = {
  user_id: number;
  email: string | null;
  name: string | null;
  tokens_24h: number;
  daily_avg_baseline: number;
  ratio: number;
};

export type TokenAnomalies =
  | {
    available: true;
    window_hours: 24;
    baseline_days: number;
    multiple: number;
    floor_tokens: number;
    accounts_checked: number;
    count: number;
    no_baseline: number;
    rows: TokenAnomalyRow[];
    how: string;
  }
  | { available: false; reason: string };

export const TOKEN_ANOMALY_HOW =
  `An account is flagged when its last 24 hours used at least ${TOKEN_ANOMALY_MULTIPLE}× its own average day `
  + `over the ${TOKEN_ANOMALY_BASELINE_DAYS} days before, and at least ${TOKEN_ANOMALY_FLOOR.toLocaleString('en')} `
  + 'tokens. Read from ai_usage_logs, cache hits left out. The threshold is a judgement, not a measured limit; '
  + 'nothing pages anyone when it trips.';

export async function loadTokenAnomalies(env: Env): Promise<TokenAnomalies> {
  let rows: Array<{ user_id: number; email: string | null; name: string | null; last_day: number; baseline: number }>;
  try {
    const res = await env.DB.prepare(
      `SELECT l.user_id,
              MAX(u.email) AS email, MAX(u.name) AS name,
              SUM(CASE WHEN l.created_at >= datetime('now', '-1 day')
                       THEN l.prompt_tokens + l.completion_tokens ELSE 0 END) AS last_day,
              SUM(CASE WHEN l.created_at < datetime('now', '-1 day')
                       THEN l.prompt_tokens + l.completion_tokens ELSE 0 END) AS baseline
         FROM ai_usage_logs l
         LEFT JOIN users u ON u.id = l.user_id
        WHERE l.user_id IS NOT NULL
          AND l.cached = 0
          AND l.created_at >= datetime('now', ?)
        GROUP BY l.user_id`,
    ).bind(`-${TOKEN_ANOMALY_BASELINE_DAYS + 1} days`).all<{
      user_id: number; email: string | null; name: string | null; last_day: number; baseline: number;
    }>();
    rows = res.results || [];
  } catch {
    return {
      available: false,
      reason: 'ai_usage_logs could not be read on this database, so no account was checked. This is not a '
        + 'claim that nothing spiked.',
    };
  }

  const flagged: TokenAnomalyRow[] = [];
  let noBaseline = 0;
  for (const r of rows) {
    const lastDay = Number(r.last_day) || 0;
    const baseline = Number(r.baseline) || 0;
    if (lastDay < TOKEN_ANOMALY_FLOOR) continue;
    if (baseline <= 0) { noBaseline += 1; continue; }
    const avg = baseline / TOKEN_ANOMALY_BASELINE_DAYS;
    if (lastDay >= TOKEN_ANOMALY_MULTIPLE * avg) {
      flagged.push({
        user_id: Number(r.user_id),
        email: r.email ?? null,
        name: r.name ?? null,
        tokens_24h: lastDay,
        daily_avg_baseline: Math.round(avg),
        ratio: Math.round((lastDay / avg) * 10) / 10,
      });
    }
  }
  flagged.sort((a, b) => b.ratio - a.ratio || b.tokens_24h - a.tokens_24h);

  return {
    available: true,
    window_hours: 24,
    baseline_days: TOKEN_ANOMALY_BASELINE_DAYS,
    multiple: TOKEN_ANOMALY_MULTIPLE,
    floor_tokens: TOKEN_ANOMALY_FLOOR,
    accounts_checked: rows.length,
    count: flagged.length,
    no_baseline: noBaseline,
    rows: flagged.slice(0, TOKEN_ANOMALY_LIST),
    how: TOKEN_ANOMALY_HOW,
  };
}
