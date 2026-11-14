/**
 * D1163 (#3070, part 6 of #2388) — the arithmetic and words of Capital calls
 * and Distributions (FND7–FND9), apart from the pages so a Node test holds
 * them.
 *
 * Money arrives as integer cents from the call ledger
 * (`GET /api/funds/:id/capital-calls`) and the distribution preview, and is
 * summed as integers. A figure the Worker did not send is `null` and reads
 * "Not recorded", never $0.00. A due date is never filled in for the admin.
 */
import { formatCents, parseDollarsToCents } from '../../investor/fundCallsModel';
import { NOT_RECORDED } from '../../../lib/absence';

export { NOT_RECORDED };

/** A person is named, never shown by email or by number: an LP with no name on record says so. */
export const lpName = (x) => x?.lp_name || x?.name || 'Name not recorded';
export const money = (cents) => formatCents(cents) ?? NOT_RECORDED;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Every line on the fund that still owes something: the numbered calls' and the earlier ones'. */
export function owingLines(ledger) {
  const calls = Array.isArray(ledger?.calls) ? ledger.calls : [];
  const legacy = Array.isArray(ledger?.unnumbered) ? ledger.unnumbered : [];
  return [...calls.flatMap((c) => (c.lines || []).map((l) => ({ ...l, call_number: c.call_number }))), ...legacy.map((l) => ({ ...l, call_number: null }))]
    .filter((l) => l.state !== 'paid' && Number(l.outstanding_cents) > 0);
}

/** FND7's age bands, in the order the chart draws them. */
export const AGE_BANDS = Object.freeze([
  { key: 'not_due', label: 'Not yet due' },
  { key: 'no_due', label: 'No due date recorded' },
  { key: 'd1_30', label: '1 to 30 days overdue', min: 1, max: 30 },
  { key: 'd31_60', label: '31 to 60 days overdue', min: 31, max: 60 },
  { key: 'd61_90', label: '61 to 90 days overdue', min: 61, max: 90 },
  { key: 'd90', label: 'Over 90 days overdue', min: 91, max: Infinity },
]);

/** The band one owing line falls in. A line with no due date is never "not yet due". */
export function ageBand(line) {
  if (line.state === 'overdue' && Number.isInteger(line.days_overdue)) {
    return AGE_BANDS.find((b) => b.min != null && line.days_overdue >= b.min && line.days_overdue <= b.max)?.key || 'd1_30';
  }
  return line.due_date ? 'not_due' : 'no_due';
}

/**
 * "Outstanding by age" (FND7): what is owed, in each band, summed in cents.
 * The note names the band holding most of it; with nothing owed it says so.
 */
export function ageChart(ledger) {
  const lines = owingLines(ledger);
  const cents = Object.fromEntries(AGE_BANDS.map((b) => [b.key, 0]));
  for (const l of lines) cents[ageBand(l)] += Number(l.outstanding_cents);
  const rows = AGE_BANDS.map((b) => ({ key: b.key, label: b.label, value: cents[b.key] / 100, cents: cents[b.key], text: money(cents[b.key]) }));
  const total = lines.reduce((n, l) => n + Number(l.outstanding_cents), 0);
  if (!total) return { empty: true, rows, total, note: 'Nothing is outstanding on this fund.', alt: 'Nothing is outstanding on this fund.', table: { head: ['Age', 'Outstanding'], rows: rows.map((r) => [r.label, r.text]) } };
  const most = rows.reduce((a, b) => (b.cents > a.cents ? b : a));
  const note = `Most of what is outstanding (${most.text} of ${money(total)}) is ${most.label.toLowerCase()}.`;
  return {
    empty: false, rows, total, note,
    alt: `Outstanding by age: ${rows.filter((r) => r.cents).map((r) => `${r.text} ${r.label.toLowerCase()}`).join('; ')}.`,
    table: { head: ['Age', 'Outstanding'], rows: rows.map((r) => [r.label, r.text]) },
  };
}

/** The soonest due date on a line still owed and not yet overdue, or null. */
export function nextDue(ledger) {
  const dates = owingLines(ledger).filter((l) => l.state !== 'overdue' && l.due_date).map((l) => String(l.due_date).slice(0, 10)).sort();
  return dates[0] || null;
}

/** FND7's six tiles, from the ledger alone. Collected counts lines marked paid before receipts existed, and says so. */
export function callTiles(ledger) {
  const s = ledger?.summary || null;
  const calls = Array.isArray(ledger?.calls) ? ledger.calls : [];
  const overdue = owingLines(ledger).filter((l) => l.state === 'overdue');
  const oldest = overdue.reduce((n, l) => Math.max(n, Number(l.days_overdue) || 0), 0);
  const collected = s ? Number(s.received_cents) + Number(s.paid_before_receipts_cents || 0) : null;
  const due = nextDue(ledger);
  return [
    { key: 'committed', k: 'Committed', v: s ? money(s.committed_cents) : NOT_RECORDED, note: s ? plural(Number(s.committed_lps || 0), 'LP') : 'The ledger was not read' },
    { key: 'called', k: 'Called', v: s ? money(s.called_cents) : NOT_RECORDED, note: plural(calls.length, 'numbered call') },
    { key: 'received', k: 'Received', v: s ? money(collected) : NOT_RECORDED, tone: 'ok',
      note: s && Number(s.paid_before_receipts_cents) > 0 ? `${money(s.paid_before_receipts_cents)} marked paid before receipts were recorded` : 'Recorded receipts' },
    { key: 'outstanding', k: 'Outstanding', v: s ? money(s.outstanding_cents) : NOT_RECORDED, tone: overdue.length ? 'warn' : null, note: plural(owingLines(ledger).length, 'line') },
    { key: 'overdue', k: 'Overdue lines', v: String(overdue.length), tone: overdue.length ? 'warn' : null, note: overdue.length ? `oldest ${oldest} day${oldest === 1 ? '' : 's'}` : 'None overdue' },
    { key: 'next', k: 'Next due', v: due || 'No line due', note: due ? 'the soonest line still owed' : 'No line still owed has a due date ahead' },
  ];
}

/** A call's one-line state, as the earlier calls list reads it. */
export function callState(call) {
  const lines = call.lines || [];
  const overdue = lines.filter((l) => l.state === 'overdue');
  if (!lines.length) return 'No line recorded';
  if (lines.every((l) => l.state === 'paid')) return 'All lines paid';
  if (overdue.length) {
    const oldest = overdue.reduce((n, l) => Math.max(n, Number(l.days_overdue) || 0), 0);
    return `${plural(overdue.length, 'line')} overdue · ${oldest} day${oldest === 1 ? '' : 's'}`;
  }
  return `${plural(lines.filter((l) => l.state !== 'paid').length, 'line')} still owed`;
}

/**
 * New capital call (FND8 A): an amount in dollars and a due date the admin
 * chooses. The date is never filled in: a missing one is refused, not
 * defaulted.
 */
export function checkNewCall({ amount, due, purpose }) {
  const cents = parseDollarsToCents(amount);
  if (cents == null) return { error: 'Enter the call in dollars, above zero, with at most two decimals.' };
  const d = String(due ?? '').trim();
  if (!d) return { error: 'Choose a due date. It is never filled in for you.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) return { error: 'The due date must be a real date.' };
  const p = String(purpose ?? '').trim().slice(0, 500);
  return { cents, due: d, purpose: p || undefined };
}

/** The preview's share of each LP, as a percentage of the commitments it splits by. */
export function previewRows(preview) {
  const lines = Array.isArray(preview?.lines) ? preview.lines : [];
  const committed = lines.reduce((n, l) => n + Number(l.commitment_cents || 0), 0);
  return lines.map((l) => ({
    ...l,
    name: lpName(l),
    pct: committed > 0 && l.commitment_cents != null ? `${((Number(l.commitment_cents) / committed) * 100).toFixed(2)}%` : NOT_RECORDED,
    flag: l.has_account === false ? 'No platform account · no identity check linked'
      : String(l.kyc_status || '').toLowerCase() === 'approved' ? null
        : l.kyc_status ? `Identity check ${String(l.kyc_status).replace(/_/g, ' ')}` : 'No identity check recorded',
  }));
}

/**
 * The issued call against its preview: the same amount and, for every LP,
 * the same share. The canvas's promise ("The preview and the call show the
 * same figures") is checked, never assumed.
 */
export function figuresMatch(preview, call) {
  if (!preview || !call) return { same: false, differs: [] };
  const owed = new Map((call.lines || []).map((l) => [Number(l.limited_partner_id), Number(l.owed_cents)]));
  const differs = (preview.lines || []).filter((l) => owed.get(Number(l.lp_id)) !== Number(l.share_cents)).map((l) => lpName(l));
  const same = Number(call.amount_cents) === Number(preview.amount_cents) && differs.length === 0 && owed.size === (preview.lines || []).length;
  return { same, differs };
}

/** Record receipt (FND8 E): the full outstanding, or another amount; the date it arrived; a reference. */
export function receiptBody(form, outstandingCents) {
  const cents = form.which === 'full' ? Number(outstandingCents) : parseDollarsToCents(form.amount);
  if (!Number.isSafeInteger(cents) || cents <= 0) return { error: 'Enter the amount received in dollars, above zero, with at most two decimals.' };
  const date = String(form.date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Enter the date the money arrived.' };
  const reference = String(form.reference ?? '').trim().slice(0, 120);
  return { body: { amount_cents: cents, received_on: date, reference: reference || undefined } };
}

/** The L6 refused-notice state: the Worker's own sentence, after the one lead the canvas gives it. */
export function refusedNotice(refusal) {
  const message = typeof refusal === 'string' ? refusal : refusal?.message;
  return `This notice can't issue: ${message || 'the Worker gave no reason.'}`;
}

export const PAGE_SIZES = Object.freeze([{ key: 'letter', label: 'Letter' }, { key: 'a4', label: 'A4' }]);

/** A distribution notice's tax character (D716 decision 5), as the Worker names them. */
export const TAX_CHARACTERS = Object.freeze([
  ['return_of_capital', 'Return of capital'],
  ['long_term_capital_gain', 'Long-term capital gain'],
  ['short_term_capital_gain', 'Short-term capital gain'],
  ['ordinary_income', 'Ordinary income'],
  ['qualified_dividend', 'Qualified dividend'],
  ['tax_withheld', 'Tax withheld'],
]);

export const NOTICE_FINAL = 'Issued notices reach each LP and cannot be withdrawn. A correction is issued as a new notice.';
export const RECEIPT_INFO = 'This records money already received. It moves no money.';
export const MARK_PAID_INFO = 'This marks this payment as made. It records; it moves no money.';
export const EXECUTE_FOOT = 'Execute asks for your authenticator code. The preview and the distribution show the same figures.';

/**
 * The per-LP distribution preview (FND9): each LP by name (D1159's `lp_name`),
 * its share of what goes to the LPs, and a total that equals the sum of its
 * lines.
 */
export function distributionRows(split) {
  const lines = Array.isArray(split?.lines) ? split.lines : [];
  const total = lines.reduce((n, l) => n + Number(l.amount_cents || 0), 0);
  return {
    rows: lines.map((l) => ({
      ...l,
      name: lpName(l),
      pct: total > 0 ? `${((Number(l.amount_cents) / total) * 100).toFixed(2)}%` : NOT_RECORDED,
    })),
    total,
    totalText: money(total),
    // What the job distributes is what the lines hold, plus the cents no line received.
    balances: split?.distributable_cents == null ? null : total + Number(split.unallocated_cents || 0) === Number(split.distributable_cents),
  };
}

/**
 * Cumulative distributions (FND9): each month's paid lines added to the
 * months before. A line not yet paid is not counted, and the note says how
 * many wait.
 */
export function cumulativeDistributions(items) {
  const list = Array.isArray(items) ? items : [];
  const paid = list.filter((d) => d.status === 'paid' && d.distributed_at);
  const byMonth = new Map();
  for (const d of paid) {
    const m = String(d.distributed_at).slice(0, 7);
    byMonth.set(m, (byMonth.get(m) || 0) + Number(d.amount_cents || 0));
  }
  let run = 0;
  const points = [...byMonth.keys()].sort().map((m) => { run += byMonth.get(m); return { label: m, cents: run, value: run / 100 }; });
  const waiting = list.filter((d) => d.status !== 'paid').length;
  const waitNote = waiting ? ` ${plural(waiting, 'line')} not yet paid ${waiting === 1 ? 'is' : 'are'} not counted.` : '';
  return {
    empty: points.length === 0,
    points,
    total: run,
    note: points.length ? `${money(run)} distributed from this fund so far, counting lines marked paid.${waitNote}` : `No distribution line is marked paid yet.${waitNote}`,
    alt: points.length ? `Cumulative distributions: ${points.map((p) => `${money(p.cents)} by ${p.label}`).join('; ')}.` : 'No distribution line is marked paid yet.',
    table: { head: ['Month', 'Distributed to date'], rows: points.map((p) => [p.label, money(p.cents)]) },
  };
}
