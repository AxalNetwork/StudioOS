/**
 * D1241 (#3254, part 5 of #2423) — DLS10, the stage-move dialogs, and DLS6's
 * Not for me. Each says what it changes before it changes it; a refusal is
 * the Worker's own sentence, and nothing moved.
 *
 * D5914 (#5914, Deals v2 board DE14): each is drawn in the one DX14 shell,
 * `components/deals/DealActionDialog.jsx` (focus trap and return, the
 * refusal in the dialog, Return to HQ in Super Admin Investor preview).
 *
 *   PassDialog            "Pass on [venture]": one of the Worker's five reasons
 *                         (required), when it comes back, an optional private
 *                         note. The round stays open for other investors.
 *   MoveToDiligenceDialog "Move [venture] to diligence": what the move does and
 *                         does not do (DE14), before it is made.
 *   MoveBackDialog        "Move [venture] back to [stage]?": it keeps its history.
 *   CommitDialog          "Move [venture] to Commit?": it does not open a vote.
 *   NotForMeDialog        hides a New for you row for the firm, with an optional reason.
 */
import React, { useState } from 'react';
import DealActionDialog from '../../../components/deals/DealActionDialog';
import { dealFlowApi } from '../../../lib/api/dealFlow.js';
import { STAGE_WORD } from './flowModel';
import { COMMIT_LINE, MOVE_BACK_LINE, MOVE_DILIGENCE_LINE, PASS_INVITED_LINE, PASS_NOTE_BOX, PASS_REASONS, passBody } from './movesModel';

const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const BOX = 'm-0 rounded-lg border border-axal-hairline bg-gray-50 px-3 py-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';
const OPTION = 'flex min-h-[44px] cursor-pointer items-start gap-2 rounded-[9px] border px-3 py-2 sm:min-h-0';
const OPTION_ON = 'border-axal-violet bg-axal-lavender dark:border-violet-400 dark:bg-violet-950';
const OPTION_OFF = 'border-axal-hairline dark:border-gray-700';

/** The pass: `row` is a flow row or a New for you item (`viaKey` set). `invited` adds the studio's line. */
export function PassDialog({ row, viaKey = null, invited = false, onClose, onPassed, api = dealFlowApi }) {
  const [reason, setReason] = useState('');
  const [revisit, setRevisit] = useState('next_round');
  const [revisitAt, setRevisitAt] = useState('');
  const [note, setNote] = useState('');
  const out = () => passBody({ reason, revisit, revisitAt, note, viaKey });
  return (
    <DealActionDialog title={`Pass on ${row.name}`} testId="dealflow-pass" width={520}
      act={`Pass on ${row.name}`} busyLabel="Passing…" fallback="The pass could not be saved. Try again."
      check={() => out().error} onConfirm={() => api.pass(row.id, out().body)} onDone={onPassed} onClose={onClose}>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" data-testid="dealflow-pass-reasons">
        <legend className={`${EYE} mb-1`}>Reason <span className="font-semibold normal-case tracking-normal">· required</span></legend>
        {PASS_REASONS.map((r) => (
          <label key={r.key} className={`${OPTION} ${reason === r.key ? OPTION_ON : OPTION_OFF}`}>
            <input type="radio" name="pass-reason" checked={reason === r.key} onChange={() => setReason(r.key)} className="mt-0.5" data-testid={`dealflow-pass-reason-${r.key}`} />
            <span><span className="font-semibold">{r.label}</span><span className="block text-[12px] text-axal-muted dark:text-gray-400">{r.sub}</span></span>
          </label>
        ))}
      </fieldset>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className={`${EYE} mb-1`}>When it comes back</legend>
        <label className="flex min-h-[44px] items-center gap-2 sm:min-h-0"><input type="radio" name="pass-revisit" checked={revisit === 'next_round'} onChange={() => setRevisit('next_round')} data-testid="dealflow-pass-next-round" />Comes back at its next round</label>
        <label className="flex min-h-[44px] items-center gap-2 sm:min-h-0"><input type="radio" name="pass-revisit" checked={revisit === 'date'} onChange={() => setRevisit('date')} data-testid="dealflow-pass-on-date" />Comes back on a date you set</label>
        {revisit === 'date' && (
          <label className="flex flex-col gap-1"><span className={EYE}>Date</span>
            <input type="date" className={FIELD} value={revisitAt} onChange={(e) => setRevisitAt(e.target.value)} data-testid="dealflow-pass-date" />
          </label>
        )}
      </fieldset>
      <label className="flex flex-col gap-1"><span className={EYE}>Private note <span className="font-semibold normal-case tracking-normal">· optional</span></span>
        <textarea className={FIELD} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Revisit once the second pilot converts." data-testid="dealflow-pass-note" />
      </label>
      <p className={BOX} data-testid="dealflow-pass-box">{PASS_NOTE_BOX}{invited ? ` ${PASS_INVITED_LINE}` : ''}</p>
    </DealActionDialog>
  );
}

/** DE14: Move to diligence, said first. `onMove` makes the move and throws to keep a refusal here. */
export function MoveToDiligenceDialog({ row, onClose, onMove, onMoved }) {
  return (
    <DealActionDialog title={`Move ${row.name} to diligence`} testId="dealflow-diligence" width={440}
      act="Move to diligence" busyLabel="Moving…" fallback={`${row.name} could not be moved. Try again.`}
      onConfirm={onMove} onDone={onMoved} onClose={onClose}>
      <p className={MUTED} data-testid="dealflow-diligence-line">{MOVE_DILIGENCE_LINE}</p>
    </DealActionDialog>
  );
}

/** Move back to an earlier stage: the same move, said first. */
export function MoveBackDialog({ row, to, onClose, onMove }) {
  return (
    <DealActionDialog title={`Move ${row.name} back to ${STAGE_WORD[to]}?`} testId="dealflow-back" width={440}
      act="Move back" busyLabel="Moving…" fallback={`${row.name} could not be moved. Try again.`} onConfirm={onMove} onClose={onClose}>
      <p className={MUTED} data-testid="dealflow-back-line">{MOVE_BACK_LINE}</p>
    </DealActionDialog>
  );
}

/** Move to Commit: the same move, with what it does not do. */
export function CommitDialog({ row, onClose, onMove }) {
  return (
    <DealActionDialog title={`Move ${row.name} to Commit?`} testId="dealflow-commit" width={440}
      act="Move" busyLabel="Moving…" fallback={`${row.name} could not be moved. Try again.`} onConfirm={onMove} onClose={onClose}>
      <p className={MUTED} data-testid="dealflow-commit-line">{COMMIT_LINE}</p>
    </DealActionDialog>
  );
}

/** Not for me: hides the row for the firm. The reason is optional and stays with the firm. */
export function NotForMeDialog({ item, onClose, onDismissed, api = dealFlowApi }) {
  const [reason, setReason] = useState('');
  return (
    <DealActionDialog title={`Hide ${item.venture || 'this venture'} from New for you?`} testId="dealflow-notforme" width={440}
      act="Not for me" busyLabel="Hiding…" fallback="This row could not be hidden. Try again."
      onConfirm={() => api.dismiss(item.key, reason.trim() || null)} onDone={() => onDismissed()} onClose={onClose}>
      <p className={MUTED}>It leaves New for you for everyone at your firm. It is not a pass: nothing is added to your deal flow, and the round does not change.</p>
      <label className="flex flex-col gap-1"><span className={EYE}>Reason · optional</span>
        <textarea className={FIELD} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="dealflow-notforme-reason" />
      </label>
    </DealActionDialog>
  );
}
