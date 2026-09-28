/**
 * The LP's own commitment, per fund, from `GET /api/funds/lp-portal` (D372).
 *
 * The I5 "My commitment" card draws committed / called / due / uncalled and
 * the call schedule. Everything here is summed from rows the Worker returned:
 * the LP's own `limited_partners` rows, their capital-call lines (each with
 * `owed_cents` and `received_cents` since D371), their distributions and the
 * per-holding performance. It is pure so a Node test can hold it.
 *
 * Money is integer cents. A figure the payload cannot support is `null`,
 * never 0: a failed calls read (`capital_calls_recorded: false`) leaves called,
 * due and uncalled unknown, and a holding with nothing paid in has no multiple.
 */

const toCents = (dollars) => {
  const n = Number(dollars);
  return dollars == null || dollars === '' || !Number.isFinite(n) ? null : Math.round(n * 100);
};
// `Number(null)` is 0, so an absent figure is refused before it is converted.
const intOr = (v, fallback = null) => (v == null || v === '' || !Number.isSafeInteger(Number(v)) ? fallback : Number(v));

/** A line's state for the LP: what the GP recorded, and whether its due date has passed. */
export function callState(line, today) {
  if (line.status === 'paid') return 'paid';
  const due = String(line.due_date || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(due) && due < today) return 'overdue';
  if (line.received_cents > 0) return 'part_received';
  return 'pending';
}

/**
 * One capital-call line as the card shows it. A line marked paid before
 * receipts existed has no receipt behind it; for the LP it is still settled.
 */
function callLine(c, today) {
  const owed = intOr(c.owed_cents) ?? toCents(c.amount);
  const received = intOr(c.received_cents, 0);
  const settled = c.status === 'paid' ? owed : received;
  const line = {
    id: c.id,
    fund_id: intOr(c.fund_id),
    call_number: intOr(c.call_number),
    owed_cents: owed,
    received_cents: received,
    settled_cents: settled,
    outstanding_cents: c.status === 'paid' || owed == null ? 0 : Math.max(0, owed - received),
    due_date: c.due_date ? String(c.due_date).slice(0, 10) : null,
    issued_on: c.created_at ? String(c.created_at).slice(0, 10) : null,
    paid_date: c.paid_date ? String(c.paid_date).slice(0, 10) : null,
    status: c.status || 'pending',
  };
  return { ...line, state: callState(line, today) };
}

/**
 * Each fund the LP holds, with its commitment and calls summed.
 *
 * @param {object|null} portal the lp-portal payload
 * @param {string} today YYYY-MM-DD
 */
export function commitmentsByFund(portal, today = new Date().toISOString().slice(0, 10)) {
  const holdings = Array.isArray(portal?.lp_holdings) ? portal.lp_holdings : [];
  const perf = Array.isArray(portal?.performance) ? portal.performance : [];
  const callsKnown = portal?.capital_calls_recorded !== false && Array.isArray(portal?.capital_calls);
  const calls = callsKnown ? portal.capital_calls.map((c) => callLine(c, today)) : [];
  const dists = Array.isArray(portal?.distributions) ? portal.distributions : [];
  const facts = portal?.funds || {};

  return holdings.map((h) => {
    const fundId = intOr(h.fund_id);
    const lpId = intOr(h.id);
    const p = perf.find((row) => intOr(row.lp_id) === lpId) || {};
    const own = calls
      .filter((c) => c.fund_id === fundId)
      .sort((a, b) => String(b.issued_on || '').localeCompare(String(a.issued_on || '')) || b.id - a.id);
    const commitment = toCents(h.commitment_amount);
    const sum = (key) => own.reduce((s, c) => s + (c[key] ?? 0), 0);
    const called = callsKnown ? sum('owed_cents') : null;
    const due = callsKnown ? sum('outstanding_cents') : null;
    const upcoming = own.filter((c) => c.state !== 'paid' && c.due_date).map((c) => c.due_date).sort();
    const fundDists = dists
      .filter((d) => intOr(d.fund_id) === fundId)
      .map((d) => ({
        id: d.id,
        amount_cents: intOr(d.amount_cents),
        on: String(d.distributed_at || d.created_at || '').slice(0, 10) || null,
        status: d.status || null,
      }));
    return {
      fund_id: fundId,
      lp_id: lpId,
      fund_name: h.fund_name || null,
      status: h.status || null,
      commitment_cents: commitment,
      committed_on: h.commitment_date ? String(h.commitment_date).slice(0, 10) : null,
      lpa_signed: !!h.lpa_signed,
      lpa_signed_at: h.lpa_signed_at ? String(h.lpa_signed_at).slice(0, 10) : null,
      calls_known: callsKnown,
      called_cents: called,
      settled_cents: callsKnown ? sum('settled_cents') : null,
      due_cents: due,
      next_due: upcoming[0] || null,
      // Uncalled needs both sides. Calls beyond the commitment are said, not
      // hidden behind a zero.
      uncalled_cents: commitment == null || called == null ? null : Math.max(0, commitment - called),
      over_called: commitment != null && called != null && called > commitment,
      calls: own,
      invested_cents: toCents(h.invested_amount),
      returns_cents: toCents(h.returns),
      distributions: fundDists,
      distributed_cents: fundDists.reduce((s, d) => s + (d.status === 'paid' ? d.amount_cents ?? 0 : 0), 0),
      tvpi: typeof p.tvpi === 'number' ? p.tvpi : null,
      dpi: typeof p.dpi === 'number' ? p.dpi : null,
      gp: facts[fundId]?.gp || null,
    };
  });
}

/** The shares of the bar: settled, due, uncalled — each a fraction of the commitment, or null. */
export function commitmentBar(row) {
  if (!row || !row.commitment_cents || row.called_cents == null) return null;
  const whole = Math.max(row.commitment_cents, row.called_cents);
  const pct = (v) => Math.max(0, Math.min(100, (v / whole) * 100));
  return { settled: pct(row.settled_cents ?? 0), due: pct(row.due_cents ?? 0) };
}

/**
 * The onboarding table's "Your status" column, from records rather than the
 * access ladder (D372). It was derived from the ladder — so KYC read
 * "Complete" for anyone the GP had given a commitment, whatever Trust said.
 *
 * Returns `[tone, label]`. Accreditation is self-certified on the application
 * and is never shown as verified; two rows have no store behind them and say
 * so.
 *
 * @param {string} requirement the ONBOARDING row's name
 * @param {{ kyc: {loaded: boolean, status?: string|null}, application: object|null,
 *   applicationLoaded: boolean, holdings: Array<{lpa_signed?: boolean}> }} ctx
 */
export function onboardingStatus(requirement, ctx) {
  switch (requirement) {
    case 'Accredited status': {
      if (!ctx.applicationLoaded) return ['gray', 'Not read'];
      const accredited = ctx.application && (ctx.application.accredited === true || Number(ctx.application.accredited) === 1);
      return accredited ? ['amber', 'Self-certified, not verified'] : ['gray', 'Not certified'];
    }
    case 'KYC / AML': {
      if (!ctx.kyc?.loaded) return ['gray', 'Not read'];
      const s = String(ctx.kyc.status || 'not_started');
      if (s === 'approved') return ['green', 'Approved'];
      if (s === 'pending') return ['amber', 'In review'];
      if (s === 'rejected') return ['amber', 'Rejected · resubmit in Trust'];
      return ['gray', 'Not started'];
    }
    case 'Limited partnership agreement': {
      const rows = Array.isArray(ctx.holdings) ? ctx.holdings : [];
      if (!rows.length) return ['gray', 'No position yet'];
      return rows.some((h) => h.lpa_signed) ? ['green', 'Signed'] : ['amber', 'Not signed'];
    }
    case 'Subscription documents':
    case 'Banking + capital call setup':
      return ['gray', 'Not recorded'];
    default:
      return ['gray', 'Not recorded'];
  }
}
