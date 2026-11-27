import { useState } from 'react';
import { Unreadable } from '../../ui';
import { fundCallsApi } from '../../lib/api/fundCalls';
import { formatCents } from './fundCallsModel';
import { FundActControl } from '../../lib/fundActs';

/**
 * D9017 (#9017) — a capital call's "bank reversed" lines on the GP's call page.
 *
 * When the bank reports a receipted wire failed, cancelled or restated, the
 * Worker records a reversal on that line (`bank_reversals` on the call read).
 * Nothing is reversed: the receipt and the line's paid state stand (D8534
 * answer b). The line reads Bank reversed until the GP of record or an Admin
 * resolves it here with a note, which is kept with their name and the time.
 * The same block lays out as cards at 390px and in light and dark themes
 * through `investorFundCalls.css`.
 */
const money = (cents) => formatCents(cents) ?? 'Not recorded';
const CAUSE = {
  failed: 'The bank reports the wire failed',
  cancelled: 'The bank reports the wire cancelled',
  restated: 'The bank restated the wire',
};
const stamp = (at) => (at ? `${String(at).slice(0, 16).replace('T', ' ')} UTC` : 'time not recorded');

/** The pill a line carries while its bank reversal is open. */
export function BankReversalPill({ line }) {
  if (!line?.bank_reversed || line.bank_reversed.resolved_at) return null;
  return <span className="if2-pill bank-reversed" data-testid={`pill-bank-reversed-${line.id}`}>Bank reversed</span>;
}

/** The call's reversals, open ones first, each resolvable once with a note. */
export default function BankReversals({ fund, reversals, lines, acts, onRetry, onResolved }) {
  const [form, setForm] = useState(null);
  if (!reversals) return null;
  if (reversals.status !== 'ready') {
    return <Unreadable what="This call's bank reversals" claim="This is not a claim that the bank reversed nothing." onRetry={onRetry} />;
  }
  if (!reversals.rows.length) return null;
  const lpOf = (id) => {
    const l = lines.find((x) => x.id === id);
    return l ? (l.lp_name || l.lp_email || `LP #${l.limited_partner_id}`) : `Line #${id}`;
  };
  const open = reversals.rows.filter((r) => !r.resolved_at).length;

  async function submit(e) {
    e.preventDefault();
    const note = form.note.trim();
    if (note.length < 10) { setForm((f) => ({ ...f, error: 'Say what you found and what was done, in at least 10 characters.' })); return; }
    setForm((f) => ({ ...f, busy: true, error: '' }));
    try {
      await fundCallsApi.resolveBankReversal(fund.id, form.uid, { note });
      setForm(null);
      await onResolved();
    } catch (err) {
      setForm((f) => ({ ...f, busy: false, error: err?.message || 'Nothing was recorded.' }));
    }
  }

  return <section className="if2-reversals" data-testid="section-bank-reversals" aria-labelledby="bank-reversals-heading">
    <h3 className="if2-sub" id="bank-reversals-heading">Bank reversed · {open} open</h3>
    <p className="if2-note">The bank took back money a receipt on these lines recorded. Nothing has been reversed: the receipt, the line, the LP’s paid-in and the fund’s deployed capital stand. Each line reads Bank reversed, to you and to its LP, until it is resolved here.</p>
    <ul className="if2-log if2-reversal-list">
      {reversals.rows.map((r) => <li key={r.uid} data-testid={`row-bank-reversal-${r.uid}`} className={r.resolved_at ? 'resolved' : 'open'}>
        <b>{lpOf(r.capital_call_id)} · {CAUSE[r.cause] || 'The bank changed the wire'}</b>
        <small>Receipt {money(r.receipt_cents)} · bank now shows {money(r.bank_amount_cents)}{r.bank_status ? `, ${r.bank_status}` : ''} · seen {stamp(r.detected_at)}</small>
        {r.resolved_at
          ? <small data-testid={`text-bank-reversal-resolved-${r.uid}`}>Resolved {stamp(r.resolved_at)} by {r.resolved_by_name || 'Not recorded'} · {r.resolution_note}</small>
          : form?.uid === r.uid
            ? <form className="if2-receipt" onSubmit={submit} data-testid="form-resolve-bank-reversal">
              <label>What you found and did<input data-testid="input-bank-reversal-note" value={form.note} maxLength={1000} required
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></label>
              <button type="submit" data-testid="button-confirm-resolve" disabled={form.busy}>{form.busy ? 'Recording…' : 'Resolve'}</button>
              <button type="button" onClick={() => setForm(null)}>Cancel</button>
              <p role={form.error ? 'alert' : undefined}>{form.error || 'Resolving moves no money. Your name, the time and this note are kept and cannot be changed.'}</p>
            </form>
            : <div className="if2-card-acts">
              <FundActControl access={acts} act="capital_call.bank_reversal" testId="text-resolve-reversal-refused" className="if2-note">
                <button type="button" className="if2-row-action if2-tap" data-testid={`button-resolve-bank-reversal-${r.uid}`}
                  onClick={() => setForm({ uid: r.uid, note: '', error: '', busy: false })}>Resolve</button>
              </FundActControl>
            </div>}
      </li>)}
    </ul>
  </section>;
}
