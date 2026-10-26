// D1034 (#2875, part 4 of #2387) — My events' four tabs complete, to the
// owner's canvas: Needs you, the month calendar and Month view (MEV1, MEV11),
// Hosting's counts, filters, sorts, ⋯ menu and pages (MEV4), Discover's chips,
// filters and actions (MEV8), Past's chart, filters and years (MEV9, MEV10),
// and the states (MEV14–MEV16). The rules are in myEventsTabsModel.js.
//
// NO READ IS MADE HERE. Every read and write comes in through `api`, which
// MyEventsPage builds from eventsApi and eventsPublic, so this file has one
// door to the Worker and its tests stub one object. Every change opens a
// dialog that says what it changes and who is told; nothing here uses a
// browser pop-up.
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { Lightbox, Unreadable, actionGhost, actionPrimary } from '../../ui';
import { ChartTable, GroupedColumns, Legend } from '../../ui/Charts';
import { ChangeDialog } from './MyEventsDrawers';
import { dateBlock, statusOf, timeLine, visibilityWord, whereOf, hostAction } from './myEventsModel';
import { hostedPath, ticketPath } from './eventDrawersModel';
import {
  CALENDAR_KINDS, EMPTY, FORMATS, HOST_DEFAULTS, HOST_SORT, HOST_STATUS, HOST_VISIBILITY, HOST_WHEN, PAST_FILTERS, PRICES, SUBSCRIBE,
  dayChips, dayLabel, discoverMonths, discoverRow, freeForMe, hostCounts, hostMenu, hostingView, invitationDialog, monthCells, monthTitle,
  pageOf, pastAll, pastChart, pastView, pastYears, placeMenu, registerDialog, shiftMonth, subscribeLine, typeChips, typeLabel,
} from './myEventsTabsModel';

export const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const INPUT = 'rounded-[7px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const TONES = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  warn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
  bad: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  info: 'border-violet-200 bg-violet-50 text-axal-violet dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-300',
  muted: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};
// The calendar's kinds, in #2375's palette: violet Going, sky Hosting, dashed for a waitlist place or an invitation.
const KIND_CHIP = {
  going: 'border-violet-300 bg-violet-50 text-axal-ink dark:border-violet-800 dark:bg-violet-950/30 dark:text-gray-100',
  hosting: 'border-sky-300 bg-sky-50 text-axal-ink dark:border-sky-800 dark:bg-sky-950/30 dark:text-gray-100',
  waitlist: 'border-dashed border-violet-300 bg-white text-axal-ink dark:border-violet-800 dark:bg-gray-900 dark:text-gray-100',
  invitation: 'border-dashed border-sky-300 bg-white text-axal-ink dark:border-sky-800 dark:bg-gray-900 dark:text-gray-100',
};
const KIND_DOT = { going: 'bg-axal-violet dark:bg-[#a78bfa]', hosting: 'bg-[#0ea5e9]' };
const viewerZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } };

export function Pill({ tone = 'muted', children, testId }) {
  return <span className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${TONES[tone] || TONES.muted}`} data-testid={testId}>{children}</span>;
}

/** MEV15: a card that is reading, its lines as grey bars. */
export function Skeleton({ lines = 3, testId = 'my-events-skeleton' }) {
  return (
    <div className={`${CARD} flex flex-col gap-2.5 p-4`} aria-label="Reading…" data-testid={testId}>
      <span className={`text-[13px] font-semibold ${MUTED}`}>Reading…</span>
      {['92%', '74%', '86%', '60%', '70%'].slice(0, lines).map((w) => <span key={w} className="block h-3 rounded-md bg-axal-hairline dark:bg-gray-800" style={{ width: w }} />)}
    </div>
  );
}

/** MEV14: an empty tab, centred, with its one way forward. */
export function EmptyCard({ copy, to, testId, glyph = '○' }) {
  return (
    <div className={`${CARD} flex flex-col items-center gap-2 px-7 py-8 text-center`} data-testid={testId}>
      <span aria-hidden="true" className={`text-[22px] ${MUTED}`}>{glyph}</span>
      <h2 className={`m-0 text-[16px] font-extrabold ${INK}`}>{copy.title}</h2>
      {copy.note ? <p className={`m-0 text-[13px] ${MUTED}`}>{copy.note}</p> : null}
      {copy.action && to ? <Link to={to} className={`${actionPrimary} mt-1`}>{copy.action}</Link> : null}
    </div>
  );
}

function DateTile({ event }) {
  const d = dateBlock(event);
  return (
    <div className="flex w-[58px] shrink-0 flex-col items-center rounded-[10px] border border-axal-hairline py-1.5 font-mono dark:border-gray-700">
      {d ? (<>
        <span className={`text-[10px] font-bold ${MUTED}`}>{d.month}</span>
        <span className={`text-[20px] font-extrabold leading-none ${INK}`}>{d.day}</span>
        <span className={`text-[10px] ${MUTED}`}>{d.weekday}</span>
      </>) : <span className={`px-1 text-center text-[10px] ${MUTED}`}>No date</span>}
    </div>
  );
}

export function EventLine({ event, to, sub = null, children }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <DateTile event={event} />
      <div className="flex min-w-0 flex-col gap-0.5">
        {to
          ? <Link to={to} className={`truncate text-[14px] font-extrabold hover:text-axal-violet ${INK}`} data-testid="my-events-open-drawer">{event.title || 'Not recorded'}</Link>
          : <span className={`truncate text-[14px] font-extrabold ${INK}`}>{event.title || 'Not recorded'}</span>}
        {sub ? <span className={`text-[12px] ${MUTED}`}>{sub}</span> : null}
        <span className={`text-[12px] ${MUTED}`}>{timeLine(event, viewerZone())}</span>
        <span className={`inline-flex items-center gap-1 text-[12px] ${MUTED}`}><MapPin size={12} /> {whereOf(event)}</span>
        {children}
      </div>
    </div>
  );
}

/**
 * The ⋯ menu on a row: links, file links and buttons. Escape and an outside
 * click close it, Escape returning focus to "⋯".
 */
export function RowMenu({ label, items, onPick, testId = 'my-events-row-menu' }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const button = useRef(null);
  useEffect(() => {
    if (!open || typeof document === 'undefined' || !document.addEventListener) return undefined;
    const away = (e) => { if (!wrap.current?.contains?.(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const close = () => { setOpen(false); if (typeof button.current?.focus === 'function') button.current.focus(); };
  const cls = (danger) => `flex min-h-[38px] w-full items-center rounded-[8px] px-3 text-left text-[12.5px] font-semibold hover:bg-axal-ground dark:hover:bg-gray-800 ${danger ? 'text-red-700 dark:text-red-300' : INK}`;
  return (
    <div ref={wrap} className="relative" onKeyDown={(e) => { if (open && e.key === 'Escape') { e.preventDefault(); close(); } }}>
      <button ref={button} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="grid h-[30px] w-[30px] place-items-center rounded-[8px] border border-axal-hairline bg-white text-[15px] font-bold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid={testId}>⋯</button>
      {open ? (
        <div role="menu" aria-label={label} className="absolute right-0 top-full z-30 mt-1 flex min-w-[200px] flex-col rounded-[12px] border border-axal-hairline bg-white p-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-900" data-testid={`${testId}-items`}>
          {items.map((it) => (it.to
            ? <Link key={it.key} role="menuitem" to={it.to} className={cls(it.danger)} onClick={() => setOpen(false)} data-testid={`${testId}-${it.key}`}>{it.label}</Link>
            : it.href
              ? <a key={it.key} role="menuitem" href={it.href} className={cls(it.danger)} onClick={() => setOpen(false)} data-testid={`${testId}-${it.key}`}>{it.label}</a>
              : <button key={it.key} type="button" role="menuitem" className={cls(it.danger)} onClick={() => { setOpen(false); onPick?.(it); }} data-testid={`${testId}-${it.key}`}>{it.label}</button>))}
        </div>
      ) : null}
    </div>
  );
}

/** A two-way switch: List / Month, Chart / Table. */
export function Segmented({ options, value, onChange, label, testId }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[9px] bg-axal-ground p-0.5 dark:bg-gray-800" data-testid={testId}>
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={o === value} onClick={() => onChange(o)}
          className={`min-h-[28px] rounded-[7px] px-3 text-[12px] ${o === value ? `bg-white font-bold shadow-[0_0_0_1px_#ececf1] dark:bg-gray-900 dark:shadow-[0_0_0_1px_#374151] ${INK}` : `font-semibold ${MUTED}`}`}
          data-testid={testId ? `${testId}-${o.toLowerCase()}` : undefined}>{o}</button>
      ))}
    </div>
  );
}

function Chip({ on, children, onClick, testId, label }) {
  return (
    <button type="button" aria-pressed={on} aria-label={label} onClick={onClick}
      className={`inline-flex min-h-[28px] items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12px] ${on
        ? 'border-violet-300 bg-violet-50 font-bold text-axal-violet dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300'
        : 'border-axal-hairline bg-white font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}
      data-testid={testId}>{children}</button>
  );
}

function Select({ value, onChange, options, label, testId }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={`${INPUT} min-h-[30px] rounded-full`} data-testid={testId}>
      {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  );
}

/** "1–25 of [N]" with Previous and Next. Hidden when one page holds everything. */
export function Pager({ page, onPage, testId }) {
  if (page.pages <= 1) return page.total ? <p className={`m-0 font-mono text-[12px] ${MUTED}`} data-testid={testId}>{page.label}</p> : null;
  return (
    <div className="flex items-center gap-2 text-[12px]" data-testid={testId}>
      <span className={`font-mono ${MUTED}`}>{page.label}</span>
      <button type="button" className={actionGhost} disabled={page.page <= 1} onClick={() => onPage(page.page - 1)} aria-label="Previous page" data-testid={`${testId}-prev`}>‹</button>
      <span className={`font-mono ${INK}`}>{page.page}</span>
      <button type="button" className={actionGhost} disabled={page.page >= page.pages} onClick={() => onPage(page.page + 1)} aria-label="Next page" data-testid={`${testId}-next`}>›</button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Needs you (MEV1)
 * ------------------------------------------------------------------ */

export function NeedsYouCard({ needs, onAnswer }) {
  if (!needs.rows.length) return null;
  return (
    <section className={CARD} data-testid="my-events-needs">
      <h2 className={`m-0 flex items-center justify-between border-b border-axal-hairline px-4 py-3 text-[15px] font-extrabold dark:border-gray-800 ${INK}`}>
        Needs you <span className={`font-mono text-[11.5px] font-bold ${MUTED}`} data-testid="my-events-needs-total">{needs.total}</span>
      </h2>
      {needs.rows.map((r) => (
        <div key={r.key} className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-ground px-4 py-2.5 last:border-b-0 dark:border-gray-800" data-testid="my-events-needs-row">
          <span className="flex items-center gap-2 text-[12.5px]"><Pill tone={r.tone}>{r.pill}</Pill> <span className={INK}>{r.text}</span></span>
          {r.kind === 'invitation' ? (
            <span className="flex gap-2 text-[12.5px]">
              <button type="button" className={LINK} onClick={() => onAnswer(r.invitation, 'accept')} data-testid="my-events-invitation-accept">Accept</button>
              <button type="button" className={`${MUTED} font-semibold`} onClick={() => onAnswer(r.invitation, 'decline')} data-testid="my-events-invitation-decline">Decline</button>
            </span>
          ) : <Link className={`${LINK} text-[12.5px]`} to={r.action.to} data-testid={`my-events-needs-${r.kind}`}>{r.action.label}</Link>}
        </div>
      ))}
    </section>
  );
}

/** Accept or decline an invitation, through a dialog that says what it changes. */
export function InvitationDialog({ answer, api, onClose, onDone }) {
  const copy = invitationDialog(answer.invitation, answer.action);
  return (
    <ChangeDialog copy={{ ...copy, keep: 'Back' }} onClose={onClose} testId="my-events-invitation-dialog"
      onConfirm={async () => { await api.answerInvitation(answer.invitation.event.id, answer.action); onDone(copy.done); }} />
  );
}

/* ------------------------------------------------------------------ *
 * The month calendar (MEV1) and Month view (MEV11)
 * ------------------------------------------------------------------ */

function MonthHead({ month, setMonth, now, zone, right = null }) {
  const today = monthCells(month, [], now, zone).some((c) => c.today && c.inMonth);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-1">
        <button type="button" className={`${MUTED} px-1 text-[15px]`} aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} data-testid="my-events-month-prev">‹</button>
        <h2 className={`m-0 text-[14px] font-extrabold ${INK}`} data-testid="my-events-month-title">{monthTitle(month)}</h2>
        <button type="button" className={`${MUTED} px-1 text-[15px]`} aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} data-testid="my-events-month-next">›</button>
      </span>
      <span className="flex items-center gap-2">
        {today ? null : <button type="button" className={`${LINK} text-[12px]`} onClick={() => setMonth(null)} data-testid="my-events-month-today">Today</button>}
        {right}
      </span>
    </div>
  );
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** MEV1's mini calendar: dots for going and hosting, today ringed, a day click filters the list. */
export function MiniCalendar({ month, setMonth, items, chosen, onChoose, explorer, now, zone }) {
  const cells = monthCells(month, items, now, zone);
  const title = monthTitle(month).split(' ')[0];
  return (
    <section className={`${CARD} flex flex-col gap-2.5 p-4`} data-testid="my-events-calendar">
      <MonthHead month={month} setMonth={setMonth} now={now} zone={zone} />
      <div role="grid" aria-label={monthTitle(month)} className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS.map((d) => <span key={d} role="columnheader" className={`${EYEBROW} py-1`}>{d}</span>)}
        {cells.map((c) => (
          <button key={c.key} type="button" role="gridcell" aria-label={dayLabel(c, title)} aria-pressed={chosen === c.key}
            onClick={() => onChoose(chosen === c.key ? null : c.key)}
            className={`flex flex-col items-center gap-0.5 rounded-[8px] py-0.5 ${chosen === c.key ? 'bg-violet-50 dark:bg-violet-950/30' : ''}`}
            data-testid={c.today ? 'my-events-calendar-today' : c.going + c.hosting ? 'my-events-calendar-day' : undefined}>
            <span className={`grid h-7 w-7 place-items-center rounded-full font-mono text-[12px] ${c.today ? 'border-2 border-axal-violet font-extrabold dark:border-[#a78bfa]' : 'font-semibold'} ${c.inMonth ? INK : MUTED}`}>{c.day}</span>
            <span className="flex h-1.5 gap-0.5">
              {Array.from({ length: c.going }, (_, i) => <i key={`g${i}`} className={`block h-1.5 w-1.5 rounded-full ${KIND_DOT.going}`} />)}
              {explorer ? null : Array.from({ length: c.hosting }, (_, i) => <i key={`h${i}`} className={`block h-1.5 w-1.5 rounded-full ${KIND_DOT.hosting}`} />)}
            </span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        <span className={`flex items-center gap-1.5 text-[11.5px] ${MUTED}`}><i className={`block h-2 w-2 rounded-full ${KIND_DOT.going}`} /> Going</span>
        {explorer ? null : <span className={`flex items-center gap-1.5 text-[11.5px] ${MUTED}`}><i className={`block h-2 w-2 rounded-full ${KIND_DOT.hosting}`} /> Hosting</span>}
        <span className={`flex items-center gap-1.5 text-[11.5px] ${MUTED}`}><i className="block h-3 w-3 rounded-full border-2 border-axal-violet dark:border-[#a78bfa]" /> Today</span>
      </div>
      <p className={`m-0 text-[12px] ${MUTED}`}>
        {chosen ? <>Showing one day. <button type="button" className={LINK} onClick={() => onChoose(null)} data-testid="my-events-calendar-clear">Show every day</button></> : 'Click a day to show only its events in the list.'}
      </p>
    </section>
  );
}

/** Add to Google Calendar, Outlook or a .ics file, from D1033's links for one event. */
export function AddToCalendar({ id, api, onSubscribe = null, testId = 'my-events-add-calendar' }) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setRead({ status: 'loading', data: null });
    Promise.resolve().then(() => api.calendarLinks(id))
      .then((data) => { if (live) setRead({ status: 'ready', data }); })
      .catch(() => { if (live) setRead({ status: 'error', data: null }); });
    return () => { live = false; };
  }, [id, n]);
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <span className={EYEBROW}>Add to calendar</span>
      {read.status === 'loading' ? <span className={`text-[12px] ${MUTED}`}>Reading…</span>
        : read.status === 'error' ? <Unreadable what="The calendar links" claim="Your place is unchanged." onRetry={() => setN((x) => x + 1)} />
          : (
            <span className="flex flex-col gap-1 text-[12.5px]">
              {read.data?.google ? <a className={LINK} href={read.data.google} target="_blank" rel="noopener noreferrer" data-testid={`${testId}-google`}>Google Calendar</a> : null}
              {read.data?.outlook ? <a className={LINK} href={read.data.outlook} target="_blank" rel="noopener noreferrer" data-testid={`${testId}-outlook`}>Outlook</a> : null}
              {read.data?.ics ? <a className={LINK} href={read.data.ics} data-testid={`${testId}-ics`}>Download .ics</a> : null}
            </span>
          )}
      {onSubscribe ? <button type="button" className={`${actionGhost} mt-1 justify-start`} onClick={onSubscribe} data-testid={`${testId}-subscribe`}>Subscribe to all my events</button> : null}
    </div>
  );
}

/** MEV11: the month as a grid, chips by kind, "+N more" opens the day, a chip offers Add to calendar. */
export function MonthView({ month, setMonth, items, now, zone, api, onSubscribe, toggle }) {
  const cells = monthCells(month, items, now, zone);
  const [day, setDay] = useState(null);
  const [adding, setAdding] = useState(null);
  const openChip = (chip) => setAdding(chip.item);
  return (
    <section className={`${CARD} flex flex-col gap-3 p-4`} data-testid="my-events-month">
      <MonthHead month={month} setMonth={setMonth} now={now} zone={zone} right={toggle} />
      <div role="grid" aria-label={monthTitle(month)} className="grid grid-cols-7 border-l border-t border-axal-hairline dark:border-gray-800">
        {WEEKDAYS.map((d) => <span key={d} role="columnheader" className={`${EYEBROW} border-b border-r border-axal-hairline px-1.5 py-1.5 dark:border-gray-800`}>{d}</span>)}
        {cells.map((c) => {
          const { chips, more } = dayChips(c, zone);
          return (
            <div key={c.key} role="gridcell" className={`flex min-h-[96px] min-w-0 flex-col gap-1 border-b border-r border-axal-hairline p-1.5 dark:border-gray-800 ${c.inMonth ? 'bg-white dark:bg-gray-900' : 'bg-axal-ground dark:bg-gray-950'}`} data-testid="my-events-month-cell">
              <span className={`font-mono text-[11px] ${c.today ? 'inline-grid h-[22px] w-[22px] place-items-center rounded-full border-2 border-axal-violet font-extrabold dark:border-[#a78bfa]' : 'font-bold'} ${c.inMonth ? INK : MUTED}`}>{c.day}</span>
              {chips.map((ch) => (
                <button key={ch.key} type="button" onClick={() => openChip(ch)} title={ch.text}
                  className={`truncate rounded-[5px] border border-l-[3px] px-1.5 py-0.5 text-left text-[11px] font-semibold ${KIND_CHIP[ch.kind]}`} data-testid={`my-events-month-chip-${ch.kind}`}>{ch.text}</button>
              ))}
              {more ? <button type="button" className={`${LINK} text-left text-[11px]`} onClick={() => setDay(c)} data-testid="my-events-month-more">+{more} more</button> : null}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        {CALENDAR_KINDS.map((k) => <span key={k.key} className={`rounded-[5px] border border-l-[3px] px-1.5 py-0.5 text-[11px] font-semibold ${KIND_CHIP[k.key]}`}>{k.label}</span>)}
      </div>
      {day ? (
        <Lightbox label={`Events on ${day.day} ${monthTitle(month)}`} title={`${day.day} ${monthTitle(month)}`} onClose={() => setDay(null)} width={420} phone="sheet" testId="my-events-month-day">
          <div className="flex flex-col gap-1.5 px-5 py-4">
            {dayChips(day, zone).all.map((ch) => (
              <button key={ch.key} type="button" onClick={() => { setDay(null); openChip(ch); }} className={`truncate rounded-[5px] border border-l-[3px] px-2 py-1 text-left text-[12px] font-semibold ${KIND_CHIP[ch.kind]}`} data-testid="my-events-month-day-chip">{ch.text}</button>
            ))}
          </div>
        </Lightbox>
      ) : null}
      {adding ? (
        <Lightbox label={adding.event.title || 'Event'} title={adding.event.title || 'Not recorded'} sub={timeLine(adding.event, viewerZone())} onClose={() => setAdding(null)} width={420} phone="sheet" testId="my-events-month-chip-panel">
          <div className="flex flex-col gap-3 px-5 py-4">
            <span className="flex flex-wrap gap-3 text-[12.5px]">
              {adding.kind === 'hosting' ? <Link className={LINK} to={hostedPath(adding.id)}>Open the event</Link>
                : adding.kind === 'invitation' ? <Link className={LINK} to={`/events/${adding.event.slug || adding.id}`}>Open the event page</Link>
                  : <Link className={LINK} to={ticketPath(adding.id)}>Show ticket</Link>}
            </span>
            {adding.kind === 'invitation' ? null : <AddToCalendar id={adding.id} api={api} onSubscribe={() => { setAdding(null); onSubscribe(); }} />}
          </div>
        </Lightbox>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Subscribe (D1033's feed)
 * ------------------------------------------------------------------ */

export function SubscribeCard({ read, onOpen }) {
  const line = subscribeLine(read);
  return (
    <section className={`${CARD} flex flex-col gap-2 p-4`} data-testid="my-events-subscribe">
      <h2 className={`m-0 text-[15px] font-extrabold ${INK}`}>{SUBSCRIBE.title}</h2>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>{SUBSCRIBE.note}</p>
      {line ? <p className={`m-0 text-[12px] ${read.status === 'error' ? 'text-red-700 dark:text-red-300' : MUTED}`} data-testid="my-events-subscribe-line">{line}</p> : null}
      <button type="button" className={`${actionGhost} w-fit`} onClick={onOpen} data-testid="my-events-subscribe-open">{read?.data?.subscribed ? 'Manage subscription' : 'Subscribe'}</button>
    </section>
  );
}

/**
 * The subscription dialog: what the address does, then Make it (or Make a new
 * one, which stops the old one), shown once; Remove stops it. Each is a
 * change the dialog names before it is made.
 */
export function SubscribeDialog({ read, api, onClose, onChanged }) {
  const [made, setMade] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [removing, setRemoving] = useState(false);
  const subscribed = !!read?.data?.subscribed;
  const run = async (fn) => {
    setBusy(true); setRefusal('');
    try { await fn(); } catch (e) { setRefusal(e?.message || 'This could not be saved. Nothing changed.'); } finally { setBusy(false); }
  };
  const make = () => run(async () => { const r = await api.makeFeed(); setMade(r); onChanged(); });
  const remove = () => run(async () => { await api.removeFeed(); setRemoving(false); onChanged(); onClose(); });
  return (
    <Lightbox label="Subscribe to my events" title="Subscribe to my events" sub={SUBSCRIBE.note} onClose={() => { if (!busy) onClose(); }} width={520} phone="sheet" testId="my-events-subscribe-dialog"
      footer={(
        <div className="flex flex-col gap-2">
          {refusal ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="my-events-subscribe-refusal">{refusal}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={actionGhost} onClick={onClose} disabled={busy}>Close</button>
            {made ? null : <button type="button" className={actionPrimary} onClick={make} disabled={busy} data-testid="my-events-subscribe-make">{busy ? 'Making…' : subscribed ? 'Make a new address' : 'Make my address'}</button>}
          </div>
        </div>
      )}>
      <div className="flex flex-col gap-2.5 px-5 py-4 text-[13px]" data-testid="my-events-subscribe-body">
        {made ? (<>
          <p className={`m-0 ${INK}`}>{SUBSCRIBE.made}</p>
          <label className="flex flex-col gap-1"><span className={EYEBROW}>Your address</span>
            <input readOnly value={made.url} className={`${INPUT} font-mono`} onFocus={(e) => e.target.select?.()} data-testid="my-events-subscribe-url" />
          </label>
          <a className={LINK} href={made.webcal_url} data-testid="my-events-subscribe-webcal">Open in your calendar app</a>
        </>) : (
          <ul className={`m-0 flex list-disc flex-col gap-1.5 pl-5 ${INK}`}>
            <li>You get one private address for your tickets and the events you host.</li>
            <li>Add it once to Google Calendar or Outlook, and new tickets appear there.</li>
            <li>{subscribed ? SUBSCRIBE.replace : 'It is shown once. Keep it private.'}</li>
          </ul>
        )}
        {read?.status === 'error' ? <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300">Whether you subscribed could not be read. Making an address replaces any older one.</p> : null}
        {subscribed && !made ? (
          removing ? (
            <div className={`flex flex-col gap-2 rounded-[10px] border px-3 py-2 ${TONES.warn}`} data-testid="my-events-subscribe-remove-confirm">
              <span className="text-[12.5px] font-semibold">Remove the address? Calendars that use it stop showing your events. Nothing else changes.</span>
              <span className="flex gap-2">
                <button type="button" className={actionGhost} onClick={() => setRemoving(false)} disabled={busy}>Keep it</button>
                <button type="button" className={actionPrimary} onClick={remove} disabled={busy} data-testid="my-events-subscribe-remove-go">{busy ? 'Removing…' : 'Remove the address'}</button>
              </span>
            </div>
          ) : <button type="button" className={`${LINK} w-fit text-[12.5px]`} onClick={() => setRemoving(true)} data-testid="my-events-subscribe-remove">Remove the address</button>
        ) : null}
      </div>
    </Lightbox>
  );
}

/* ------------------------------------------------------------------ *
 * Hosting (MEV4)
 * ------------------------------------------------------------------ */

/** The counts line and bar under a hosted event: "[42] of [60] taken", waitlist, to approve, invitations. */
export function HostCountsLine({ event }) {
  const c = hostCounts(event);
  if (!c) return <span className={`text-[11.5px] ${MUTED}`} data-testid="my-events-host-counts-unread">Seats, waitlist and approvals: Not read here yet</span>;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px]" data-testid="my-events-host-counts">
      {c.cap ? <span className="block h-2 w-[140px] overflow-hidden rounded-full border border-axal-hairline bg-axal-ground dark:border-gray-700 dark:bg-gray-800" aria-hidden="true"><span className="block h-full rounded-full bg-axal-violet dark:bg-[#a78bfa]" style={{ width: `${c.pct}%` }} /></span> : null}
      <span className={`font-mono ${INK}`}>{c.line}</span>
      {c.extra ? <span className={`font-mono ${MUTED}`}>{c.extra}</span> : null}
    </span>
  );
}

export function HostingFilters({ f, setF }) {
  const set = (k) => (v) => setF({ ...f, [k]: v, page: 1 });
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="my-events-host-filters">
      <input type="search" value={f.q} onChange={(e) => set('q')(e.target.value)} placeholder="Search your events" aria-label="Search your events" className={`${INPUT} w-full max-w-xs`} />
      <Select label="Status" value={f.status} onChange={set('status')} options={HOST_STATUS} testId="my-events-host-status" />
      <Select label="Visibility" value={f.visibility} onChange={set('visibility')} options={HOST_VISIBILITY} testId="my-events-host-visibility" />
      <Select label="When" value={f.when} onChange={set('when')} options={HOST_WHEN} testId="my-events-host-when" />
      <Select label="Sort" value={f.sort} onChange={set('sort')} options={HOST_SORT} testId="my-events-host-sort" />
    </div>
  );
}

/**
 * One hosted row: the event, its status, visibility and counts, its one action, and the ⋯ menu.
 * D1037 (MEV18c): with `onCheckIn` (a phone), the event's-day "Check in" opens the camera sheet in place.
 */
export function HostedRow({ event: e, now, onPublish, onCopy, onCancel, onCheckIn = null }) {
  const st = statusOf(e);
  const act = hostAction(e, now);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-ground px-4 py-3 last:border-b-0 dark:border-gray-800" data-testid="my-events-hosted-row">
      <EventLine event={e} to={hostedPath(e.id)}>
        <span className="mt-1 flex flex-wrap items-center gap-2 text-[12px]"><Pill tone={st.tone}>{st.label}</Pill><span className={MUTED}>{visibilityWord(e.visibility)}</span></span>
        {e.status === 'published' || e.status === 'pending_review' ? <HostCountsLine event={e} /> : null}
      </EventLine>
      <span className="flex flex-wrap items-center gap-3 text-[12px]">
        {act.dialog ? <button type="button" className={LINK} onClick={() => onPublish(e)} data-testid="my-events-host-action">{act.label}</button>
          : onCheckIn && act.label === 'Check in' ? <button type="button" className={LINK} onClick={() => onCheckIn(e)} data-testid="my-events-host-checkin">Check in</button>
          : act.label ? <Link className={LINK} to={act.to} data-testid="my-events-host-action">{act.label}</Link> : act.note ? <span className={MUTED}>{act.note}</span> : null}
        <RowMenu label={`Actions for ${e.title || 'this event'}`} items={hostMenu(e, now)} testId="my-events-host-menu"
          onPick={(it) => (it.key === 'copy' ? onCopy(it.copy) : it.key === 'cancel' ? onCancel(e) : null)} />
      </span>
    </div>
  );
}

export function HostingList({ hosting, now, f, setF, onPublish, onCopy, onCancel, onCheckIn = null }) {
  const view = hostingView(hosting, f, now);
  return (
    <>
      <HostingFilters f={f} setF={setF} />
      {view.groups.length === 0 ? (
        <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="my-events-hosting-nomatch">No hosted event matches these filters. <button type="button" className={LINK} onClick={() => setF(HOST_DEFAULTS)}>Clear the filters</button></p>
      ) : view.groups.map((g) => (
        <section key={g.key} className={CARD} data-testid={`my-events-group-${g.key}`}>
          <h2 className={`m-0 border-b border-axal-hairline px-4 py-3 text-[14px] font-extrabold dark:border-gray-800 ${INK}`}>{g.label} <span className={`font-mono text-[12px] ${MUTED}`}>{g.rows.length}</span></h2>
          {g.rows.map((e) => <HostedRow key={e.id} event={e} now={now} onPublish={onPublish} onCopy={onCopy} onCancel={onCancel} onCheckIn={onCheckIn} />)}
        </section>
      ))}
      <Pager page={view.page} onPage={(p) => setF({ ...f, page: p })} testId="my-events-host-pages" />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Discover (MEV8)
 * ------------------------------------------------------------------ */

/**
 * Discover: the next three months as chips, each with its count; the type
 * chips with counts for the chosen month; Format, Price and "Free for me";
 * each row's price line and action from eligibility; "1–25 of [N]". One
 * failed read is said where it is, and never blanks the tab.
 */
export function DiscoverTabFull({ api, held, invitations, suggested, suggestionsRead, onRegistered, onAccept, now = Date.now() }) {
  const zone = viewerZone();
  const months = discoverMonths(now, zone);
  const [monthKey, setMonthKey] = useState(months[0].key);
  const [type, setType] = useState('');
  const [format, setFormat] = useState('');
  const [price, setPrice] = useState('');
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [read, setRead] = useState({ status: 'loading', events: [], total: null });
  const [again, setAgain] = useState(0);
  const [monthCounts, setMonthCounts] = useState({});
  const [elig, setElig] = useState({});
  const [registering, setRegistering] = useState(null);
  const term = q.trim().length >= 2 ? q.trim() : '';
  const win = months.find((m) => m.key === monthKey) || months[0];

  // The month chips' counts: one read each, `limit: 1`, for its exact total. A failed count is a dash.
  useEffect(() => {
    let live = true;
    for (const m of months) {
      Promise.resolve().then(() => api.publicList({ limit: 1, offset: 0, from: m.from, to: m.to, format: format || undefined, price: price || undefined }))
        .then((r) => { if (live) setMonthCounts((c) => ({ ...c, [m.key]: Number.isFinite(Number(r?.total)) ? Number(r.total) : null })); })
        .catch(() => { if (live) setMonthCounts((c) => ({ ...c, [m.key]: null })); });
    }
    return () => { live = false; };
  }, [format, price, again]);

  // The chosen month, every event the filters match up to 100, so the type chips and pages count what is there.
  useEffect(() => {
    let live = true;
    setRead({ status: 'loading', events: [], total: null });
    Promise.resolve().then(() => api.publicList({ limit: 100, offset: 0, from: win.from, to: win.to, q: term || undefined, format: format || undefined, price: price || undefined }))
      .then((r) => { if (live) setRead({ status: 'ready', events: Array.isArray(r?.events) ? r.events : [], total: Number.isFinite(Number(r?.total)) ? Number(r.total) : null }); })
      .catch(() => { if (live) setRead({ status: 'error', events: [], total: null }); });
    return () => { live = false; };
  }, [monthKey, term, format, price, again]);

  const chips = typeChips(read.events);
  const byType = read.events.filter((ev) => !type || (ev.type || 'other') === type);
  const eligOf = (id) => elig[id];
  const list = mine ? freeForMe(byType, eligOf) : byType;
  const pg = pageOf(list, page);

  // Eligibility for the rows on this page (and, with "Free for me", for every row of the month), once each.
  // Marking a read as asked changes `wanted`, so liveness is the tab's, not one effect run's.
  const asked = useRef(new Set());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const wanted = (mine ? byType : pg.rows).map((ev) => ev.id).filter((id) => !held.has(id) && !asked.current.has(id));
  useEffect(() => {
    for (const id of wanted) {
      asked.current.add(id);
      setElig((m) => ({ ...m, [id]: { status: 'loading' } }));
      Promise.resolve().then(() => api.eligibility(id))
        .then((data) => { if (mounted.current) setElig((m) => ({ ...m, [id]: { status: 'ready', data } })); })
        .catch(() => { if (mounted.current) setElig((m) => ({ ...m, [id]: { status: 'error' } })); });
    }
  }, [wanted.join(',')]);

  const invitationFor = (id) => (invitations || []).find((i) => i.event?.id === id) || null;
  const reset = () => setPage(1);
  return (
    <div className="flex flex-col gap-3.5" data-testid="my-events-discover">
      {suggestionsRead?.status === 'error' ? <Unreadable what="Suggested events" claim="This is not a claim that none are available." onRetry={suggestionsRead.reload} /> : null}
      {suggested.length ? (
        <section className="flex flex-col gap-2">
          <h2 className={`m-0 text-[15px] font-extrabold ${INK}`}>Suggested for you</h2>
          <div className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-4">
            {suggested.slice(0, 4).map((ev) => (
              <Link key={ev.id} to={`/events/${ev.slug || ev.id}`} className={`${CARD} flex flex-col gap-1 p-3 hover:border-axal-violet`} data-testid="my-events-discover-suggested">
                <span className={`text-[13px] font-bold ${INK}`}>{ev.title}</span>
                <span className={`text-[11.5px] ${MUTED}`}>{timeLine(ev, zone)}</span>
                {ev.suggestion_reason ? <Pill tone="info">{ev.suggestion_reason}</Pill> : null}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      <div className="flex flex-wrap items-center gap-2" data-testid="my-events-discover-months">
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} placeholder="Search events" aria-label="Search events" className={`${INPUT} w-full max-w-xs`} />
        {months.map((m) => (
          <Chip key={m.key} on={m.key === monthKey} onClick={() => { setMonthKey(m.key); setType(''); reset(); }} testId={`my-events-discover-month-${m.key}`} label={`${m.title}: ${monthCounts[m.key] == null ? 'count not read' : `${monthCounts[m.key]} events`}`}>
            {m.label} <span className="font-mono text-[11px]">{m.key in monthCounts ? (monthCounts[m.key] == null ? '—' : monthCounts[m.key]) : '…'}</span>
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2" data-testid="my-events-discover-types">
        {chips.map((t) => (
          <Chip key={t.key} on={type === t.key} onClick={() => { setType(type === t.key ? '' : t.key); reset(); }} testId={`my-events-discover-type-${t.key}`}>
            {t.label} <span className="font-mono text-[11px]">{t.count}</span>
          </Chip>
        ))}
        <Select label="Format" value={format} onChange={(v) => { setFormat(v); reset(); }} options={FORMATS} testId="my-events-discover-format" />
        <Select label="Price" value={price} onChange={(v) => { setPrice(v); reset(); }} options={PRICES} testId="my-events-discover-price" />
        <Chip on={mine} onClick={() => { setMine(!mine); reset(); }} testId="my-events-discover-free">Free for me</Chip>
      </div>
      {read.status === 'ready' && read.total != null && read.total > read.events.length ? (
        <p className={`m-0 text-[12px] ${MUTED}`} data-testid="my-events-discover-capped">{win.title} has {read.total} events; the first {read.events.length} are listed and counted here. Search to narrow them.</p>
      ) : null}
      <section className={CARD}>
        <h2 className={`m-0 flex items-center justify-between border-b border-axal-hairline px-4 py-3 text-[14px] font-extrabold dark:border-gray-800 ${INK}`}>{win.title} <span className={`text-[12px] font-semibold ${MUTED}`}>By date</span></h2>
        {read.status === 'loading' ? <div className="p-4"><Skeleton lines={4} testId="my-events-discover-loading" /></div>
          : read.status === 'error' ? <div className="p-4" data-testid="my-events-discover-unreadable"><Unreadable what="The public calendar" claim="This is not a claim that nothing is on." onRetry={() => setAgain((x) => x + 1)} /></div>
            : pg.rows.length === 0 ? <p className={`m-0 p-4 text-[12.5px] ${MUTED}`} data-testid="my-events-discover-none">{mine ? 'No event on this page’s list is free for you.' : term ? `No event in ${win.title} matches “${term}”.` : `No upcoming events on the public calendar in ${win.title}.`}</p>
              : pg.rows.map((ev) => {
                const row = discoverRow(ev, { held, invitation: invitationFor(ev.id), elig: elig[ev.id] });
                return (
                  <div key={ev.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-ground px-4 py-3 last:border-b-0 dark:border-gray-800" data-testid="my-events-discover-row">
                    <EventLine event={ev} sub={ev.summary || null}>
                      <span className="mt-1 flex flex-wrap items-center gap-2"><Pill>{typeLabel(ev.type)}</Pill>{row.pill ? <Pill tone="info">{row.pill}</Pill> : null}</span>
                    </EventLine>
                    <span className="flex flex-col items-end gap-1">
                      <span className={`font-mono text-[12.5px] font-bold ${row.muted ? MUTED : INK}`} data-testid="my-events-discover-price-line">{row.price}</span>
                      {row.action?.ticket ? <Link className={`${LINK} text-[12px]`} to={ticketPath(ev.id)}>{row.action.label}</Link>
                        : row.action?.accept ? <button type="button" className={`${LINK} text-[12px]`} onClick={() => onAccept(row.action.accept)} data-testid="my-events-discover-accept">Accept</button>
                          : row.action?.register ? <button type="button" className={`${LINK} text-[12px]`} onClick={() => setRegistering({ ev, row })} data-testid="my-events-discover-register">{row.action.label}</button>
                            : row.action?.to ? <Link className={`${LINK} text-[12px]`} to={row.action.to}>{row.action.label}</Link> : null}
                      {row.note ? <span className={`text-[11.5px] ${MUTED}`}>{row.note}</span> : null}
                    </span>
                  </div>
                );
              })}
      </section>
      {read.status === 'ready' ? <Pager page={pg} onPage={setPage} testId="my-events-discover-pages" /> : null}
      {registering ? (
        <ChangeDialog copy={{ ...registerDialog(registering.ev, registering.row, elig[registering.ev.id]), keep: 'Back' }} onClose={() => setRegistering(null)} testId="my-events-register-dialog"
          onConfirm={async () => {
            const copy = registerDialog(registering.ev, registering.row, elig[registering.ev.id]);
            await api.register(registering.ev.id);
            setRegistering(null);
            asked.current.delete(registering.ev.id);
            setElig((m) => { const x = { ...m }; delete x[registering.ev.id]; return x; });
            onRegistered(copy.done);
          }} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Past (MEV9, MEV10)
 * ------------------------------------------------------------------ */

export function PastTabFull({ past, hosting, now = Date.now(), onOlder, older, onRetry }) {
  const places = Array.isArray(past?.places) ? past.places : [];
  const rows = pastAll(places, hosting, now);
  const years = pastYears(rows);
  const thisYear = new Date(now).getUTCFullYear();
  const [year, setYear] = useState(years.includes(thisYear) ? thisYear : years[0] ?? thisYear);
  const [filters, setFilters] = useState([]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [view, setView] = useState('Chart');
  const complete = past ? places.length >= Number(past.total || 0) : false;
  const oldest = places.length ? places[places.length - 1].starts_at : null;
  const chart = pastChart(rows, { year, now, complete, oldest });
  const shown = pastView(rows, { filters, year, q });
  const pg = pageOf(shown, page);
  const toggle = (k) => { setFilters(filters.includes(k) ? filters.filter((x) => x !== k) : [...filters, k]); setPage(1); };
  if (!past) {
    return (
      <div className={`${CARD} p-5`} data-testid="my-events-past-unreadable">
        <Unreadable what="Your past events" claim="That is not the same as having none." onRetry={onRetry} />
      </div>
    );
  }
  if (!rows.length) return <EmptyCard copy={EMPTY.past} testId="my-events-past-none" />;
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2" data-testid="my-events-past-filters">
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search past events" aria-label="Search past events" className={`${INPUT} w-full max-w-xs`} />
        {PAST_FILTERS.map((f) => <Chip key={f.key} on={filters.includes(f.key)} onClick={() => toggle(f.key)} testId={`my-events-past-filter-${f.key}`}>{f.label}</Chip>)}
        {years.map((y) => <Chip key={y} on={y === year} onClick={() => { setYear(y); setPage(1); }} testId={`my-events-past-year-${y}`}>{y}</Chip>)}
      </div>
      <section className={`${CARD} flex flex-col gap-2.5 p-4`} data-testid="my-events-past-chart">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={`m-0 text-[15px] font-extrabold ${INK}`}>{year === thisYear ? 'Your events this year' : `Your events in ${year}`}</h2>
          <Segmented options={['Chart', 'Table']} value={view} onChange={setView} label="Show as" testId="my-events-past-view" />
        </div>
        <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="my-events-past-summary">{chart.summary}</p>
        {view === 'Chart' ? (<>
          <Legend items={[{ label: 'Went', tone: 'violet' }, { label: 'Hosted', tone: 'sky' }, ...(year === thisYear ? [{ label: 'This month, so far', tone: 'hatch' }] : [])]} />
          <div role="img" aria-label={chart.summary} data-testid="my-events-past-chart-svg"><GroupedColumns rows={chart.rows} series={chart.series} height={200} /></div>
        </>) : <div data-testid="my-events-past-table"><ChartTable chart={chart} caption={chart.summary} /></div>}
        {chart.foot ? <p className={`m-0 text-[12px] ${MUTED}`}>{chart.foot}</p> : null}
      </section>
      <section className={CARD} data-testid="my-events-past">
        <h2 className={`m-0 flex items-center justify-between border-b border-axal-hairline px-4 py-3 text-[14px] font-extrabold dark:border-gray-800 ${INK}`}>Past events <span className={`font-mono text-[12px] ${MUTED}`}>{shown.length}</span></h2>
        <p className={`m-0 px-4 pt-2 text-[12px] ${MUTED}`}>Replay is not recorded: events have no recording link yet.</p>
        {pg.rows.length === 0 ? <p className={`m-0 p-4 text-[12.5px] ${MUTED}`} data-testid="my-events-past-nomatch">No past event matches these filters.</p> : pg.rows.map((r) => (
          <div key={r.key} className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-ground px-4 py-3 last:border-b-0 dark:border-gray-800" data-testid="my-events-past-row">
            <EventLine event={r.event} to={r.kind === 'hosted' ? hostedPath(r.event.id) : null}><Pill tone={r.result.tone}>{r.result.label}</Pill></EventLine>
            <span className={`font-mono text-[11.5px] ${MUTED}`}>Replay · Not recorded</span>
          </div>
        ))}
      </section>
      <Pager page={pg} onPage={setPage} testId="my-events-past-pages" />
      {!complete ? (
        <p className={`m-0 text-[12px] ${MUTED}`} data-testid="my-events-past-older">
          {places.length} of your {past.total} past places are read here.{' '}
          <button type="button" className={LINK} onClick={onOlder} disabled={older === 'loading'} data-testid="my-events-past-older-read">{older === 'loading' ? 'Reading…' : 'Read older places'}</button>
          {older === 'error' ? <span className="text-red-700 dark:text-red-300"> Older places could not be read.</span> : null}
        </p>
      ) : null}
    </div>
  );
}

export { placeMenu };
