/**
 * D6130 part 2 (#6130): the Axal VC Fund workspace's first screen, chosen by
 * the reader's standing (canvas `Axal VC Fund v2 and LP Workspace`, boards
 * VF-01 to VF-05, VF-15 and VF-16A; D6127).
 *
 * Pure, so a Node test holds it. Every value comes from a read the page
 * already makes, or from the two it adds for this screen:
 *   - `GET /api/funds/lp-portal` (the position, calls, statements, reports),
 *   - `GET /api/spinout-lab/lp-application` (the application),
 *   - `GET /api/fund-booklets/mine` (the booklet; 404 is "none"),
 *   - `GET /api/fund-notices/mine` (the notices issued to the reader).
 * A read that failed is said as Unavailable and never as an empty list: "no
 * calls" and "nothing arrived" are claims about the reader's money.
 */
import { commitmentsByFund } from './lpCommitmentModel.js';

/** The first screens, one per standing, and the two states before one is known. */
export const FIRST_SCREENS = Object.freeze([
  'loading', 'unreadable', 'visitor', 'applicant', 'approved_no_position',
  'position_unsigned', 'approved', 'committed', 'full',
]);

/**
 * Which first screen to draw. `state` is the access ladder's rung
 * (`lpAccessState`), or an admin's preview of one. The page never draws a
 * standing before the position is read (VF-15B), and a failed position read is
 * its own screen, never Visitor (VF-15).
 */
export function firstScreenKind({ loading = false, portalFailed = false, state, applicationStatus = null, holdings = 0 } = {}) {
  if (loading) return 'loading';
  if (portalFailed) return 'unreadable';
  switch (state) {
    case 'voting': return 'full';
    case 'committed': return 'committed';
    case 'approved': return 'approved';
    case 'pending':
      // lpAccessState caps all three at 'pending' (VF-02B): a position with
      // nothing committed and the LPA unsigned, an approved application with no
      // position yet, and an application in review.
      if (holdings > 0) return 'position_unsigned';
      return applicationStatus === 'approved' ? 'approved_no_position' : 'applicant';
    default:
      return 'visitor';
  }
}

/**
 * The order of the page's sections after the first screen (the canvas's tab
 * order). A committed reader never meets the fund's sales page first; an
 * applicant meets onboarding before the fund's terms.
 */
export function sectionOrder(kind) {
  if (kind === 'approved' || kind === 'committed' || kind === 'full') return ['participation', 'reports', 'fund', 'onboarding'];
  if (kind === 'applicant' || kind === 'approved_no_position' || kind === 'position_unsigned') return ['participation', 'onboarding', 'fund', 'reports'];
  return ['fund', 'participation', 'reports', 'onboarding'];
}

/** Whether Apply and onboarding comes before Fund and terms in the section links. */
export const onboardingFirst = (kind) => sectionOrder(kind).indexOf('onboarding') < sectionOrder(kind).indexOf('fund');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `YYYY-MM-DD` from a stamp or a date, or null. */
export function isoDay(v) {
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/** "10 Nov 2026" from a day, or null. */
export function dayLabel(v) {
  const d = isoDay(v);
  if (!d) return null;
  const [y, m, day] = d.split('-').map(Number);
  return m >= 1 && m <= 12 ? `${day} ${MONTHS[m - 1]} ${y}` : null;
}

/** Whole days from `today` to `day` (both `YYYY-MM-DD`), or null. */
export function daysUntil(day, today) {
  const a = isoDay(day);
  const b = isoDay(today);
  if (!a || !b) return null;
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/** The call state's word with its date (canvas `CS`): "Due · in 17 days", "Overdue · 3 days". */
export function callWord(line, today) {
  if (line.state === 'paid') return line.paid_date ? `Paid · ${dayLabel(line.paid_date)}` : 'Paid';
  const n = daysUntil(line.due_date, today);
  if (line.state === 'overdue') return n == null ? 'Overdue' : `Overdue · ${-n} day${n === -1 ? '' : 's'}`;
  const base = line.state === 'part_received' ? 'Part received' : 'Due';
  if (n == null) return `${base} · no due date recorded`;
  if (n === 0) return `${base} · today`;
  return `${base} · in ${n} day${n === 1 ? '' : 's'}`;
}

/**
 * What is due (VF-04): every open capital-call line the reader owes, soonest
 * due first. `known: false` when the calls could not be read — the block then
 * says so instead of "nothing due".
 */
export function dueLines(portal, today) {
  const rows = commitmentsByFund(portal, today);
  const known = portal?.capital_calls_recorded !== false && Array.isArray(portal?.capital_calls);
  if (!known) return { known: false, lines: [] };
  const lines = rows.flatMap((r) => r.calls
    .filter((c) => c.state !== 'paid' && (c.owed_cents == null || c.outstanding_cents > 0))
    .map((c) => ({ ...c, fund_name: r.fund_name, word: callWord(c, today) })));
  lines.sort((a, b) => {
    if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    if (!!a.due_date !== !!b.due_date) return a.due_date ? -1 : 1;
    return a.id - b.id;
  });
  return { known: true, lines };
}

/**
 * What to sign (VF-04, VF-03 "To sign"): the subscription booklet and the LPA,
 * each with its recorded state. `booklet` is `{ status: 'ready'|'none'|'unreadable'|'loading', view }`.
 * `left` counts what still waits on the reader; `complete` is false while a
 * source is loading or could not be read, so the block never says "nothing left" then.
 */
export function signItems({ booklet, holdings = [] } = {}) {
  const items = [];
  const b = booklet || { status: 'loading' };
  if (b.status === 'unreadable') {
    items.push({ key: 'booklet', title: 'Subscription booklet', tone: 'unavailable', word: 'Unavailable', left: false,
      sub: 'Your booklet could not be read. This is not a claim that nothing waits for your signature.' });
  } else if (b.status === 'ready' && b.view) {
    items.push(bookletItem(b.view));
  } else if (b.status === 'none') {
    items.push({ key: 'booklet', title: 'Subscription booklet', tone: 'none', word: 'None on the platform', left: false,
      sub: 'No subscription booklet is recorded on the platform for your account.' });
  }
  const rows = Array.isArray(holdings) ? holdings : [];
  if (rows.length) {
    const signed = rows.filter((h) => h?.lpa_signed);
    if (signed.length === rows.length) {
      const day = signed.map((h) => isoDay(h.lpa_signed_at)).filter(Boolean).sort().pop();
      items.push({ key: 'lpa', title: 'Limited partnership agreement', tone: 'ok', word: 'Signed', left: false,
        sub: day ? `signed ${dayLabel(day)}` : 'signed · date not recorded' });
    } else {
      items.push({ key: 'lpa', title: 'Limited partnership agreement', tone: 'due', word: 'Not signed', left: true,
        sub: 'Signing is recorded with its date. It commits no amount.', href: '#my-commitment', action: 'Open the LPA' });
    }
  }
  const loading = b.status === 'loading';
  // `complete`: every source was read, so "nothing left" is a claim the page can make.
  return { items, left: items.filter((i) => i.left).length, loading, complete: !loading && !items.some((i) => i.tone === 'unavailable') };
}

function bookletItem(view) {
  const title = 'Subscription booklet';
  const submitted = dayLabel(view.submitted_at);
  const signing = view.signing || {};
  if (view.status === 'open') {
    return { key: 'booklet', title, tone: 'due', word: 'Open', left: true,
      sub: 'Read each part, tick what applies, then submit it.', href: '#subscription-booklet', action: 'Continue the booklet' };
  }
  if (view.status !== 'submitted') {
    return { key: 'booklet', title, tone: 'none', word: 'Not recorded', left: false, sub: 'The booklet returned a state this page does not know.' };
  }
  const on = submitted ? `submitted ${submitted}` : 'submitted · date not recorded';
  switch (signing.state) {
    case 'not_sent':
      return { key: 'booklet', title, tone: 'due', word: 'Ready to sign', left: true, sub: on, href: '#subscription-booklet', action: 'Sign the booklet' };
    case 'sent':
      return { key: 'booklet', title, tone: 'due', word: 'Out for your signature', left: true, sub: `${on} · open the signing link we emailed you` };
    case 'awaiting_gp':
      return { key: 'booklet', title, tone: 'pending', word: 'Waiting for the General Partner', left: false,
        sub: `${on}${dayLabel(signing.signed_at) ? ` · you signed ${dayLabel(signing.signed_at)}` : ''}` };
    case 'accepted':
      return { key: 'booklet', title, tone: 'ok', word: 'Complete', left: false,
        sub: `${on} · General Partner signed ${dayLabel(signing.accepted_at) || '(date not recorded)'}` };
    case 'void':
      return { key: 'booklet', title, tone: 'due', word: 'Signature request voided', left: true,
        sub: 'Ask Axal VC to withdraw the booklet so you can open a new one.' };
    default:
      return { key: 'booklet', title, tone: 'none', word: 'Submitted', left: false, sub: on };
  }
}

export const ARRIVED_SHOWN = 3;

/**
 * What arrived (VF-04): the latest notices, statements and reports issued to
 * the reader, newest first. `notices` is `{ status: 'ready'|'unreadable'|'loading', list }`.
 * `unreadable` names each source that could not be read, so a short list is
 * never mistaken for everything there is.
 */
export function arrivedItems({ portal, notices } = {}) {
  const items = [];
  const unreadable = [];
  const n = notices || { status: 'loading' };
  if (n.status === 'unreadable') unreadable.push('Notices');
  for (const x of n.status === 'ready' && Array.isArray(n.list) ? n.list : []) {
    if (x?.superseded) continue;
    const title = x?.type === 'capital_call_notice' && x.call_number ? `Capital call notice #${x.call_number}` : (x?.title || 'Notice');
    items.push({ key: `notice-${x.uid}`, kind: 'Notice', title, on: isoDay(x.notice_date), amount_cents: Number.isSafeInteger(x?.amount_cents) ? x.amount_cents : null, href: '#my-notices', action: 'Open' });
  }
  if (portal?.capital_statements_recorded === false) unreadable.push('Capital statements');
  for (const s of Array.isArray(portal?.capital_statements) ? portal.capital_statements : []) {
    const rev = Number(s?.revision) > 1 ? ` · revision ${Number(s.revision)}` : '';
    items.push({ key: `statement-${s.uid}`, kind: 'Statement', title: `Capital statement${s?.period_label ? ` · ${s.period_label}` : ''}`, on: isoDay(s?.issued_at), extra: rev, href: '#reports', action: 'Open' });
  }
  if (portal?.fee_statements_recorded === false) unreadable.push('Fee statements');
  for (const s of Array.isArray(portal?.fee_statements) ? portal.fee_statements : []) {
    items.push({ key: `fee-${s.uid}`, kind: 'Statement', title: `Management fee statement${s?.period_label ? ` · ${s.period_label}` : ''}`, on: isoDay(s?.issued_at), href: '#my-commitment', action: 'Open' });
  }
  for (const p of Array.isArray(portal?.report_periods) ? portal.report_periods : []) {
    items.push({ key: `report-${p.id}`, kind: 'Report', title: `Quarterly report${p?.period ? ` · ${p.period}` : ''}`, on: isoDay(p?.issued_at), href: '#reports', action: 'Open' });
  }
  const ordered = items.map((it, i) => ({ it, i })).sort((a, b) => {
    if (a.it.on && b.it.on && a.it.on !== b.it.on) return a.it.on > b.it.on ? -1 : 1;
    if (!!a.it.on !== !!b.it.on) return a.it.on ? -1 : 1;
    return a.i - b.i;
  }).map(({ it }) => ({ ...it, date: it.on ? `issued ${dayLabel(it.on)}` : 'issue date not recorded' }));
  return { items: ordered.slice(0, ARRIVED_SHOWN), total: ordered.length, unreadable, loading: n.status === 'loading' };
}

/**
 * The commitment figures (VF-04 "My commitment · Fund I"), for one holding.
 * Each value is cents, a multiple, or null with the reason it is missing —
 * never a zero that the record does not hold. `fundId` picks the Fund I row;
 * with none given, a reader holding exactly one fund gets that one.
 */
export function commitmentFigures(portal, { fundId = null, today } = {}) {
  const rows = commitmentsByFund(portal, today);
  const row = fundId != null ? rows.find((r) => r.fund_id === Number(fundId)) : (rows.length === 1 ? rows[0] : null);
  if (!row) return null;
  const calls = row.calls_known ? `${row.calls.length} capital call${row.calls.length === 1 ? '' : 's'}` : 'calls could not be read';
  const noMultiple = 'nothing paid in yet, so no multiple';
  return {
    fund_name: row.fund_name,
    figures: [
      { key: 'committed', label: 'Committed (to date)', cents: row.commitment_cents, note: row.committed_on ? `recorded ${dayLabel(row.committed_on)}` : 'limited partner record' },
      { key: 'called', label: 'Called (to date)', cents: row.called_cents, note: calls, unreadable: !row.calls_known },
      // Not "Paid in": My commitment's Paid in is the record's invested amount, a different figure.
      { key: 'paid', label: 'Received on calls (to date)', cents: row.settled_cents, note: 'settled against capital calls', unreadable: !row.calls_known },
      { key: 'uncalled', label: 'Uncalled', cents: row.uncalled_cents, note: 'committed − called', unreadable: !row.calls_known },
      { key: 'distributions', label: 'Distributions (to date)', cents: row.distributed_cents, note: row.distributions.some((d) => d.status === 'paid') ? 'paid distributions' : 'none paid yet' },
      { key: 'tvpi', label: 'TVPI (to date)', multiple: row.tvpi, note: row.tvpi == null ? noMultiple : 'value ÷ paid in' },
      { key: 'dpi', label: 'DPI (to date)', multiple: row.dpi, note: row.dpi == null ? noMultiple : 'distributions ÷ paid in' },
    ],
    over_called: row.over_called,
  };
}
