/**
 * D9108 (#9108) — an Admin's receipt acts on Contracts › Closings (CP10, CP13,
 * CP14): record an Axal entity's Mercury credit or a phone-verified transfer as
 * evidence on a line, withdraw a piece with a reason, and add a late line to an
 * open closing. Each dialog says what changes before it changes it; every act
 * is the Worker's (`routes/closings.ts`, `routes/deals.ts` transfers), and a
 * refusal is drawn as its own sentence with the dialog kept open. The line's
 * status comes from the closing's re-read, never from here. Nothing here moves
 * money.
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { adminMercuryApi } from '../../lib/api/adminMercury';
import { closingsApi } from '../../lib/api/closings';
import { Lightbox, Unreadable } from '../../ui';
import { BTN, INPUT } from '../account/AccountCenter';
import { Err, useAct, useLoad } from './ClosingDialogs';
import { moneyCents } from './deskModel';
import {
  TRANSFER_WORDS, WITHDRAW_REASON_MAX, dayOf, lineableCommitments, mercuryEvidenceBody, prospectIdOf, reasonState, transferBody, transferEvidenceBody,
} from './roomModel';

const Foot = ({ children }) => <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 px-5 py-3 max-sm:flex-col max-sm:items-stretch dark:border-gray-800">{children}</div>;
const Changes = ({ children, testId }) => <p role="note" className="m-0 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[12.5px] text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200" data-testid={testId}>{children}</p>;
const muted = 'm-0 text-[12.5px] text-gray-600 dark:text-gray-400';
const pulse = <div className="h-10 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />;
const ENTITY = Object.freeze({ holdings: 'Axal Holdings', management: 'Axal Management', gp: 'Axal GP', fund: 'Axal Fund' });

/** CP10, Axal Mercury: one credit on an Axal entity's Mercury, recorded as `axal_mercury` and nothing else. */
export function RecordMercuryEvidenceDialog({ closing, line, onClose, onDone }) {
  const read = useLoad(() => adminMercuryApi.transactions({ direction: 'credit' }), []);
  const [pick, setPick] = useState('');
  const act = useAct();
  const items = Array.isArray(read.data?.items) ? read.data.items.filter((t) => Number(t?.amount_cents) > 0) : [];
  const chosen = items.find((t) => t.uid === pick) || null;
  const go = async () => {
    const body = mercuryEvidenceBody(chosen);
    if (body.error) { act.setError(body.error); return; }
    if (await act.run(() => closingsApi.addEvidence(closing.uid, line.uid, body), 'The evidence could not be recorded. Try again.')) onDone?.();
  };
  return (
    <Lightbox label="Record an Axal Mercury credit" title="Record an Axal Mercury credit" sub={line.investor_name || 'This line'} testId="closing-evidence-mercury-dialog" onClose={onClose} width={560}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <p className={muted}>The credits read from the four Axal entities’ Mercury, newest first. A portfolio company’s Mercury and the investor’s Mercury are not read here.</p>
        {read.status === 'loading' && pulse}
        {read.status === 'error' && <Unreadable what="The Axal entities’ Mercury credits" claim="This is not a claim that no credit arrived." onRetry={read.retry} />}
        {read.status === 'ok' && (items.length === 0
          ? <p className={muted} data-testid="closing-evidence-mercury-none">No credit is recorded on an Axal entity’s Mercury.</p>
          : (
            <ul className="m-0 flex max-h-72 list-none flex-col gap-1.5 overflow-y-auto p-0" role="radiogroup" aria-label="Mercury credit" data-testid="closing-evidence-mercury-list">
              {items.map((t) => (
                <li key={t.uid}>
                  <label className={`flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-[12.5px] ${pick === t.uid ? 'border-violet-500 bg-violet-50 dark:border-violet-400 dark:bg-violet-950/30' : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'}`}>
                    <input type="radio" name="mercury-credit" checked={pick === t.uid} onChange={() => { setPick(t.uid); act.setError(''); }} data-testid={`closing-evidence-mercury-${t.uid}`} />
                    <span className="flex min-w-0 flex-col">
                      <span className="font-semibold tabular-nums">{moneyCents(t.amount_cents, closing.currency || 'USD')}</span>
                      <span className="break-words text-gray-600 dark:text-gray-400">
                        {dayOf(t.posted_on || t.created_on) || 'Day not recorded'} · {ENTITY[t.entity_key] || 'Axal entity'}{t.last_four ? ` ····${t.last_four}` : ''}{t.counterparty_name ? ` · ${t.counterparty_name}` : ''}
                      </span>
                      {t.match ? <span className="text-gray-600 dark:text-gray-400">Already matched in Fund admin ({t.match.state}).</span> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ))}
        <Changes testId="closing-evidence-mercury-changes">What changes: the credit is added as receiving-side evidence on this line, under your name, and the line reads Received once the closing is read again. The investor and the founder see it on the room.</Changes>
        <Err text={act.error} testId="closing-evidence-mercury-error" />
      </div>
      <Foot>
        <button type="button" className={BTN.ghost} onClick={onClose}>Cancel</button>
        <button type="button" className={BTN.primary} disabled={act.busy || !chosen} onClick={go} data-testid="closing-evidence-mercury-record">Record the credit</button>
      </Foot>
    </Lightbox>
  );
}

/**
 * CP10 `rtD`, without its Date: the transfer route stores the time of the call.
 * First the phone-verified transfer, tied to the line; then it is recorded as
 * evidence. When only the second step fails, the transfer stays saved and the
 * retry repeats the second step alone, so a transfer is never saved twice.
 */
export function RecordTransferDialog({ closing, line, onClose, onDone }) {
  const [form, setForm] = useState({ amount: '', reference: '', phone: false });
  const [saved, setSaved] = useState(null);
  const act = useAct();
  const record = async (item) => {
    const body = transferEvidenceBody(item);
    if (!body) { act.setError(`${TRANSFER_WORDS.saved} The transfer’s id was not returned.`); return; }
    if (await act.run(() => closingsApi.addEvidence(closing.uid, line.uid, body), 'The transfer could not be recorded on the line. Try again.')) onDone?.();
  };
  const go = async () => {
    if (saved) { await record(saved); return; }
    const body = transferBody({ ...form, lineUid: line.uid });
    if (body.error) { act.setError(body.error); return; }
    const out = await act.run(() => api.dealTransferRecord(closing.deal_id, body), 'The transfer could not be saved. Try again.');
    if (!out) return;
    setSaved(out.item || {});
    await record(out.item);
  };
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: k === 'phone' ? !!e.target.checked : e.target.value })); act.setError(''); };
  return (
    <Lightbox label="Record a transfer" title="Record a transfer" sub={line.investor_name || 'This line'} testId="closing-evidence-transfer-dialog" onClose={onClose} width={460}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <label className="flex flex-col gap-1 text-[12.5px] font-semibold">Amount
          <input className={INPUT} inputMode="decimal" value={form.amount} disabled={!!saved} onChange={set('amount')} data-testid="closing-evidence-transfer-amount" />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] font-semibold">Reference <span className="font-normal text-gray-500 dark:text-gray-400">Optional: the wire’s reference, never an account number.</span>
          <input className={INPUT} maxLength={200} value={form.reference} disabled={!!saved} onChange={set('reference')} data-testid="closing-evidence-transfer-reference" />
        </label>
        <label className="flex min-h-[44px] items-start gap-2 text-[12.5px] font-medium">
          <input type="checkbox" checked={form.phone} disabled={!!saved} onChange={set('phone')} data-testid="closing-evidence-transfer-phone" />
          <span>{TRANSFER_WORDS.phone}</span>
        </label>
        {!form.phone && <p className={muted} data-testid="closing-evidence-transfer-why">{TRANSFER_WORDS.phoneNeeded}</p>}
        <Changes testId="closing-evidence-transfer-changes">What changes: a phone-verified transfer is saved on the deal for this line, then recorded as receiving-side evidence under your name, and the line reads Received once the closing is read again. The day recorded is today.</Changes>
        {saved && <p role="status" className="m-0 text-[12.5px] font-semibold text-amber-800 dark:text-amber-200" data-testid="closing-evidence-transfer-saved">{TRANSFER_WORDS.saved}</p>}
        <Err text={act.error} testId="closing-evidence-transfer-error" />
      </div>
      <Foot>
        <button type="button" className={BTN.ghost} onClick={onClose}>Cancel</button>
        <button type="button" className={BTN.primary} disabled={act.busy || !form.phone} onClick={go} data-testid="closing-evidence-transfer-record">{saved ? 'Record it on the line again' : 'Record transfer'}</button>
      </Foot>
    </Lightbox>
  );
}

/** Withdraw one piece, with the Worker's 10 to 200 character reason and a live count. */
export function WithdrawEvidenceDialog({ closing, piece, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const act = useAct();
  const r = reasonState(reason);
  const go = async () => {
    if (!r.ok) { act.setError(`Give a reason of 10 to ${WITHDRAW_REASON_MAX} characters.`); return; }
    if (await act.run(() => closingsApi.withdrawEvidence(closing.uid, piece.uid, reason.trim()), 'The evidence could not be withdrawn. Try again.')) onDone?.();
  };
  return (
    <Lightbox label="Withdraw this evidence" title="Withdraw this evidence?" sub={`${piece.source} · ${piece.words}`} testId="closing-evidence-withdraw-dialog" onClose={onClose} width={460}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <label className="flex flex-col gap-1 text-[12.5px] font-semibold">Reason
          <textarea className={INPUT} rows={3} maxLength={WITHDRAW_REASON_MAX + 40} value={reason} onChange={(e) => { setReason(e.target.value); act.setError(''); }} data-testid="closing-evidence-withdraw-reason" />
        </label>
        <p className={`m-0 text-[12px] ${r.ok ? 'text-gray-600 dark:text-gray-400' : 'text-amber-800 dark:text-amber-200'}`} aria-live="polite" data-testid="closing-evidence-withdraw-count">{r.count} · {r.hint}</p>
        <Changes testId="closing-evidence-withdraw-changes">What changes: the piece stays on record, marked withdrawn with your reason, and no longer counts. The line’s status falls back to what its other evidence shows.</Changes>
        <Err text={act.error} testId="closing-evidence-withdraw-error" />
      </div>
      <Foot>
        <button type="button" className={BTN.ghost} onClick={onClose}>Keep it</button>
        <button type="button" className={BTN.danger} disabled={act.busy || !r.ok} onClick={go} data-testid="closing-evidence-withdraw-confirm">Withdraw the evidence</button>
      </Foot>
    </Lightbox>
  );
}

/**
 * Add a late line (CP13/CP14 dialog style; the canvas draws no frame for it):
 * a live commitment on the deal with no line yet, or a Raise prospect of the
 * venture by its id. Which commitments hold a cents amount is not in the read,
 * so the Worker's `amount_not_recorded` says so when one does not.
 */
export function AddLineDialog({ closing, lines, onClose, onDone }) {
  const read = useLoad(() => api.dealCommitments(closing.deal_id), [closing.deal_id]);
  const [source, setSource] = useState('commitment');
  const [pick, setPick] = useState('');
  const [prospect, setProspect] = useState('');
  const act = useAct();
  const list = lineableCommitments(Array.isArray(read.data) ? read.data : [], lines);
  const go = async () => {
    let body;
    if (source === 'commitment') {
      if (!pick) { act.setError('Choose the commitment this line is for.'); return; }
      body = { commitment_uid: pick };
    } else {
      const id = prospectIdOf(prospect);
      if (id == null) { act.setError('Give the Raise prospect’s id, a whole number.'); return; }
      body = { prospect_id: id };
    }
    if (await act.run(() => closingsApi.addLine(closing.uid, body), 'The line could not be added. Try again.')) onDone?.();
  };
  const amountOf = (c) => (Number.isFinite(Number(c.amount)) && Number(c.amount) > 0 ? moneyCents(Math.round(Number(c.amount) * 100), closing.currency || 'USD') : 'Amount not recorded');
  return (
    <Lightbox label="Add a line" title="Add a line to this closing" sub="A live commitment on the deal, or a Raise prospect of the venture." testId="closing-add-line-dialog" onClose={onClose} width={520}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="flex flex-wrap gap-3 text-[12.5px] font-semibold" role="radiogroup" aria-label="Line source">
          <label className="flex min-h-[44px] items-center gap-2"><input type="radio" name="line-source" checked={source === 'commitment'} onChange={() => { setSource('commitment'); act.setError(''); }} data-testid="closing-add-line-source-commitment" />A commitment</label>
          <label className="flex min-h-[44px] items-center gap-2"><input type="radio" name="line-source" checked={source === 'prospect'} onChange={() => { setSource('prospect'); act.setError(''); }} data-testid="closing-add-line-source-prospect" />A Raise prospect</label>
        </div>
        {source === 'commitment' && (read.status === 'loading' ? pulse
          : read.status === 'error' ? <Unreadable what="The deal’s commitments" claim="This is not a claim that it has none." onRetry={read.retry} />
            : list.length === 0 ? <p className={muted} data-testid="closing-add-line-none">Every live commitment on this deal already has a line.</p>
              : (
                <label className="flex flex-col gap-1 text-[12.5px] font-semibold">Commitment
                  <select className={INPUT} value={pick} onChange={(e) => { setPick(e.target.value); act.setError(''); }} data-testid="closing-add-line-commitment">
                    <option value="">Choose a commitment</option>
                    {list.map((c) => <option key={c.uid} value={c.uid}>{c.investor_name || c.company_name || 'Investor not recorded'} · {amountOf(c)} · {c.status === 'confirmed' ? 'Confirmed' : 'Pending'}</option>)}
                  </select>
                </label>
              ))}
        {source === 'prospect' && (
          <label className="flex flex-col gap-1 text-[12.5px] font-semibold">Raise prospect id <span className="font-normal text-gray-500 dark:text-gray-400">The prospect’s number on Raise › Prospects.</span>
            <input className={INPUT} inputMode="numeric" value={prospect} onChange={(e) => { setProspect(e.target.value); act.setError(''); }} data-testid="closing-add-line-prospect" />
          </label>
        )}
        <Changes testId="closing-add-line-changes">What changes: a new line with the commitment’s or prospect’s amount in cents and no route yet. It counts in the round’s total, and the closing cannot be marked Closed until it is received or withdrawn.</Changes>
        <Err text={act.error} testId="closing-add-line-error" />
      </div>
      <Foot>
        <button type="button" className={BTN.ghost} onClick={onClose}>Cancel</button>
        <button type="button" className={BTN.primary} disabled={act.busy} onClick={go} data-testid="closing-add-line-confirm">Add the line</button>
      </Foot>
    </Lightbox>
  );
}

/** CP10 `ubD`: no route stores a closing file the evidence route can name, so the action is shown off, with its reason. */
export const BANK_CONFIRMATION_LINE = 'A bank confirmation cannot be uploaded here yet.';
