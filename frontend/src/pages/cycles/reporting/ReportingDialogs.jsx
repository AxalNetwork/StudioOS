/**
 * D1060 (#2930) — the Reporting desk's and the builder's dialogs, each in the
 * page and each saying what it changes; never a browser pop-up. A refusal
 * stays in its dialog in the Worker's words, and closing is locked while a
 * write runs.
 *
 *   RPT7a  Give an expected date   POST /api/reporting/periods/:uid/expected
 *   RPT7b  Reminder settings       PUT  /api/reporting/reminders
 *   RPT5d  Send                    POST /api/reporting/reports/:uid/send
 *   RPT6   Correct this report     POST /api/reporting/reports/:uid/correct
 */
import React, { useRef, useState } from 'react';
import { reportingApi } from '../../../lib/api/reporting.js';
import { reportError } from '../../../lib/log';
import { Lightbox, actionGhost, actionPrimary } from '../../../ui';
import {
  CHANNEL_WORDS, NOTE_MAX, REMINDERS_LINE, expectedAudience, expectedError, holderName, offsetWords, reminderChoices,
} from './deskModel.js';
import { correctionError, sendLines, sendRefusal, sendTitle } from './builderModel.js';

const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'm-0 text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const INFO = 'm-0 rounded-lg border border-axal-lavender-edge bg-axal-lavender px-3 py-2 text-[12.5px] text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-200';

/** The shell every dialog here shares: one press at a time, the refusal said in the dialog. */
export function Dialog({ title, testId, children, button, busyWord = 'Saving…', ready, run, onClose, onDone, refusalOf = (e) => e?.message || 'That did not work. Nothing changed. Try again.' }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const lock = useRef(false);
  const close = () => { if (!lock.current) onClose(); };
  const go = async () => {
    if (lock.current || !ready) return;
    lock.current = true; setBusy(true); setRefusal('');
    try { const out = await run(); lock.current = false; onDone(out); } catch (e) {
      reportError('ReportingDialogs:write', e);
      setRefusal(refusalOf(e));
    } finally { lock.current = false; setBusy(false); }
  };
  return (
    <Lightbox label={title} title={title} onClose={close} width={560} testId={testId}
      footer={(
        <div className="flex flex-col gap-2">
          {refusal && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid={`${testId}-refused`}>{refusal}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={actionGhost} onClick={close} disabled={busy}>Back</button>
            <button type="button" className={actionPrimary} onClick={go} disabled={!ready || busy} data-testid={`${testId}-go`}>{busy ? busyWord : button}</button>
          </div>
        </div>
      )}>
      <div className="flex flex-col gap-3 text-[13px]">{children}</div>
    </Lightbox>
  );
}

/** RPT7a: the founders' expected date and note, which the period's holder sees. */
export function ExpectedDateDialog({ period, today, onClose, onDone }) {
  const [day, setDay] = useState(period?.expected_on || '');
  const [note, setNote] = useState(period?.expected_note || '');
  const error = expectedError(day, note, today);
  return (
    <Dialog title="Give an expected date" testId="reporting-expected" button="Save date" ready={!error}
      run={() => reportingApi.setExpected(period.uid, day, note.trim())} onClose={onClose} onDone={onDone}>
      <p className={SUB}>{period.label} {period.duty.title.toLowerCase()} to {holderName(period.duty)}.</p>
      <label className="flex flex-col gap-1">
        <span className={EYE}>Expected date</span>
        <input type="date" min={today} value={day} onChange={(e) => setDay(e.target.value)} className={FIELD} data-testid="reporting-expected-day" />
      </label>
      <label className="flex flex-col gap-1">
        <span className={EYE}>Note · optional</span>
        <textarea rows={2} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} className={FIELD} placeholder="Waiting on our accountant’s close" data-testid="reporting-expected-note" />
      </label>
      {day && error && <p className="m-0 text-[12px] text-amber-800 dark:text-amber-200" data-testid="reporting-expected-error">{error}</p>}
      <p className={INFO} data-testid="reporting-expected-audience">{expectedAudience(period)}</p>
    </Dialog>
  );
}

/** RPT7b: when, how and to whom the venture's reminders go. The team only, never an investor. */
export function ReminderDialog({ desk, onClose, onDone }) {
  const saved = desk?.reminders || {};
  const team = Array.isArray(saved.team) ? saved.team : [];
  const [offsets, setOffsets] = useState(() => new Set((saved.offsets || []).map(Number)));
  const [channels, setChannels] = useState(() => new Set(saved.channels || []));
  const [people, setPeople] = useState(() => new Set((saved.recipient_user_ids || []).map(Number)));
  const flip = (set, setter, v) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); setter(n); };
  const ready = offsets.size > 0 && offsets.size <= 6 && channels.size > 0 && people.size > 0;
  const box = (checked, onChange, label, testId) => (
    <label className="flex items-center gap-2" key={testId}>
      <input type="checkbox" checked={checked} onChange={onChange} data-testid={testId} />
      <span>{label}</span>
    </label>
  );
  return (
    <Dialog title="Reminder settings" testId="reporting-reminders" button="Save" ready={ready}
      run={() => reportingApi.setReminders({ project: desk.project.id, offsets: [...offsets].sort((a, b) => b - a), channels: [...channels], recipient_user_ids: [...people] })}
      onClose={onClose} onDone={onDone}>
      <p className={SUB}>For every duty of {desk?.project?.name || 'this venture'}.{saved.saved === false ? ' These are the defaults; nothing is saved yet.' : ''}</p>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className={EYE}>When</legend>
        {reminderChoices(saved.offsets).map((n) => box(offsets.has(n), () => flip(offsets, setOffsets, n), offsetWords(n), `reporting-reminder-offset-${n}`))}
      </fieldset>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className={EYE}>How</legend>
        {Object.entries(CHANNEL_WORDS).map(([k, w]) => box(channels.has(k), () => flip(channels, setChannels, k), w, `reporting-reminder-channel-${k}`))}
      </fieldset>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className={EYE}>To</legend>
        {team.length
          ? team.map((u) => box(people.has(Number(u.id)), () => flip(people, setPeople, Number(u.id)), u.name || 'A founder not named', `reporting-reminder-person-${u.id}`))
          : <p className={SUB} data-testid="reporting-reminder-noteam">The founder team could not be named here.</p>}
      </fieldset>
      {!ready && <p className="m-0 text-[12px] text-amber-800 dark:text-amber-200" data-testid="reporting-reminder-need">Choose at least one time (at most six), one way and one person.</p>}
      <p className={INFO}>{REMINDERS_LINE}</p>
    </Dialog>
  );
}

/** RPT5d: what Send freezes, what it meets, and what it is sent without. */
export function SendDialog({ report, preview, recipients, onClose, onDone }) {
  const lines = sendLines(report, preview);
  return (
    <Dialog title={sendTitle(report, recipients)} testId="reporting-send" button="Send" busyWord="Sending…"
      ready={!!preview?.figures_sha256 && !preview?.stale}
      run={() => reportingApi.sendReport(report.uid, preview.figures_sha256)} refusalOf={sendRefusal}
      onClose={onClose} onDone={onDone}>
      <ul className="m-0 flex list-disc flex-col gap-2 pl-5" data-testid="reporting-send-lines">
        {lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
      {preview?.stale && <p className="m-0 text-[12.5px] text-amber-800 dark:text-amber-200" data-testid="reporting-send-stale">{preview.stale_reason}</p>}
    </Dialog>
  );
}

/** RPT6: Correct this report, a new revision with a reason everyone the report reached reads. */
export function CorrectDialog({ report, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const error = correctionError(reason);
  return (
    <Dialog title="Correct this report" testId="reporting-correct" button="Open the correction" ready={!error}
      run={() => reportingApi.correctReport(report.uid, reason.trim())} onClose={onClose} onDone={onDone}>
      <p className={SUB}>A correction is revision {Number(report.revision) + 1}: a new draft with this report’s choices and statements, and its figures read again. When you send it, everyone this report reached is told, and they see both versions. This revision stays as it was sent.</p>
      <label className="flex flex-col gap-1">
        <span className={EYE}>What the correction changes · required</span>
        <textarea rows={3} maxLength={280} value={reason} onChange={(e) => setReason(e.target.value)} className={FIELD} placeholder="Customers changed after a Stripe refund" data-testid="reporting-correct-reason" />
      </label>
      {reason && error && <p className="m-0 text-[12px] text-amber-800 dark:text-amber-200">{error}</p>}
    </Dialog>
  );
}
