import React, { useState } from 'react';
import { currencyCode, parseMinor } from '../../../lib/money.js';
import { UNRECORDED_CURRENCY, money, statementAllowsPaidInFull } from './revenueModel.js';

/**
 * D5039 — the statement entry HQ has today (D453, D458, D514), moved here from
 * `RevenuePage.jsx` unchanged when the page was split. The statement drawer
 * mounts `StatementActions` as its footer. The governed versions the canvas
 * draws (Record a payment with before → after, RV05b; Mark issued and Void
 * behind a reason) are the next slice of #5039, so nothing here was redesigned
 * or weakened: the payloads refuse what the Worker refuses, and the Worker is
 * the gate.
 */

/** Quarter period the statement routes accept (YYYY-Qn). */
export const STATEMENT_PERIOD_RE = /^\d{4}-Q[1-4]$/;

export function statementDrawPayload({ licenceUid, period }) {
  if (!licenceUid) return { error: 'Choose the licence to draw a statement for.' };
  const p = String(period || '').trim();
  if (!STATEMENT_PERIOD_RE.test(p)) return { error: 'The period is a quarter, written YYYY-Qn.' };
  return { licenceUid, period: p };
}

/**
 * Paid and disputed amounts leave as integer minor units. A blank payment is
 * refused; zero is allowed when nothing was received.
 */
export function statementPaidPayload({ amountText, note, owedCents, currency }) {
  const text = String(amountText ?? '').trim();
  if (text === '') return { error: 'Enter what was received, in the licence currency. 0 is valid when nothing arrived.' };
  if (!currencyCode(currency)) return { error: 'This statement has no recorded currency, so what was received cannot be read as an amount.' };
  const parsed = parseMinor(text, currency);
  if (!parsed.ok) return { error: `The paid amount: ${parsed.message}` };
  const paid_cents = parsed.minor;
  const owed = Number(owedCents);
  if (Number.isFinite(owed) && paid_cents > owed) {
    return { error: `That is more than the ${money(owed, currency)} this statement claims.` };
  }
  return { body: { paid_cents, paid_note: String(note ?? '').trim() || null } };
}

export function statementVoidPayload({ note }) {
  const void_note = String(note ?? '').trim();
  if (void_note.length < 10) {
    return { error: 'Voiding must say why — at least ten characters, read by whoever audits it.' };
  }
  return { body: { status: 'void', void_note } };
}


/**
 * D514 — 0 clears a dispute (and needs no reason); anything above 0 must say
 * why. The worker refuses paid and disputed together above owed.
 */
export function statementDisputePayload({ amountText, note, currency }) {
  const text = String(amountText ?? '').trim();
  if (text === '') return { error: 'Enter the disputed amount, or 0 to clear the dispute.' };
  if (!currencyCode(currency)) return { error: 'This statement has no recorded currency, so the disputed amount cannot be read.' };
  const parsed = parseMinor(text, currency);
  if (!parsed.ok) return { error: `The disputed amount: ${parsed.message}` };
  const disputed_cents = parsed.minor;
  if (disputed_cents === 0) return { body: { disputed_cents: 0 } };
  const dispute_note = String(note ?? '').trim();
  if (!dispute_note) return { error: 'A dispute must say why — a subsidiary will ask HQ to justify it.' };
  return { body: { disputed_cents, dispute_note } };
}

/** D514 — "Mark as issued" is offered on a complete draft only; the worker refuses a floor. */
export function statementAllowsIssue(statement) {
  return !!statement && statement.status === 'draft' && statementAllowsPaidInFull(statement);
}

/** Licences that carry a revenue share and are active can be drawn. */
export function licencesDrawableForStatements(licences) {
  if (!Array.isArray(licences)) return [];
  return licences.filter(
    (l) => l.revenue_share_bps !== null && l.revenue_share_bps !== undefined && l.status === 'active',
  );
}

/** D514 — how many statements in `currency` are floors (drawn over unreported or estimated streams). */
export function floorsInCurrency(items, currency) {
  return (Array.isArray(items) ? items : [])
    .filter((s) => (currencyCode(s.currency) || UNRECORDED_CURRENCY) === currency && s.status !== 'void' && !statementAllowsPaidInFull(s)).length;
}

/**
 * D514 — the facts the payload carried and the row never drew (canvas H10):
 * the balance outstanding, when the payment was entered, and how fresh the
 * reports were. A dispute stores no who or when, and the row says so rather
 * than leaving the reader to assume one.
 */
export function StatementFacts({ statement: s }) {
  if (!s) return null;
  const when = (v) => (v ? String(v).slice(0, 10) : null);
  return (
    <div className="mt-0.5 text-[12px] tabular-nums text-axal-faint" data-testid={`hq-statement-facts-${s.uid}`}>
      {Number.isFinite(Number(s.outstanding_cents)) ? `outstanding ${money(s.outstanding_cents, s.currency)}` : 'outstanding not recorded'}
      {' · '}{s.paid_at ? `paid total entered ${when(s.paid_at)}` : 'no payment entered'}
      {' · '}{s.reports_as_of ? `reports as of ${when(s.reports_as_of)}` : 'reports as of: Not recorded'}
      {s.disputed_cents > 0 && ' · who entered the dispute, and when, is not recorded'}
    </div>
  );
}

/**
 * HQ-entered half of a statement: issue, record paid or disputed, void.
 */
export function StatementActions({ statement, onUpdate }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [paid, setPaid] = useState({ amount: '', note: '' });
  const [dispute, setDispute] = useState({ amount: '', note: '' });
  const [voidNote, setVoidNote] = useState('');
  const canPayInFull = statementAllowsPaidInFull(statement);
  const canIssue = statementAllowsIssue(statement);
  if (!statement?.uid) return null;
  const rowLabel = `${statement.brand_name || statement.licence_ref || statement.licence_uid || statement.uid} ${statement.period || ''}`.trim();

  const patch = async (body) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      await onUpdate(statement.uid, body);
      setMsg({ err: false, text: 'Saved.' });
      setPaid({ amount: '', note: '' });
      setDispute({ amount: '', note: '' });
    } catch (err) {
      setMsg({ err: true, text: err?.data?.message || err?.message || 'The update was not saved.' });
    } finally {
      setBusy(false);
    }
  };

  const submitPaid = (e) => {
    e.preventDefault();
    const p = statementPaidPayload({ amountText: paid.amount, note: paid.note, owedCents: statement.owed_cents, currency: statement.currency });
    if (p.error) { setMsg({ err: true, text: p.error }); return; }
    patch(p.body);
  };

  const submitDispute = (e) => {
    e.preventDefault();
    const p = statementDisputePayload({ amountText: dispute.amount, note: dispute.note, currency: statement.currency });
    if (p.error) { setMsg({ err: true, text: p.error }); return; }
    patch(p.body);
  };

  const submitVoid = (e) => {
    e.preventDefault();
    const p = statementVoidPayload({ note: voidNote });
    if (p.error) { setMsg({ err: true, text: p.error }); return; }
    patch(p.body);
  };

  const input = 'w-full rounded-lg border border-axal-hairline bg-axal-ground px-2 py-1 text-[12px]';
  const btn = 'rounded-md border border-axal-hairline px-2 py-1 text-[12px] font-bold disabled:opacity-50';
  const isDraft = statement.status === 'draft';
  const isVoid = statement.status === 'void';

  // D514 — A VOID ROW OFFERS NOTHING FURTHER, and says so: a period holds one
  // statement, and a void one cannot be drawn again.
  if (isVoid) {
    return (
      <p className="mt-2 border-t border-axal-hairline/60 pt-2 text-[12px] text-axal-faint" data-testid={`hq-statement-void-${statement.uid}`}>
        Void. Nothing further can be entered, and this period cannot be drawn again.
      </p>
    );
  }

  return (
    <div className="mt-2 border-t border-axal-hairline/60 pt-2" data-testid={`hq-statement-actions-${statement.uid}`}>
      <div className="flex flex-wrap gap-2">
        {isDraft && (canIssue ? (
          <button type="button" disabled={busy} className={`${btn} bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200`}
            onClick={() => patch({ status: 'issued' })} aria-label={`Mark ${rowLabel} as issued`}>
            Mark as issued
          </button>
        ) : (
          <span className="text-[12px] text-amber-800 dark:text-amber-200" data-testid="hq-statement-no-issue">
            Mark as issued is unavailable while the owed figure is a floor.
          </span>
        ))}
        {!isVoid && (
          <>
            {statement.status === 'paid' ? null : (
              canPayInFull ? (
                <button type="button" disabled={busy} className={btn}
                  onClick={() => patch({ status: 'paid', paid_cents: statement.owed_cents, paid_note: paid.note || 'Marked paid in full' })}>
                  Mark paid in full
                </button>
              ) : (
                <span className="text-[12px] text-amber-800 dark:text-amber-200" data-testid="hq-statement-no-paid-in-full">
                  Paid in full is unavailable while the owed figure is a floor.
                </span>
              )
            )}
          </>
        )}
      </div>
      {!isVoid && (
        <form onSubmit={submitVoid} className="mt-2 space-y-1">
          <div className="text-[12px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Void statement</div>
          <p className="text-[12px] text-axal-faint">A void period cannot be drawn again.</p>
          <input className={input} required minLength={10} placeholder="Why this claim is withdrawn — required" value={voidNote} onChange={(e) => setVoidNote(e.target.value)} aria-label={`Void reason for ${rowLabel}`} />
          <button type="submit" disabled={busy} className={`${btn} border-red-300 text-red-800 dark:border-red-500/40 dark:text-red-300`}>Void</button>
        </form>
      )}
      {!isVoid && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <form onSubmit={submitPaid} className="space-y-1">
            <div className="text-[12px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Set total paid</div>
            <p className="text-[12px] text-axal-faint">Replaces the total received so far; it does not add a receipt.</p>
            <input className={input} type="text" inputMode="decimal" autoComplete="off" placeholder="Total received to date" value={paid.amount} onChange={(e) => setPaid((x) => ({ ...x, amount: e.target.value }))} aria-label={`Total paid for ${rowLabel}`} />
            <input className={input} placeholder="Reference or note" value={paid.note} onChange={(e) => setPaid((x) => ({ ...x, note: e.target.value }))} aria-label={`Payment note for ${rowLabel}`} />
            <button type="submit" disabled={busy} className={`${btn} bg-emerald-700 text-white hover:bg-emerald-800 dark:hover:bg-emerald-600`}>Save total paid</button>
          </form>
          <form onSubmit={submitDispute} className="space-y-1">
            <div className="text-[12px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Record dispute</div>
            <p className="text-[12px] text-axal-faint">0 clears the dispute.</p>
            <input className={input} type="text" inputMode="decimal" autoComplete="off" placeholder="Disputed amount" value={dispute.amount} onChange={(e) => setDispute((x) => ({ ...x, amount: e.target.value }))} aria-label={`Disputed amount for ${rowLabel}`} />
            <input className={input} placeholder="Why — required above 0" value={dispute.note} onChange={(e) => setDispute((x) => ({ ...x, note: e.target.value }))} aria-label={`Dispute reason for ${rowLabel}`} />
            <button type="submit" disabled={busy} className={`${btn} border-red-300 text-red-800 dark:border-red-500/40 dark:text-red-300`}>Save dispute</button>
          </form>
        </div>
      )}
      {msg && (
        <p role={msg.err ? 'alert' : 'status'} className={`mt-1 text-[12px] ${msg.err ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{msg.text}</p>
      )}
    </div>
  );
}

