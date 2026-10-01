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
