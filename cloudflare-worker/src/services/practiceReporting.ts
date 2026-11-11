/**
 * D4704 (#4704, Practice audit 6/6) — the ONE definition of an advisor's money
 * report. The earnings overview (`GET /me/earnings`), the ledger and its export
 * (`GET /me/ledger`) and the annual summary (`GET /me/tax-summary`) all read
 * `ledgerAggregate`, so no overview/detail/export pair can use different
 * definitions for the same figure.
 *
 * THE POPULATION. Every booking of the advisor created in the half-open window
 * `[from, until)` (absent bounds = unbounded), except a cancelled or missed
 * session that was never collected: it owes nothing, is in no total, and is
 * counted apart (`voidSessions`). Counted in the database: no row cap applies to
 * any total.
 *
 * THE STATE OF A LINE. Derived from the amount first, then the stored state:
 *   unpriced     `amount_cents IS NULL` (no figure, so no gross and no cut)
 *   collected    priced and `billing_state = 'collected'`
 *   written_off  priced and `billing_state = 'written_off'`
 *   billed       any other priced line (including one whose stored state still
 *                says 'unpriced': it has a price, so it is owed)
 * Before D4704 the earnings overview grouped by the stored `billing_state`, so
 * a priced line stored as 'unpriced' was "unpriced" there and "billed" in the
 * ledger beside it.
 *
 * THE CUT. A line's cut is the cut stamped when it was priced; only a line
 * priced before 241 (no stored cut) is derived, at its stored rate or the
 * fallback, rounded down, as `cutCents` does.
 *
 * `clients` is the top `LEDGER_CLIENT_CAP` by gross; `other` sums everyone past
 * it, so the listed rows plus `other` always reconcile to the totals.
 *
 * Moved here unchanged from `routes/advisors_money.ts` (#4702, D4702), which
 * re-exports it.
 */
import type { Env } from '../types';

/** The client rows a ledger lists one by one; the rest are summed into `clients_other`. */
export const LEDGER_CLIENT_CAP = 500;

/**
 * #4702 (D4702): the one definition of an advisor's money over a window, shared
 * by `GET /me/ledger` and `GET /me/tax-summary` so the table, the export and the
 * annual summary cannot disagree.
 *
 *   · the population is every booking created in the half-open window
 *     `[from, until)` (absent bounds = unbounded), counted in the database; there
 *     is no row cap on the totals;
 *   · a line's cut is the cut it was STAMPED with when it was priced; only a line
 *     priced before 241 (no stored cut) is derived, at its stored rate or the
 *     fallback, rounded down, the same rule `cutCents` uses;
 *   · an unpriced booking has no gross and no cut and is counted apart.
 *
 * `clients` is the top `LEDGER_CLIENT_CAP` by gross; `other` sums everyone past
 * it, so the listed rows plus `other` always reconcile to the totals.
 */
export type LedgerLine = { sessions: number; gross_cents: number; cut_cents: number; unpriced: number };
export async function ledgerAggregate(env: Env, advisorId: number, from: string | null, until: string | null, fallbackBps: number) {
  const t = await env.DB.prepare(
    `SELECT COUNT(*) AS sessions,
            COALESCE(SUM(CASE WHEN b.amount_cents IS NULL THEN 1 ELSE 0 END), 0) AS unpriced,
            COALESCE(SUM(b.amount_cents), 0) AS gross,
            COALESCE(SUM(CASE WHEN b.amount_cents IS NULL THEN 0
                              WHEN b.platform_cut_cents IS NOT NULL THEN b.platform_cut_cents
                              ELSE CAST((b.amount_cents * COALESCE(b.take_rate_bps, ?)) / 10000 AS INTEGER) END), 0) AS cut,
            COUNT(DISTINCT b.founder_user_id) AS clients,
            COUNT(DISTINCT CASE WHEN b.amount_cents IS NOT NULL THEN b.founder_user_id END)
              + COALESCE(MAX(CASE WHEN b.amount_cents IS NOT NULL AND b.founder_user_id IS NULL THEN 1 ELSE 0 END), 0) AS priced_clients
       FROM advisor_bookings b
      WHERE b.advisor_id = ?
        AND (? IS NULL OR datetime(b.created_at) >= datetime(?))
        AND (? IS NULL OR datetime(b.created_at) < datetime(?))
        AND NOT (b.status IN ('cancelled', 'no_show') AND COALESCE(b.billing_state, '') != 'collected')`
  ).bind(fallbackBps, advisorId, from, from, until, until).first<{ sessions: number; unpriced: number; gross: number; cut: number; clients: number; priced_clients: number }>();
  const rows = (await env.DB.prepare(
    `SELECT b.founder_user_id AS client_user_id, MAX(u.name) AS client_name,
            COUNT(*) AS sessions,
            COALESCE(SUM(CASE WHEN b.amount_cents IS NULL THEN 1 ELSE 0 END), 0) AS unpriced,
            COALESCE(SUM(b.amount_cents), 0) AS gross,
            COALESCE(SUM(CASE WHEN b.amount_cents IS NULL THEN 0
                              WHEN b.platform_cut_cents IS NOT NULL THEN b.platform_cut_cents
                              ELSE CAST((b.amount_cents * COALESCE(b.take_rate_bps, ?)) / 10000 AS INTEGER) END), 0) AS cut
       FROM advisor_bookings b
       LEFT JOIN users u ON u.id = b.founder_user_id
      WHERE b.advisor_id = ?
        AND (? IS NULL OR datetime(b.created_at) >= datetime(?))
        AND (? IS NULL OR datetime(b.created_at) < datetime(?))
        AND NOT (b.status IN ('cancelled', 'no_show') AND COALESCE(b.billing_state, '') != 'collected')
      GROUP BY b.founder_user_id
      ORDER BY gross DESC, sessions DESC, b.founder_user_id
      LIMIT ?`
  ).bind(fallbackBps, advisorId, from, from, until, until, LEDGER_CLIENT_CAP + 1).all<any>()).results || [];
  // #4679: what happened to the money, one database total per billing state over
  // the same population as `t`, so the states add up to the totals.
  const st = (await env.DB.prepare(
    `SELECT CASE WHEN b.amount_cents IS NULL THEN 'unpriced'
                 WHEN b.billing_state = 'collected' THEN 'collected'
                 WHEN b.billing_state = 'written_off' THEN 'written_off'
                 ELSE 'billed' END AS state,
            COUNT(*) AS sessions,
            COALESCE(SUM(b.amount_cents), 0) AS gross,
            COALESCE(SUM(CASE WHEN b.amount_cents IS NULL THEN 0
                              WHEN b.platform_cut_cents IS NOT NULL THEN b.platform_cut_cents
                              ELSE CAST((b.amount_cents * COALESCE(b.take_rate_bps, ?)) / 10000 AS INTEGER) END), 0) AS cut
       FROM advisor_bookings b
      WHERE b.advisor_id = ?
        AND (? IS NULL OR datetime(b.created_at) >= datetime(?))
        AND (? IS NULL OR datetime(b.created_at) < datetime(?))
        AND NOT (b.status IN ('cancelled', 'no_show') AND COALESCE(b.billing_state, '') != 'collected')
      GROUP BY state`
  ).bind(fallbackBps, advisorId, from, from, until, until).all<{ state: string; sessions: number; gross: number; cut: number }>()).results || [];
  const stateOf = (k: string) => {
    const r = st.find((x) => x.state === k);
    const g = Number(r?.gross ?? 0); const cu = Number(r?.cut ?? 0);
    return { sessions: Number(r?.sessions ?? 0), gross_cents: g, cut_cents: cu, net_cents: g - cu };
  };
  // A cancelled or missed session that was never collected owes nothing: it is
  // in no total above and is counted here on its own.
  const v = await env.DB.prepare(
    `SELECT COUNT(*) AS n
       FROM advisor_bookings b
      WHERE b.advisor_id = ?
        AND (? IS NULL OR datetime(b.created_at) >= datetime(?))
        AND (? IS NULL OR datetime(b.created_at) < datetime(?))
        AND b.status IN ('cancelled', 'no_show') AND COALESCE(b.billing_state, '') != 'collected'`
  ).bind(advisorId, from, from, until, until).first<{ n: number }>();
  const sessions = Number(t?.sessions ?? 0);
  const gross = Number(t?.gross ?? 0);
  const cut = Number(t?.cut ?? 0);
  const unpriced = Number(t?.unpriced ?? 0);
  // A "client" row counts the NULL-user group too, and `COUNT(DISTINCT)` does not
  // count NULL, so the total is the larger of it and the rows actually returned.
  const listedRows = rows.slice(0, LEDGER_CLIENT_CAP);
  const clientsTotal = Math.max(Number(t?.clients ?? 0) + (rows.some((r: any) => r.client_user_id == null) ? 1 : 0), rows.length);
  const clients = listedRows.map((r: any) => ({
    client_user_id: r.client_user_id == null ? null : Number(r.client_user_id),
    client_name: r.client_name ?? null,
    sessions: Number(r.sessions), gross_cents: Number(r.gross), cut_cents: Number(r.cut), unpriced: Number(r.unpriced),
  }));
  const listed = clients.reduce((a, r) => ({
    sessions: a.sessions + r.sessions, gross_cents: a.gross_cents + r.gross_cents,
    cut_cents: a.cut_cents + r.cut_cents, unpriced: a.unpriced + r.unpriced,
  }), { sessions: 0, gross_cents: 0, cut_cents: 0, unpriced: 0 } as LedgerLine);
  const overflow = rows.length > LEDGER_CLIENT_CAP;
  return {
    totals: { sessions, unpriced, priced: sessions - unpriced, gross_cents: gross, cut_cents: cut, net_cents: gross - cut },
    pricedClients: Number(t?.priced_clients ?? 0),
    states: {
      billed: stateOf('billed'), collected: stateOf('collected'), written_off: stateOf('written_off'),
      unpriced: Number(st.find((x) => x.state === 'unpriced')?.sessions ?? 0),
    },
    voidSessions: Number(v?.n ?? 0),
    clients,
    clientsTotal,
    // Everyone past the cap, as one line; null when every client is listed.
    other: overflow ? {
      clients: Math.max(0, clientsTotal - clients.length),
      sessions: sessions - listed.sessions, gross_cents: gross - listed.gross_cents,
      cut_cents: cut - listed.cut_cents, net_cents: (gross - listed.gross_cents) - (cut - listed.cut_cents),
      unpriced_sessions: unpriced - listed.unpriced,
    } : null,
  };
}

export type LedgerAggregate = Awaited<ReturnType<typeof ledgerAggregate>>;

/** The billing states the earnings overview lists, in its order. */
export const EARNINGS_STATES = ['unpriced', 'billed', 'collected', 'written_off'] as const;

/**
 * The earnings overview's figures, read from the same aggregate as the ledger
 * (all time). `outstanding` is what is billed and not yet collected.
 */
export function earningsOf(agg: LedgerAggregate) {
  const s = agg.states;
  return {
    billed_cents: s.billed.gross_cents,
    collected_cents: s.collected.gross_cents,
    written_off_cents: s.written_off.gross_cents,
    outstanding_cents: s.billed.gross_cents,
    unpriced_count: s.unpriced,
    by_state: EARNINGS_STATES.map((state) => state === 'unpriced'
      ? { state, bookings: s.unpriced, total_cents: 0 }
      : { state, bookings: s[state].sessions, total_cents: s[state].gross_cents }),
    // D4704: what the figures cover, so a reader never has to guess.
    population: {
      definition: 'practice_money_v1',
      period: { from: null, until: null },
      sessions: agg.totals.sessions,
      excluded_void_sessions: agg.voidSessions,
      complete: true,
    },
  };
}
