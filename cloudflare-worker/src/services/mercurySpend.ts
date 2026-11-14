/**
 * D752 (#1889) section 5 — a founder's months, net burn, cash and runway from
 * their own Mercury lines. Pure: no SQL, no fetch, no Hono context, and nothing
 * from the personal bank code (its input types are its own), so the personal
 * guard's allowlists stay as they are. `routes/revenue.ts` reads the bank and
 * hands the lines here.
 *
 * A MONTH is the UTC calendar month of a line's posted date, else its created
 * date. Only posted, non-internal, non-voided lines are summed; pending,
 * failed and internal lines are counted, never summed. Money out is the
 * posted debits. Financing in is a credit from an Axal entity or a confirmed
 * raise receipt (#1887): it is never income and never lowers burn. Net burn is
 * money out minus operating money in. A month with no posted line has no
 * figures (`no_lines`), never zeros.
 */
import { runwayMonths } from './saasMetrics';

export interface SpendLine {
  transaction_id: string;
  amount_cents: number;
  posted_on: string | null;
  created_on: string | null;
  posted: boolean;
  internal: boolean;
  voided: boolean;
  counterparty_name: string | null;
  category: string | null;
  financing: boolean;
}

export interface SpendAccount { kind: string; available_cents: number | null }

export const SPEND_MONTHS_DEFAULT = 6;
export const SPEND_MONTHS_MAX = 12;
export const RUNWAY_FULL_MONTHS = 3;
export const TOP_COUNTERPARTIES = 5;
/** Every reader of `project_metrics`, told to the founder before a save (decision 8). */
export const SPEND_VISIBILITY = 'Saved figures are read wherever your metrics are read: by Axal\'s admins and partners, on your Grow and Raise pages, in the investor updates you send, and in the drafts you ask the assistant for.';

/** `?months=`: 1 to 12, default 6. Only one or two digits are read. */
export function spendMonths(raw: string | undefined | null): number | { error: 'invalid_months'; message: string } {
  if (raw === undefined || raw === null || raw === '') return SPEND_MONTHS_DEFAULT;
  const n = /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > SPEND_MONTHS_MAX) return { error: 'invalid_months', message: 'Choose 1 to 12 months.' };
  return n;
}

/** `YYYY-MM` moved by `n` months. */
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
}

const lastDayOf = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/**
 * The read: at least four calendar months, so the three full months runway
 * needs exist even when one to three are listed; it lists only `months`.
 */
export function spendWindow(months: number, today: string) {
  const current = today.slice(0, 7);
  const span = Math.max(months, RUNWAY_FULL_MONTHS + 1);
  const listed = Array.from({ length: months }, (_, i) => addMonths(current, i - months + 1));
  const runway = Array.from({ length: RUNWAY_FULL_MONTHS }, (_, i) => addMonths(current, i - RUNWAY_FULL_MONTHS));
  return {
    from: `${addMonths(current, -(span - 1))}-01`,
    to: today,
    current,
    listed,
    runwayMonths: runway,
    lastFullMonth: addMonths(current, -1),
  };
}

/** The last full month's first and last day. */
export function lastFullMonthWindow(today: string): { month: string; from: string; to: string } {
  const month = addMonths(today.slice(0, 7), -1);
  return { month, from: `${month}-01`, to: lastDayOf(month) };
}

export const monthOf = (l: Pick<SpendLine, 'posted_on' | 'created_on'>): string | null => (l.posted_on ?? l.created_on)?.slice(0, 7) ?? null;

export interface SpendMonth {
  month: string;
  partial: boolean;
  reason: 'no_lines' | null;
  operating_in_cents: number | null;
  financing_in_cents: number | null;
  out_cents: number | null;
  net_burn_cents: number | null;
  lines: { posted: number; pending: number; failed: number; internal: number };
  top_counterparties: Array<{ name: string | null; out_cents: number; lines: number }>;
  categories: Array<{ category: string; out_cents: number }> | null;
}

const groupKey = (name: string | null) => (name == null ? null : name.trim().replace(/\s+/g, ' ').toLowerCase() || null);

/** One row per month key; `partialMonth` (the current month) is marked partial. */
export function bucketMonths(lines: SpendLine[], monthKeys: string[], partialMonth: string | null = null): SpendMonth[] {
  return monthKeys.map((month) => {
    const mine = lines.filter((l) => monthOf(l) === month);
    const counts = { posted: 0, pending: 0, failed: 0, internal: 0 };
    let operating = 0, financing = 0, out = 0;
    const payees = new Map<string | null, { name: string | null; out_cents: number; lines: number }>();
    const cats = new Map<string, number>();
    let anyCategory = false;
    for (const l of mine) {
      if (l.category) anyCategory = true;
      if (l.voided) { counts.failed += 1; continue; }
      if (!l.posted) { counts.pending += 1; continue; }
      if (l.internal) { counts.internal += 1; continue; }
      counts.posted += 1;
      if (l.amount_cents > 0) {
        if (l.financing) financing += l.amount_cents;
        else operating += l.amount_cents;
      } else if (l.amount_cents < 0) {
        const spent = -l.amount_cents;
        out += spent;
        const key = groupKey(l.counterparty_name);
        const p = payees.get(key) ?? { name: key == null ? null : l.counterparty_name, out_cents: 0, lines: 0 };
        p.out_cents += spent;
        p.lines += 1;
        payees.set(key, p);
        if (l.category) cats.set(l.category, (cats.get(l.category) ?? 0) + spent);
      }
    }
    const none = counts.posted === 0;
    return {
      month,
      partial: month === partialMonth,
      reason: none ? 'no_lines' : null,
      operating_in_cents: none ? null : operating,
      financing_in_cents: none ? null : financing,
      out_cents: none ? null : out,
      net_burn_cents: none ? null : out - operating,
      lines: counts,
      top_counterparties: [...payees.values()]
        .sort((a, b) => b.out_cents - a.out_cents || String(a.name ?? '').localeCompare(String(b.name ?? '')))
        .slice(0, TOP_COUNTERPARTIES),
      categories: anyCategory
        ? [...cats.entries()].map(([category, out_cents]) => ({ category, out_cents })).sort((a, b) => b.out_cents - a.out_cents || a.category.localeCompare(b.category))
        : null,
    };
  });
}

/** Cash now: the available balance of checking and savings; one without it is unreadable, never 0. */
export function cashNow(accounts: SpendAccount[]): { cents: number | null; accounts_counted: number; accounts_unreadable: number } {
  let cents = 0, counted = 0, unreadable = 0;
  for (const a of accounts) {
    if (a.kind !== 'checking' && a.kind !== 'savings') continue;
    if (a.available_cents === null || a.available_cents === undefined || !Number.isFinite(a.available_cents)) { unreadable += 1; continue; }
    cents += a.available_cents;
    counted += 1;
  }
  return { cents: counted ? cents : null, accounts_counted: counted, accounts_unreadable: unreadable };
}

export type RunwayReason = 'not_burning' | 'needs_three_months' | 'cash_not_read' | 'partial' | null;

/** Runway from cash and the three full months before the current one (decision 5). */
export function runwayFrom(cash: number | null, rows: SpendMonth[], capped: boolean):
  { months: number | null; reason: RunwayReason; from: string[]; average_net_burn_cents: number | null } {
  const from = rows.map((r) => r.month);
  if (capped) return { months: null, reason: 'partial', from, average_net_burn_cents: null };
  if (rows.length < RUNWAY_FULL_MONTHS || rows.some((r) => r.net_burn_cents === null)) {
    return { months: null, reason: 'needs_three_months', from, average_net_burn_cents: null };
  }
  const average = Math.round(rows.reduce((s, r) => s + (r.net_burn_cents as number), 0) / rows.length);
  if (average <= 0) return { months: null, reason: 'not_burning', from, average_net_burn_cents: average };
  if (cash === null) return { months: null, reason: 'cash_not_read', from, average_net_burn_cents: average };
  return { months: runwayMonths(cash, average), reason: null, from, average_net_burn_cents: average };
}

export type SnapshotFigures =
  | { ok: true; net_burn: number; cash_balance: number | null; notes: string }
  | { ok: false; code: 'no_lines_last_month' | 'cash_not_read'; message: string };

/** The row a save writes, in dollars as `project_metrics` keeps them; refused when the month or cash is missing. */
export function snapshotFigures(row: SpendMonth, cash: number | null, includeCash: boolean, today: string): SnapshotFigures {
  if (row.net_burn_cents === null) {
    return { ok: false, code: 'no_lines_last_month', message: `Your Mercury shows no posted line in ${row.month}, so there is no burn to save. Nothing was saved.` };
  }
  if (includeCash && cash === null) {
    return { ok: false, code: 'cash_not_read', message: 'Mercury did not give an available balance for your accounts, so there is no cash figure to save. Save without cash, or try again. Nothing was saved.' };
  }
  const notes = includeCash
    ? `Net burn for ${row.month} and cash on hand on ${today}, read from your Mercury on ${today}.`
    : `Net burn for ${row.month}, read from your Mercury on ${today}.`;
  return { ok: true, net_burn: row.net_burn_cents / 100, cash_balance: includeCash ? (cash as number) / 100 : null, notes };
}
