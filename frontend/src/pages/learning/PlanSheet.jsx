// D3959 (#3959) — the "Add to my plan" sheet, and the button that opens it on
// a course, lesson, video, webinar, exercise or exam page. Composed from the
// Calendar's create dialog (CAL7, `design/incoming/Calendar Page.dc.html`):
// one 520 Lightbox, the fields in order, the primary action last.
//
// The subject is fixed when it opens from a Learning page. From the
// Calendar's New › Plan learning it opens with `picker`, and the member first
// chooses what to plan (`PlanPicker`). Every write is `learningPlanApi.create`;
// the Worker checks the same rules again (`routes/learning_plan.ts`).
import React, { useEffect, useState } from 'react';
import { Lightbox, actionGhost, actionPrimary } from '../../ui';
import { createPlan, planChoices } from './planReads';
import { reportError } from '../../lib/log';
import {
  ADD_LABEL, DURATIONS, KIND_NOTES, KIND_WORDS, PICKER_KINDS, REMINDERS, REPEAT_WORDS,
  defaultStart, planBody, refusalOf,
} from './learningPlanModel';

const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const LABEL = 'flex flex-col gap-1 text-[13px] font-semibold text-axal-ink dark:text-gray-200';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] font-normal text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const ALERT = 'm-0 text-[12.5px] font-semibold text-red-700 dark:text-red-400';
const OPTION = 'flex w-full items-center justify-between gap-2 rounded-[9px] border border-axal-hairline px-3 py-2 text-left text-[13px] text-axal-ink hover:bg-axal-lavender dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';

/** New › Plan learning: choose a kind, then an item (or name a study block). */
export function PlanPicker({ onPick }) {
  const [kind, setKind] = useState('course');
  const [state, setState] = useState({ status: 'loading', rows: [] });
  const [picking, setPicking] = useState('');
  useEffect(() => {
    if (kind === 'study_block') { setState({ status: 'ready', rows: [] }); return undefined; }
    let live = true;
    setState({ status: 'loading', rows: [] });
    planChoices(kind).then((rows) => { if (live) setState({ status: 'ready', rows }); }, (e) => {
      reportError('Learning:plan-picker', e);
      if (live) setState({ status: 'error', rows: [] });
    });
    return () => { live = false; };
  }, [kind]);
  const pick = async (row) => {
    setPicking(row.key);
    try {
      const uid = row.uid || (row.resolve ? await row.resolve() : null);
      if (uid) onPick({ kind, uid, title: row.title });
      else setState((s) => ({ ...s, status: 'error' }));
    } catch (e) { reportError('Learning:plan-picker', e); setState((s) => ({ ...s, status: 'error' })); } finally { setPicking(''); }
  };
  return (
    <div className="flex flex-col gap-3" data-testid="plan-picker">
      <label className={LABEL}>What to plan
        <select className={FIELD} value={kind} onChange={(e) => setKind(e.target.value)} data-testid="plan-picker-kind">
          {PICKER_KINDS.map((k) => <option key={k} value={k}>{KIND_WORDS[k]}</option>)}
        </select>
      </label>
      {kind === 'study_block' ? (
        <button type="button" className={actionPrimary} onClick={() => onPick({ kind: 'study_block' })} data-testid="plan-picker-study">Plan a study block</button>
      ) : state.status === 'loading' ? <p className={MUTED} role="status">Reading…</p>
        : state.status === 'error' ? <p className={ALERT} role="alert" data-testid="plan-picker-error">The list could not be read. That is not the same as there being nothing to plan.</p>
          : !state.rows.length ? <p className={MUTED} data-testid="plan-picker-empty">Nothing of this kind is open to you yet.</p>
            : (
              <div className="flex max-h-[18rem] flex-col gap-1.5 overflow-auto">
                {state.rows.map((r) => (
                  <button key={r.key} type="button" className={OPTION} disabled={!!picking} onClick={() => pick(r)} data-testid={`plan-picker-${r.key}`}>
                    <span>{r.title}</span><span className={MUTED}>{picking === r.key ? 'Opening…' : 'Choose'}</span>
                  </button>
                ))}
              </div>
            )}
    </div>
  );
}

/**
 * The sheet. `subject` is `{ kind, uid, title, startsAt? }` (a webinar's own
 * time is shown, not asked). With `picker` and no subject it shows the picker
 * first. `onDone(item)` gets the saved plan item.
 */
export function PlanSheet({ subject: given = null, picker = false, onDone, onClose, now = new Date() }) {
  const [subject, setSubject] = useState(given);
  const start = defaultStart(now);
  const [form, setForm] = useState({ date: start.date, time: start.time, duration: 30, repeat: 'none', until: '', remind: 30, title: '', goal: '', goalDate: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: k === 'duration' ? Number(e.target.value) : k === 'remind' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value }));
  const choosing = picker && !subject;
  const webinar = subject?.kind === 'webinar';
  const save = async () => {
    const out = planBody(subject, form);
    if (out.error) { setError(out.error); return; }
    setBusy(true); setError('');
    try { const r = await createPlan(out.body); onDone?.(r?.item || null); }
    catch (e) { setError(refusalOf(e)); }
    finally { setBusy(false); }
  };
  const title = choosing ? 'Plan learning' : subject?.kind === 'study_block' ? 'Plan a study block' : ADD_LABEL;
  return (
    <Lightbox label={title} title={title} width={520} onClose={() => !busy && onClose?.()} testId="plan-sheet"
      footer={choosing ? (
        <div className="flex justify-end"><button type="button" className={actionGhost} onClick={onClose}>Cancel</button></div>
      ) : (
        <div className="flex justify-end gap-2">
          <button type="button" className={actionGhost} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={actionPrimary} onClick={save} disabled={busy} data-testid="plan-sheet-save">{busy ? 'Saving…' : webinar ? 'Add and register' : ADD_LABEL}</button>
        </div>
      )}>
      {choosing ? <PlanPicker onPick={setSubject} /> : (
        <div className="flex flex-col gap-3" data-testid="plan-sheet-form" data-kind={subject?.kind}>
          {subject?.kind !== 'study_block' && (
            <p className={`m-0 text-[14px] font-semibold ${INK}`} data-testid="plan-sheet-subject">{KIND_WORDS[subject?.kind]} · {subject?.title || 'Untitled'}</p>
          )}
          <p className={MUTED} data-testid="plan-sheet-note">{KIND_NOTES[subject?.kind]}</p>
          {subject?.kind === 'study_block' && (
            <label className={LABEL}>Name
              <input className={FIELD} value={form.title} maxLength={200} onChange={set('title')} placeholder="e.g. Read the term sheet guide" data-testid="plan-sheet-title" />
            </label>
          )}
          {webinar ? (
            <p className={`m-0 text-[13px] ${INK}`} data-testid="plan-sheet-webinar-time">
              {subject.startsAt ? new Date(subject.startsAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'At the webinar’s own time'}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className={LABEL}>Date<input type="date" className={FIELD} value={form.date} onChange={set('date')} data-testid="plan-sheet-date" /></label>
                <label className={LABEL}>Time<input type="time" className={FIELD} value={form.time} onChange={set('time')} data-testid="plan-sheet-time" /></label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className={LABEL}>Duration
                  <select className={FIELD} value={form.duration} onChange={set('duration')} data-testid="plan-sheet-duration">
                    {DURATIONS.map((d) => <option key={d} value={d}>{d < 60 ? `${d} minutes` : `${d / 60} hour${d === 60 ? '' : 's'}`}</option>)}
                  </select>
                </label>
                <label className={LABEL}>Repeat
                  <select className={FIELD} value={form.repeat} onChange={set('repeat')} data-testid="plan-sheet-repeat">
                    {Object.entries(REPEAT_WORDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </label>
              </div>
              {form.repeat !== 'none' && (
                <label className={LABEL}>Until <span className={MUTED}>(optional)</span>
                  <input type="date" className={FIELD} value={form.until} onChange={set('until')} data-testid="plan-sheet-until" />
                </label>
              )}
            </>
          )}
          <label className={LABEL}>Reminder
            <select className={FIELD} value={form.remind ?? ''} onChange={set('remind')} data-testid="plan-sheet-remind">
              {REMINDERS.map((r) => <option key={String(r.value)} value={r.value ?? ''}>{r.label}</option>)}
            </select>
          </label>
          <label className={LABEL}>Goal <span className={MUTED}>(optional, e.g. Finish by 15 December)</span>
            <input className={FIELD} value={form.goal} maxLength={200} onChange={set('goal')} data-testid="plan-sheet-goal" />
          </label>
          {form.goal.trim() && (
            <label className={LABEL}>Target date
              <input type="date" className={FIELD} value={form.goalDate} onChange={set('goalDate')} data-testid="plan-sheet-goal-date" />
            </label>
          )}
          {error ? <p className={ALERT} role="alert" data-testid="plan-sheet-error">{error}</p> : null}
        </div>
      )}
    </Lightbox>
  );
}

/** The page action: "Add to my plan", then "In your plan" once saved. Nothing to plan, no button. */
export function AddToPlan({ subject }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  if (!subject?.uid || !KIND_WORDS[subject.kind]) return null;
  return (
    <>
      <button type="button" className={actionGhost} onClick={() => setOpen(true)} data-testid="plan-add">
        {saved ? 'In your plan ✓' : ADD_LABEL}
      </button>
      {open ? <PlanSheet subject={subject} onClose={() => setOpen(false)} onDone={() => { setSaved(true); setOpen(false); }} /> : null}
    </>
  );
}

export default PlanSheet;
