import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox } from '../../../ui';
import { articleHref } from '../contentQueueModel';
import { localInputValue, publishAtFromLocal } from '../articlePublishAt';
import {
  WEEKDAYS, addDays, alsoThatDay, chipsByDay, dayLabel, monthGrid, monthTitle, moveProblem, nothingScheduled, nothingShown,
  readRange, readerZone, sameTimeNote, shiftMonth, utcLine, weekDays, weekHours, zoned,
} from './calendarModel';

/**
 * D1296 (#3392) — Content queue › Calendar at `/admin/articles/calendar`:
 * ART7 (month), ART8 (week) and ART13c (nothing scheduled), on D1291's
 * queue read by date range. The rules are `calendarModel.js`.
 *
 * Every scheduled chip has Move…, which opens the schedule dialog: the same
 * D484 call the review panel makes (`POST /admin/articles/:id/schedule`).
 * No drag is needed, and none is built. A published article opens its
 * review; a Publication is read only.
 */

const CARD = 'rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900';
const MUTED = 'text-[12px] leading-snug text-slate-500 dark:text-slate-400';
const BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-violet-700 px-3.5 text-[12.5px] font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[36px]';
const BTN_SEC = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-3.5 text-[12.5px] font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 sm:min-h-[36px]';
const CHIP = {
  sch: 'border border-violet-200 border-l-[3px] border-l-violet-600 bg-violet-50 text-slate-900 dark:border-violet-400/40 dark:border-l-violet-400 dark:bg-violet-950/30 dark:text-slate-100',
  pub: 'border border-slate-300 bg-white text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100',
  pn: 'border border-dashed border-slate-300 bg-transparent text-slate-500 dark:border-slate-600 dark:text-slate-400',
};

const todayKey = (zone, now) => zoned(new Date(now).toISOString(), zone).day;

function useCalendarRead(api, range) {
  const [st, setSt] = useState({ status: 'loading', items: [], publications: null });
  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current;
    setSt((s) => ({ ...s, status: 'loading' }));
    api.queue({ stage: 'calendar', from: range.from, to: range.to, sort: 'goes_out', limit: 100 }).then(
      (r) => { if (n === seq.current) setSt({ status: 'ready', items: Array.isArray(r?.items) ? r.items : [], publications: r?.publications ?? null }); },
      () => { if (n === seq.current) setSt({ status: 'unreadable', items: [], publications: null }); },
    );
  }, [api, range.from, range.to]);
  useEffect(() => { load(); }, [load]);
  return { ...st, reload: load };
}

function useReady(api) {
  const [st, setSt] = useState({ status: 'loading', items: [], total: null });
  const load = useCallback(() => {
    setSt((s) => ({ ...s, status: 'loading' }));
    api.queue({ stage: 'ready', sort: 'waiting', limit: 20 }).then(
      (r) => setSt({ status: 'ready', items: Array.isArray(r?.items) ? r.items : [], total: typeof r?.total === 'number' ? r.total : null }),
      () => setSt({ status: 'unreadable', items: [], total: null }),
    );
  }, [api]);
  useEffect(() => { load(); }, [load]);
  return { ...st, reload: load };
}

/** The schedule dialog (ART6 E): the time in the reader's zone, the same instant in UTC, and what else goes out that day. */
export function ScheduleDialog({ target, zone, byDay, onSchedule, onClose, now = Date.now() }) {
  const [value, setValue] = useState(() => localInputValue(target.at));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const iso = publishAtFromLocal(value);
  const problem = value ? moveProblem(iso, now) : 'Pick a date and a time.';
  const day = iso ? zoned(iso, zone)?.day : null;
  const others = day ? alsoThatDay(byDay, day, target.id) : [];
  const go = async () => {
    setBusy(true); setErr('');
    try { await onSchedule(target.id, iso); onClose(); } catch (e) { setErr(e?.message || 'The time could not be set. Nothing was changed.'); setBusy(false); }
  };
  const verb = target.at ? 'Move' : 'Schedule';
  return (
    <Lightbox label={`${verb} “${target.title}”`} title={`${verb} “${target.title}”`} sub="Pick a time in the future, up to a year ahead. It goes out within a minute of that time." onClose={onClose} width={520} phone="sheet" testId="calendar-schedule"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BTN_SEC} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN} onClick={go} disabled={busy || !!problem} data-testid="calendar-schedule-confirm">{busy ? 'Saving…' : verb}</button>
        </div>
      )}>
      <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-slate-900 dark:text-slate-100">Date and time, in {zone}
        <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} aria-label={`Date and time, in ${zone}`}
          className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-2 text-[13px] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" data-testid="calendar-schedule-input" />
      </label>
      <p className={`${MUTED} mt-2`} data-testid="calendar-schedule-utc">{iso ? utcLine(iso) : 'No time picked yet.'}</p>
      {target.at ? <p className={`${MUTED} mt-1`} data-testid="calendar-schedule-now">Now set for {utcLine(target.at)}. The new time replaces it.</p> : null}
      {others.length ? <p className="mt-2 text-[12.5px] text-slate-700 dark:text-slate-300" data-testid="calendar-schedule-others">Also going out that day: {others.join(' and ')}.</p> : null}
      {problem && value ? <p className="mt-2 text-[12.5px] text-amber-800 dark:text-amber-300" data-testid="calendar-schedule-problem">{problem}</p> : null}
      {err ? <p role="alert" className="mt-2 text-[12.5px] text-red-700 dark:text-red-300">{err}</p> : null}
      <p className={`${MUTED} mt-2`}>Recorded: scheduled by you. The author is told when it goes out.</p>
    </Lightbox>
  );
}

function Chip({ c, onMove }) {
  return (
    <span className={`flex min-w-0 flex-col gap-0.5 rounded-md px-1.5 py-1 text-[11px] leading-snug ${CHIP[c.kind]}`} data-testid={`calendar-chip-${c.id}`}>
      {c.kind === 'pub'
        ? <Link to={articleHref(c.id)} className="truncate hover:underline">✓ {c.time} {c.title}</Link>
        : <span className="truncate">{c.kind === 'sch' ? `${c.time} ` : ''}{c.title}</span>}
      {c.move ? <button type="button" onClick={() => onMove(c)} className="self-start text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300" aria-label={`Move “${c.title}”`} data-testid={`calendar-move-${c.id}`}>Move…</button> : null}
    </span>
  );
}

function Legend() {
  return (
    <p className={`${MUTED} flex flex-wrap gap-3`} data-testid="calendar-legend">
      <span>Scheduled, with its time</span><span>✓ Published</span><span>Publication issued, read only</span>
    </p>
  );
}

export default function ContentCalendar({ api, zone = readerZone(), now = Date.now() }) {
  const today = todayKey(zone, now);
  const [mode, setMode] = useState('month');
  const [cursor, setCursor] = useState({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) });
  const [weekOf, setWeekOf] = useState(today);
  const [showPubs, setShowPubs] = useState(true);
  const [moving, setMoving] = useState(null);
  const grid = useMemo(() => monthGrid(cursor), [cursor]);
  const keys = useMemo(() => (mode === 'month' ? grid.flat().map((d) => d.key) : weekDays(weekOf)), [mode, grid, weekOf]);
  const range = useMemo(() => readRange(keys), [keys]);
  const read = useCalendarRead(api, range);
  const ready = useReady(api);
  const byDay = useMemo(() => chipsByDay(read.items, read.publications, zone, { showPublications: showPubs }), [read.items, read.publications, zone, showPubs]);
  const monthKeys = grid.flat().filter((d) => d.inMonth).map((d) => d.key);
  const shownKeys = mode === 'month' ? monthKeys : keys;
  const title = mode === 'month' ? monthTitle(cursor) : `${dayLabel(keys[0])} – ${dayLabel(keys[6], { year: true })}`;
  const schedule = (id, iso) => api.schedule(id, iso).then(() => { read.reload(); ready.reload(); });
  const step = (by) => (mode === 'month' ? setCursor((c) => shiftMonth(c, by)) : setWeekOf((k) => addDays(k, by * 7)));
  const goToday = () => { setCursor({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) }); setWeekOf(today); };

  return (
    <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_300px]" data-testid="content-calendar">
      <div className={`${CARD} flex min-w-0 flex-col gap-3 p-4`}>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN_SEC} aria-label={mode === 'month' ? 'Previous month' : 'Previous week'} onClick={() => step(-1)} data-testid="calendar-prev">‹</button>
          <h2 className="m-0 text-[15px] font-extrabold text-slate-900 dark:text-slate-100" data-testid="calendar-title">{title}</h2>
          <button type="button" className={BTN_SEC} aria-label={mode === 'month' ? 'Next month' : 'Next week'} onClick={() => step(1)} data-testid="calendar-next">›</button>
          <button type="button" className={BTN_SEC} onClick={goToday}>Today</button>
          <div role="group" aria-label="Calendar view" className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
            {['month', 'week'].map((k) => (
              <button key={k} type="button" aria-pressed={mode === k ? 'true' : 'false'} onClick={() => setMode(k)} data-testid={`calendar-mode-${k}`}
                className={`min-h-[44px] rounded-md px-3 text-[12px] font-semibold sm:min-h-[30px] ${mode === k ? 'bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200' : 'text-slate-700 dark:text-slate-300'}`}>{k === 'month' ? 'Month' : 'Week'}</button>
            ))}
          </div>
          <span className={MUTED} data-testid="calendar-zone">Times in {zone}</span>
          <button type="button" role="switch" aria-checked={showPubs ? 'true' : 'false'} onClick={() => setShowPubs((v) => !v)} className={`${MUTED} min-h-[44px] underline sm:min-h-0`} data-testid="calendar-publications">Show Publications issued: {showPubs ? 'on' : 'off'}</button>
        </div>
        {read.status === 'loading' ? <p aria-busy="true" className={MUTED} data-testid="calendar-loading">Reading…</p> : null}
        {read.status === 'unreadable' ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-800 dark:border-red-500/40 dark:bg-red-950/30 dark:text-red-300" data-testid="calendar-error">
            The calendar could not be read. That is not the same as nothing scheduled.
            <button type="button" className={BTN_SEC} onClick={read.reload}>Try again</button>
          </div>
        ) : null}
        {read.status === 'ready' && read.publications?.available === false && showPubs ? <p className={MUTED} data-testid="calendar-publications-unread">Publications could not be read, so none is shown. The articles are.</p> : null}
        {read.status === 'ready' && nothingShown(byDay, shownKeys) ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-6 dark:border-slate-600" data-testid="calendar-empty">
            <h3 className="m-0 text-[15px] font-extrabold text-slate-900 dark:text-slate-100">Nothing scheduled in {mode === 'month' ? monthTitle(cursor) : 'this week'}.</h3>
            <p className={`${MUTED} mt-1`}>Approved articles wait on the right until you give them a time.</p>
          </div>
        ) : read.status === 'ready' && mode === 'month' ? (
          <>
            {nothingScheduled(byDay, monthKeys) ? <p className={MUTED} data-testid="calendar-none-scheduled">Nothing is scheduled in {monthTitle(cursor)} yet. What went out is shown.</p> : null}
            <div role="grid" aria-label={monthTitle(cursor)} className="hidden sm:block" data-testid="calendar-month">
              <div role="row" className="grid grid-cols-7">{WEEKDAYS.map((d) => <span key={d} role="columnheader" className={`${MUTED} px-1.5 py-1`}>{d}</span>)}</div>
              {grid.map((w, wi) => (
                <div role="row" key={wi} className="grid grid-cols-7">
                  {w.map((d) => {
                    const chips = byDay.get(d.key) || [];
                    const note = sameTimeNote(chips);
                    return (
                      <div key={d.key} role="gridcell" aria-label={`${dayLabel(d.key, { year: true })}${d.key === today ? ', today' : ''}, ${chips.length ? `${chips.length} ${chips.length > 1 ? 'items' : 'item'}` : 'nothing'}`}
                        className={`flex min-h-[104px] min-w-0 flex-col gap-1 border-t border-slate-100 p-1.5 dark:border-slate-800 ${d.inMonth ? '' : 'bg-slate-50 dark:bg-slate-950/40'}`} data-testid={`calendar-day-${d.key}`}>
                        <span className={`font-mono text-[11.5px] ${d.key === today ? 'font-bold text-violet-700 dark:text-violet-300' : d.inMonth ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}`}>{d.n}</span>
                        {chips.map((c) => <Chip key={c.id} c={c} onMove={setMoving} />)}
                        {note ? <span className="text-[10.5px] font-semibold text-amber-800 dark:text-amber-300" data-testid={`calendar-note-${d.key}`}>{note}</span> : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <ol className="m-0 flex list-none flex-col gap-2 p-0 sm:hidden" data-testid="calendar-agenda">
              {monthKeys.filter((k) => (byDay.get(k) || []).length).map((k) => (
                <li key={k} className="flex flex-col gap-1">
                  <span className="text-[12px] font-bold text-slate-900 dark:text-slate-100">{dayLabel(k)}{k === today ? ' · Today' : ''}</span>
                  {(byDay.get(k) || []).map((c) => <Chip key={c.id} c={c} onMove={setMoving} />)}
                </li>
              ))}
            </ol>
          </>
        ) : read.status === 'ready' ? (
          <div role="grid" aria-label={`Week of ${dayLabel(keys[0], { year: true })}`} className="overflow-x-auto" data-testid="calendar-week">
            <div role="row" className="grid min-w-[640px] grid-cols-[56px_repeat(7,1fr)]">
              <span />
              {keys.map((k) => <span key={k} role="columnheader" className={`px-2 py-1 text-[12px] font-bold ${k === today ? 'text-violet-700 dark:text-violet-300' : 'text-slate-900 dark:text-slate-100'}`}>{dayLabel(k)}</span>)}
            </div>
            {weekHours(byDay, keys).map((h) => (
              <div role="row" key={h} className="grid min-w-[640px] grid-cols-[56px_repeat(7,1fr)] border-t border-slate-100 dark:border-slate-800">
                <span role="rowheader" className={`${MUTED} px-1 py-1 font-mono`}>{String(h).padStart(2, '0')}:00</span>
                {keys.map((k) => (
                  <div key={k} role="gridcell" className={`flex min-w-0 flex-col gap-1 border-l border-slate-100 p-1 dark:border-slate-800 ${k === today ? 'bg-slate-50 dark:bg-slate-950/40' : ''}`} data-testid={`calendar-slot-${k}-${h}`}>
                    {(byDay.get(k) || []).filter((c) => c.hour === h).map((c) => <Chip key={c.id} c={c} onMove={setMoving} />)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : null}
        <Legend />
      </div>
      <aside aria-label="Ready to publish" className={`${CARD} flex flex-col gap-2 p-4`} data-testid="calendar-ready">
        <h3 className="m-0 text-[14px] font-extrabold text-slate-900 dark:text-slate-100">Ready to publish {typeof ready.total === 'number' ? <span className="font-mono text-[12px] text-slate-500">{ready.total}</span> : null}</h3>
        {ready.status === 'loading' ? <p className={MUTED}>Reading…</p> : null}
        {ready.status === 'unreadable' ? <p role="alert" className="text-[12.5px] text-red-700 dark:text-red-300" data-testid="calendar-ready-error">Ready to publish could not be read. <button type="button" className="underline" onClick={ready.reload}>Try again</button></p> : null}
        {ready.status === 'ready' && !ready.items.length ? <p className={MUTED} data-testid="calendar-ready-none">No approved article is waiting for a time.</p> : null}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {ready.items.map((a) => (
            <li key={a.id} className="flex flex-col gap-1 rounded-lg border border-slate-200 p-2 dark:border-slate-700" data-testid={`calendar-ready-${a.id}`}>
              <Link to={articleHref(a.id)} className="text-[13px] font-semibold text-slate-900 hover:underline dark:text-slate-100">{String(a.title || '').trim() || 'Untitled'}</Link>
              <span className={MUTED}>{String(a.author_name || '').trim() || 'Author not recorded'}</span>
              <button type="button" className={`${BTN_SEC} self-start`} onClick={() => setMoving({ id: a.id, title: String(a.title || '').trim() || 'Untitled', at: null })} data-testid={`calendar-schedule-${a.id}`}>Schedule…</button>
            </li>
          ))}
        </ul>
        <p className={MUTED}>Only approved articles can be scheduled. A time can be moved until it goes out. Move… on each chip changes it; no dragging is needed.</p>
      </aside>
      {moving ? <ScheduleDialog target={moving} zone={zone} byDay={byDay} onSchedule={schedule} onClose={() => setMoving(null)} now={now} /> : null}
    </section>
  );
}
