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

/**
 * D802 — the royalty on platform licences a subsidiary sells (`§4.7`). Not a
 * stream a branch reports: it is DERIVED from the licence-fees stream's gross,
 * so it never appears in a usage report and never counts towards `unreported`
 * (its source stream already does).
 */
export const ROYALTY_STREAM = 'platform_licence_royalties' as const;

/**
 * D802 — the share terms a statement is drawn at. `fallback_bps` is the
 * ledger's `territory_licences.revenue_share_bps`; each per-stream share is
 * D797's schedule term, null when the schedule does not record one. A null
 * stream share falls back, and the row says so. `royalty_bps` null means the
 * royalty is NOT RECORDED — it owes nothing and reads so, never "0%".
 */
export type ShareTerms = {
  fallback_bps: number;
  subscriptions_bps?: number | null;
  licence_fees_bps?: number | null;
  token_margin_bps?: number | null;
  royalty_bps?: number | null;
};

export type StreamFigure = {
  stream: string;
  /** Null when nobody could report it — NOT 0. See rule 3. */
  gross_cents: number | null;
  currency: string;
  available: boolean;
  is_estimate?: boolean;
  /** Required when `available` is false, so the screen never has to guess. */
  reason?: string;
  /** D802 — the share this stream was drawn at; null when no rate applies. */
  share_bps?: number | null;
  /** D802 — `stream` (the schedule's own share), `fallback` (the ledger's), or `not_recorded`. */
  share_source?: 'stream' | 'fallback' | 'not_recorded';
  /** D802 — what this stream owes; null when its gross is unknown or unusable. */
  owed_cents?: number | null;
  /** D802 — true on the royalty row: derived from licence fees, not reported. */
  derived?: boolean;
};

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

const STREAM_SHARE_KEY: Record<string, keyof ShareTerms> = {
  subscriptions: 'subscriptions_bps',
  licence_fees: 'licence_fees_bps',
  token_margin: 'token_margin_bps',
};

function bpsOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Draw a statement from the figures a branch reported.
 *
 * `currency` is the licence's own — the statement is denominated in what the
 * contract is denominated in, not in whatever the first stream happened to
 * use, because the revenue share is a term of that contract.
 *
 * `shares` is either one rate for every stream (the H5 draw, rounded once over
 * the total) or D802's per-stream `ShareTerms`. With per-stream terms each
 * stream's owed figure is rounded once, on its own gross at its own rate, and
 * the statement owes the sum of those — a stream's share is a term of its own,
 * so its cent is settled where its rate is.
 */
export function drawStatement(
  streams: StreamFigure[],
  shares: number | ShareTerms,
  currency: string,
): DrawnStatement {
  if (typeof shares === 'object' && shares !== null) {
    return drawPerStream(streams, shares, currency);
  }
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

function drawPerStream(streams: StreamFigure[], terms: ShareTerms, currency: string): DrawnStatement {
  const cur = String(currency || 'EUR').toUpperCase();
  const fallback = Math.trunc(Number(terms.fallback_bps) || 0);
  const usableRow = (s: StreamFigure) => s.available && s.currency === cur && s.gross_cents !== null;

  const rows: StreamFigure[] = (streams || [])
    .filter((s) => s.stream !== ROYALTY_STREAM)
    .map((s) => {
      const row = { ...s, currency: String(s.currency || cur).toUpperCase() };
      const key = STREAM_SHARE_KEY[row.stream];
      const own = key ? bpsOrNull(terms[key]) : null;
      const bps = own ?? fallback;
      return {
        ...row,
        share_bps: bps,
        share_source: own === null ? 'fallback' as const : 'stream' as const,
        owed_cents: usableRow(row) ? shareOf(Number(row.gross_cents), bps) : null,
      };
    });

  // THE ROYALTY ROW. Its gross is the licence-fees gross — the same money,
  // owed a second time at a different rate under a different clause.
  const fees = rows.find((s) => s.stream === 'licence_fees');
  const royaltyBps = bpsOrNull(terms.royalty_bps);
  const feesUsable = !!fees && usableRow(fees);
  let royalty: StreamFigure;
  if (royaltyBps === null) {
    royalty = {
      stream: ROYALTY_STREAM, derived: true, gross_cents: feesUsable ? Number(fees!.gross_cents) : null,
      currency: cur, available: false, share_bps: null, share_source: 'not_recorded', owed_cents: 0,
      reason: 'Not recorded: the licence terms record no platform-licence royalty, so this stream owes nothing.',
    };
  } else {
    royalty = {
      stream: ROYALTY_STREAM, derived: true, gross_cents: feesUsable ? Number(fees!.gross_cents) : null,
      currency: cur, available: feesUsable, is_estimate: feesUsable ? !!fees!.is_estimate : undefined,
      share_bps: royaltyBps, share_source: 'stream',
      owed_cents: feesUsable ? shareOf(Number(fees!.gross_cents), royaltyBps) : null,
      reason: feesUsable ? undefined
        : 'The licence-fees stream has no usable figure, so the royalty on it cannot be drawn.',
    };
  }

  const usable = rows.filter(usableRow);
  const gross = usable.reduce((n, s) => n + Math.trunc(Number(s.gross_cents) || 0), 0);
  const owed = usable.reduce((n, s) => n + (s.owed_cents || 0), 0) + (royalty.owed_cents || 0);
  const otherCurrency = [...new Set(
    rows.filter((s) => s.available && s.currency !== cur).map((s) => s.currency),
  )].sort();
  // The royalty row is derived, so it is never counted here: an unreported
  // licence-fees stream is already counted once, and "Not recorded" is a term
  // HQ never set, not a figure a branch failed to send.
  const unreported = rows.filter((s) => !s.available || s.gross_cents === null).length;
  const estimated = usable.filter((s) => s.is_estimate).length;

  return {
    currency: cur,
    gross_cents: gross,
    revenue_share_bps: fallback,
    owed_cents: owed,
    streams: [...rows, royalty],
    estimated,
    unreported,
    other_currency: otherCurrency,
    complete: unreported === 0 && otherCurrency.length === 0 && estimated === 0,
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
