// D1614 W8 (#3994, frontend half) — "My tasks": every task given to the reader,
// across the projects whose Team they are on, then the companies' compliance
// tasks given to them (GET /api/teams/me/tasks, #4286). Built from the house
// shell (the owner, 2026-11-04: no WK13 board). It reads only; a task opens in
// its own page. A task the reader can no longer read is never in the reply.
//
// Placed in each licence's workspace: the founder's Studio and Work (filtered to
// the project there), the investor's Deals, the advisor's Practice › Engagements,
// the operating partner's Delivery › Board, and HQ.
//
// D8727 (#8727): a page may pass `offReason`, its own sentence for an engine
// that is off (HQ's names no issue), and `hideControlsWhenOff`, which draws
// Show and Due only once a read has answered: while Work is off they cannot
// change the result, so they are not drawn at all.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BTN_SECONDARY, MUTED, HonestBlock } from '../team/teamUi.jsx';
import { workAdapter } from './workAdapter.js';
import { MY_TASK_DUES, MY_TASK_STATES, licenceBadge, myTaskSections, refusalWords } from './workModel.js';

export const MY_TASKS_EMPTY = 'Nothing is given to you here. A task assigned to you on a Team you belong to appears here.';
export const MY_TASKS_LICENCE = Object.freeze({ founder: 'Founder', investor: 'Investor', advisor: 'Advisor', partner: 'Operating partner', admin: 'HQ' });

export default function MyTasks({ licence = 'founder', project = null, title = 'My tasks', testId = 'my-tasks', offReason = null, hideControlsWhenOff = false }) {
  const [state, setState] = useState('open');
  const [due, setDue] = useState('');
  const [read, setRead] = useState({ status: 'loading' });
  const [engineOn, setEngineOn] = useState(false);
  const load = useCallback(async () => {
    setRead({ status: 'loading' });
    try {
      const r = await workAdapter.myTasks({ state, due: due || undefined, project: project ?? undefined });
      setRead(r.available ? { status: 'ready', data: r.data } : { status: 'off', reason: offReason || r.reason });
      setEngineOn(Boolean(r.available));
    } catch (e) {
      setRead({ status: 'error', message: refusalWords(e, 'Your tasks could not be read. That is not the same as having none.') });
    }
  }, [state, due, project, offReason]);
  useEffect(() => { load(); }, [load]);

  const view = read.status === 'ready' ? myTaskSections(read.data) : null;
  const controls = !hideControlsWhenOff || engineOn;
  return (
    <section className="flex flex-col gap-3 rounded-[12px] border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900" aria-label={title} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h2 className="flex items-center gap-2 text-[14px] font-bold text-axal-ink dark:text-gray-100">
          {title}
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${licenceBadge(licence)}`} data-testid={`${testId}-licence`}>{MY_TASKS_LICENCE[licence] || MY_TASKS_LICENCE.admin}</span>
          {view ? <span className={MUTED} data-testid={`${testId}-count`}>{view.count}</span> : null}
        </h2>
        {controls ? <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-1 text-[12.5px] text-axal-muted dark:text-gray-400">
            <span className="sr-only">Show</span>
            <select value={state} onChange={(e) => setState(e.target.value)} className="rounded-md border border-axal-hairline bg-white px-2 py-1 text-[12.5px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid={`${testId}-state`}>
              {MY_TASK_STATES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 text-[12.5px] text-axal-muted dark:text-gray-400">
            <span className="sr-only">Due</span>
            <select value={due} onChange={(e) => setDue(e.target.value)} className="rounded-md border border-axal-hairline bg-white px-2 py-1 text-[12.5px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid={`${testId}-due`}>
              {MY_TASK_DUES.map((d) => <option key={d.key || 'any'} value={d.key}>{d.label}</option>)}
            </select>
          </label>
        </div> : null}
      </div>
      {read.status === 'loading' ? <p className={MUTED} data-testid={`${testId}-loading`}>Reading…</p> : null}
      {read.status === 'off' && !offReason ? <HonestBlock testId={`${testId}-off`}>{read.reason}</HonestBlock> : null}
      {read.status === 'off' && offReason ? (
        // A page's own sentence is a fact about the page, not news: no live region, and the state in a word and a glyph.
        <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-axal-hairline px-4 py-3 dark:border-gray-700" data-testid={`${testId}-off`}>
          <span className="inline-flex items-center gap-[5px] whitespace-nowrap rounded-full border border-axal-hairline py-px pl-1.5 pr-2 text-[11.5px] font-bold leading-[1.6] text-axal-muted dark:border-gray-600 dark:text-gray-400">
            <span aria-hidden="true" className="inline-block h-[9px] w-[9px] rounded-full border-[1.5px] border-dashed border-current" />Not switched on
          </span>
          <span className="text-[13px] leading-normal text-axal-ink dark:text-gray-200">{read.reason}</span>
        </div>
      ) : null}
      {read.status === 'error' ? (
        <HonestBlock role="alert" testId={`${testId}-error`} action={<button type="button" className={BTN_SECONDARY} onClick={load}>Try again</button>}>{read.message}</HonestBlock>
      ) : null}
      {view && !view.sections.length ? <p className={MUTED} data-testid={`${testId}-empty`}>{MY_TASKS_EMPTY}</p> : null}
      {view?.sections.map((s) => (
        <div key={s.key} data-testid={`${testId}-section`}>
          <h3 className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">{s.title}</h3>
          <ul className="mt-1 divide-y divide-axal-hairline dark:divide-gray-800">
            {s.rows.map((r) => (
              <li key={r.uid} className="flex flex-wrap items-center justify-between gap-2 py-1.5" data-testid={`${testId}-row`}>
                {r.link ? <Link to={r.link} className="text-[13px] font-medium text-axal-ink hover:underline dark:text-gray-100">{r.title}</Link> : <span className="text-[13px] font-medium">{r.title}</span>}
                <span className="flex flex-wrap items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400">
                  <span>{r.where}</span>
                  <span data-overdue={r.overdue ? 'true' : undefined} className={r.overdue ? 'font-semibold text-axal-destructive dark:text-red-300' : undefined}>{r.due}</span>
                  {r.chips.map((c) => <span key={c} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">{c}</span>)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {view?.more ? <p className={MUTED} data-testid={`${testId}-more`}>More tasks are given to you than this list shows; narrow it by date.</p> : null}
    </section>
  );
}
