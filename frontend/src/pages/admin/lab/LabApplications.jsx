import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { adminLabApi } from '../../../lib/api/adminLab';
import { Lightbox, actionGhost, actionPrimary } from '../../../ui';
import { Week1Plan, answerRows } from '../AdminApplicantDetail';
import { dataOf, isFailed, refusalText } from './labDesksModel';
import {
  CARD, Chip, Dialog, EYE, Field, INPUT, LINK, MONO, Pill, Radios, ReadState, SUB, Select, TD, TH, hasRows, useRead, useWrite,
} from './labParts';
import {
  APPLICATIONS_PATH, APPLICATION_REFUSALS, ASKS_MAX, BULK_MAX, CHIPS, EMPTY_FILTERS, INCORPORATED_FILTERS, INTERVIEW_FILTERS, LENGTHS, NOTE_MAX,
  ORIGIN_FILTERS, PAGE_SIZE, REASON_MAX, SORTS, STAGE_FILTERS, TTO_FILTERS,
  admitCopy, applicationOf, applicationRow, approveCopy, asksOf, bulkCopy, bulkResult, cancelCopy, cannotAct, capacityOf, closedLine,
  cohortSwitch, cohortWord, countQuery, decidedLine, declineCopy, detailReply, etToUtc, founderSees, historyOf, interviewCopy, interviewOf,
  listQuery, listReply, moveCopy, movedLine, narrowed, needsConfirm, nextCohort, openCohorts, rangeOf, runCopy, statusOf, waitlistCopy, yourTime,
} from './applicationsModel';

/**
 * D948 (#2753) — Applications (SL2), one application (SL3) at
 * `/applications/:id`, and SL4's seven dialogs, to the owner's canvas.
 *
 *   · SL2: the cohort switch, the status chips with their counts, the capacity
 *     bar and the below-the-minimum callout (SL2b), search, the filters, the
 *     sort, the selection with its bulk bar, and "1–25 of N", all asked of
 *     D944's paged read; a table, cards on a phone.
 *   · SL3: a drawer (a full-screen sheet on a phone) from D948's one-application
 *     read: the idea, the facts, the Week 1 plan, the interview, what the
 *     founder sees, the history, and SL3b's closed states.
 *   · SL4 A–G: Approve (with the places line and the over-places confirm),
 *     Waitlist, Decline (internal reason, the founder's note and up to three
 *     asks, separate fields), Move, Schedule an interview, Run below the
 *     minimum, and Admit without an application.
 *
 * Every change is an in-page dialog that says what it changes; there is no
 * browser pop-up. A read that failed says so with Try again; nothing stands in
 * for it as a zero. A row's door to its application is written out
 * (`to={\`/admin/…/applications/${id}\`}`), so the reachability walk finds
 * `/applications/:id`.
 */

const BTN_SM = 'inline-flex min-h-[32px] items-center rounded-[8px] border border-axal-hairline bg-white px-2.5 text-[12px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const MENU_ITEM = 'rounded-[7px] px-2.5 py-2 text-left text-[13px] text-axal-ink hover:bg-axal-ground disabled:text-axal-muted dark:text-gray-100 dark:hover:bg-gray-800 dark:disabled:text-gray-500';

const ACTIONS = [
  { kind: 'approve', word: 'Approve' },
  { kind: 'waitlist', word: 'Waitlist' },
  { kind: 'decline', word: 'Decline' },
  { kind: 'move', word: 'Move to another cohort' },
  { kind: 'interview', word: 'Schedule an interview' },
];

/** ⋯ for one row: its five actions, each opening its dialog. */
function RowMenu({ row, onAction }) {
  const [open, setOpen] = useState(false);
  const pick = (kind) => { setOpen(false); onAction(kind, row); };
  return (
    <span className="relative inline-block">
      <button type="button" aria-expanded={open} aria-label={`Actions for ${row.company}`} className={BTN_SM} onClick={() => setOpen((o) => !o)} data-testid={`lab-app-menu-${row.id}`}>⋯</button>
      {open ? (
        <span className="absolute right-0 z-10 mt-1 flex min-w-[13rem] flex-col rounded-[10px] border border-axal-hairline bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900" data-testid={`lab-app-menu-${row.id}-list`}>
          {ACTIONS.map((a) => (
            <button key={a.kind} type="button" className={MENU_ITEM} onClick={() => pick(a.kind)} data-testid={`lab-app-${a.kind}-${row.id}`}>{a.word}</button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function ReasonField({ value, onChange, label, disabled, testId }) {
  return (
    <Field label={label}>
      <textarea value={value} rows={3} maxLength={REASON_MAX} disabled={disabled} onChange={(e) => onChange(e.target.value.slice(0, REASON_MAX))}
        className={`${INPUT} py-2 leading-normal`} data-testid={testId} />
    </Field>
  );
}

function Confirm({ on, onChange, line, disabled, testId }) {
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-950/40" data-testid={testId}>
      <span className="text-[12.5px] font-semibold text-amber-900 dark:text-amber-200">{line}</span>
      <label className="flex items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100">
        <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={`${testId}-check`} />
        I confirm approving past the places
      </label>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * SL4 A–C: the three decisions
 * ------------------------------------------------------------------ */

function ApproveDialog({ row, cap, onClose, onChanged }) {
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [asked, setAsked] = useState(false);
  const w = useWrite(onChanged, APPLICATION_REFUSALS, refusalText);
  const copy = approveCopy(row, cap);
  const showConfirm = copy.over || asked;
  const go = () => w.run(async () => {
    try {
      return await api.adminCohortApplicantDecide(row.applicantId, { status: 'approved', reason: reason.trim(), confirm_over_places: confirm === true });
    } catch (e) { if (needsConfirm(e)) setAsked(true); throw e; }
  });
  return (
    <Dialog title={copy.title} sub={copy.sub} onClose={onClose} w={w} action={copy.action} disabled={!reason.trim() || (showConfirm && !confirm)} testId="lab-app-approve"
      onAction={go} done={w.reply ? decidedLine('approved', w.reply, row) : null}>
      <ReasonField value={reason} onChange={setReason} label="Reason · internal, required, never shown to the founder" disabled={Boolean(w.reply)} testId="lab-app-approve-reason" />
      {copy.after ? <p className={`m-0 ${MONO}`} data-testid="lab-app-approve-after">{copy.after}</p> : null}
      {copy.unread ? <p className={`m-0 ${SUB}`} data-testid="lab-app-approve-unread">{copy.unread}</p> : null}
      {showConfirm ? <Confirm on={confirm} onChange={setConfirm} line={copy.overLine} disabled={Boolean(w.reply)} testId="lab-app-approve-over" /> : null}
    </Dialog>
  );
}

function WaitlistDialog({ row, next, onClose, onChanged }) {
  const [reason, setReason] = useState('');
  const w = useWrite(onChanged, APPLICATION_REFUSALS, refusalText);
  const copy = waitlistCopy(row, next);
  return (
    <Dialog title={copy.title} sub={copy.sub} onClose={onClose} w={w} action={copy.action} disabled={!reason.trim()} testId="lab-app-waitlist"
      onAction={() => w.run(() => api.adminCohortApplicantDecide(row.applicantId, { status: 'waitlisted', reason: reason.trim() }))}
      done={w.reply ? decidedLine('waitlisted', w.reply, row) : null}>
      <ReasonField value={reason} onChange={setReason} label="Reason · internal, required" disabled={Boolean(w.reply)} testId="lab-app-waitlist-reason" />
    </Dialog>
  );
}

function DeclineDialog({ row, next, onClose, onChanged }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [asks, setAsks] = useState(['']);
  const w = useWrite(onChanged, APPLICATION_REFUSALS, refusalText);
  const copy = declineCopy(row, next);
  const setAsk = (i) => (e) => setAsks((a) => a.map((x, j) => (j === i ? e.target.value.slice(0, 200) : x)));
  const payload = () => {
    const out = { status: 'rejected', reason: reason.trim() };
    if (note.trim()) out.applicant_note = note.trim();
    const list = asksOf(asks);
    if (list.length) out.applicant_asks = list;
    return out;
  };
  return (
    <Dialog title={copy.title} sub={copy.sub} onClose={onClose} w={w} action={copy.action} tone="danger" disabled={!reason.trim()} testId="lab-app-decline"
      onAction={() => w.run(() => api.adminCohortApplicantDecide(row.applicantId, payload()))}
      done={w.reply ? decidedLine('rejected', w.reply, row) : null}>
      <ReasonField value={reason} onChange={setReason} label="Reason · internal, required, never shown" disabled={Boolean(w.reply)} testId="lab-app-decline-reason" />
      <Field label="Note to the founder · optional · they read this">
        <textarea value={note} rows={3} maxLength={NOTE_MAX} disabled={Boolean(w.reply)} onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
          className={`${INPUT} py-2 leading-normal`} data-testid="lab-app-decline-note" />
      </Field>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className={EYE}>{`What to work on · up to ${ASKS_MAX}`}</legend>
        {asks.map((a, i) => (
          <input key={i} value={a} onChange={setAsk(i)} disabled={Boolean(w.reply)} aria-label={`What to work on, line ${i + 1}`} className={INPUT} data-testid={`lab-app-decline-ask-${i}`} />
        ))}
        {asks.length < ASKS_MAX && !w.reply ? (
          <button type="button" className={`${LINK} self-start`} onClick={() => setAsks((a) => [...a, ''])} data-testid="lab-app-decline-add">Add a line</button>
        ) : null}
      </fieldset>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * SL4 D–G
 * ------------------------------------------------------------------ */

function MoveDialog({ row, overview, onClose, onChanged, now }) {
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [asked, setAsked] = useState(false);
  const w = useWrite(onChanged, APPLICATION_REFUSALS, refusalText);
  const copy = moveCopy(row);
  const choices = openCohorts(overview, now, row.cohort);
  const chosen = (choices || []).find((c) => c.value === target) || null;
  const go = () => w.run(async () => {
    try {
      return await adminLabApi.move(row.applicantId, { cycle_id: Number(target), reason: reason.trim(), confirm_over_places: confirm === true });
    } catch (e) { if (needsConfirm(e)) setAsked(true); throw e; }
  });
  return (
    <Dialog title={copy.title} sub={copy.sub} onClose={onClose} w={w} action={copy.action} disabled={!target || !reason.trim() || (asked && !confirm)} testId="lab-app-move"
      onAction={go} done={w.reply ? movedLine(w.reply, row, chosen) : null}>
      {choices === null ? <p className={`m-0 ${SUB}`} data-testid="lab-app-move-unread">The cohorts could not be read, so none can be chosen. Close this and try again.</p> : null}
      {choices && !choices.length ? <p className={`m-0 ${SUB}`} data-testid="lab-app-move-none">No other cohort is open now.</p> : null}
      {choices && choices.length ? <Radios name="lab-app-move" value={target} onChange={setTarget} options={choices} disabled={Boolean(w.reply)} testId="lab-app-move-to" /> : null}
      <ReasonField value={reason} onChange={setReason} label="Reason · required" disabled={Boolean(w.reply)} testId="lab-app-move-reason" />
      {asked ? <Confirm on={confirm} onChange={setConfirm} line="That cohort is full. An approved founder takes a place there." disabled={Boolean(w.reply)} testId="lab-app-move-over" /> : null}
    </Dialog>
  );
}

function InterviewDialog({ row, again, onClose, onChanged }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [length, setLength] = useState(30);
  const [place, setPlace] = useState('');
  const [note, setNote] = useState('');
  const w = useWrite(onChanged, APPLICATION_REFUSALS, refusalText);
  const copy = interviewCopy(row, again);
  const at = etToUtc(date, time);
  const mine = at ? yourTime(at) : null;
  return (
    <Dialog title={copy.title} sub={copy.sub} onClose={onClose} w={w} action={copy.action} disabled={!at} testId="lab-app-interview"
      onAction={() => w.run(() => api.adminCohortScheduleInterview(row.applicantId, { scheduled_at: at, duration_min: length, location: place.trim() || undefined, note: note.trim() || undefined }))}
      done={w.reply ? `The interview with ${row.company} is set. The founder sees it now.` : null}>
      <span className="flex flex-wrap gap-3">
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={Boolean(w.reply)} className={`${INPUT} font-mono`} data-testid="lab-app-interview-date" /></Field>
        <Field label="Time · ET"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={Boolean(w.reply)} className={`${INPUT} font-mono`} data-testid="lab-app-interview-time" /></Field>
      </span>
      {mine ? <p className={`m-0 ${SUB}`} data-testid="lab-app-interview-yours">{mine}</p> : null}
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className={EYE}>Length</legend>
        <span className="flex flex-wrap gap-2">
          {LENGTHS.map((m) => <Chip key={m} on={length === m} onClick={() => setLength(m)} testId={`lab-app-interview-${m}`}>{`${m} min`}</Chip>)}
        </span>
      </fieldset>
      <Field label="Place or link"><input value={place} maxLength={500} onChange={(e) => setPlace(e.target.value)} disabled={Boolean(w.reply)} className={INPUT} data-testid="lab-app-interview-place" /></Field>
      <Field label="Note to the founder">
        <textarea value={note} rows={3} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} disabled={Boolean(w.reply)} className={`${INPUT} py-2 leading-normal`} data-testid="lab-app-interview-note" />
      </Field>
    </Dialog>
  );
}

function CancelDialog({ row, onClose, onChanged }) {
  const w = useWrite(onChanged, APPLICATION_REFUSALS, refusalText);
  const copy = cancelCopy(row);
  return (
    <Dialog title={copy.title} sub={copy.sub} onClose={onClose} w={w} action={copy.action} tone="danger" testId="lab-app-cancel"
      onAction={() => w.run(() => api.adminCohortCancelInterview(row.applicantId))}
      done={w.reply ? `The interview with ${row.company} is cancelled.` : null} />
  );
}

function RunDialog({ cap, onClose, onChanged }) {
  const [reason, setReason] = useState('');
  const w = useWrite(onChanged, APPLICATION_REFUSALS, refusalText);
  const copy = runCopy(cap);
  return (
    <Dialog title={copy.title} sub={copy.sub} onClose={onClose} w={w} action={copy.action} disabled={!reason.trim()} testId="lab-app-run"
      onAction={() => w.run(() => api.adminCohortForceProceed(cap.cohort.id, { reason: reason.trim() }))}
      done={w.reply ? `${cap.word} will run below the minimum.` : null}>
      <ReasonField value={reason} onChange={setReason} label="Reason · required" disabled={Boolean(w.reply)} testId="lab-app-run-reason" />
    </Dialog>
  );
}

/**
 * SL4 G: admit a founder without an application. Opened from here, it finds
 * the founder by name or email (`GET /api/admin/users?q=`); the Users console
 * can open the same dialog with `who` already chosen.
 */
export function AdmitDialog({ who: given = null, overview, onClose, onChanged, now = Date.now() }) {
  const [who, setWho] = useState(given);
  const [q, setQ] = useState('');
  const [asked, setAsked] = useState('');
  const [cycle, setCycle] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [over, setOver] = useState(false);
  const found = useRead(`admit-users:${asked}`, 0, () => (asked ? api.adminListUsers({ q: asked, envelope: true, limit: 10 }) : Promise.resolve(null)));
  const w = useWrite(onChanged, APPLICATION_REFUSALS, refusalText);
  const copy = admitCopy(who?.name || who?.email);
  const choices = openCohorts(overview, now);
  const people = (dataOf(found)?.results || []).filter((u) => u.role !== 'admin');
  const go = () => w.run(async () => {
    try {
      return await adminLabApi.admit({ user_id: who.id, cycle_id: Number(cycle), reason: reason.trim(), confirm_over_places: confirm === true });
    } catch (e) { if (needsConfirm(e)) setOver(true); throw e; }
  });
  return (
    <Dialog title={copy.title} sub={copy.sub} onClose={onClose} w={w} action={copy.action} disabled={!who || !cycle || !reason.trim() || (over && !confirm)} testId="lab-app-admit"
      onAction={go} done={w.reply ? `${who?.name || 'The founder'} is admitted. Their application is in the queue as approved.` : null}>
      {given ? null : (
        <div className="flex flex-col gap-2">
          <form className="flex flex-wrap gap-2" role="search" onSubmit={(e) => { e.preventDefault(); setAsked(q.trim()); }}>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" aria-label="Find the founder by name or email" className={`${INPUT} flex-1`} data-testid="lab-app-admit-q" />
            <button type="submit" className={actionGhost} data-testid="lab-app-admit-find">Find</button>
          </form>
          {asked ? <ReadState read={found} what="The accounts" claim="No founder can be chosen while they cannot be read." onRetry={() => setAsked(`${asked} `.trim())} testId="lab-app-admit-read" /> : null}
          {asked && dataOf(found) && !people.length ? <p className={`m-0 ${SUB}`} data-testid="lab-app-admit-none">No founder account matches.</p> : null}
          {people.length ? (
            <Radios name="lab-app-admit-who" value={who ? String(who.id) : null} onChange={(v) => setWho(people.find((u) => String(u.id) === v) || null)}
              options={people.map((u) => ({ value: String(u.id), label: [u.name, u.email].filter(Boolean).join(' · ') }))} disabled={Boolean(w.reply)} testId="lab-app-admit-who" />
          ) : null}
        </div>
      )}
      <Field label="Cohort · open only">
        {choices === null ? <span className={SUB} data-testid="lab-app-admit-unread">The cohorts could not be read, so none can be chosen.</span> : (
          <select value={cycle} onChange={(e) => setCycle(e.target.value)} disabled={Boolean(w.reply)} className={INPUT} data-testid="lab-app-admit-cohort">
            <option value="">Choose an open cohort</option>
            {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        )}
      </Field>
      <ReasonField value={reason} onChange={setReason} label="Reason · required" disabled={Boolean(w.reply)} testId="lab-app-admit-reason" />
      {over ? <Confirm on={confirm} onChange={setConfirm} line="That cohort is full. Admitting takes a place." disabled={Boolean(w.reply)} testId="lab-app-admit-over" /> : null}
    </Dialog>
  );
}

/** The bulk bar's dialog: one reason, each application through the one decision path (D945). */
function BulkDialog({ status, rows, cap, onClose, onChanged }) {
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [asked, setAsked] = useState(false);
  const w = useWrite(onChanged, APPLICATION_REFUSALS, refusalText);
  const copy = bulkCopy(status, rows.length);
  const result = w.reply ? bulkResult(w.reply, rows) : null;
  const room = cap?.state === 'ready' ? cap.places - cap.approved : null;
  const over = status === 'approved' && room !== null && rows.filter((r) => !r.approved).length > room;
  const go = () => w.run(async () => {
    const reply = await adminLabApi.bulkDecide({ applicant_ids: rows.map((r) => r.applicantId), status, reason: reason.trim(), confirm_over_places: confirm === true });
    if ((reply?.results || []).some((x) => x.error === 'over_places')) setAsked(true);
    return reply;
  });
  return (
    <Dialog title={copy.title} sub={copy.sub} onClose={onClose} w={w} action={copy.action} disabled={!reason.trim() || ((over || asked) && !confirm && !w.reply)} testId="lab-app-bulk"
      onAction={go} done={result ? result.line : null}>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="lab-app-bulk-list">
        {rows.map((r) => <li key={r.id}>{`${r.company} · ${r.name}`}</li>)}
      </ul>
      <ReasonField value={reason} onChange={setReason} label="Reason · internal, required · covers them all" disabled={Boolean(w.reply)} testId="lab-app-bulk-reason" />
      {(over || asked) && !w.reply ? <Confirm on={confirm} onChange={setConfirm} line={cap?.state === 'ready' ? `This is over the ${cap.places.toLocaleString('en-US')} places set in Settings.` : 'Some of these are over the places set in Settings.'} testId="lab-app-bulk-over" /> : null}
      {result?.refused.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="lab-app-bulk-refused">
          {result.refused.map((l) => <li key={l} className="text-[12.5px] font-semibold text-red-700 dark:text-red-300">{l}</li>)}
        </ul>
      ) : null}
    </Dialog>
  );
}

/** Whichever dialog the admin opened, or the sentence that says why it cannot open. */
function ActionDialog({ dialog, overview, onClose, onChanged, now }) {
  const { kind, row } = dialog;
  const why = row ? cannotAct(kind, row) : null;
  if (why) {
    return (
      <Lightbox label="Cannot change this" title="Cannot change this" onClose={onClose} testId="lab-app-cannot" pageBelow="lg"
        footer={<div className="flex justify-end"><button type="button" className={actionPrimary} onClick={onClose}>Close</button></div>}>
        <p className="m-0 px-5 py-4 text-[13px] text-axal-ink dark:text-gray-100" data-testid="lab-app-cannot-why">{why}</p>
      </Lightbox>
    );
  }
  const cap = row ? capacityOf(overview, row.cohort, now) : dialog.cap;
  const next = row ? nextCohort(overview, row.cohort) : null;
  if (kind === 'approve') return <ApproveDialog row={row} cap={cap} onClose={onClose} onChanged={onChanged} />;
  if (kind === 'waitlist') return <WaitlistDialog row={row} next={next} onClose={onClose} onChanged={onChanged} />;
  if (kind === 'decline') return <DeclineDialog row={row} next={next} onClose={onClose} onChanged={onChanged} />;
  if (kind === 'move') return <MoveDialog row={row} overview={overview} onClose={onClose} onChanged={onChanged} now={now} />;
  if (kind === 'interview') return <InterviewDialog row={row} again={row.hasInterview} onClose={onClose} onChanged={onChanged} />;
  if (kind === 'cancel') return <CancelDialog row={row} onClose={onClose} onChanged={onChanged} />;
  if (kind === 'run') return <RunDialog cap={dialog.cap} onClose={onClose} onChanged={onChanged} />;
  if (kind === 'admit') return <AdmitDialog overview={overview} onClose={onClose} onChanged={onChanged} now={now} />;
  return <BulkDialog status={dialog.status} rows={dialog.rows} cap={dialog.cap} onClose={onClose} onChanged={onChanged} />;
}

/* ------------------------------------------------------------------ *
 * One application (SL3)
 * ------------------------------------------------------------------ */

function Section({ title, meta, children, testId }) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-axal-hairline pt-3 dark:border-gray-700" data-testid={testId}>
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-[13.5px] font-extrabold text-axal-ink dark:text-gray-100">{title}</h3>
        {meta ? <span className={SUB}>{meta}</span> : null}
      </span>
      {children}
    </section>
  );
}

function Drawer({ id, tick, onClose, onAction, onRetry, now }) {
  const read = useRead(`application:${id}`, tick, () => adminLabApi.application(id).then(detailReply));
  const d = dataOf(read);
  const it = d?.item;
  const row = it ? applicationRow(it, now) : null;
  const notFound = isFailed(read) && Number(read.error?.status) === 404;
  const from = d?.cohort?.available ? d.cohort.carried_from : null;
  const closed = d ? closedLine(d, now) : null;
  const iv = d ? interviewOf(d, now) : null;
  const facts = it ? answerRows({ ...it, withdrawn_at: d.founder?.available ? d.founder.withdrawn_at : null }) : null;
  const history = d ? historyOf(d, now) : null;
  return (
    <Lightbox label={row?.company || 'Application'} title={row?.company || 'Application'} sub={row ? [row.name, row.role].filter(Boolean).join(' · ') : null}
      onClose={onClose} testId="lab-app-drawer" pageBelow="lg"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          {row && !closed ? (
            <>
              <button type="button" className={actionPrimary} onClick={() => onAction('approve', row)} data-testid="lab-app-drawer-approve">Approve</button>
              <button type="button" className={actionGhost} onClick={() => onAction('waitlist', row)} data-testid="lab-app-drawer-waitlist">Waitlist</button>
              <button type="button" className={actionGhost} onClick={() => onAction('decline', row)} data-testid="lab-app-drawer-decline">Decline</button>
              <button type="button" className={actionGhost} onClick={() => onAction('move', row)} data-testid="lab-app-drawer-move">Move to another cohort</button>
            </>
          ) : null}
          <button type="button" className={actionGhost} onClick={onClose}>Close</button>
        </div>
      )}>
      <div className="flex flex-col gap-3.5 px-5 py-4">
        {notFound ? <p className="m-0 text-[13px]" data-testid="lab-app-drawer-missing">There is no application with this address.</p> : null}
        {notFound ? null : <ReadState read={read} what="This application" claim="Nothing about it is shown while it cannot be read." onRetry={onRetry} testId="lab-app-drawer-read" />}
        {row ? (
          <>
            <span className="flex flex-wrap items-center gap-2" data-testid="lab-app-drawer-pills">
              <Pill tone={row.status.tone} glyph={row.status.glyph}>{row.status.word}</Pill>
              {row.cohort ? <Pill tone="violet" glyph="◆">{cohortWord(row.cohort)}</Pill> : null}
              {from ? <Pill tone="muted" glyph="→">{`Carried from ${cohortWord(from.cohort)}`}</Pill> : null}
            </span>
            {closed ? <p role="status" className={`m-0 rounded-[10px] border border-axal-hairline px-3 py-2 text-[13px] dark:border-gray-700`} data-testid="lab-app-drawer-closed">{closed}</p> : null}
            <Section title="The idea" testId="lab-app-idea">
              <p className="m-0 text-[13px] leading-relaxed text-axal-ink dark:text-gray-100">{it.idea || 'Not answered.'}</p>
            </Section>
            <Section title="Facts" testId="lab-app-facts">
              <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2">
                {[['Incorporated', it.incorporated === 'yes' ? 'Yes' : it.incorporated === 'no' ? 'Not yet' : 'Not recorded'], ['Stage', it.stage || 'Not recorded'], ['Jurisdiction', it.jurisdiction || 'Not recorded'], ...facts.rows].map(([k, v]) => (
                  <div key={k} className="flex gap-2"><dt className="text-axal-muted dark:text-gray-400">{k}</dt><dd className="m-0 text-axal-ink dark:text-gray-100">{v}</dd></div>
                ))}
              </dl>
              {facts.note ? <p className={`m-0 ${SUB}`} data-testid="lab-app-facts-note">{`Facts: ${facts.note}`}</p> : null}
            </Section>
            <Section title="Week 1 plan" meta="Read only" testId="lab-app-plan">
              {d.week1_plan?.available === false ? (
                <p className="m-0 flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-amber-800 dark:text-amber-300" data-testid="lab-app-plan-unread">
                  The Week 1 plan could not be read. That is not the same as none.
                  <button type="button" className="underline" onClick={onRetry}>Try again</button>
                </p>
              ) : <Week1Plan plan={d.week1_plan?.plan || null} unreadable={false} />}
            </Section>
            <Section title="Interview" testId="lab-app-interview-block">
              {iv.state === 'unreadable' ? <span className={SUB}>The interview could not be read.</span> : null}
              {iv.state === 'none' ? (
                <span className="flex flex-wrap items-center gap-2 text-[13px]">
                  No interview is set.
                  {row.interviewable ? <button type="button" className={BTN_SM} onClick={() => onAction('interview', row)} data-testid="lab-app-drawer-schedule">Schedule an interview</button> : null}
                </span>
              ) : null}
              {iv.state === 'set' ? (
                <>
                  <span className="flex flex-wrap items-center gap-2.5">
                    <span className={MONO} data-testid="lab-app-interview-line">{iv.line}</span>
                    {iv.yours ? <span className={SUB}>{iv.yours}</span> : null}
                    <button type="button" className={BTN_SM} onClick={() => onAction('interview', row)} data-testid="lab-app-drawer-reschedule">Move</button>
                    <button type="button" className={BTN_SM} onClick={() => onAction('cancel', row)} data-testid="lab-app-drawer-cancel">Cancel</button>
                  </span>
                  {iv.note ? <p className={`m-0 ${SUB}`}>{`Your note: ‘${iv.note}’`}</p> : null}
                  {iv.ask ? <p role="status" className="m-0 text-[12.5px] font-semibold text-amber-800 dark:text-amber-300" data-testid="lab-app-interview-ask">{iv.ask}</p> : null}
                </>
              ) : null}
            </Section>
            <Section title="What the founder sees" testId="lab-app-sees">
              <p className="m-0 rounded-[10px] border border-axal-hairline bg-axal-ground px-3 py-2 text-[13px] leading-relaxed text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">{founderSees(d, now)}</p>
              {d.founder?.available === false ? <span className={SUB}>What the founder was told could not be read, so their note is not shown.</span> : null}
            </Section>
            <Section title="History" testId="lab-app-history">
              {history.length ? (
                <ul className="m-0 flex list-none flex-col p-0">
                  {history.map((h) => (
                    <li key={h.key} className="flex flex-wrap items-baseline justify-between gap-2 py-1 text-[13px] text-axal-ink dark:text-gray-100">
                      <span><span aria-hidden="true" className="mr-2 text-axal-violet dark:text-violet-300">{h.glyph}</span>{h.text}</span>
                      {h.at ? <span className={`${MONO} text-axal-muted dark:text-gray-400`}>{h.at}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : <span className={SUB}>The record holds no dated step yet.</span>}
            </Section>
          </>
        ) : null}
      </div>
    </Lightbox>
  );
}

/* ------------------------------------------------------------------ *
 * The queue (SL2)
 * ------------------------------------------------------------------ */

function Capacity({ cap, onRetry, onRun }) {
  if (!cap) return null;
  return (
    <section className={`${CARD} flex flex-col gap-2 px-4 py-3`} aria-label={cap.label} data-testid="lab-app-capacity">
      <span className={EYE}>{cap.label}</span>
      {cap.state === 'unreadable' ? (
        <>
          <span className="font-mono text-[13px] font-bold text-axal-muted dark:text-gray-400" data-testid="lab-app-capacity-unreadable">Unreadable</span>
          <span className={SUB}>{cap.reason}</span>
          <button type="button" className={`${LINK} self-start`} onClick={onRetry}>Try again</button>
        </>
      ) : (
        <>
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-[13px] font-bold text-axal-ink dark:text-gray-100" data-testid="lab-app-capacity-text">{cap.text}</span>
            <Pill tone={cap.minimum.met ? 'green' : 'amber'} glyph={cap.minimum.met ? '✓' : '!'} testId="lab-app-capacity-min">{cap.minimum.text}</Pill>
          </span>
          <span aria-hidden="true" className="block h-2.5 w-full max-w-[360px] overflow-hidden rounded-full border border-axal-hairline bg-axal-ground dark:border-gray-700 dark:bg-gray-800">
            <span className={`block h-full ${cap.over ? 'bg-amber-500' : 'bg-axal-violet dark:bg-violet-400'}`} style={{ width: `${cap.pct}%` }} />
          </span>
          {cap.callout ? (
            <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="lab-app-below">
              <span>{cap.callout}</span>
              <button type="button" className={actionGhost} onClick={onRun} data-testid="lab-app-run-open">Run it anyway</button>
            </div>
          ) : null}
          {cap.forced ? <span className={SUB} data-testid="lab-app-forced">{cap.forced}</span> : null}
        </>
      )}
    </section>
  );
}

export default function LabApplications({ now = Date.now() }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const id = applicationOf(loc.pathname);
  const [f, setF] = useState(EMPTY_FILTERS);
  const [typed, setTyped] = useState('');
  const [tick, setTick] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [picked, setPicked] = useState({});
  const reload = () => setTick((t) => t + 1);
  const overview = useRead('applications-overview', tick, () => adminLabApi.overview());
  const sw = cohortSwitch(overview, now);
  // The open cohort is chosen until the admin picks; a failed or slow calendar chooses All.
  const cohort = f.cohort === null ? (dataOf(overview) ? sw.fallback : '') : f.cohort;
  const query = listQuery({ ...f, cohort });
  const read = useRead(`applications:${JSON.stringify(query)}`, tick, () => adminLabApi.applications(query).then(listReply));
  const counts = useRead(`applications-counts:${cohort}`, tick, () => Promise.all(CHIPS.map((c) => adminLabApi.applications(countQuery(cohort, c.key)).then(
    (r) => (r?.available === true && Number.isFinite(Number(r.total)) ? Number(r.total) : null),
    () => null,
  ))));
  const set = (k) => (v) => { setPicked({}); setF((x) => ({ ...x, cohort, [k]: v, page: 1 })); };
  const d = dataOf(read);
  const rows = (d?.items || []).map((r) => applicationRow(r, now));
  const total = Number(d?.total) || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const cap = capacityOf(overview, cohort, now);
  const chosen = rows.filter((r) => picked[r.id]);
  const onAction = (kind, row) => setDialog({ kind, row });
  const onChanged = () => { setPicked({}); reload(); };
  const toggle = (r) => setPicked((p) => (p[r.id] ? { ...p, [r.id]: false } : Object.values(p).filter(Boolean).length >= BULK_MAX ? p : { ...p, [r.id]: true }));
  const chipCount = dataOf(counts);
  const page = (n) => { setPicked({}); setF((x) => ({ ...x, cohort, page: n })); };

  return (
    <div className="flex flex-col gap-3.5" data-testid="lab-applications">
      <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">One queue. Every application belongs to one cohort. Approved founders start on the cohort’s 1st.</p>

      <section className={`${CARD} flex flex-wrap items-center gap-2.5 px-[18px] py-3`} aria-label="Cohort" data-testid="lab-app-cohorts">
        <span className={EYE}>Cohort</span>
        <span className="flex flex-wrap gap-2" role="group" aria-label="Cohort">
          {sw.options.map((o) => <Chip key={o.value || 'all'} on={cohort === o.value} onClick={() => set('cohort')(o.value)} testId={`lab-app-cohort-${o.value || 'all'}`}>{o.label}</Chip>)}
        </span>
        <span className="ml-auto"><button type="button" className={actionGhost} onClick={() => setDialog({ kind: 'admit' })} data-testid="lab-app-admit-open">Admit without an application</button></span>
        {isFailed(overview) ? <p className={`m-0 w-full ${SUB}`} data-testid="lab-app-cohorts-unread">The cohort calendar could not be read, so only All cohorts can be shown. <button type="button" className="underline" onClick={reload}>Try again</button></p> : null}
      </section>

      <section className="flex flex-wrap gap-2" aria-label="Status" role="group" data-testid="lab-app-chips">
        {CHIPS.map((c, i) => (
          <Chip key={c.key} on={f.status === c.key} onClick={() => set('status')(f.status === c.key ? '' : c.key)} testId={`lab-app-chip-${c.key}`}>
            <span aria-hidden="true">{c.glyph}</span>{c.word}
            <span className="font-mono" data-testid={`lab-app-chip-${c.key}-n`}>{chipCount ? (chipCount[i] === null ? '–' : chipCount[i].toLocaleString('en-US')) : '…'}</span>
          </Chip>
        ))}
        {chipCount && chipCount.some((n) => n === null) ? <span className={SUB} data-testid="lab-app-chips-unread">A dash is a count that could not be read, not a zero.</span> : null}
      </section>

      <Capacity cap={cap} onRetry={reload} onRun={() => setDialog({ kind: 'run', cap })} />

      {chosen.length ? (
        <section className="flex flex-wrap items-center gap-2.5 rounded-[12px] border border-axal-lavender-edge bg-axal-lavender px-3.5 py-2.5 dark:border-violet-800 dark:bg-violet-950/40" aria-label="Selected" data-testid="lab-app-bulk-bar">
          <span className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100" data-testid="lab-app-bulk-n">{`${chosen.length} selected`}</span>
          <span className={SUB}>One reason covers them all.</span>
          <span className="ml-auto flex flex-wrap gap-2">
            <button type="button" className={actionPrimary} onClick={() => setDialog({ kind: 'bulk', status: 'approved', rows: chosen, cap })} data-testid="lab-app-bulk-approve">Approve</button>
            <button type="button" className={actionGhost} onClick={() => setDialog({ kind: 'bulk', status: 'waitlisted', rows: chosen, cap })} data-testid="lab-app-bulk-waitlist">Waitlist</button>
            <button type="button" className={actionGhost} onClick={() => setPicked({})} data-testid="lab-app-bulk-clear">Clear</button>
          </span>
        </section>
      ) : null}

      <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-label="Applications">
        <h2 className="sr-only">Applications</h2>
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); set('q')(typed); }} role="search">
          <input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search company, founder, institution or idea" aria-label="Search company, founder, institution or idea"
            className={`${INPUT} min-w-[14rem] flex-1`} data-testid="lab-app-search" />
          <button type="submit" className={actionGhost} data-testid="lab-app-search-go">Search</button>
          <Select label="Origin" value={f.origin} onChange={set('origin')} options={ORIGIN_FILTERS} testId="lab-app-origin" />
          <Select label="Tech transfer" value={f.tech_transfer} onChange={set('tech_transfer')} options={TTO_FILTERS} testId="lab-app-tto" />
          <Select label="Stage" value={f.stage} onChange={set('stage')} options={STAGE_FILTERS} testId="lab-app-stage" />
          <Select label="Incorporated" value={f.incorporated} onChange={set('incorporated')} options={INCORPORATED_FILTERS} testId="lab-app-incorporated" />
          <Select label="Interview" value={f.interview} onChange={set('interview')} options={INTERVIEW_FILTERS} testId="lab-app-interview" />
          <Chip on={f.carried} onClick={() => set('carried')(!f.carried)} testId="lab-app-carried">Carried forward</Chip>
          <Select label="Sort" value={f.sort} onChange={set('sort')} options={SORTS} testId="lab-app-sort" />
        </form>
        <ReadState read={read} what="The applications" claim="No application is shown as waiting or decided while they cannot be read." onRetry={reload} testId="lab-app-read" />
        {hasRows(read) ? (
          !rows.length ? (
            <p className={`m-0 ${SUB}`} data-testid="lab-app-empty">
              {total ? 'This page is past the last application.' : narrowed(f) ? 'No application matches these filters.' : f.status ? `No application is ${statusOf(f.status).word.toLowerCase()}${cohort ? ` in ${cohortWord(cohort)}` : ''}.` : 'No application is in this cohort.'}
            </p>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[1100px] border-collapse" data-testid="lab-app-table">
                  <thead><tr className="border-b border-axal-hairline dark:border-gray-700">
                    {['', 'Company', 'Founder', 'Origin', 'Tech transfer', 'Team', 'Applied', 'Waiting', 'Interview', 'Status', ''].map((c, i) => (
                      <th key={i} scope="col" className={TH}>{c || <span className="sr-only">{i ? 'Actions' : 'Select'}</span>}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-axal-hairline last:border-b-0 dark:border-gray-700" data-testid={`lab-app-row-${r.id}`}>
                        <td className={TD}><input type="checkbox" checked={Boolean(picked[r.id])} onChange={() => toggle(r)} aria-label={`Select ${r.company}`} data-testid={`lab-app-pick-${r.id}`} /></td>
                        <td className={TD}>
                          <Link to={`/admin/programs/spinout-lab/applications/${encodeURIComponent(r.id)}`} className="font-bold text-axal-ink underline decoration-dotted underline-offset-2 dark:text-gray-100" data-testid={`lab-app-open-${r.id}`}>{r.company}</Link>
                          {r.idea ? <span className={`block ${SUB}`}>{r.idea}</span> : null}
                          {r.carried ? <span className="mt-1 block"><Pill tone="muted" glyph="→">Carried forward</Pill></span> : null}
                        </td>
                        <td className={TD}><span className="block">{r.name}</span>{r.role ? <Pill tone={r.role === 'Founder' ? 'violet' : 'muted'}>{r.role}</Pill> : null}</td>
                        <td className={`${TD} text-[12.5px]`}>{r.origin}</td>
                        <td className={`${TD} text-[12.5px]`}>{r.tto}</td>
                        <td className={`${TD} ${MONO}`}>{r.team}</td>
                        <td className={`${TD} ${MONO}`}>{r.applied}</td>
                        <td className={`${TD} ${MONO} ${r.overdue ? 'font-bold text-amber-800 dark:text-amber-300' : ''}`} data-testid={`lab-app-waited-${r.id}`}>{r.waited ? `${r.overdue ? '● ' : ''}${r.waited}` : '—'}</td>
                        <td className={`${TD} ${MONO}`}>{r.interview || '—'}</td>
                        <td className={TD}><Pill tone={r.status.tone} glyph={r.status.glyph}>{r.status.word}</Pill></td>
                        <td className={TD}><RowMenu row={r} onAction={onAction} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="m-0 flex list-none flex-col gap-2 p-0 lg:hidden" data-testid="lab-app-cards">
                {rows.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline px-3.5 py-3 dark:border-gray-700" data-testid={`lab-app-card-${r.id}`}>
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link to={`/admin/programs/spinout-lab/applications/${encodeURIComponent(r.id)}`} className="text-[13.5px] font-bold text-axal-ink dark:text-gray-100">{r.company}</Link>
                      <Pill tone={r.status.tone} glyph={r.status.glyph}>{r.status.word}</Pill>
                    </span>
                    <span className={SUB}>{[r.name, r.role, r.origin].filter(Boolean).join(' · ')}</span>
                    {r.waited ? <span className={`${MONO} ${r.overdue ? 'text-amber-800 dark:text-amber-300' : 'text-axal-muted dark:text-gray-400'}`}>{`Waiting ${r.waited}`}</span> : null}
                    <span className="flex items-center justify-between gap-2">
                      <label className="flex min-h-[44px] items-center gap-2 text-[12.5px] text-axal-ink dark:text-gray-100">
                        <input type="checkbox" checked={Boolean(picked[r.id])} onChange={() => toggle(r)} data-testid={`lab-app-card-pick-${r.id}`} />Select
                      </label>
                      <RowMenu row={r} onAction={onAction} />
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )
        ) : null}
        {hasRows(read) ? (
          <div className="flex flex-wrap items-center justify-between gap-2" data-testid="lab-app-pager">
            <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid="lab-app-range">{rangeOf(f.page, rows.length, total)}</span>
            {pages > 1 ? (
              <span className="flex gap-2">
                <button type="button" className={actionGhost} disabled={f.page <= 1} onClick={() => page(f.page - 1)} data-testid="lab-app-prev">Previous</button>
                <button type="button" className={actionGhost} disabled={f.page >= pages} onClick={() => page(f.page + 1)} data-testid="lab-app-next">Next</button>
              </span>
            ) : null}
          </div>
        ) : null}
        <p className={`m-0 ${SUB}`}>Waiting counts from the last change. ⋯ holds Approve, Waitlist, Decline, Move to another cohort and Schedule an interview. A row opens the application. Times are ET.</p>
      </section>

      {id ? <Drawer id={id} tick={tick} onClose={() => navigate(APPLICATIONS_PATH)} onAction={onAction} onRetry={reload} now={now} /> : null}
      {dialog ? <ActionDialog key={`${dialog.kind}-${dialog.row?.id || ''}`} dialog={dialog} overview={overview} onClose={() => setDialog(null)} onChanged={onChanged} now={now} /> : null}
    </div>
  );
}
