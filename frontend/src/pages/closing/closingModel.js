/**
 * D1213 (#2424) — the closing room and the admin's Closings desk, from the
 * owner's canvas "Closing room" (CP1–CP21). Pure, so
 * `frontend/test/closing_room_d1213.test.mjs` holds each rule.
 *
 * WHAT IS READ TODAY. No `closings` store exists yet (D1213 part 2), so a
 * closing is a deal: its commitments (`GET /api/deals/:id/commitments`, scoped
 * by role), its closing checklist, its recorded transfers, and on the desk the
 * deals list with each deal's closing deadline. The paper, the route, the
 * payment instructions, the evidence, the cap-table proposal, the reporting
 * duties and the activity log say "Not read here yet" with their reason, never
 * a zero.
 *
 * THE PLATFORM NEVER MOVES MONEY. A line reads Received only on the receiving
 * side's evidence: today that is a confirmed commitment (the founder's Mercury
 * match, D752). An investor's own Mercury proposal is not that evidence.
 */

export const DESK_PATH = '/admin/contracts/closings';
export const FOUNDER_PATH = '/raise/capital-relationships/closing';

/** One closing on the admin desk; the deal id is digits only. */
export const closingHref = (dealId) => (/^[1-9]\d*$/.test(String(dealId)) ? `/admin/contracts/closings/${dealId}` : DESK_PATH);

/** The canvas's stepper, in its order (CP1). */
export const STEPS = Object.freeze(['Paper', 'Sign', 'Route', 'Pay', 'Receipt', 'Cap table', 'Reporting']);

/**
 * A commitment's status in the canvas's words. Today's store has three:
 * pending is Committed, confirmed is Received (the receiving side's match),
 * withdrawn is Withdrawn. Anything else is "Not recorded", never a guess.
 */
export const LINE_WORD = Object.freeze({ pending: 'Committed', confirmed: 'Received', withdrawn: 'Withdrawn' });
export const lineWord = (status) => LINE_WORD[status] || 'Not recorded';

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * The lines the room draws, from the commitments read. A row without an
 * amount keeps a null amount (drawn "Not recorded"), and Received sums only
 * Received lines: a committed line is not money in the account.
 */
export function lineRows(commitments) {
  const list = Array.isArray(commitments) ? commitments : [];
  const rows = list.map((c) => ({
    uid: c.uid || String(c.id),
    investor: c.investor_name || 'Name not recorded',
    amount: num(c.amount),
    word: lineWord(c.status),
    at: c.created_at || null,
  }));
  const live = rows.filter((r) => r.word !== 'Withdrawn');
  const sum = (xs) => xs.reduce((n, r) => n + (r.amount ?? 0), 0);
  return {
    rows,
    committed: sum(live),
    received: sum(live.filter((r) => r.word === 'Received')),
    unrecordedAmounts: live.filter((r) => r.amount == null).length,
  };
}

/** Whole days from `now` to an ISO day, or null when there is no readable deadline. */
export function daysLeft(deadline, now = new Date()) {
  if (!deadline) return null;
  const d = new Date(`${String(deadline).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((d.getTime() - today) / 86_400_000);
}

/** The canvas marks a deadline under 14 days (CP13). */
export const SOON_DAYS = 14;

/**
 * CP13's rows from the deals list: every deal with a closing deadline, by
 * deadline. Confirmed is the deal's `capital_committed` (confirmed commitments
 * only); a deal with no deadline is not on the desk.
 */
export function deskRows(deals, now = new Date()) {
  const list = Array.isArray(deals) ? deals : [];
  return list
    .filter((d) => d && d.closing_deadline)
    .map((d) => {
      const left = daysLeft(d.closing_deadline, now);
      return {
        id: d.id,
        name: d.project_name || 'Venture not recorded',
        instrument: d.instrument || null,
        currency: d.currency || 'USD',
        target: num(d.target_raise ?? d.amount),
        confirmed: num(d.capital_committed),
        deadline: String(d.closing_deadline).slice(0, 10),
        left,
        soon: left != null && left >= 0 && left < SOON_DAYS,
        href: closingHref(d.id),
      };
    })
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
}

export const NOT_YET = 'Not read here yet';

/** What the canvas draws that no read carries yet. Never a zero, never "none". */
export const WAITS = Object.freeze({
  closings: 'Closings are not recorded yet: a closing is read from its deal until the closings store lands. Lines waiting, who acts next and the owner of each closing are not read here yet.',
  paper: 'The paper for each line is not read here yet: the template, its filled fields with their sources, and the signing order with Axal’s countersign.',
  route: 'The capital route for each line is not read here yet: direct, a syndicate SPV, an Axal VC fund, or a third-party fund.',
  instructions: 'Payment instructions are not read here yet. The company’s receiving account has no store; nothing here tells anyone where to pay.',
  evidence: 'Receipt evidence per line is not read here yet. A line reads Received only on the receiving side’s evidence; the sender’s alone reads Sent, not yet confirmed.',
  captable: 'The cap table change for a received line is not read here yet. It is one proposal with Raise › Cap table, accepted once by the founder.',
  reporting: 'Reporting duties are not read here yet. They start when the closing is marked Closed.',
  activity: 'The closing’s activity log is not read here yet.',
  roundTotal: 'Only the round’s confirmed total is shown to an investor; other investors’ lines are never shown here.',
});
