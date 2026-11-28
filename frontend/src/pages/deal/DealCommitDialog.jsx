/**
 * D5914 (#5914, Deals v2 board DE14): the Commit dialog, drawn in the DX14
 * shell (`components/deals/DealActionDialog.jsx`). It was `CommitModal` in
 * `DealRoomPage.jsx`, a hand-built overlay with no focus trap; the page
 * re-exports it under that name.
 *
 * What it asks, in the canvas's order: the amount in the deal's currency
 * (with the minimum), the firm it is held under, the route preference
 * (D6195), an optional note, and a confirmation that it is recorded, not
 * transferred. Nothing is sent until the box is ticked.
 *
 * D6191 (#6191): a new commitment starts at the deal minimum with no note; a change starts from
 * `current`, the live commitment, so saving without touching the note keeps it (the Worker sets
 * `amount` and `notes` from the body). A refusal stays in the dialog, in words (`commitRefusal`).
 * D752 (#1891): an investor on HQ is offered one optional last step once it is recorded.
 * D5915: in Super Admin Investor preview the shell offers Return to HQ instead of Commit.
 */
import React, { useState } from 'react';
import { Lightbox, actionGhost, actionPrimary } from '../../ui';
import { api } from '../../lib/api';
import { useActiveCompany } from '../../contexts/ActiveCompanyContext';
import DealActionDialog from '../../components/deals/DealActionDialog';
import { COMMIT_ACK, commitActLabel, commitCheck, firmLine } from '../../components/deals/dealActionModel';
import { dealMoney } from '../../components/deals/dealMoney';
import { COMMIT_RECORDED, SHARE_BUTTON, showsProof } from '../investor/proofOfFundsModel';
import { ROUTES, ROUTE_NONE, ROUTE_NOTE, commitRefusal, routePreferenceWord } from './dealWorkModel';

const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] text-axal-muted dark:text-gray-400';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink focus:border-axal-violet focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

export function CommitModal({ deal, onClose, onDone, user = null, current = null }) {
  const changing = !!current;
  const currency = deal.currency || 'USD';
  const [amount, setAmount] = useState(changing && current.amount != null ? String(current.amount) : (deal.minimum_check || ''));
  const [notes, setNotes] = useState(changing && current.notes != null ? String(current.notes) : '');
  // D6195: how the investor would like to invest, a preference only. '' is none recorded (never Direct).
  const [pref, setPref] = useState(changing && routePreferenceWord(current.route_preference) ? current.route_preference : '');
  const [ack, setAck] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const firm = firmLine(useActiveCompany()?.company);
  const minimum = deal.minimum_check ? dealMoney(deal.minimum_check, currency) : null;

  if (recorded) {
    // Every close is today's success: Done, ×, the backdrop. Only the share asks for the sheet.
    return (
      <Lightbox label={COMMIT_RECORDED} title={COMMIT_RECORDED} onClose={() => onDone()} width={440} testId="commit-recorded" phone="sheet"
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={`${actionGhost} max-sm:min-h-[44px] max-sm:flex-1`} onClick={() => onDone()} data-testid="commit-done">Done</button>
            <button type="button" className={`${actionPrimary} max-sm:min-h-[44px] max-sm:flex-1`} onClick={() => onDone({ share: true })} data-testid="commit-share">{SHARE_BUTTON}</button>
          </div>
        )}>
        <p className={`m-0 px-5 py-4 ${SUB}`}>It is recorded, not transferred.</p>
      </Lightbox>
    );
  }

  return (
    <DealActionDialog testId="commit" title={changing ? 'Change your commitment' : `Commit to ${deal.project_name || 'this deal'}`}
      act={commitActLabel(amount, currency, changing)} busyLabel="Recording…"
      check={() => commitCheck({ amount, minimum: deal.minimum_check, currency, confirmed: ack })}
      onConfirm={() => api.createCommitment(deal.id, { amount: Number(amount), notes: notes || null, route_preference: pref || null })}
      refusalOf={(e) => commitRefusal(e, deal)}
      onDone={() => { if (showsProof(user)) setRecorded(true); else onDone(); }}
      onClose={onClose}>
      <p className={`m-0 ${SUB}`} data-testid="commit-intent">{changing ? 'Changing your commitment to ' : 'Committing to '}<span className="font-semibold text-axal-ink dark:text-gray-100">{deal.project_name}</span>. This records your intent — no funds move.</p>
      <label className="flex flex-col gap-1">
        <span className={EYE}>Amount ({currency})</span>
        <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${FIELD} font-mono`} placeholder="50000" data-testid="commit-amount" />
        {minimum ? <span className={SUB}>Minimum check: {minimum}</span> : null}
      </label>
      <dl className="m-0 grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-[90px_minmax(0,1fr)]">
        <dt className={EYE}>Firm</dt>
        <dd className={`m-0 ${firm.named ? 'text-[13px] text-axal-ink dark:text-gray-100' : SUB}`} data-testid="commit-firm">{firm.text}</dd>
      </dl>
      <fieldset className="m-0 border-0 p-0" data-testid="commit-route-preference">
        <legend className={`${EYE} mb-1`}>How you would like to invest · optional</legend>
        <div className="flex flex-col gap-1.5">
          {[...ROUTES.map((r) => ({ key: r.key, title: r.title })), { key: '', title: ROUTE_NONE }].map((r) => (
            <label key={r.key || 'none'} className="flex min-h-[44px] cursor-pointer items-center gap-2 text-[13px] sm:min-h-[24px]">
              <input type="radio" name="commit-route-preference" value={r.key} checked={pref === r.key} onChange={() => setPref(r.key)} data-testid={`commit-route-${r.key || 'none'}`} />
              {r.title}
            </label>
          ))}
        </div>
        <p className={`m-0 mt-1 ${SUB}`}>{ROUTE_NOTE}</p>
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className={EYE}>Note · optional</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={FIELD} data-testid="commit-notes" />
      </label>
      <label className="flex min-h-[44px] cursor-pointer items-start gap-2 rounded-[9px] border border-axal-hairline px-3 py-2 dark:border-gray-700 sm:min-h-0">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" data-testid="commit-ack" />
        <span>{COMMIT_ACK}</span>
      </label>
    </DealActionDialog>
  );
}

export default CommitModal;
