import { currencyCode, parseMinor } from '../../../lib/money.js';
import { finite, money, statementAllowsPaidInFull } from './revenueModel.js';

/**
 * D5039 (#5039 part 2; canvas RV05, RV05b) — the rules of the statement
 * drawer's governed actions, pure for the Node test. The Worker is the gate
 * (`routes/admin_statements.ts`, `services/statementActions.ts`); these say
 * what to offer, what the before → after will be, and what an answer means.
 *
 * THE FLOWS.
 *   Record a payment   Prepare → Review → Confirm → Authenticate → Receipt
 *   Mark issued        Prepare → Review → Confirm → Receipt   (no money moves, no step-up)
 *   Void               Scope → Review → Authenticate → Result (destructive; the step-up applies)
 *
 * WHAT AN ANSWER MEANS (`classifyOutcome`). Five outcomes, never folded:
 *   settled   a payment applied, and nothing is outstanding
 *   partial   a payment applied, and some is still outstanding
 *   applied   Mark issued or Void applied
 *   refused   the Worker said no; nothing was written
 *   stale     the statement changed after it was opened; nothing was written
 *   unknown   no answer, a timeout or a server error: the action may or may
 *             not have landed. It is never drawn as success, and "Check
 *             again" resends the SAME key, which the Worker replays.
 */

export const ACTION_REASON_MIN = 10;
export const PAYMENT_REFERENCE_MAX = 120;

export const FLOW_STEPS = Object.freeze({
  record_payment: Object.freeze(['Prepare', 'Review', 'Confirm', 'Authenticate', 'Receipt']),
  issue: Object.freeze(['Prepare', 'Review', 'Confirm', 'Receipt']),
  void: Object.freeze(['Scope', 'Review', 'Authenticate', 'Result']),
  record_dispute: Object.freeze(['Prepare', 'Review', 'Confirm', 'Authenticate', 'Receipt']),
  set_due_date: Object.freeze(['Prepare', 'Review', 'Confirm', 'Authenticate', 'Receipt']),
});

/** The step a flow is on while its request is out: Authenticate where the step-up applies, else Confirm. */
export function pendingStep(kind) {
  const steps = FLOW_STEPS[kind];
  return steps.includes('Authenticate') ? 'Authenticate' : 'Confirm';
}

export const ACTION_LABEL = Object.freeze({
  record_payment: 'Record a payment',
  issue: 'Mark issued',
  void: 'Void statement',
  record_dispute: 'Record dispute',
  set_due_date: 'Set due date',
});

/** A key the Worker accepts (`IDEMPOTENCY_KEY_RE`), minted once per prepared action. */
export function newIdempotencyKey(kind = 'action') {
  const rand = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `rv-${kind}-${rand}`;
}

/** The revision the drawer read. A row from before migration 202611090909 reads 0, as the Worker's default. */
export const revisionOf = (s) => (Number.isSafeInteger(Number(s?.revision)) ? Number(s.revision) : 0);

/**
 * Which actions this statement offers, and why one is not offered. A reason
 * is shown beside the control rather than hiding it, so the operator learns
 * what would make it possible.
 */
export function actionAvailability(s) {
  const status = s?.status;
  const paid = finite(s?.paid_cents);
  const complete = statementAllowsPaidInFull(s);
  return {
    issue: status === 'draft'
      ? (complete ? { offered: true } : { offered: false, why: 'Mark issued is unavailable while the owed figure is a floor: some streams were not reported or were estimated.' })
      : { offered: false, why: null },
    record_payment: status === 'issued'
      ? { offered: true }
      : (status === 'draft' ? { offered: false, why: 'A payment is recorded against an issued statement. Mark it issued first.' } : { offered: false, why: null }),
    void: (status === 'draft' || status === 'issued')
      ? (paid === 0 ? { offered: true } : {
        offered: false,
        why: paid === null
          ? 'The paid figure could not be read, so a void cannot be checked against it. Reload the statement.'
          : 'A payment is recorded against this statement, so it cannot be voided. Record a dispute for the part that is wrong.',
      })
      : { offered: false, why: null },
  };
}

/** The reason, or why it is not enough. */
export function reasonError(text) {
  const t = String(text ?? '').trim();
  return t.length < ACTION_REASON_MIN
    ? `Say why, in at least ${ACTION_REASON_MIN} characters: it is what an auditor reads.`
    : null;
}

/** The three figures a before → after needs, or null when any of them is unreadable. Never 0 for unknown. */
function readFigures(s) {
  const owed = finite(s?.owed_cents);
  const paid = finite(s?.paid_cents);
  const disputed = finite(s?.disputed_cents);
  if (owed === null || paid === null || disputed === null) return null;
  return { owed, paid, disputed, outstanding: Math.max(0, owed - paid - disputed) };
}

/**
 * Record a payment's Prepare step: the typed amount read in the statement's
 * own currency, the before → after it would make, or why it cannot be
 * recorded. Mirrors `planStatementAction`; the Worker decides.
 */
export function paymentPreview({ statement: s, amountText, reference, reason }) {
  const cur = currencyCode(s?.currency);
  if (!cur) return { error: 'This statement has no currency StudioOS can price in, so a payment cannot be read as an amount.' };
  const f = readFigures(s);
  if (!f) return { error: 'This statement’s owed, paid or disputed figure could not be read, so the after cannot be shown. Reload it first.' };
  const text = String(amountText ?? '').trim();
  if (text === '') return { error: `Enter the amount received, in ${cur}.` };
  const parsed = parseMinor(text, cur);
  if (!parsed.ok) return { error: `The amount: ${parsed.message}` };
  const amount = parsed.minor;
  if (amount <= 0) return { error: 'A payment is more than nothing. To clear a figure, record a dispute instead.' };
  if (f.paid + amount + f.disputed > f.owed) {
    return { error: `That is more than the ${money(f.outstanding, cur)} still open on this statement.` };
  }
  const ref = String(reference ?? '').trim();
  if (ref.length > PAYMENT_REFERENCE_MAX) return { error: `The bank reference is at most ${PAYMENT_REFERENCE_MAX} characters.` };
  const why = reasonError(reason);
  if (why) return { error: why };
  const paidAfter = f.paid + amount;
  if (paidAfter === f.owed && !statementAllowsPaidInFull(s)) {
    return { error: 'This owed figure is a floor, so it cannot be paid in full.' };
  }
  const settles = paidAfter === f.owed;
  return {
    amount,
    amountLabel: money(amount, cur),
    currency: cur,
    settles,
    body: { amount_cents: amount, reference: ref || null, reason: String(reason).trim() },
    rows: [
      { label: 'Paid · recorded by HQ', before: money(f.paid, cur), after: money(paidAfter, cur) },
      { label: 'Outstanding', before: money(f.outstanding, cur), after: money(f.outstanding - amount, cur) },
      { label: 'Status', before: 'Issued', after: settles ? 'Paid' : 'Issued · part paid' },
    ],
  };
}

/** Mark issued's and Void's Review rows. Unknown figures read Not recorded, never 0. */
export function statusPreview(kind, s) {
  const cur = currencyCode(s?.currency);
  const show = (cents) => (cur && finite(cents) !== null ? money(cents, cur) : 'Not recorded');
  const f = readFigures(s);
  const status = s?.status === 'issued' ? 'Issued' : 'Draft';
  if (kind === 'issue') {
    return [
      { label: 'Status', before: 'Draft', after: 'Issued · sent to the subsidiary' },
      { label: 'Owed to HQ', before: show(s?.owed_cents), after: show(s?.owed_cents) },
    ];
  }
  return [
    { label: 'Status', before: status, after: 'Void · withdrawn' },
    { label: 'Owed to HQ', before: show(s?.owed_cents), after: 'Withdrawn' },
    { label: 'Outstanding', before: f && cur ? money(f.outstanding, cur) : 'Not recorded', after: 'None: a void claim is not owed' },
  ];
}

/** The body a governed action sends: its fields plus the reason, the revision it read and its key. */
export function actionBody({ kind, statement, fields = {}, reason, key }) {
  return {
    ...(['record_payment', 'record_dispute', 'set_due_date'].includes(kind) ? fields : {}),
    reason: String(reason ?? '').trim(),
    expected_revision: revisionOf(statement),
    idempotency_key: key,
  };
}

/**
 * What an answer means. `result` is the Worker's reply; `error` what
 * `request` threw. An error with no status, a timeout or a 5xx is UNKNOWN: the
 * request may have landed, and only a replay of the same key can say.
 */
export function classifyOutcome({ kind, result, error }) {
  if (result && !error) {
    if (result.outcome !== 'applied') {
      return { kind: 'unknown', title: 'Outcome unknown', message: 'The server answered without saying the action was applied. Check again before doing anything else.' };
    }
    const replayed = result.replayed === true;
    if (kind === 'record_payment') {
      return result.settled
        ? { kind: 'settled', title: 'Payment recorded · statement paid', replayed }
        : { kind: 'partial', title: 'Payment recorded · part still outstanding', replayed };
    }
    return { kind: 'applied', title: ({ void: 'Statement voided', issue: 'Statement marked issued', record_dispute: 'Dispute recorded', set_due_date: 'Due date recorded' })[kind], replayed };
  }
  const status = Number(error?.status);
  const code = error?.code || error?.data?.error || error?.data?.code || null;
  if (!Number.isFinite(status) || status === 0 || status >= 500 || code === 'timeout') {
    return {
      kind: 'unknown',
      title: 'Outcome unknown',
      message: 'No answer came back, so it is not known whether this was recorded. Do not record it again: Check again asks the server with the same key, and it will not be applied twice.',
    };
  }
  if (status === 409 && code === 'changed_since_open') {
    return {
      kind: 'stale',
      title: 'The statement changed after you opened it',
      message: 'Nothing was written. Review it as it stands now and prepare the action again.',
      current: error?.data?.current || null,
    };
  }
  if (status === 403 && code === 'step_up_required') {
    return { kind: 'refused', title: 'Not authenticated', message: 'The authenticator code was not entered, so nothing was written.' };
  }
  return {
    kind: 'refused',
    title: 'Refused · nothing was written',
    message: error?.data?.message || error?.message || 'The server refused this action.',
    code,
  };
}

/** The receipt's facts, from the Worker's reply only. A figure it did not return reads Not returned. */
export function receiptRows(result) {
  const r = result?.receipt || {};
  const cur = currencyCode(r.currency);
  const show = (cents) => (cur && finite(cents) !== null ? money(cents, cur) : 'Not returned');
  const rows = [];
  if (finite(r.amount_cents) !== null) rows.push(['Amount', show(r.amount_cents)]);
  if (r.reference) rows.push(['Bank reference', r.reference]);
  rows.push(['Reason', r.reason || 'Not returned']);
  rows.push(['Recorded at', typeof r.at === 'string' ? r.at.replace('T', ' ').slice(0, 16) + ' UTC' : 'Not returned']);
  rows.push(['Receipt', r.action_uid || 'Not returned']);
  const b = result?.before;
  const a = result?.after;
  if (b && a) {
    if (result.action === 'set_due_date') rows.push(['Due date', `${b.due_on || 'Not recorded'} → ${a.due_on || 'Not recorded'}`]);
    if (result.action === 'record_dispute') rows.push(['Disputed', `${show(b.disputed_cents)} → ${show(a.disputed_cents)}`]);
    rows.push(['Outstanding', `${show(b.outstanding_cents)} → ${show(a.outstanding_cents)}`]);
    rows.push(['Status', `${b.status || 'Not returned'} → ${a.status || 'Not returned'}`]);
  }
  return rows;
}

/** Preview explicit adjustments without substituting zero for unknown figures. */
export function adjustmentPreview({ kind, statement: s, amountText, dueOn, reason }) {
  const why = reasonError(reason);
  if (why) return { error: why };
  if (!['draft', 'issued'].includes(s?.status)) return { error: 'Only a draft or issued statement can be adjusted.' };
  if (kind === 'set_due_date') {
    const value = dueOn || null;
    if (value) {
      const d = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) return { error: 'Enter a real calendar date.' };
    }
    return { body: { due_on: value }, rows: [{ label: 'Due date · UTC', before: s.due_on || 'Not recorded', after: value || 'Not recorded · cleared' }] };
  }
  const cur = currencyCode(s?.currency);
  const f = readFigures(s);
  if (!cur || !f) return { error: 'The currency or statement figures cannot be read. Reload first.' };
  if (!String(amountText ?? '').trim()) return { error: 'Enter a disputed amount, or 0 to clear it.' };
  const p = parseMinor(amountText, cur);
  if (!p.ok) return { error: p.message };
  if (p.minor < 0 || f.paid + p.minor > f.owed) return { error: 'Paid and disputed together cannot exceed owed.' };
  return {
    body: { disputed_cents: p.minor },
    rows: [
      { label: 'Disputed', before: money(f.disputed, cur), after: money(p.minor, cur) },
      { label: 'Outstanding', before: money(f.outstanding, cur), after: money(f.owed - f.paid - p.minor, cur) },
    ],
  };
}

/**
 * One prepared action's sender. A second `run` while one is out returns null
 * and sends nothing (the double-submit guard does not wait for a re-render),
 * and every answer comes back classified. "Check again" calls `run` with the
 * same body, so the same key.
 */
export function createActionRunner(onSubmit) {
  let inFlight = false;
  return {
    get busy() { return inFlight; },
    async run(kind, uid, body) {
      if (inFlight) return null;
      inFlight = true;
      let result = null;
      let error = null;
      try { result = await onSubmit(kind, uid, body); } catch (e) { error = e; } finally { inFlight = false; }
      return { ...classifyOutcome({ kind, result, error }), result };
    },
  };
}
