/**
 * D1241 (#3254, part 5 of #2423) — DLS10, the stage-move dialogs, and DLS6's
 * Not for me. Each says what it changes before it changes it; a refusal is
 * the Worker's own sentence, and nothing moved.
 *
 *   PassDialog      "Pass on [venture]?": one of the five reasons (required),
 *                   when it comes back, an optional note. The round stays open
 *                   for other investors.
 *   MoveBackDialog  "Move [venture] back to [stage]?": it keeps its history.
 *   CommitDialog    "Move [venture] to Commit?": it does not open a vote.
 *   NotForMeDialog  hides a New for you row for the firm, with an optional reason.
 */
import React, { useState } from 'react';
import { Lightbox, actionGhost, actionPrimary } from '../../../ui';
import { reportError } from '../../../lib/log';
import { dealFlowApi } from '../../../lib/api/dealFlow.js';
import { STAGE_WORD } from './flowModel';
import { COMMIT_LINE, MOVE_BACK_LINE, PASS_INVITED_LINE, PASS_NOTE_BOX, PASS_REASONS, passBody } from './movesModel';

const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const REFUSED = 'm-0 text-[12.5px] text-red-700 dark:text-red-300';
const DANGER = 'inline-flex items-center justify-center rounded-[9px] bg-red-700 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-red-800 disabled:opacity-50 dark:bg-red-600 dark:hover:bg-red-500';
const BOX = 'm-0 rounded-lg border border-axal-hairline bg-gray-50 px-3 py-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';

function Footer({ error, busy, onBack, go, label, busyLabel, testId, danger = false }) {
  return (
    <div className="flex flex-col gap-2">
      {error && <p className={REFUSED} role="alert" data-testid={`${testId}-refused`}>{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={actionGhost} onClick={onBack} disabled={busy}>Back</button>
        <button type="button" className={danger ? DANGER : actionPrimary} onClick={go} disabled={busy} data-testid={`${testId}-go`}>{busy ? busyLabel : label}</button>
      </div>
    </div>
  );
}

/** The pass: `row` is a flow row or a New for you item (`viaKey` set). `invited` adds the studio's line. */
export function PassDialog({ row, viaKey = null, invited = false, onClose, onPassed, api = dealFlowApi }) {
  const [reason, setReason] = useState('');
  const [revisit, setRevisit] = useState('next_round');
  const [revisitAt, setRevisitAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    const out = passBody({ reason, revisit, revisitAt, note, viaKey });
    if (out.error) { setError(out.error); return; }
    setBusy(true); setError('');
    try { onPassed(await api.pass(row.id, out.body)); } catch (e) { reportError('DealFlow:pass', e); setError(e?.message || 'The pass could not be saved. Nothing changed.'); setBusy(false); }
  };
  return (
    <Lightbox label="Pass" title={`Pass on ${row.name}?`} onClose={() => { if (!busy) onClose(); }} width={520} testId="dealflow-pass"
      footer={<Footer error={error} busy={busy} onBack={onClose} go={go} label="Pass" busyLabel="Passing…" testId="dealflow-pass" danger />}>
      <div className="flex flex-col gap-3 text-[13px]">
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" data-testid="dealflow-pass-reasons">
          <legend className={EYE}>Reason</legend>
          {PASS_REASONS.map((r) => (
            <label key={r.key} className="flex items-start gap-2">
              <input type="radio" name="pass-reason" checked={reason === r.key} onChange={() => setReason(r.key)} className="mt-0.5" data-testid={`dealflow-pass-reason-${r.key}`} />
              <span><span className="font-semibold">{r.label}</span><span className="block text-[12px] text-axal-muted dark:text-gray-400">{r.sub}</span></span>
            </label>
          ))}
        </fieldset>
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className={EYE}>When it comes back</legend>
          <label className="flex items-center gap-2"><input type="radio" name="pass-revisit" checked={revisit === 'next_round'} onChange={() => setRevisit('next_round')} data-testid="dealflow-pass-next-round" />Comes back at its next round</label>
          <label className="flex items-center gap-2"><input type="radio" name="pass-revisit" checked={revisit === 'date'} onChange={() => setRevisit('date')} data-testid="dealflow-pass-on-date" />Comes back on a date you set</label>
          {revisit === 'date' && (
            <label className="flex flex-col gap-1"><span className={EYE}>Date</span>
              <input type="date" className={FIELD} value={revisitAt} onChange={(e) => setRevisitAt(e.target.value)} data-testid="dealflow-pass-date" />
            </label>
          )}
        </fieldset>
        <label className="flex flex-col gap-1"><span className={EYE}>Note · optional</span>
          <textarea className={FIELD} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Revisit once the second pilot converts." data-testid="dealflow-pass-note" />
        </label>
        <p className={BOX} data-testid="dealflow-pass-box">{PASS_NOTE_BOX}{invited ? ` ${PASS_INVITED_LINE}` : ''}</p>
      </div>
    </Lightbox>
  );
}

/** Move back to an earlier stage: the same move, said first. */
export function MoveBackDialog({ row, to, onClose, onMove }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => { setBusy(true); setError(''); try { await onMove(); } catch (e) { setError(e?.message || `${row.name} could not be moved. Nothing changed.`); setBusy(false); } };
  return (
    <Lightbox label="Move back" title={`Move ${row.name} back to ${STAGE_WORD[to]}?`} onClose={() => { if (!busy) onClose(); }} width={440} testId="dealflow-back"
      footer={<Footer error={error} busy={busy} onBack={onClose} go={go} label="Move back" busyLabel="Moving…" testId="dealflow-back" />}>
      <p className={MUTED} data-testid="dealflow-back-line">{MOVE_BACK_LINE}</p>
    </Lightbox>
  );
}

/** Move to Commit: the same move, with what it does not do. */
export function CommitDialog({ row, onClose, onMove }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => { setBusy(true); setError(''); try { await onMove(); } catch (e) { setError(e?.message || `${row.name} could not be moved. Nothing changed.`); setBusy(false); } };
  return (
    <Lightbox label="Move to Commit" title={`Move ${row.name} to Commit?`} onClose={() => { if (!busy) onClose(); }} width={440} testId="dealflow-commit"
      footer={<Footer error={error} busy={busy} onBack={onClose} go={go} label="Move" busyLabel="Moving…" testId="dealflow-commit" />}>
      <p className={MUTED} data-testid="dealflow-commit-line">{COMMIT_LINE}</p>
    </Lightbox>
  );
}

/** Not for me: hides the row for the firm. The reason is optional and stays with the firm. */
export function NotForMeDialog({ item, onClose, onDismissed, api = dealFlowApi }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true); setError('');
    try { await api.dismiss(item.key, reason.trim() || null); onDismissed(); } catch (e) { reportError('DealFlow:dismiss', e); setError(e?.message || 'This row could not be hidden. Nothing changed.'); setBusy(false); }
  };
  return (
    <Lightbox label="Not for me" title={`Hide ${item.venture || 'this venture'} from New for you?`} onClose={() => { if (!busy) onClose(); }} width={440} testId="dealflow-notforme"
      footer={<Footer error={error} busy={busy} onBack={onClose} go={go} label="Not for me" busyLabel="Hiding…" testId="dealflow-notforme" />}>
      <div className="flex flex-col gap-3 text-[13px]">
        <p className={MUTED}>It leaves New for you for everyone at your firm. It is not a pass: nothing is added to your deal flow, and the round does not change.</p>
        <label className="flex flex-col gap-1"><span className={EYE}>Reason · optional</span>
          <textarea className={FIELD} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="dealflow-notforme-reason" />
        </label>
      </div>
    </Lightbox>
  );
}
