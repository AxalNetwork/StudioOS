import React, { useRef, useState } from 'react';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import { buildIcs, downloadIcs } from '../../../lib/ics';
import { NothingYet, ZoneBody, ZoneHeading } from '../expertise/kit';
import { FromTheLab, NoBatch, StatedLimit, cohortLabel } from './kit';
import { CohortLoading, useCohortRead, useCohortWorkspace } from './CohortWorkspace';
import {
  EVENT_TYPES, LAB_TZ, TYPE_ORDER, WEEKDAYS, addDays, agendaDays, calendarEvents, clockTime, conflictText,
  conflictsByRef, dayKey, dayTitle, eventDetail, eventType, exportUid, filterByTypes, missingSources, monthGrid,
  monthTitle, shiftAnchor, startOfMonth, startOfWeek, weekColumns, weekTitle,
} from './calendarModel';

/**
 * Cohorts · Calendar — boards C8 (Week), C9 (Agenda, and the partial state)
 * and C15 (phone): the Lab's dates and your own sessions, on one page.
 *
 * THE JOIN LIVES IN THE WORKER (`/me/cohort/:id/calendar`): `week_windows`
 * gives the Lab's unlock/deadline pairs, slots and bookings give the sessions.
 * Since D4813 package 3 the Worker sends a group session ONCE with its
 * participants, keeps a session that is already under way (so its conflicts
 * are still found), names the zone, and reads each half on its own.
 *
 * ONLY BOOKED SESSIONS APPEAR. An unbooked slot is availability, not an
 * obligation; putting a free afternoon on the same list as a deadline would
 * make it look like a commitment.
 *
 * PARTIAL IS NOT FAILED. When the Lab's dates or your sessions could not be
 * read (or the cycle has no week windows recorded), the half that loaded is
 * drawn and a line says what is missing. Rendering nothing would hide the half
 * that is true; rendering the half as the whole would say the cohort has no
 * deadlines, the one thing this page must never claim.
 *
 * ON A PHONE AGENDA COMES FIRST and the month grid is not squeezed onto 390px:
 * Month there is the month's days as a list.
 */

/**
 * The canvas's original kind groups (D393), kept for the export and older
 * readers. The page's own filter is by event type (`EVENT_TYPES`).
 */
export const CAL_VIEWS = {
  all: () => true,
  cohort: (it) => it.kind === 'cohort',
  client: (it) => it.kind === 'client',
  demo_day: (it) => it.kind === 'demo_day',
};

/**
 * `Export to calendar`, built in the browser from the rows on screen (the
 * shared builder in lib/ics.js). A Lab date has no end — a week opens, a
 * deadline falls — so it is written as a point in time, not a meeting.
 *
 * THE UID IS COHORT-SCOPED (D4813 package 3). It used to be the ref, and
 * `week:2:unlock` is the same string in every cohort — so importing March's
 * export and then April's overwrote March's week 2 with April's. Lab dates now
 * carry the cycle id; a session carries its slot, so the same session from two
 * cohorts' exports is one entry.
 */
export function calendarIcs(items, cycleId) {
  return buildIcs({
    prodId: '-//Axal//Cohort Calendar//EN',
    events: (items || []).map((it) => ({
      uid: exportUid(it, cycleId), start: it.starts_at, end: it.ends_at || null,
      summary: it.title, description: EVENT_TYPES[eventType(it)]?.label || it.kind,
    })),
  });
}

export const CAL_MODES = [['month', 'Month'], ['week', 'Week'], ['agenda', 'Agenda']];

function phoneFirst() {
  try { return typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches; } catch { return false; }
}

/** Month · Week · Agenda, a radio group: arrow keys move, Tab leaves. */
export function ViewSwitch({ view, onChange }) {
  const refs = useRef([]);
  const onKey = (e, i) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? CAL_MODES.length - 1 : (i + step + CAL_MODES.length) % CAL_MODES.length;
    onChange(CAL_MODES[n][0]);
    refs.current[n]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Calendar view" className="inline-flex rounded-lg border border-axal-hairline p-0.5 dark:border-gray-700" data-testid="calendar-views">
      {CAL_MODES.map(([key, label], i) => (
        <button
          key={key}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={view === key}
          tabIndex={view === key ? 0 : -1}
          onKeyDown={(e) => onKey(e, i)}
          onClick={() => onChange(key)}
          className={`min-h-[44px] rounded-md px-3 text-[12px] font-semibold lg:min-h-[32px] ${view === key
            ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
            : 'text-axal-muted hover:bg-axal-ground dark:hover:bg-gray-800'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** One event as a button: type in words and a shape, conflict marked ▲ in words. */
function EventChip({ ev, conflicts, onOpen, compact = false }) {
  const t = EVENT_TYPES[ev.etype] || EVENT_TYPES.week_opens;
  const n = (ev.participants || []).length;
  return (
    <button
      type="button"
      onClick={() => onOpen(ev)}
      data-ref={ev.ref}
      className={`block w-full min-h-[44px] rounded-md border px-2 py-1 text-left text-[11.5px] lg:min-h-0 ${conflicts
        ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40'
        : 'border-axal-hairline bg-white hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800'}`}
    >
      <span className="flex items-center gap-1 font-semibold">
        <span aria-hidden="true">{t.glyph}</span>
        <span className="truncate">{ev.title}</span>
      </span>
      {!compact && (
        <span className="block text-[10.5px] text-axal-muted">
          {`${clockTime(ev.starts_at)}${ev.ends_at ? `–${clockTime(ev.ends_at)}` : ''} · ${t.label}${ev.etype === 'group_session' ? ` · ${n} founder${n === 1 ? '' : 's'}` : ''}`}
          {ev.ongoing ? ' · in progress' : ''}
        </span>
      )}
      {conflicts && <span className="block text-[10.5px] font-bold text-red-800 dark:text-red-300">▲ Conflict</span>}
    </button>
  );
}

/** The agenda (C9 A, and C15 on a phone): day headings and a list per day. */
export function AgendaList({ days, clash, onOpen, cohortName }) {
  if (!days.length) return <p className="py-3 text-[12px] text-axal-muted">Nothing in these fourteen days for the types shown.</p>;
  return (
    <ol className="space-y-3" data-testid="calendar-agenda">
      {days.map((d) => (
        <li key={d.key}>
          <h4 className="mb-1 text-[11px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{d.title}</h4>
          <ul className="space-y-1.5">
            {d.items.map((ev) => (
              <li key={ev.ref} className="grid grid-cols-[4.5rem_1fr] items-start gap-2">
                <span className="pt-1.5 text-[11px] tabular-nums text-axal-muted">
                  {ev.ends_at ? `${clockTime(ev.starts_at)}–${clockTime(ev.ends_at)}` : clockTime(ev.starts_at)}
                </span>
                <div className="min-w-0">
                  <EventChip ev={ev} conflicts={clash.has(ev.ref)} onOpen={onOpen} />
                  <span className="sr-only">{cohortName}</span>
                </div>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

/** The week (C8): seven days, each a list. Stacked on a phone. */
export function WeekView({ columns, clash, onOpen, today }) {
  return (
    <ol className="grid gap-2 sm:grid-cols-7" data-testid="calendar-week">
      {columns.map((d) => (
        <li key={d.key} className={`min-w-0 rounded-lg border p-1.5 ${d.key === today ? 'border-emerald-400 dark:border-emerald-700' : 'border-axal-hairline dark:border-gray-800'}`}>
          <h4 className="mb-1 text-[11px] font-bold">
            {d.title}{d.key === today ? <span className="ml-1 text-emerald-700 dark:text-emerald-300">· Today</span> : null}
          </h4>
          {d.items.length === 0 ? (
            <p className="text-[10.5px] text-axal-faint">Nothing</p>
          ) : (
            <ul className="space-y-1">
              {d.items.map((ev) => <li key={ev.ref}><EventChip ev={ev} conflicts={clash.has(ev.ref)} onOpen={onOpen} /></li>)}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

/** The month: a table from `sm` up; on a phone, the month's days as a list. */
export function MonthView({ weeks, clash, onOpen, today }) {
  const days = weeks.flat().filter((c) => c.inMonth && c.items.length);
  return (
    <>
      <table className="hidden w-full table-fixed border-collapse text-[11px] sm:table" data-testid="calendar-month">
        <thead>
          <tr>{WEEKDAYS.map((d) => <th key={d} scope="col" className="py-1 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{d}</th>)}</tr>
        </thead>
        <tbody>
          {weeks.map((row) => (
            <tr key={row[0].key}>
              {row.map((c) => (
                <td key={c.key} className={`h-20 border border-axal-hairline p-1 align-top dark:border-gray-800 ${c.inMonth ? '' : 'bg-axal-ground/60 text-axal-faint dark:bg-gray-950'}`}>
                  <div className={`text-[10.5px] ${c.key === today ? 'font-extrabold text-emerald-700 dark:text-emerald-300' : ''}`}>
                    {Number(c.key.slice(8))}{c.key === today ? ' · Today' : ''}
                  </div>
                  <ul className="mt-0.5 space-y-0.5">
                    {c.items.slice(0, 3).map((ev) => <li key={ev.ref}><EventChip ev={ev} conflicts={clash.has(ev.ref)} onOpen={onOpen} compact /></li>)}
                    {c.items.length > 3 && <li className="text-[10px] text-axal-faint">{`+${c.items.length - 3} more`}</li>}
                  </ul>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sm:hidden" data-testid="calendar-month-list">
        {days.length === 0
          ? <p className="py-3 text-[12px] text-axal-muted">Nothing this month for the types shown.</p>
          : <AgendaList days={days.map((c) => ({ key: c.key, title: dayTitle(c.key), items: c.items }))} clash={clash} onOpen={onOpen} />}
      </div>
    </>
  );
}

/** C9 B / C11 Partial data: what loaded is drawn, and this names what did not. */
export function PartialNotice({ missing, onRetry }) {
  if (!missing?.length) return null;
  return (
    <div role="status" data-testid="calendar-partial"
      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <p className="font-bold"><span aria-hidden="true">! </span>Showing what loaded</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {missing.map((m) => <li key={m.key}>{m.text}</li>)}
      </ul>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-1.5 min-h-[44px] rounded-md border border-amber-300 px-2.5 font-semibold dark:border-amber-800 lg:min-h-[28px]">Retry</button>
      )}
    </div>
  );
}

/** The selected event (C8/C9 Details). */
export function EventDetail({ detail, onClose, conflicts }) {
  if (!detail) return null;
  const rows = [
    ['Cohort', detail.cohort], ['Type', detail.type], ['Starts', detail.start], ['Ends', detail.end],
    ['Timezone', detail.timezone], ['Participants', detail.participants], ['Status', detail.status],
  ];
  return (
    <section aria-label="Event detail" aria-live="polite" data-testid="calendar-detail"
      className="rounded-[10px] border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-extrabold tracking-tight">{detail.title}{detail.ongoing ? ' · in progress' : ''}</h3>
        <button type="button" onClick={onClose} className="min-h-[44px] rounded-md px-2 text-[12px] font-semibold text-axal-muted hover:bg-axal-ground dark:hover:bg-gray-800 lg:min-h-0">Close</button>
      </div>
      <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-[12px]">
        {rows.map(([k, v]) => (
          <React.Fragment key={k}><dt className="text-axal-faint">{k}</dt><dd className="min-w-0 break-words">{v}</dd></React.Fragment>
        ))}
      </dl>
      {conflicts.length > 0 && (
        <ul className="mt-2 space-y-1 text-[12px] text-red-800 dark:text-red-300">
          {conflicts.map((t) => <li key={t}>{`▲ ${t}`}</li>)}
        </ul>
      )}
    </section>
  );
}

export default function CalendarZone() {
  // D4813: the cohort is the workspace's (header selector, `?cohort=`); the
  // read is keyed by it and a late answer for another cohort is dropped.
  // No `accept`: a cycle without week windows is a PARTIAL calendar now, drawn
  // with what loaded (see the header), not a failed read.
  const ws = useCohortWorkspace();
  const data = useCohortRead((id) => api.listMyAdvisorCohortCalendar(id), {
    fallbackError: 'This batch’s calendar could not be read.',
  });
  const load = data.reload;
  const now = Date.now();
  const today = dayKey(now);
  const [view, setView] = useState(() => (phoneFirst() ? 'agenda' : 'week'));
  const [anchor, setAnchor] = useState(today);
  const [types, setTypes] = useState(() => new Set(TYPE_ORDER));
  const [selected, setSelected] = useState(null);

  const payload = data.data;
  const tz = payload?.timezone || LAB_TZ;
  const all = calendarEvents(payload);
  const visible = filterByTypes(all, types);
  const clashes = payload?.collisions || [];
  const clash = conflictsByRef(clashes);
  const byRef = new Map(all.map((e) => [e.ref, e]));
  const missing = missingSources(payload);
  const batch = ws.current?.cohort;
  const cohortName = cohortLabel(batch);

  const onAgendaToday = anchor === today;
  const agenda = onAgendaToday
    ? agendaDays(visible, now, 14)
    : [...weekColumns(visible, anchor), ...weekColumns(visible, addDays(anchor, 7))].filter((d) => d.items.length);
  const weekStart = startOfWeek(anchor);
  const columns = weekColumns(visible, weekStart);
  const grid = monthGrid(visible, anchor);
  const title = view === 'month' ? monthTitle(startOfMonth(anchor)) : view === 'week' ? weekTitle(weekStart)
    : onAgendaToday ? 'Next 14 days' : `${dayTitle(anchor)} – ${dayTitle(addDays(anchor, 13))}`;
  const shown = view === 'month' ? grid.flat().filter((c) => c.inMonth).flatMap((c) => c.items)
    : view === 'week' ? columns.flatMap((c) => c.items) : agenda.flatMap((d) => d.items);
  const toggle = (t) => setTypes((prev) => {
    const next = new Set(prev);
    if (next.has(t)) next.delete(t); else next.add(t);
    return next;
  });
  const open = (ev) => setSelected(ev.ref);
  const sel = selected ? byRef.get(selected) : null;

  return (
    <div className="space-y-4">
      <ZoneHeading
        title="Calendar"
        blurb="The cohort's dates and your own booked and group sessions, in one place."
      />

      <ZoneBody
        loading={ws.assignments.loading}
        error={ws.assignments.error}
        onRetry={ws.reloadAssignments}
        isEmpty={ws.assignments.items.length === 0}
        empty={<NoBatch />}
      >
      {data.loading && <CohortLoading what="the calendar" />}
      <ZoneBody
        loading={data.loading}
        error={data.error}
        onRetry={load}
        isEmpty={!data.loading && !data.error && all.length === 0 && missing.length === 0}
        empty={(
          <NothingYet
            title="Nothing on this cohort's calendar"
            body={`${cohortName} has no dates recorded ahead and you have no booked sessions.`}
          />
        )}
      >
        <PartialNotice missing={missing} onRetry={load} />

        <div className="flex flex-wrap items-center gap-2" data-testid="calendar-toolbar">
          <ViewSwitch view={view} onChange={setView} />
          <div className="flex items-center gap-1">
            <button type="button" aria-label={`Previous ${view === 'agenda' ? 'fourteen days' : view}`} onClick={() => setAnchor((a) => shiftAnchor(view, a, -1))}
              className="min-h-[44px] min-w-[44px] rounded-md border border-axal-hairline text-[13px] dark:border-gray-700 lg:min-h-[32px] lg:min-w-[32px]">‹</button>
            <span className="min-w-[8rem] text-center text-[12.5px] font-bold" aria-live="polite" data-testid="calendar-range">{title}</span>
            <button type="button" aria-label={`Next ${view === 'agenda' ? 'fourteen days' : view}`} onClick={() => setAnchor((a) => shiftAnchor(view, a, 1))}
              className="min-h-[44px] min-w-[44px] rounded-md border border-axal-hairline text-[13px] dark:border-gray-700 lg:min-h-[32px] lg:min-w-[32px]">›</button>
            <button type="button" onClick={() => setAnchor(today)} disabled={anchor === today}
              className="min-h-[44px] rounded-md border border-axal-hairline px-2.5 text-[12px] font-semibold disabled:opacity-50 dark:border-gray-700 lg:min-h-[32px]">Today</button>
          </div>
          <span className="text-[11.5px] text-axal-faint" data-testid="calendar-timezone">{`Times in ${tz}`}</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Event types" data-testid="calendar-chips">
          {TYPE_ORDER.map((t) => (
            <button key={t} type="button" aria-pressed={types.has(t)} onClick={() => toggle(t)}
              className={`inline-flex min-h-[44px] items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold lg:min-h-[28px] ${types.has(t)
                ? 'border-emerald-600 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
                : 'border-axal-hairline text-axal-muted line-through dark:border-gray-700'}`}>
              <span aria-hidden="true">{EVENT_TYPES[t].glyph}</span>{EVENT_TYPES[t].label}
            </button>
          ))}
          <button type="button" disabled={shown.length === 0}
            onClick={() => downloadIcs(calendarIcs(shown, ws.cycleId), 'axal-cohort-calendar.ics')}
            className="min-h-[44px] rounded-full border border-axal-hairline px-2.5 text-[11px] font-semibold disabled:opacity-50 dark:border-gray-700 lg:min-h-[28px]">
            {shown.length === 0 ? 'Export to calendar · nothing in this view' : 'Export to calendar · this view'}
          </button>
        </div>

        {clashes.length > 0 && (
          <Card className="border-red-200 p-3 dark:border-red-900" data-testid="calendar-conflicts">
            <h3 className="text-[12.5px] font-extrabold text-red-800 dark:text-red-300">
              <span aria-hidden="true">▲ </span>{`${clashes.length} conflict${clashes.length === 1 ? '' : 's'}`}
            </h3>
            <ul className="mt-1 space-y-1 text-[12px]">
              {clashes.map((c) => <li key={`${c.a}|${c.b}`}>{`${conflictText(c, byRef)} Open either event to move it.`}</li>)}
            </ul>
          </Card>
        )}

        <EventDetail
          detail={sel ? eventDetail(sel, batch, tz) : null}
          conflicts={sel ? (clash.get(sel.ref) || []).map((c) => conflictText(c, byRef)) : []}
          onClose={() => setSelected(null)}
        />

        <Card className="p-3 sm:p-4">
          {view === 'agenda' && <AgendaList days={agenda} clash={clash} onOpen={open} cohortName={cohortName} />}
          {view === 'week' && <WeekView columns={columns} clash={clash} onOpen={open} today={today} />}
          {view === 'month' && <MonthView weeks={grid} clash={clash} onOpen={open} today={today} />}
        </Card>

        <FromTheLab>
          the cohort's dates are the Lab's record, read-only here — your own sessions are yours
        </FromTheLab>

        <StatedLimit title="What a conflict is, and what is not counted">
          <p>
            A conflict is an obligation landing inside a booked session, or two sessions
            overlapping — including a session already in progress. A week window spans seven
            days and every session in the month falls inside one, so overlapping a window is
            not a clash.
          </p>
          <p>
            Sessions that merely touch — one ending as the next begins — are not a clash
            either. Past sessions are not read here. Missing prep is not counted at all:
            nothing in the product stores a session brief, so every session would read as
            unprepared.
          </p>
        </StatedLimit>
      </ZoneBody>
      </ZoneBody>
    </div>
  );
}
