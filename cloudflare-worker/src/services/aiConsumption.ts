/**
 * D776 (#2093) — a member's own AI consumption, where it was spent: their runs
 * this month grouped by the AI rail's page, by option within a page, or by
 * record, with what they were charged and how much of it came from the
 * allowance and how much from tokens.
 *
 * WHAT IS SUMMED. Every `ai_usage_logs` row of the member in the month:
 *   - `charged_microusd` (D762), which each row records for its own share, a
 *     Llama Guard row (D763, `guard_for` set) included. A NULL charge (a row
 *     from before migration 493, or a run held for a D640 review) is never a
 *     zero: it is counted in `not_recorded`, and a group whose every row is
 *     NULL reads `charged_microusd: null`.
 *   - the split comes from the hold that paid: `ai_budget_reservations`'
 *     `actual_included_microusd` (the allowance) and `actual_topup_microusd`
 *     (tokens), read once per hold through the run's own row
 *     (`guard_for IS NULL`): its guard rows share the hold and the page, so
 *     joining them too would count the hold twice. A hold still pending or in
 *     review has no split yet (migration 419 keeps its actual amounts NULL
 *     until it settles) and adds nothing to either.
 *   - `runs` counts the runs, not their guard checks.
 *
 * Only `user_id = ?` rows are read, joined to the member's own holds; no other
 * member's row can reach a group. A page, option or record a run did not
 * record is `null`, which the page shows as "Not recorded".
 */
import type { Env } from '../types';

export type ConsumptionGroup = 'page' | 'option' | 'record';
export const CONSUMPTION_GROUPS: readonly ConsumptionGroup[] = ['page', 'option', 'record'];
/** At most this many groups come back, the largest charges first; `truncated` says when there were more. */
export const MAX_CONSUMPTION_ROWS = 200;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** `YYYY-MM` for a date, in UTC, as the allowance's month is. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The month's bounds as `created_at` compares them (`YYYY-MM-DD HH:MM:SS`, UTC), or null for a malformed month. */
export function monthBounds(month: string): { from: string; to: string } | null {
  const m = MONTH_RE.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (y < 2020 || y > 2100) return null;
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  return { from: `${month}-01 00:00:00`, to: `${next}-01 00:00:00` };
}

export interface ConsumptionRow {
  page: string | null;
  option?: string | null;
  record?: string | null;
  runs: number;
  charged_microusd: number | null;
  allowance_microusd: number;
  tokens_microusd: number;
  not_recorded: number;
}

export interface ConsumptionTotals {
  runs: number;
  charged_microusd: number | null;
  allowance_microusd: number;
  tokens_microusd: number;
  not_recorded: number;
}

const SECOND: Record<ConsumptionGroup, string | null> = { page: null, option: 'rail_option', record: 'record_ref' };

const SUMS = `SUM(CASE WHEN l.guard_for IS NULL THEN 1 ELSE 0 END) AS runs,
       COUNT(l.charged_microusd) AS recorded,
       SUM(CASE WHEN l.charged_microusd IS NULL THEN 1 ELSE 0 END) AS not_recorded,
       COALESCE(SUM(l.charged_microusd), 0) AS charged_microusd,
       COALESCE(SUM(CASE WHEN l.guard_for IS NULL THEN r.actual_included_microusd END), 0) AS allowance_microusd,
       COALESCE(SUM(CASE WHEN l.guard_for IS NULL THEN r.actual_topup_microusd END), 0) AS tokens_microusd`;

const FROM = `FROM ai_usage_logs l
  LEFT JOIN ai_budget_reservations r ON r.uid = l.reservation_uid AND r.user_id = l.user_id
 WHERE l.user_id = ? AND l.created_at >= ? AND l.created_at < ?`;

type SumRow = { runs: number | null; recorded: number; not_recorded: number | null; charged_microusd: number; allowance_microusd: number; tokens_microusd: number };

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function sums(row: SumRow): Omit<ConsumptionTotals, never> {
  return {
    runs: n(row.runs),
    charged_microusd: n(row.recorded) > 0 ? n(row.charged_microusd) : null,
    allowance_microusd: n(row.allowance_microusd),
    tokens_microusd: n(row.tokens_microusd),
    not_recorded: n(row.not_recorded),
  };
}

/** The member's own runs in `month`, grouped. Throws when a table cannot be read; the route answers that as Unreadable. */
export async function memberConsumption(env: Env, userId: number, group: ConsumptionGroup, month: string) {
  const bounds = monthBounds(month);
  if (!bounds) throw new RangeError('month');
  const second = SECOND[group];
  const cols = second ? `l.rail_page AS page, l.${second} AS second` : 'l.rail_page AS page';
  const by = second ? `l.rail_page, l.${second}` : 'l.rail_page';
  const binds = [userId, bounds.from, bounds.to];
  const [grouped, total] = await Promise.all([
    env.DB.prepare(`SELECT ${cols}, ${SUMS} ${FROM} GROUP BY ${by} ORDER BY charged_microusd DESC, runs DESC LIMIT ?`)
      .bind(...binds, MAX_CONSUMPTION_ROWS + 1).all<SumRow & { page: string | null; second?: string | null }>(),
    env.DB.prepare(`SELECT ${SUMS} ${FROM}`).bind(...binds).first<SumRow>(),
  ]);
  const all = grouped.results ?? [];
  const rows: ConsumptionRow[] = all.slice(0, MAX_CONSUMPTION_ROWS).map((r) => ({
    page: r.page ?? null,
    ...(group === 'option' ? { option: r.second ?? null } : {}),
    ...(group === 'record' ? { record: r.second ?? null } : {}),
    ...sums(r),
  }));
  return {
    group,
    month,
    rows,
    truncated: all.length > MAX_CONSUMPTION_ROWS,
    totals: total ? sums(total) : { runs: 0, charged_microusd: null, allowance_microusd: 0, tokens_microusd: 0, not_recorded: 0 },
  };
}
