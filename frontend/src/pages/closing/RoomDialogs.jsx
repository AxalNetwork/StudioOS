/**
 * D1218 (#3215) — the room's drawers and dialogs: Review and sign (CP4), the
 * payment instructions (CP9), the receipt drawer (CP10), the cap-table
 * proposal (CP11) and the investor's match (CP2, CP20). Each change says what
 * it changes before it changes it, and is the Worker's act: a refusal is drawn
 * as its own sentence. Nothing here moves money, and nothing here is a
 * browser pop-up.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { closingsApi } from '../../lib/api/closings';
import { mercuryInvestorApi } from '../../lib/api/mercuryInvestor';
import { Lightbox, Unrecorded } from '../../ui';
import { BTN } from '../account/AccountCenter';
import { Err } from './ClosingDialogs';
import { closingHrefFor, moneyCents } from './deskModel';
import { ROOM_WAITS, evidenceRows, signingRows } from './roomModel';
import Sheet from '../../ui/Sheet.jsx';

const mutedText = 'm-0 text-[12.5px] text-gray-600 dark:text-gray-400';
const NOT_YET_PILL = 'w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:border-gray-600 dark:text-gray-400';
const Foot = ({ children }) => <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 px-5 py-3 max-sm:flex-col max-sm:items-stretch dark:border-gray-800">{children}</div>;
const refusal = (e, fallback) => (typeof e?.message === 'string' && e.message.trim() ? e.message.trim() : fallback);

/** CP9's warning, first in every place an investor meets payment details. */
export const PAY_WARNING = (company) => `Before you send money, call ${company} to confirm these details on a phone number you already hold, never one given in an email or on this page.`;

function Warning({ children, testId }) {
  return <p role="note" className="m-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid={testId}>{children}</p>;
}

function useAct() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn, fallback) => {
    setBusy(true); setError('');
    try { await fn(); return true; } catch (e) { setError(refusal(e, fallback)); return false; } finally { setBusy(false); }
  };
  return { busy, error, run };
}

/** CP4: the paper's signing order, whose turn it is, and where the viewer signs. */
export function SignDrawer({ row, envelope, failed, viewer, company, onClose }) {
  const rows = signingRows(envelope, viewer);
  const mine = rows.find((r) => r.yourTurn);
  return (
    <Sheet label="Review and sign" eyebrow="Step 2 · Sign" title={envelope?.title || 'Review and sign'} sub={`${company} and ${viewer === 'investor' ? 'you' : row.investor}`} onClose={onClose} width={560} phone="sheet" testId="closing-sign"
      footer={<Foot><button type="button" className={BTN.ghost} onClick={onClose}>Close</button></Foot>}>
      <div className="flex flex-col gap-3 px-5 py-4">
        {failed ? <p className={mutedText} data-testid="closing-sign-failed">This line’s paper could not be read. Close and try again from the room.</p>
          : !envelope ? <p className={mutedText} data-testid="closing-sign-none">No paper has been sent on this line yet. The studio team prepares it.</p> : (
            <>
              <section className="flex flex-col" data-testid="closing-sign-order">
                <h3 className="m-0 text-[14px] font-bold">Signing order</h3>
                {rows.map((r) => (
                  <div key={r.key} className="flex items-center gap-3 border-t border-gray-100 py-2 dark:border-gray-800" data-testid={`closing-signer-${r.position}`}>
                    <span className="font-mono text-[12px] text-gray-500 dark:text-gray-400">{r.position}.</span>
                    <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">{r.who}</span><span className="block text-[12px] text-gray-500 dark:text-gray-400">{r.role}</span></span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${r.yourTurn ? 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>{r.state}</span>
                  </div>
                ))}
              </section>
              {mine ? (
                <p className="m-0 text-[13px] font-semibold" data-testid="closing-sign-yours">Your turn. The signing link was sent to you{mine.sentAt ? ` on ${mine.sentAt}` : ''}. You sign on the e-sign page it opens, which records your signature.</p>
              ) : null}
              {rows.some((r) => r.state === 'Waiting for the Super Admin') ? <p className={mutedText}>A Super Admin countersigns for Axal, last.</p> : null}
              <section className="flex flex-col gap-1" data-testid="closing-sign-clause">
                <span className={NOT_YET_PILL}>Not read here yet</span>
                <p className={mutedText}>{ROOM_WAITS.clause}</p>
              </section>
            </>
          )}
      </div>
    </Sheet>
  );
}

/** CP10: a line's evidence, newest first; only the receiving side's turns the line Received. */
export function ReceiptDrawer({ row, viewer, dealId, onClose }) {
  const items = evidenceRows(row.evidence);
  return (
    <Sheet label="Receipt" eyebrow="Step 5 · Receipt" title={row.investor} sub={row.amount || undefined} onClose={onClose} width={560} phone="sheet" testId="closing-receipt"
      footer={<Foot>{viewer === 'admin' ? <Link className={BTN.ghost} to={closingHrefFor(dealId)}>Record evidence on Contracts › Closings</Link> : null}<button type="button" className={BTN.ghost} onClick={onClose}>Close</button></Foot>}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <p className="m-0 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[12.5px] dark:border-violet-800 dark:bg-violet-950/40">Received needs the receiving side’s evidence: the company’s Mercury, an Axal entity’s Mercury, a phone-verified record or a bank confirmation. The investor’s own Mercury alone reads Sent, not yet confirmed.</p>
        <p className="m-0 text-[13px]" data-testid="closing-receipt-status">This line: <b>{row.status}</b></p>
        <h3 className="m-0 text-[14px] font-bold">Evidence, newest first</h3>
        {items.length === 0 ? <p className={mutedText} data-testid="closing-receipt-empty">No evidence recorded for this line yet.</p> : items.map((e) => (
          <div key={e.key} className="flex flex-col gap-1 rounded-lg border border-gray-200 p-3 dark:border-gray-800" data-testid={`closing-evidence-${e.key}`}>
            <span className="text-[12.5px] font-semibold">{e.source} · {e.words}</span>
            <span className="flex flex-wrap items-center gap-2 text-[12px] text-gray-600 dark:text-gray-400">
              {e.at || 'Day not recorded'}
              <span className={`rounded-full px-2 text-[11px] font-bold ${e.receiving ? 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>{e.side}</span>
            </span>
            {e.withdrawn ? <span className="text-[12px] text-red-700 dark:text-red-300">{e.withdrawn}</span> : null}
          </div>
        ))}
        <p className={mutedText}>The evidence names a stored record, never a bank memo or an account number. Its amount is the line’s.</p>
      </div>
    </Sheet>
  );
}

/** CP9: the warning first, then the instructions, which no mounted route serves yet (D1217, #3214). */
export function PaymentDrawer({ company, amount, onClose }) {
  return (
    <Sheet label="Payment instructions" eyebrow="Pay" title="Payment instructions" sub={amount ? `For your ${amount} line in ${company}` : undefined} onClose={onClose} width={520} phone="sheet" testId="closing-pay"
      footer={<Foot><button type="button" className={BTN.ghost} onClick={onClose}>Close</button></Foot>}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <Warning testId="closing-pay-warning">{PAY_WARNING(company)}</Warning>
        <span className={NOT_YET_PILL}>Not read here yet</span>
        <p className={mutedText} data-testid="closing-pay-wait">{ROOM_WAITS.instructions}</p>
        <p className={mutedText}>When the account is read here, revealing its full number is recorded and shows for 30 seconds. A change to the account is announced to every investor with an unpaid line.</p>
      </div>
    </Sheet>
  );
}

/** CP11: the founder decides the cap-table change once. Accepting records the decision; Raise › Cap table writes the holder. */
export function CaptableDialog({ closing, view, rows, instrument, onClose, onDone }) {
  const act = useAct();
  const received = rows.filter((r) => r.status === 'Received');
  const decide = (accept) => act.run(() => (accept ? closingsApi.acceptCaptable(closing.uid) : closingsApi.dismissCaptable(closing.uid)), 'The decision could not be recorded. Try again.').then((ok) => ok && onDone());
  return (
    <Sheet label="Cap table change" title={received.length === 1 ? `Add ${received[0].investor} to the cap table?` : 'Add the received lines to the cap table?'} onClose={onClose} width={620} phone="sheet" testId="closing-captable-dialog"
      footer={(
        <Foot>
          <button type="button" className={BTN.ghost} onClick={onClose} disabled={act.busy}>Not now</button>
          {view.canDecide ? <button type="button" className={BTN.danger} onClick={() => decide(false)} disabled={act.busy} data-testid="closing-captable-dismiss">Dismiss the proposal</button> : null}
          {view.canDecide ? <button type="button" className={BTN.primary} onClick={() => decide(true)} disabled={act.busy} data-testid="closing-captable-accept">Add to cap table</button> : null}
        </Foot>
      )}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]" data-testid="closing-captable-lines">
          {received.map((r) => <li key={r.uid}><b>{r.investor}</b> · {instrument || 'Instrument not recorded'} · {r.amount || <Unrecorded reason="No amount is recorded on this line." />}</li>)}
        </ul>
        <span className={NOT_YET_PILL}>Not read here yet</span>
        <p className={mutedText} data-testid="closing-captable-modelled">{ROOM_WAITS.modelled}</p>
        <p className="m-0 text-[13px]">This comes from the signed paper and the received payments. Nothing changes until you accept. Dismissing records that you will not add them from this closing.</p>
        {!view.canDecide ? <p className={mutedText}>{view.text}</p> : null}
        <Err text={act.error} testId="closing-captable-error" />
      </div>
    </Sheet>
  );
}

/** CP2, CP20: accept a match from the investor's own Mercury. It records Sent, not yet confirmed, never Received. */
export function MatchDialog({ match, currency, company, onClose, onDone }) {
  const act = useAct();
  const amount = moneyCents(match.cents, currency);
  const go = (accept) => act.run(() => (accept ? mercuryInvestorApi.accept(match.uid) : mercuryInvestorApi.dismiss(match.uid)), 'This match could not be recorded. Try again.').then((ok) => ok && onDone());
  return (
    <Lightbox label="Accept this match" title="Accept this match?" onClose={onClose} width={460} phone="sheet" testId="closing-match-dialog"
      footer={(
        <Foot>
          <button type="button" className={BTN.ghost} onClick={onClose} disabled={act.busy}>Cancel</button>
          <button type="button" className={BTN.ghost} onClick={() => go(false)} disabled={act.busy} data-testid="closing-match-dismiss">Not this one</button>
          <button type="button" className={BTN.primary} onClick={() => go(true)} disabled={act.busy} data-testid="closing-match-accept">Accept</button>
        </Foot>
      )}>
      <div className="flex flex-col gap-2 px-5 py-4">
        <p className="m-0 text-[13px]">It records {amount || 'this payment'} as Sent, not yet confirmed, from your Mercury.</p>
        <p className={mutedText}>The line is Received when {company}’s bank confirms it. Not this one keeps it off this line.</p>
        <Err text={act.error} testId="closing-match-error" />
      </div>
    </Lightbox>
  );
}
