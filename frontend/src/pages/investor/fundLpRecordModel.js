/**
 * D6236 (#6236) — one LP's record, as the Fund · LPs drawer shows it: pure
 * functions over the reads that already exist, so a Node test can hold them.
 *
 *   register row   GET /api/funds/:id/lps (the page's own read)
 *   calls          GET /api/funds/:id/ledger?lp=<id>   (lines and receipts)
 *   comms          GET /api/funds/:id/comms?lp=<id>
 *   statement      GET /api/funds/:id/lp-report/:lpId (the LP-portal shape)
 *
 * Money from the ledger and distributions is integer cents; nothing here turns
 * it into a float. A figure that was not sent is null and prints as absent,
 * never as zero.
 */
import { formatCents } from './fundCallsModel';
import { titleCase } from '../../lib/absence';

/** `?lp=` as an LP id, or null. */
export function lpParam(raw) {
  const s = String(raw ?? '').trim();
  return /^\d{1,15}$/.test(s) && Number(s) > 0 ? Number(s) : null;
}

const day = (v) => (v ? String(v).slice(0, 10) : null);
const whole = (v) => (v != null && Number.isSafeInteger(Number(v)) ? Number(v) : null);

/** Cents as money, or "Not recorded". */
export const moneyText = (cents) => formatCents(cents) ?? 'Not recorded';

/**
 * KYC and where it comes from. An LP with no platform account has no KYC
 * record: that reads "No account", never pending.
 */
export function kycOf(lp) {
  if (!lp || lp.account_user_id == null) {
    return { label: 'No account', tone: 'none', source: 'No platform account is linked, so there is no KYC record.' };
  }
  const s = String(lp.kyc_status || '').trim();
  if (!s) return { label: 'Not recorded', tone: 'none', source: 'Their linked account has no KYC status.' };
  const tone = s.toLowerCase() === 'approved' ? 'ok' : ['rejected', 'failed'].includes(s.toLowerCase()) ? 'bad' : 'wait';
  return { label: titleCase(s), tone, source: 'From their linked account.' };
}

/** The LPA: signed (with its date when one is recorded) or not. */
export function lpaOf(lp) {
  if (!lp?.lpa_signed) return { label: 'Not signed', tone: 'wait' };
  const on = day(lp.lpa_signed_at);
  return { label: on ? `Signed ${on}` : 'Signed · date not recorded', tone: 'ok' };
}

/**
 * The LP's call lines with the receipts recorded against each, newest first.
 * `outstanding` is null when the owed figure is not a whole number of cents.
 */
export function callLines(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const receipts = list.filter((e) => e?.kind === 'receipt');
  const lines = list.filter((e) => e?.kind === 'line').map((line) => {
    const mine = receipts.filter((r) => Number(r.capital_call_id) === Number(line.id));
    const owed = whole(line.amount_cents);
    const paidStatus = String(line.status || '').toLowerCase() === 'paid';
    // A line marked paid before receipts were recorded owes nothing, and what was received is not on record.
    if (paidStatus && !mine.length) {
      return { id: line.id, call: line.call_number != null ? `Call ${line.call_number}` : 'Before numbering', due: day(line.due_date), owed, received: null, outstanding: 0, state: 'Paid · no receipt recorded', receipts: [] };
    }
    const amounts = mine.map((r) => whole(r.amount_cents));
    const received = amounts.every((a) => a != null) ? amounts.reduce((s, a) => s + a, 0) : null;
    const outstanding = owed != null && received != null ? Math.max(owed - received, 0) : null;
    let state;
    if (outstanding === 0) state = mine.length ? 'Paid' : 'Nothing owed';
    else if (received != null && received > 0) state = 'Part received';
    else state = titleCase(line.status) || 'Pending';
    return {
      id: line.id, call: line.call_number != null ? `Call ${line.call_number}` : 'Before numbering',
      due: day(line.due_date), owed, received, outstanding, state, receipts: mine,
    };
  });
  const linked = new Set(lines.map((l) => Number(l.id)));
  const loose = receipts.filter((r) => !linked.has(Number(r.capital_call_id)));
  return { lines, loose };
}

/** Called to date across the LP's lines, or null when any owed figure is missing or the read was cut short. */
export function calledToDate(lines, truncated) {
  if (truncated || !lines.every((l) => l.owed != null)) return null;
  return lines.reduce((s, l) => s + l.owed, 0);
}

/**
 * The statement as the LP sees it, from `lp-report` (`performance[0]`, in
 * dollars as the LP portal sends it), plus the LP's issued statements.
 */
export function statementOf(report) {
  const p = Array.isArray(report?.performance) ? report.performance[0] : null;
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    found: !!p,
    commitment: num(p?.commitment),
    paidIn: num(p?.invested_amount),
    distributed: num(p?.distributions_dollars),
    tvpi: num(p?.tvpi),
    issued: Array.isArray(report?.capital_statements) ? report.capital_statements : [],
    issuedRecorded: report?.capital_statements_recorded !== false,
  };
}

/** Dollars (the LP portal's unit) as money, or "Not recorded". */
export function dollarsText(v) {
  if (v == null || !Number.isFinite(Number(v))) return 'Not recorded';
  return `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const DIST_TYPE = { return_of_capital: 'Return of capital', profit_share: 'Profit share', exit_proceeds: 'Exit proceeds' };

/** One distribution row for the drawer. */
export function distributionRow(d) {
  return {
    id: d?.id,
    on: day(d?.distributed_at) || (d?.status === 'paid' ? 'Paid · date not recorded' : 'Not paid yet'),
    amount: moneyText(d?.amount_cents),
    type: DIST_TYPE[d?.distribution_type] || titleCase(d?.distribution_type) || 'Not recorded',
    status: titleCase(d?.status) || 'Not recorded',
  };
}

/** The body `POST /api/funds/:id/comms` takes for this LP, or the sentence that says why not. */
export function commBody(lpId, form) {
  const subject = String(form?.subject || '').trim();
  if (!subject) return { error: 'A logged message needs its subject, so the log says what was sent.' };
  if (subject.length > 200) return { error: 'The subject is at most 200 characters.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(form?.sentOn || ''))) return { error: 'When it was sent must be a date.' };
  const body = { lp_id: lpId, kind: form.kind, subject, sent_at: form.sentOn };
  if (form.callId) body.capital_call_id = Number(form.callId);
  return { body };
}
