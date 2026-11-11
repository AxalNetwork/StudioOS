/**
 * `earningsLedger` — D4's four windows, its table arithmetic and its labels.
 *
 * This module imports nothing, for the same two reasons its siblings do: a
 * guard test can load it without React and a stylesheet coming through the
 * component tree, and a derivation unit-tested in both directions is one a
 * mutation cannot quietly change.
 *
 * A PERIOD IS A CALENDAR LABEL AND ITS BOUNDS ARE INSTANTS, and this module
 * is where the two meet. `sessionGrid.js` holds a slot's instant beside a
 * blackout's weekday; here the pairing is different and just as easy to get
 * wrong:
 *
 *   * `2026-Q3` is a NAME. It is built from a reader's own calendar quarter
 *     and never parsed as a date — it is a key the note store is filed under
 *     and a label the chip shows.
 *   * `from` and `until` are INSTANTS in UTC, because that is what
 *     `advisor_bookings.created_at` is and what the ledger route compares
 *     against. Deriving them from a local `new Date(2026, 6, 1)` would shift
 *     the quarter boundary by the reader's offset and file a 1 July session
 *     in Sydney under Q2.
 *
 * So the quarter is CHOSEN locally (the reader means their own current
 * quarter) and its bounds are EMITTED in UTC. Both halves are stated because
 * getting either one wrong is invisible until a session lands on a boundary.
 *
 * NO MONEY IS COMPUTED HERE. Gross, cut and net all arrive from the worker in
 * integer cents, already reconciling; `services/advisorMoney.ts` says why in
 * its own header. The one number this module derives is a PERCENTAGE for
 * display, which is a ratio of two figures the server sent rather than a
 * third figure invented beside them.
 */

/** The four chips D4 draws, in its order. */
export const LEDGER_VIEWS = ['this_quarter', 'last_quarter', 'ytd', 'all'];

/**
 * Which calendar quarter a moment falls in, 1-4.
 *
 * Takes a Date so a test can pin it; callers pass `new Date()`. The month is
 * read LOCALLY, because a reader in Sydney on 1 July means Q3 even while UTC
 * still says 30 June.
 */
export function quarterOf(date) {
  return Math.floor(date.getMonth() / 3) + 1;
}

/** `2026-Q3` — the key a note is filed under and the label a chip shows. */
export function quarterKey(year, quarter) {
  return `${year}-Q${quarter}`;
}

/**
 * The window a chip asks the ledger for: a period key, a human label, and the
 * half-open UTC bounds `[from, until)`.
 *
 * HALF-OPEN, because the alternative double-counts. A session at exactly
 * midnight on 1 October belongs to Q4 and to Q4 only; an inclusive `until`
 * would put it in both quarters and make two adjacent tables that cannot both
 * be right.
 *
 * `all` has no bounds at all rather than a very old `from`: an absent bound is
 * "every row", and a date far enough back to look like one is a guess that
 * eventually stops being true.
 */
export function periodWindow(view, now) {
  const d = now || new Date();
  const year = d.getFullYear();
  const q = quarterOf(d);

  const utc = (y, monthIndex) => new Date(Date.UTC(y, monthIndex, 1)).toISOString();

  // #4834 (D4834): Practice v2's selector (PX-07). A month is chosen locally,
  // like a quarter, and its bounds are UTC; `last_month` wraps at January.
  if (view === 'this_month' || view === 'last_month') {
    const back = view === 'last_month' ? 1 : 0;
    const mi = d.getMonth() - back;
    const ty = mi < 0 ? year - 1 : year;
    const tm = mi < 0 ? 11 : mi;
    return {
      key: monthKey(ty, tm + 1),
      label: `${MONTHS_LONG[tm]} ${ty}`,
      from: utc(ty, tm),
      until: utc(ty, tm + 1),
    };
  }
  if (view === 'quarter') return periodWindow('this_quarter', d);
  if (view === 'year') return { ...periodWindow('ytd', d), label: String(year) };

  if (view === 'all') {
    return { key: 'all', label: 'All time', from: null, until: null };
  }
  if (view === 'ytd') {
    return {
      key: String(year),
      label: 'Year to date',
      from: utc(year, 0),
      until: utc(year + 1, 0),
    };
  }
  // `last_quarter` wraps into the previous year at Q1, which is the one case
  // an off-by-one here produces a table labelled Q0.
  const target = view === 'last_quarter' ? q - 1 : q;
  const ty = target < 1 ? year - 1 : year;
  const tq = target < 1 ? 4 : target;
  const startMonth = (tq - 1) * 3;
  return {
    key: quarterKey(ty, tq),
    label: `Q${tq} ${ty}`,
    from: utc(ty, startMonth),
    until: utc(ty, startMonth + 3),
  };
}

/**
 * The chip labels, computed rather than written down.
 *
 * D4's fixture reads "Q3 2026 · Q2 2026 · Year to date · All time", which are
 * the right FOUR and the wrong two literals: hard-coding them means the page
 * says Q3 2026 forever. The first two are derived from today so the chip a
 * reader clicks names the quarter they are in.
 */
export function viewLabels(now) {
  return LEDGER_VIEWS.map((v) => ({ key: v, label: periodWindow(v, now).label }));
}

/**
 * One client's share of gross, as a whole percent, or null.
 *
 * NULL WHEN THERE IS NOTHING TO SHARE. A share of zero gross is not 0% — it
 * is a question with no answer, and 0% reads as "well spread", which is the
 * opposite of what an empty quarter means (D56/D68). The worker applies the
 * same rule to the concentration tile; this is the per-row version.
 */
export function sharePct(cents, totalCents) {
  // ABSENT IS CHECKED BEFORE COERCION, because `Number(null)` is 0 and
  // `Number('')` is 0 — so a missing numerator would come out as a confident
  // 0% share. The same coercion made a blank take-rate setting read as a
  // deliberate 0% in `services/advisorMoney.ts`; it is the D56/D68 failure in
  // its purest form and it hides in a one-line conversion.
  if (cents == null || totalCents == null) return null;
  const t = Number(totalCents);
  if (!Number.isFinite(t) || t <= 0) return null;
  const c = Number(cents);
  if (!Number.isFinite(c)) return null;
  return Math.round((c / t) * 100);
}

/**
 * D4's cut note, built from the figures rather than from its fixture.
 *
 * The artboard's own sentence is three claims: the cut is charged per line
 * and not netted at the bottom; the top client is N% of gross; and a client
 * billing in equity is absent from a cash table entirely. The first is always
 * true and always said. The second is said only when there IS a top client —
 * otherwise it would assert a concentration over nothing. The third is said
 * only when the page actually knows of such a client, because "someone is
 * missing from this table" is a claim about the reader's book.
 */
export function cutNote({ cutLabel, concentration, equityClients }) {
  const parts = [
    `The cut is charged per line, not netted at the bottom${cutLabel ? ` — ${cutLabel} in this window` : ''}.`,
  ];
  if (concentration?.client_name && concentration.pct != null) {
    parts.push(
      `${concentration.client_name} is ${concentration.pct}% of gross, which is the number a`
      + ' compressed summary cannot show you and the one that should decide whether you take'
      + ' the next retainer.',
    );
  }
  if (equityClients > 0) {
    parts.push(
      `${equityClients} engagement${equityClients === 1 ? ' is' : 's are'} paid in equity and`
      + ' therefore absent from this table — real compensation a cash ledger cannot hold.',
    );
  }
  return parts.join(' ');
}

/**
 * A payout row's tone, from its state. `scheduled` is FUTURE tense and must
 * not read as settled: it is the one state on this card where a confident
 * colour would assert money had moved.
 */
export const PAYOUT_TONE = {
  paid: 'ok',
  scheduled: 'neutral',
  failed: 'danger',
  reversed: 'warn',
};

export const PAYOUT_STATE_LABEL = {
  paid: 'Paid',
  scheduled: 'Scheduled',
  failed: 'Failed',
  reversed: 'Reversed',
};

/**
 * The date a payout row shows, and WHICH KIND OF TIME it is.
 *
 * `scheduled_for` is a banking DAY ('2026-09-01') and is rendered from its own
 * parts — `new Date('2026-09-01')` is midnight UTC and would show "Aug 31" to
 * every reader west of Greenwich. `paid_at` is an INSTANT and goes through the
 * browser's formatter, because the moment it settled is the reader's own.
 *
 * Returns `{ text, kind }` so a caller can label the two differently rather
 * than printing a bare date that means different things on different rows.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function payoutWhen(row) {
  if (row?.paid_at) {
    const d = new Date(row.paid_at);
    if (!Number.isNaN(d.getTime())) {
      try {
        return { text: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), kind: 'paid' };
      } catch { /* fall through to the day form */ }
    }
  }
  if (row?.scheduled_for) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(row.scheduled_for));
    if (m) {
      const month = MONTHS[Number(m[2]) - 1];
      if (month) return { text: `${month} ${Number(m[3])}`, kind: 'scheduled' };
    }
  }
  return { text: null, kind: 'none' };
}

/**
 * Whether a stored note still describes the table beside it.
 *
 * A narrative reads "gross is $18,450"; if a session is priced afterwards the
 * table moves and the sentence does not. Migration 242 stamps the figures the
 * note was written against precisely so the page can say which, instead of
 * showing two numbers and no reason.
 *
 * `null` means the note carries no stamped figures — an older row, or one the
 * advisor typed — and that is NOT "still current". Absent evidence is not
 * evidence (D56/D68), so the caller renders nothing rather than a reassurance.
 */
export function noteIsStale(note, totals) {
  const was = note?.figures;
  if (!was || totals == null) return null;
  const keys = ['gross_cents', 'cut_cents', 'net_cents'];
  for (const k of keys) {
    if (was[k] == null || totals[k] == null) return null;
    if (Number(was[k]) !== Number(totals[k])) return true;
  }
  return false;
}

/**
 * #4679 — ONLY THE LATEST REQUEST MAY WRITE.
 *
 * Switching quarters fast starts a ledger read, a note read and maybe a model
 * draft for each quarter, and they finish in any order. Each starts by taking a
 * ticket from `begin()`; when it finishes it applies its result only if
 * `isCurrent(ticket)`. An older response is dropped, not shown under the newer
 * quarter's heading.
 */
export function latestOnly() {
  let n = 0;
  return {
    begin() { n += 1; return n; },
    isCurrent(ticket) { return ticket === n; },
    /** Invalidate everything in flight (the window changed). */
    cancel() { n += 1; },
  };
}

/**
 * A draft or edited note may be filed only against the period it was written
 * for. `draftKey` is the period key when the text was drafted or loaded;
 * `windowKey` is the period the page shows now. Absent evidence is a refusal.
 */
export function draftFitsPeriod(draftKey, windowKey) {
  return !!draftKey && !!windowKey && draftKey === windowKey;
}

/**
 * The four honest tiles for a window, from the worker's `states`. PRICED is
 * what the advisor priced; only COLLECTED is "received". Nothing here adds,
 * subtracts or rounds: every figure arrives in cents from the worker.
 */
export function stateTiles(ledger) {
  const s = ledger?.states;
  if (!s) return null;
  return {
    priced_cents: ledger?.totals?.gross_cents ?? null,
    received_cents: s.collected?.net_cents ?? null,
    received_sessions: s.collected?.sessions ?? 0,
    unpaid_cents: s.billed?.gross_cents ?? null,
    unpaid_sessions: s.billed?.sessions ?? 0,
    written_off_cents: s.written_off?.gross_cents ?? null,
    written_off_sessions: s.written_off?.sessions ?? 0,
    refunds_owed_cents: s.refunds_owed?.amount_cents ?? null,
    refunded_cents: s.refunded?.amount_cents ?? null,
    paid_out_cents: s.paid_out_cents ?? null,
    void_sessions: s.void_sessions ?? 0,
  };
}

/**
 * #4713 (D4713): whether the note editor holds text that is not filed — the
 * advisor typed or drafted something that differs from the stored note for the
 * period shown. Resolved (filed or discarded) before the period changes.
 */
export function noteIsDirty(note, draft) {
  const typed = String(draft ?? '').trim();
  if (!typed) return false;
  return typed !== String(note?.body ?? '').trim();
}


// ───────────────────────────────────────────────────────────────────────────
// #4834 (D4834) — Practice v2 Earnings (PX-07, PX-08).
//
// NOTHING BELOW IS CALLED "RECEIVED". The store records what the advisor
// billed and what they marked collected; whether money reached them is a
// payout, and a payout is its own row (`advisor_payouts`). So the cards say
// "Recorded billed" and "Recorded collected", and "Paid out" appears only over
// paid payout rows. Every figure is the Worker's, in cents; this module only
// chooses labels and says what each figure is built from.
// ───────────────────────────────────────────────────────────────────────────

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** The five periods Practice v2 draws, in its order. */
export const PERIOD_VIEWS = ['this_month', 'last_month', 'quarter', 'year', 'custom'];

/** `2026-11` — a month's note key. */
export function monthKey(year, month1) {
  return `${year}-${String(month1).padStart(2, '0')}`;
}

/**
 * A custom range from two calendar days (`YYYY-MM-DD`, both inclusive), or
 * null when either is missing, malformed or the range runs backwards.
 *
 * IT HAS NO KEY. A note is the advisor's word on a named period; a range typed
 * today is not one, so nothing is filed against it (the Worker stores month,
 * quarter, year and all-time keys only).
 */
export function customWindow(fromDay, untilDay) {
  const parse = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
    if (!m) return null;
    const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const t = Date.UTC(y, mo - 1, da);
    const back = new Date(t);
    if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== da) return null;
    return { y, mo, da, t };
  };
  const a = parse(fromDay);
  const b = parse(untilDay);
  if (!a || !b || a.t > b.t) return null;
  const short = (p) => `${MONTHS[p.mo - 1]} ${p.da}`;
  const label = a.y === b.y
    ? `${short(a)} – ${short(b)}, ${b.y}`
    : `${short(a)}, ${a.y} – ${short(b)}, ${b.y}`;
  return {
    key: null,
    label,
    from: new Date(a.t).toISOString(),
    // Inclusive of the last day: the half-open bound is the next midnight.
    until: new Date(b.t + 86_400_000).toISOString(),
  };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * What "Recorded billed" is built from, in the canvas's words: "From 12 priced
 * sessions · 1 session has no recorded price." Null when there are no totals —
 * a sentence about nothing would be a claim.
 */
export function pricedBasis(totals) {
  if (!totals || totals.priced_sessions == null) return null;
  const priced = Number(totals.priced_sessions);
  const unpriced = Number(totals.unpriced_sessions || 0);
  const head = `From ${plural(priced, 'priced session', 'priced sessions')}`;
  if (!unpriced) return `${head}.`;
  return `${head} · ${plural(unpriced, 'session has', 'sessions have')} no recorded price.`;
}

/**
 * The cards for one window, from the ledger response. Each is `{ key, label,
 * cents, basis }`; `cents` null renders "Not recorded", never $0.
 *
 * "PAID OUT" IS A CARD ONLY OVER RECORDED PAYOUTS: when the Worker counted at
 * least one paid payout in the window. None recorded is no card at all (a $0
 * card would read as "paid nothing"); an unreadable payout table is a card
 * that says so (`unread: true`), never a zero.
 */
export function earningsCards(ledger) {
  const t = ledger?.totals;
  const s = ledger?.states;
  if (!t || !s) return [];
  const unfrozen = Number(ledger?.lines?.unfrozen || 0);
  const writtenOff = Number(s.written_off?.sessions || 0);
  const cards = [
    {
      key: 'billed',
      label: 'Recorded billed',
      cents: t.gross_cents ?? null,
      basis: [pricedBasis(t), writtenOff ? `Includes ${plural(writtenOff, 'session', 'sessions')} written off.` : null]
        .filter(Boolean).join(' '),
    },
    {
      key: 'collected',
      label: 'Recorded collected',
      cents: s.collected?.gross_cents ?? null,
      basis: `Sessions you marked collected · ${plural(Number(s.collected?.sessions || 0), 'session', 'sessions')}.`,
    },
    {
      key: 'outstanding',
      label: 'Outstanding',
      cents: s.billed?.gross_cents ?? null,
      basis: `Billed, not marked collected · ${plural(Number(s.billed?.sessions || 0), 'session', 'sessions')}.`,
    },
    {
      key: 'fees',
      label: 'Platform fees',
      cents: t.cut_cents ?? null,
      basis: unfrozen
        ? `On priced records, at each record’s own rate · ${plural(unfrozen, 'record', 'records')} priced before rates were recorded ${unfrozen === 1 ? 'is' : 'are'} counted at today’s rate.`
        : 'On priced records, at each record’s own rate.',
    },
  ];
  if (s.paid_out_cents == null) {
    cards.push({ key: 'paid_out', label: 'Paid out', cents: null, unread: true, basis: 'Payout information could not be read.' });
  } else if (Number(s.paid_out_count || 0) > 0) {
    cards.push({
      key: 'paid_out',
      label: 'Paid out',
      cents: s.paid_out_cents,
      basis: `${plural(Number(s.paid_out_count), 'payout', 'payouts')} with a paid date in this period.`,
    });
  }
  return cards;
}

/** A line's billing state, as a word and a shape: status is never colour alone. */
export const BILLING_STATE = {
  unpriced: { label: 'Unpriced', tone: 'neutral', mark: '○' },
  billed: { label: 'Billed', tone: 'warn', mark: '◐' },
  collected: { label: 'Collected', tone: 'ok', mark: '●' },
  written_off: { label: 'Written off', tone: 'danger', mark: '✕' },
};

/** A stored rate as a percent, or null when the line has none of its own. */
export function ratePct(bps) {
  if (bps == null || bps === '' || !Number.isFinite(Number(bps))) return null;
  const pct = Number(bps) / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

/**
 * The day a ledger line shows: the session's own start, else the day it was
 * booked, said as such. Both are instants (`nowIso()` / slot `starts_at`), so
 * the reader's own formatter is right for either.
 */
export function lineWhen(line) {
  const fmt = (v) => {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    try { return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return null; }
  };
  const session = line?.session_at ? fmt(line.session_at) : null;
  if (session) return { text: session, kind: 'session' };
  const booked = line?.created_at ? fmt(line.created_at) : null;
  if (booked) return { text: `Booked ${booked}`, kind: 'booked' };
  return { text: null, kind: 'none' };
}

/** True when a failed read means this account has no advisor profile at all. */
export function noAdvisorProfile(err) {
  return /no advisor profile/i.test(String(err?.message || err || ''));
}
