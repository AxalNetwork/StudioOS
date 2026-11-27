// D3959 (#3959) — a plan item's actions, on /learning/plan and on a Learning
// entry in the Calendar: Mark done, Reschedule, Open in Learning, Remove.
// Reschedule and Remove are dialogs that say what they do first, as the
// Calendar's Reschedule and Cancel are (CAL19, `design/incoming/Calendar
// Page.dc.html`). Every write is `learningPlanApi`'s.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, actionDanger, actionGhost, actionPrimary } from '../../ui';
import { markPlanDone, removePlan, updatePlan } from './planReads';
import { calendarActions, defaultStart, refusalOf, rescheduleBody } from './learningPlanModel';

const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const ALERT = 'm-0 text-[12.5px] font-semibold text-red-700 dark:text-red-400';
const LINK = 'inline-flex items-center rounded-[9px] border border-axal-hairline px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-200';

/** The calendar event shape the actions read, from a plan item. */
export const eventOfItem = (item) => ({
  kind: 'learning', source_uid: item.uid, status: item.status, url: item.href || '/learning/plan',
  learning: { item_kind: item.item_kind, plan: true },
});

/**
 * `ev` is a Calendar event (kind `learning`) or, on the plan page, `item`
 * turned into one. `onChanged` reloads whoever drew the row.
 */
export function PlanRowActions({ item = null, ev = null, onChanged }) {
  const event = ev || (item ? eventOfItem(item) : null);
  const actions = calendarActions(event);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState('');
  const [said, setSaid] = useState('');
  const start = defaultStart();
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  if (!actions.length) return null;
  const uid = event.source_uid;
  const run = async (what, fn) => {
    setBusy(what); setSaid('');
    try { await fn(); setDialog(null); onChanged?.(); } catch (e) { setSaid(refusalOf(e)); } finally { setBusy(''); }
  };
  const reschedule = () => {
    const out = rescheduleBody({ item_kind: event.learning?.item_kind }, date, time);
    if (out.error) { setSaid(out.error); return; }
    run('reschedule', () => updatePlan(uid, out.body));
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid={`plan-actions-${uid || 'webinar'}`}>
      {actions.map((a) => (a.to ? (
        <Link key={a.key} to={a.to} className={LINK} data-testid={`plan-action-${a.key}`}>{a.label}</Link>
      ) : (
        <button key={a.key} type="button" className={a.key === 'done' ? actionPrimary : actionGhost} disabled={!!busy}
          onClick={() => (a.key === 'done' ? run('done', () => markPlanDone(uid)) : setDialog(a.key))} data-testid={`plan-action-${a.key}`}>
          {busy === a.key ? 'Saving…' : a.label}
        </button>
      )))}
      {said && !dialog ? <p className={ALERT} role="alert" data-testid="plan-action-error">{said}</p> : null}
      {dialog === 'reschedule' ? (
        <Lightbox label="Reschedule" title="Reschedule" width={520} onClose={() => !busy && setDialog(null)} testId="plan-reschedule"
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={actionGhost} onClick={() => setDialog(null)} disabled={!!busy}>Cancel</button>
              <button type="button" className={actionPrimary} onClick={reschedule} disabled={!!busy} data-testid="plan-reschedule-save">{busy ? 'Saving…' : 'Move it'}</button>
            </div>
          )}>
          <div className="flex flex-col gap-3">
            <p className={MUTED}>A repeating item moves from its first time; every later one keeps the same rhythm.</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[13px] font-semibold">Date<input type="date" className={FIELD} value={date} onChange={(e) => setDate(e.target.value)} data-testid="plan-reschedule-date" /></label>
              <label className="flex flex-col gap-1 text-[13px] font-semibold">Time<input type="time" className={FIELD} value={time} onChange={(e) => setTime(e.target.value)} data-testid="plan-reschedule-time" /></label>
            </div>
            {said ? <p className={ALERT} role="alert" data-testid="plan-reschedule-error">{said}</p> : null}
          </div>
        </Lightbox>
      ) : null}
      {dialog === 'remove' ? (
        <Lightbox label="Remove from your plan" title="Remove from your plan" width={520} onClose={() => !busy && setDialog(null)} testId="plan-remove"
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={actionGhost} onClick={() => setDialog(null)} disabled={!!busy}>Keep it</button>
              <button type="button" className={actionDanger} onClick={() => run('remove', () => removePlan(uid))} disabled={!!busy} data-testid="plan-remove-confirm">{busy ? 'Removing…' : 'Remove'}</button>
            </div>
          )}>
          <p className={MUTED}>It leaves your plan and your calendar, with every repeat. Your progress in Learning stays, and a webinar registration stays until you cancel it on the webinar’s page.</p>
          {said ? <p className={ALERT} role="alert">{said}</p> : null}
        </Lightbox>
      ) : null}
    </div>
  );
}

export default PlanRowActions;
