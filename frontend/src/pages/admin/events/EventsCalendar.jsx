import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Unreadable } from '../../../ui';
import { usePhoneWidth } from '../../../ui/phone/usePhoneWidth';
import { LIST_CLAIM, analyticsJoin, eventHref, readyList, statusWord, whenLine } from './eventsDeskModel';
import {
  CAL_VIEWS, LEGEND, WEEKDAYS, addMonths, blockBox, calendarSearch, calendarState, monthGrid, monthList, overlapText,
  seatsLine, timeText, unplacedLine, weekGrid, addDays,
} from './calendarModel';
import { matchesFilters, readQuery, writeQuery } from './allEventsModel';
import EventFilters, { CONTROL } from './EventFilters';
import { CARD, H2, LINK, SUB, StatusPill } from './parts';

/**
 * D919 (#2702) — the Calendar tab (EV8 month, EV8w week, EV17e list), from R1
 * (every page) with R2's seat counts under Guard G for the chip card.
 *
 * Month runs Monday to Sunday, three chips a day and "+n more", which opens
 * the day. Week is a time grid where overlapping events sit side by side.
 * List is the phone's default. A day with a clash (D915 §2's rule) carries an
 * amber dot and "[n] overlap". A chip opens a small card: title, time, seats,
 * status and "Open event". The address keeps the month, the view and the
 * filters (Status, Visibility, Price; Type, Format and Host wait for parts 1
 * and 3).
 */

const PHONE = '(max-width: 639px)';

const CHIP = {
  plain: 'border border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100',
  review: 'border border-dashed border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200',
  muted: 'border border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
  cancelled: 'border border-axal-hairline bg-white text-axal-muted line-through dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400',
};

const chipText = (e) => `${e.time} ${e.title}${e.word ? ` · ${e.word}` : ''}`;
const OVERLAP = 'inline-flex items-center gap-1 font-mono text-[10.5px] font-bold text-amber-800 dark:text-amber-300';

function Chip({ e, onOpen, block = false, style }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(e)}
      title={chipText(e)}
      style={style}
      className={`${CHIP[e.tone]} ${block ? 'absolute overflow-hidden px-1.5 py-1 text-left' : 'block w-full truncate px-1.5 py-0.5 text-left'} rounded-[6px] text-[10.5px] font-semibold leading-snug`}
      data-testid={`events-cal-chip-${e.id}`}
    >
      {chipText(e)}
    </button>
  );
}

function Overlap({ n, testId }) {
  if (!n) return null;
  return <span className={OVERLAP} data-testid={testId}><span aria-hidden="true">●</span>{overlapText(n)}</span>;
}

function Legend() {
  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-2 p-0" aria-label="Legend" data-testid="events-cal-legend">
      {LEGEND.map((l) => <li key={l.tone}><span className={`${CHIP[l.tone]} inline-block rounded-[6px] px-1.5 py-0.5 text-[10.5px] font-semibold`}>{l.label}</span></li>)}
      <li className={OVERLAP}><span aria-hidden="true">●</span>Overlap</li>
    </ul>
  );
}

function MonthView({ grid, onOpen, onDay }) {
  return (
    <div className="-mx-[18px] overflow-x-auto px-[18px]">
      <div className="grid min-w-[720px] grid-cols-7 border-l border-t border-axal-hairline dark:border-gray-700" role="grid" aria-label={grid.label} data-testid="events-cal-month">
        <div role="row" className="contents">
          {WEEKDAYS.map((d) => <div key={d} role="columnheader" className="border-b border-r border-axal-hairline bg-axal-ground px-2 py-1.5 text-[10.5px] font-bold uppercase tracking-[.06em] text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">{d}</div>)}
        </div>
        {grid.weeks.map((week) => (
          <div role="row" className="contents" key={week[0].key}>
            {week.map((d) => (
              <div
                key={d.key}
                role="gridcell"
                aria-label={d.key}
                className={`flex min-h-[104px] min-w-0 flex-col gap-[3px] border-b border-r border-axal-hairline p-1.5 dark:border-gray-700 ${d.inMonth ? 'bg-white dark:bg-gray-900' : 'bg-axal-ground dark:bg-gray-800'}`}
                data-testid={`events-cal-day-${d.key}`}
              >
                <span className="flex items-center justify-between gap-1">
                  <span className={`font-mono text-[11px] font-bold ${d.today ? 'rounded-full bg-axal-violet px-1.5 text-white dark:bg-violet-500 dark:text-white' : d.inMonth ? 'text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-500'}`}>{d.date}</span>
                  <Overlap n={d.overlap} testId={`events-cal-overlap-${d.key}`} />
                </span>
                {d.chips.map((e) => <Chip key={e.id} e={e} onOpen={onOpen} />)}
                {d.more ? (
                  <button type="button" onClick={() => onDay(d)} className={`self-start text-[11px] font-bold ${LINK}`} data-testid={`events-cal-more-${d.key}`}>{`+${d.more} more`}</button>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const HOUR_PX = 48;

function WeekView({ grid, onOpen }) {
  const height = ((grid.to - grid.from) / 60) * HOUR_PX;
  return (
    <div className="-mx-[18px] overflow-x-auto px-[18px]">
      <p className={`m-0 mb-2 ${SUB}`}>Overlapping events sit side by side.</p>
      <div className="grid min-w-[760px] grid-cols-[48px_repeat(7,minmax(0,1fr))]" data-testid="events-cal-week">
        <div />
        {grid.cols.map((c) => (
          <div key={c.key} className="flex flex-col gap-0.5 border-b border-axal-hairline px-1.5 pb-1.5 dark:border-gray-700">
            <span className={`text-[12px] font-bold ${c.today ? 'text-axal-violet dark:text-violet-300' : 'text-axal-ink dark:text-gray-100'}`}>{c.label}</span>
            <Overlap n={c.overlap} testId={`events-cal-overlap-${c.key}`} />
          </div>
        ))}
        <div className="relative" style={{ height }}>
          {grid.hours.map((m) => (
            <span key={m} className="absolute right-2 -translate-y-1/2 font-mono text-[10.5px] text-axal-muted dark:text-gray-400" style={{ top: `${((m - grid.from) / (grid.to - grid.from)) * 100}%` }}>{timeText(m)}</span>
          ))}
        </div>
        {grid.cols.map((c) => (
          <div key={c.key} className="relative border-l border-axal-hairline dark:border-gray-700" style={{ height }} data-testid={`events-cal-col-${c.key}`}>
            {grid.hours.map((m) => <span key={m} aria-hidden="true" className="absolute inset-x-0 border-t border-axal-hairline dark:border-gray-800" style={{ top: `${((m - grid.from) / (grid.to - grid.from)) * 100}%` }} />)}
            {c.events.map((e) => {
              const b = blockBox(e, grid);
              return <Chip key={e.id} e={e} onOpen={onOpen} block style={{ top: `${b.top}%`, height: `${b.height}%`, left: `calc(${b.left}% + 2px)`, width: `calc(${b.width}% - 4px)` }} />;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ListView({ list }) {
  if (!list.rows.length) return <p className={`m-0 ${SUB}`} data-testid="events-cal-list-none">No events this month.</p>;
  return (
    <ol className="m-0 flex list-none flex-col gap-1 p-0" data-testid="events-cal-list">
      {list.rows.map((r) => (
        <li key={r.id}>
          <Link to={eventHref(r.id)} className="flex min-h-[44px] items-center gap-3 rounded-[10px] border border-axal-hairline px-3 py-2 text-axal-ink hover:border-axal-violet dark:border-gray-700 dark:text-gray-100 dark:hover:border-violet-400" data-testid={`events-cal-row-${r.id}`}>
            <span className="flex w-[42px] shrink-0 flex-col items-center font-mono leading-tight">
              <span className="text-[10px] font-bold text-axal-muted dark:text-gray-400">{r.day.m}</span>
              <span className="text-[17px] font-bold">{r.day.d}</span>
              <span className="text-[10px] font-bold text-axal-muted dark:text-gray-400">{r.day.w}</span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={`text-[13.5px] font-bold leading-snug ${r.tone === 'cancelled' ? 'line-through' : ''}`}>{r.title}</span>
              <span className={`font-mono ${r.clashes ? 'text-[11.5px] font-medium text-amber-800 dark:text-amber-300' : 'text-[11.5px] font-medium text-axal-muted dark:text-gray-400'}`}>{r.line}</span>
            </span>
            <StatusPill status={r.ev.status} />
          </Link>
        </li>
      ))}
    </ol>
  );
}

/** The card a chip opens, or the day "+n more" opens. Focus moves to its heading, and Close (or Escape) returns. */
function Selected({ sel, join, onOpen, onClose }) {
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, [sel]);
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  const close = <button type="button" onClick={onClose} className={`${CONTROL} font-semibold`} data-testid="events-cal-close">Close</button>;
  if (sel.kind === 'day') {
    return (
      <section className={`${CARD} flex flex-col gap-2 px-4 py-3`} aria-labelledby="events-cal-sel" data-testid="events-cal-dayview">
        <div className="flex items-center justify-between gap-2">
          <h3 id="events-cal-sel" ref={heading} tabIndex={-1} className={`${H2} outline-none`}>{`${sel.day.events.length} events on ${sel.day.key}`}</h3>
          {close}
        </div>
        {sel.day.events.map((e) => <Chip key={e.id} e={e} onOpen={onOpen} />)}
      </section>
    );
  }
  const ev = sel.e.ev;
  return (
    <section className={`${CARD} flex flex-col gap-2 px-4 py-3`} aria-labelledby="events-cal-sel" data-testid="events-cal-card">
      <div className="flex items-start justify-between gap-2">
        <h3 id="events-cal-sel" ref={heading} tabIndex={-1} className={`${H2} outline-none`}>{sel.e.title}</h3>
        {close}
      </div>
      <p className={`m-0 font-mono ${SUB}`} data-testid="events-cal-card-when">{whenLine(ev)}</p>
      <p className="m-0 font-mono text-[12.5px] font-semibold text-axal-ink dark:text-gray-100" data-testid="events-cal-card-seats">{seatsLine(ev, join)}</p>
      {sel.e.clashes ? <p className="m-0 text-[12.5px] font-semibold text-amber-800 dark:text-amber-300" data-testid="events-cal-card-clash">{`Overlaps ${sel.e.clashes === 1 ? 'one other event' : `${sel.e.clashes} other events`}.`}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusPill status={ev.status} />
        <Link to={eventHref(ev.id)} className={`${LINK} inline-flex min-h-[44px] items-center`} data-testid="events-cal-card-open">Open event</Link>
      </div>
    </section>
  );
}

export default function EventsCalendar({ reads, now }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const phone = usePhoneWidth(PHONE);
  const [sel, setSel] = useState(null);
  const state = calendarState(loc.search, now, phone);
  const query = readQuery(loc.search);
  const list = readyList(reads.all);
  const join = useMemo(() => analyticsJoin(reads.analytics, list ? list.length : 0), [reads.analytics, list]);
  const shown = useMemo(() => (list || []).filter((ev) => matchesFilters(ev, { ...query, when: null, featured: null }, now)), [list, loc.search, now]);

  const go = (next) => { setSel(null); navigate({ pathname: loc.pathname, search: calendarSearch(loc.search, next) }); };
  const filter = (patch) => { setSel(null); navigate({ pathname: loc.pathname, search: writeQuery(loc.search, patch) }, { replace: true }); };
  const step = (n) => (state.view === 'week' ? go({ monday: addDays(state.monday, 7 * n) }) : go({ month: addMonths(state.month, n) }));
  const today = () => (state.view === 'week' ? go({ monday: calendarState('', now).monday }) : go({ month: state.today.slice(0, 7) }));

  const month = state.view === 'month' && list ? monthGrid(shown, state.month, now) : null;
  const week = state.view === 'week' && list ? weekGrid(shown, state.monday, now) : null;
  const rows = state.view === 'list' && list ? monthList(shown, state.month) : null;
  const title = week ? week.label : (month || rows)?.label || '';
  const unplaced = unplacedLine((month || week || rows)?.unplaced || 0);
  const unit = state.view === 'week' ? 'week' : 'month';

  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-label="Calendar" data-testid="events-calendar">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={H2} data-testid="events-cal-title">{title}</h2>
          <span className="flex gap-1">
            <button type="button" aria-label={`Previous ${unit}`} onClick={() => step(-1)} className={`${CONTROL} w-9 max-sm:w-11`} data-testid="events-cal-prev">‹</button>
            <button type="button" aria-label={`Next ${unit}`} onClick={() => step(1)} className={`${CONTROL} w-9 max-sm:w-11`} data-testid="events-cal-next">›</button>
            <button type="button" onClick={today} className={`${CONTROL} font-semibold`} data-testid="events-cal-today">Today</button>
          </span>
        </div>
        <div className="flex rounded-[8px] border border-axal-hairline p-0.5 dark:border-gray-700" role="group" aria-label="View" data-testid="events-cal-views">
          {CAL_VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              aria-pressed={state.view === v.key}
              onClick={() => go({ view: v.key, ...(v.key === 'week' ? { monday: state.monday } : { month: state.month }) })}
              className={`min-h-[32px] rounded-[6px] px-3 text-[12.5px] font-semibold max-sm:min-h-[44px] ${state.view === v.key ? 'bg-axal-lavender text-axal-violet dark:bg-violet-950/50 dark:text-violet-300' : 'text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
              data-testid={`events-cal-view-${v.key}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <EventFilters query={query} onChange={filter} fields={['status', 'visibility', 'price']} />
      <Legend />

      {reads.all.status === 'loading' ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">Reading…</span> : null}
      {reads.all.status === 'error' ? <Unreadable what="The events list" claim={LIST_CLAIM} onRetry={reads.reload} /> : null}

      {month ? <MonthView grid={month} onOpen={(e) => setSel({ kind: 'event', e })} onDay={(day) => setSel({ kind: 'day', day })} /> : null}
      {week ? <WeekView grid={week} onOpen={(e) => setSel({ kind: 'event', e })} /> : null}
      {rows ? <ListView list={rows} /> : null}
      {unplaced ? <p className={`m-0 ${SUB}`} data-testid="events-cal-unplaced">{unplaced}</p> : null}
      {sel ? <Selected sel={sel} join={join} onOpen={(e) => setSel({ kind: 'event', e })} onClose={() => setSel(null)} /> : null}
      {list && !list.length ? <p className={`m-0 ${SUB}`}>No events yet.</p> : null}
      <span className="sr-only" aria-live="polite">{sel?.kind === 'event' ? `${sel.e.title}, ${statusWord(sel.e.ev.status)}` : ''}</span>
    </section>
  );
}
