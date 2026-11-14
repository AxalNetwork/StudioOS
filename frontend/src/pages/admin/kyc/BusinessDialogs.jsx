/**
 * D1234 (#3242) — a business's decision dialogs (KYC8 A, B, C, E, and Link to
 * an account from KYC7b), each in the page and each saying what it changes;
 * never a browser pop-up.
 *
 * Every write sends the `review_token` the case read returned (If-Match), so
 * a case that changed while it was open is refused with 409 `kyb_changed`
 * and the dialog asks for a fresh read; it never retries silently.
 * Approve, Reject, Ask for documents, Dismiss and Link ask for the
 * authenticator code when the last check has lapsed: `request()` asks for it
 * and sends the decision again once.
 *
 * KYC8 D, Send to HQ, is not drawn: no Worker route sends a business to HQ.
 */
import React, { useRef, useState } from 'react';
import { kybApi } from '../../../lib/api/kyb.js';
import { reportError } from '../../../lib/log';
import { Lightbox, actionDanger, actionGhost, actionPrimary } from '../../../ui';
import {
  DOC_KINDS, REASON_MAX, approveBody, approveProblem, reasonProblem, refusalOf, requestText,
} from './businessModel';

const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'm-0 text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const WARN = 'm-0 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[12.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200';
const CODE = 'A decision asks for your authenticator code when your last check has lapsed.';

function Dialog({ title, testId, children, button, danger = false, problem, run, onClose, onDone, onStale }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const lock = useRef(false);
  const close = () => { if (!lock.current) onClose(); };
  const go = async () => {
    if (lock.current || problem) return;
    lock.current = true; setBusy(true); setRefusal(null);
    try { onDone(await run()); } catch (e) {
      reportError('BusinessDialogs:write', e);
      setRefusal(refusalOf(e));
    } finally { lock.current = false; setBusy(false); }
  };
  return (
    <Lightbox label={title} title={title} onClose={close} width={560} testId={testId}
      footer={(
        <div className="flex flex-col gap-2">
          {problem ? <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid={`${testId}-problem`}>{problem}</p> : null}
          {refusal && (
            <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid={`${testId}-refused`}>
              {refusal.line}
              {refusal.changed ? <> <button type="button" className="font-semibold underline" onClick={onStale} data-testid={`${testId}-reread`}>Read it again</button></> : null}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className={actionGhost} onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className={danger ? actionDanger : actionPrimary} onClick={go} disabled={!!problem || busy} data-testid={`${testId}-go`}>{busy ? 'Saving…' : button}</button>
          </div>
        </div>
      )}>
      <div className="flex flex-col gap-3 text-[13px]">{children}</div>
    </Lightbox>
  );
}

function Tick({ label, checked, onChange, testId, hint = null }) {
  return (
    <label className="flex items-start gap-2">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span>{label}{hint ? <span className="block text-[12px] text-axal-muted dark:text-gray-400">{hint}</span> : null}</span>
    </label>
  );
}

function Reason({ label = 'Reason', value, onChange, testId, hint = null }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={EYE}>{label} · required</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} maxLength={REASON_MAX} className={FIELD} data-testid={testId} />
      {hint ? <span className="text-[12px] text-axal-muted dark:text-gray-400">{hint}</span> : null}
    </label>
  );
}

/** A · Approve. The three checks; an owner of 25% or more with no approved identity check needs a reason. */
export function ApproveBusiness({ c, owners, onClose, onDone, onStale }) {
  const [f, setF] = useState({ registry: false, identified: false, checked: false, goodStanding: '', reason: '', note: '' });
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const problem = approveProblem(f, owners);
  const unchecked = owners.state === 'ok' ? owners.unchecked : [];
  return (
    <Dialog title={`Approve ${c.entity_name || 'this business'}’s business check?`} testId="kyb-approve" button="Approve" problem={problem}
      run={() => kybApi.approve(c.uid, { ...approveBody(f, owners), review_token: c.review_token })} onClose={onClose} onDone={onDone} onStale={onStale}>
      <Tick label="Registry record matches" checked={f.registry} onChange={(v) => set({ registry: v })} testId="kyb-approve-registry" />
      <Tick label="Owners of 25% or more identified" checked={f.identified} onChange={(v) => set({ identified: v })} testId="kyb-approve-identified" />
      <Tick label="Every owner’s KYC approved or explained" checked={f.checked} onChange={(v) => set({ checked: v })} testId="kyb-approve-checked" />
      <label className="flex flex-col gap-1">
        <span className={EYE}>Good standing</span>
        <select className={FIELD} value={f.goodStanding} onChange={(e) => set({ goodStanding: e.target.value })} data-testid="kyb-approve-standing">
          <option value="">Not recorded</option><option value="yes">Active, in good standing</option><option value="no">Not in good standing</option>
        </select>
      </label>
      {unchecked.length ? (
        <>
          <p className={WARN} data-testid="kyb-approve-unchecked">{unchecked.map((o) => `${o.name} (${o.share})`).join(', ')} {unchecked.length === 1 ? 'has' : 'have'} no approved identity check. Say why you approve now.</p>
          <Reason value={f.reason} onChange={(v) => set({ reason: v })} testId="kyb-approve-reason" />
        </>
      ) : null}
      <label className="flex flex-col gap-1">
        <span className={EYE}>Note · optional</span>
        <textarea value={f.note} onChange={(e) => set({ note: e.target.value })} rows={2} maxLength={REASON_MAX} className={FIELD} data-testid="kyb-approve-note" />
      </label>
      <p className={SUB}>It satisfies Entity verification (KYB) for 24 months. Recorded under your name. {CODE}</p>
    </Dialog>
  );
}

/** B · Reject. The reason is told to them; their documents are deleted. */
export function RejectBusiness({ c, onClose, onDone, onStale }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog title={`Reject ${c.entity_name || 'this business'}’s business check?`} testId="kyb-reject" button="Reject" danger problem={reasonProblem(reason)}
      run={() => kybApi.reject(c.uid, { reason: reason.trim(), review_token: c.review_token })} onClose={onClose} onDone={onDone} onStale={onStale}>
      <Reason value={reason} onChange={setReason} testId="kyb-reject-reason" hint="They are told this reason." />
      <p className="m-0 rounded-lg border border-red-200 bg-red-50 p-2.5 text-[12.5px] text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">They can submit again. Their documents are deleted.</p>
      <p className={SUB}>{CODE}</p>
    </Dialog>
  );
}

/** C · Ask for documents. The case moves to Needs information. */
export function RequestDocuments({ c, onClose, onDone, onStale }) {
  const [kinds, setKinds] = useState([]);
  const [message, setMessage] = useState('');
  const [edited, setEdited] = useState(false);
  const text = edited ? message : requestText(c.entity_name, kinds);
  const toggle = (k, on) => setKinds((xs) => (on ? [...new Set([...xs, k])] : xs.filter((x) => x !== k)));
  const problem = !kinds.length ? 'Choose the documents to ask for.' : !text.trim() ? 'Write the request.' : null;
  return (
    <Dialog title={`Ask ${c.entity_name || 'this business'} for documents`} testId="kyb-docs" button="Send request" problem={problem}
      run={() => kybApi.requestDocuments(c.uid, { kinds, message: text.trim(), review_token: c.review_token })} onClose={onClose} onDone={onDone} onStale={onStale}>
      {DOC_KINDS.map(([k, label]) => <Tick key={k} label={label} checked={kinds.includes(k)} onChange={(v) => toggle(k, v)} testId={`kyb-docs-${k}`} />)}
      <label className="flex flex-col gap-1">
        <span className={EYE}>What they read</span>
        <textarea value={text} onChange={(e) => { setEdited(true); setMessage(e.target.value); }} rows={3} maxLength={REASON_MAX} className={FIELD} data-testid="kyb-docs-message" />
      </label>
      <p className={SUB}>The case moves to Needs information. The wait clock pauses. {CODE}</p>
    </Dialog>
  );
}

/** E · Dismiss an import. It was imported, not submitted; nobody is told. */
export function DismissImport({ c, onClose, onDone, onStale }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog title={`Remove ${c.entity_name || 'this import'} from the queue?`} testId="kyb-dismiss" button="Dismiss import" danger problem={reasonProblem(reason)}
      run={() => kybApi.dismiss(c.uid, { reason: reason.trim(), review_token: c.review_token })} onClose={onClose} onDone={onDone} onStale={onStale}>
      <p className="m-0">It was imported, not submitted. Nobody is told.</p>
      <Reason value={reason} onChange={setReason} testId="kyb-dismiss-reason" />
      <p className={SUB}>Its history is kept. Recorded under your name. {CODE}</p>
    </Dialog>
  );
}

/** KYC7b · Link an import to an account in this studio; the case goes back to review. */
export function LinkAccount({ c, onClose, onDone, onStale }) {
  const [id, setId] = useState('');
  const ok = /^[1-9][0-9]{0,15}$/.test(id.trim());
  return (
    <Dialog title={`Link ${c.entity_name || 'this import'} to an account?`} testId="kyb-link" button="Link account" problem={ok ? null : 'Give the account’s number.'}
      run={() => kybApi.linkAccount(c.uid, Number(id.trim()), c.review_token)} onClose={onClose} onDone={onDone} onStale={onStale}>
      <label className="flex flex-col gap-1">
        <span className={EYE}>Account number</span>
        <input inputMode="numeric" className={FIELD} value={id} onChange={(e) => setId(e.target.value)} data-testid="kyb-link-id" />
      </label>
      <p className={SUB}>The account must be in this studio, and not yours. The case goes back to Waiting for review. {CODE}</p>
    </Dialog>
  );
}
