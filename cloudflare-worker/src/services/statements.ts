/**
 * Drawing a statement: what a subsidiary owes HQ for a period (H5, D111).
 *
 * WHY THIS IS A PURE FUNCTION. The arithmetic is the part that must be right
 * and the part that is easiest to get wrong quietly — a rounding rule, a
 * currency mixed into a total, a missing stream counted as zero. None of that
 * needs a database to test, and testing it through one would mean the rounding
 * assertions ran against whatever a fixture happened to contain.
 *
 * THREE RULES, AND THE THIRD IS THE ONE WITH TEETH.
 *
 *   1. MONEY IS INTEGER CENTS, RATES ARE INTEGER BASIS POINTS, and the
 *      multiplication rounds ONCE at the end. 3500 bps of 1234567 cents is
 *      432098.45, and `Math.round` gives 432098 — a floor would quietly
 *      under-bill every statement by up to a cent, forever, in HQ's favour
 *      nowhere and against it always.
 *
 *   2. NOTHING IS SUMMED ACROSS CURRENCIES. `admin_revenue.ts` already refuses
 *      to, and for the same reason: licences are denominated per licence, so a
 *      platform total would be wrong by whatever the rate happens to be, quoted
 *      to the cent. A statement is drawn in ONE currency and streams in any
 *      other are reported as unusable rather than converted.
 *
 *   3. A STREAM NOBODY COULD REPORT IS NOT ZERO. Measured against the schema:
 *      no branch can total its subscription revenue locally (`account_
 *      subscriptions` has a plan and no amount; the charges are in Stripe), and
 *      `ai_usage_logs` gives a token COST with nothing recording what tokens
 *      were billed at. So the honest answer for those streams is "unknown",
 *      and a draw that treated them as 0 would produce a smaller number
 *      presented as the whole quarter — which is not a smaller truth, it is a
 *      false one. `unreported` counts them and every surface shows it.
 */

/** The streams a statement can be drawn over. */
export const STATEMENT_STREAMS = ['subscriptions', 'licence_fees', 'token_margin', 'other'] as const;
export type StatementStream = (typeof STATEMENT_STREAMS)[number];

export type StreamFigure = {
  stream: string;
  /** Null when nobody could report it — NOT 0. See rule 3. */
  gross_cents: number | null;
  currency: string;
  available: boolean;
  is_estimate?: boolean;
  /** Required when `available` is false, so the screen never has to guess. */
  reason?: string;
  /** D802: the share this stream was drawn at, and where it came from. */
  share_bps?: number;
  share_source?: 'terms' | 'ledger';
  share_note?: string;
  owed_cents?: number | null;
  /** D802: the royalty row only. */
  royalty_bps?: number | null;
  not_recorded?: boolean;
};

/**
 * D802 (#2238): the shares a statement is drawn at. `fallback_bps` is the
 * ledger's `territory_licences.revenue_share_bps`; each named stream takes
 * D797's share when recorded and the fallback when not. `royalty_bps` is
 * D797's `royalty_platform_licence_bps`, null when not recorded.
 */
export type StreamShares = {
  fallback_bps: number;
  subscriptions?: number | null;
  licence_fees?: number | null;
  token_margin?: number | null;
  royalty_bps?: number | null;
};

/** The royalty stream: HQ's share of each platform licence fee the subsidiary sells (D797 §4.7). */
export const ROYALTY_STREAM = 'platform_licence_royalties';

export type DrawnStatement = {
  currency: string;
  gross_cents: number;
  revenue_share_bps: number;
  owed_cents: number;
  streams: StreamFigure[];
  estimated: number;
  unreported: number;
  /** Streams reported in some OTHER currency, which are not summed in. */
  other_currency: string[];
  complete: boolean;
  /** D802: drawn per stream (`StreamShares`) rather than at one share. */
  per_stream?: boolean;
};

/**
 * `bps` of `cents`, rounded once, as integers throughout.
 *
 * Exported so the rounding rule has exactly one home and a test can hit it
 * directly rather than inferring it from a statement total.
 */
export function shareOf(cents: number, bps: number): number {
  const c = Math.trunc(Number(cents) || 0);
  const b = Math.trunc(Number(bps) || 0);
  return Math.round((c * b) / 10000);
}

/**
 * Draw a statement from the figures a branch reported.
 *
 * `currency` is the licence's own — the statement is denominated in what the
 * contract is denominated in, not in whatever the first stream happened to
 * use, because the revenue share is a term of that contract.
 */
export function drawStatement(
  streams: StreamFigure[],
  shares: number | StreamShares,
  currency: string,
): DrawnStatement {
  if (typeof shares === 'object' && shares !== null) return drawPerStream(streams, shares, currency);
  const revenueShareBps = shares;
  const cur = String(currency || 'EUR').toUpperCase();
  const rows = (streams || []).map((s) => ({
    ...s,
    currency: String(s.currency || cur).toUpperCase(),
  }));

  // Summed: available, in this currency, with a figure. Everything else is
  // counted and named rather than folded in at zero.
  const usable = rows.filter((s) => s.available && s.currency === cur && s.gross_cents !== null);
  const gross = usable.reduce((n, s) => n + Math.trunc(Number(s.gross_cents) || 0), 0);

  const otherCurrency = [...new Set(
    rows.filter((s) => s.available && s.currency !== cur).map((s) => s.currency),
  )].sort();

  const unreported = rows.filter((s) => !s.available || s.gross_cents === null).length;

  return {
    currency: cur,
    gross_cents: gross,
    revenue_share_bps: Math.trunc(Number(revenueShareBps) || 0),
    owed_cents: shareOf(gross, revenueShareBps),
    streams: rows,
    estimated: usable.filter((s) => s.is_estimate).length,
    unreported,
    other_currency: otherCurrency,
    // A statement is COMPLETE only when every stream was reported, in this
    // currency, measured rather than inferred. Anything less and the owed
    // figure is a floor, not a total.
    complete: unreported === 0 && otherCurrency.length === 0
      && usable.filter((s) => s.is_estimate).length === 0,
  };
}

const bpsOrNull = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 10000 ? v : null);

/**
 * D802 (#2238): a statement drawn per stream. Each reported stream is owed at
 * its own share, rounded once per stream, and the total owed is their sum; a
 * stream with no share on D797's terms falls back to the ledger's and says so
 * in its row. The royalty row is HQ's share of the licence-fees stream's gross
 * at D797's royalty; with no royalty recorded it reads "Not recorded" and owes
 * nothing, never zero by assumption. The royalty row adds nothing to the gross
 * (its base is the licence fees already counted) and is never "unreported": a
 * term nobody set is not a report nobody sent.
 */
function drawPerStream(streams: StreamFigure[], shares: StreamShares, currency: string): DrawnStatement {
  const cur = String(currency || 'EUR').toUpperCase();
  const fallback = Math.trunc(Number(shares.fallback_bps) || 0);
  const own: Record<string, number | null> = {
    subscriptions: bpsOrNull(shares.subscriptions),
    licence_fees: bpsOrNull(shares.licence_fees),
    token_margin: bpsOrNull(shares.token_margin),
  };
  const base = (streams || []).filter((s) => s.stream !== ROYALTY_STREAM).map((s) => {
    const row: StreamFigure = { ...s, currency: String(s.currency || cur).toUpperCase() };
    const recorded = own[row.stream] ?? null;
    row.share_bps = recorded ?? fallback;
    row.share_source = recorded === null ? 'ledger' : 'terms';
    if (recorded === null) row.share_note = 'No share for this stream is recorded on the terms, so the licence\'s revenue share is used.';
    const usable = row.available && row.currency === cur && row.gross_cents !== null;
    row.owed_cents = usable ? shareOf(Number(row.gross_cents), row.share_bps) : null;
    return row;
  });
  const usable = base.filter((s) => s.available && s.currency === cur && s.gross_cents !== null);
  const gross = usable.reduce((n, s) => n + Math.trunc(Number(s.gross_cents) || 0), 0);
  const otherCurrency = [...new Set(base.filter((s) => s.available && s.currency !== cur).map((s) => s.currency))].sort();
  const unreported = base.filter((s) => !s.available || s.gross_cents === null).length;
  const estimated = usable.filter((s) => s.is_estimate).length;

  const fees = usable.find((s) => s.stream === 'licence_fees') ?? null;
  const royaltyBps = bpsOrNull(shares.royalty_bps);
  const royalty: StreamFigure = {
    stream: ROYALTY_STREAM,
    gross_cents: fees ? Number(fees.gross_cents) : null,
    currency: cur,
    available: royaltyBps !== null && fees !== null,
    is_estimate: fees?.is_estimate ?? false,
    royalty_bps: royaltyBps,
    owed_cents: royaltyBps !== null && fees ? shareOf(Number(fees.gross_cents), royaltyBps) : 0,
    not_recorded: royaltyBps === null,
    ...(royaltyBps === null
      ? { reason: 'Not recorded: no royalty on platform licences is on this licence\'s terms, so none is owed.' }
      : fees === null ? { reason: 'The licence fees this royalty is drawn on were not reported.' } : {}),
  };
  const owed = usable.reduce((n, s) => n + (s.owed_cents ?? 0), 0) + (royalty.owed_cents ?? 0);
  return {
    currency: cur,
    gross_cents: gross,
    revenue_share_bps: fallback,
    owed_cents: owed,
    streams: [...base, royalty],
    estimated,
    unreported,
    other_currency: otherCurrency,
    complete: unreported === 0 && otherCurrency.length === 0 && estimated === 0,
    per_stream: true,
  };
}

/**
 * 'YYYY-Qn' for a date. The grain the canvas's statements zone draws and the
 * grain a revenue share is agreed at.
 */
export function quarterKey(d: Date): string {
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/** `2026-Q3` → true; `2026-Q5`, `2026-03`, `Q3` → false. */
export const PERIOD_RE = /^\d{4}-Q[1-4]$/;
