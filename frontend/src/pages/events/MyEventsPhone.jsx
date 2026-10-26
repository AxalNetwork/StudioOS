// D1037 (#2878, part 7 of #2387) — My events on a phone, to the owner's
// canvas MEV18a–c (390 wide): Upcoming with the month as a one-week strip,
// the next event full width and Going as cards (MEV18a), and Hosting's
// "Check in" on the event's day as the camera sheet (MEV18c). The ticket full
// screen (MEV18b) is the ticket drawer as a page (`TicketDrawer` with `page`).
// MyEventsPage draws the frame, the bar and the tabs; every read comes in
// from it, so this file makes no read of its own but the check-in itself.
// The rules and words are in myEventsPhoneModel.js.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { eventsApi } from '../../lib/eventsApi';
import { Lightbox, actionGhost, actionPrimary } from '../../ui';
import { ScannerView, useScanner } from '../../components/events/CheckinScanner';
import { goingGroups, hostingSoon, joinState, nextEvent, placeOf, seatSourceLabel, splitTickets, tabHref, timeLine } from './myEventsModel';
import { ticketPath } from './eventDrawersModel';
import { EMPTY, calendarItems, needsYouRows, onDay, placeMenu } from './myEventsTabsModel';
import { AddToCalendar, CARD, EmptyCard, EventLine, NeedsYouCard, Pill, RowMenu } from './MyEventsTabs';
import { POINT, checkInLine, checkInResult, weekStrip } from './myEventsPhoneModel';
// The 44 × 44px rule under the phone root (`PHONE_ROOT`), imported where the phone's parts live.
import './myEventsPhone.css';

const INK = 'text-axal-ink dark:text-gray-200';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-400 dark:hover:text-violet-300';
const BTN = 'inline-flex items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3.5 text-[13px] font-bold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200';
const viewerZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } };

/** MEV18a: the week as seven days, ‹ and › to move a week, a day's tap showing only its events. */
export function WeekStrip({ items, chosen, onChoose, explorer, now, zone }) {
  const [offset, setOffset] = useState(0);
  const week = weekStrip(explorer ? items.filter((x) => x.kind !== 'hosting') : items, now, zone, offset);
  return (
    <section className={`${CARD} flex flex-col gap-2 px-2 py-2.5`} data-testid="my-events-week">
      <div className="flex items-center justify-between px-1">
        <button type="button" className={`${MUTED} text-[15px]`} aria-label="Previous week" onClick={() => setOffset((x) => x - 1)} data-testid="my-events-week-prev">‹</button>
        <h2 className={`m-0 text-[13px] font-extrabold ${INK}`} data-testid="my-events-week-title">{week.title}</h2>
        <span className="flex items-center">
          {week.thisWeek ? null : <button type="button" className={`${LINK} text-[12px]`} onClick={() => setOffset(0)} data-testid="my-events-week-today">Today</button>}
          <button type="button" className={`${MUTED} text-[15px]`} aria-label="Next week" onClick={() => setOffset((x) => x + 1)} data-testid="my-events-week-next">›</button>
        </span>
      </div>
      <div role="grid" aria-label={week.title} className="grid grid-cols-7 gap-0.5 text-center">
        {week.days.map((d) => (
          <button key={d.key} type="button" role="gridcell" aria-label={d.label} aria-pressed={chosen === d.key}
            onClick={() => onChoose(chosen === d.key ? null : d.key)}
            className={`flex flex-col items-center gap-0.5 rounded-[8px] py-1 ${chosen === d.key ? 'bg-violet-50 dark:bg-[#211f3d]' : ''}`}
            data-testid={d.today ? 'my-events-week-today-cell' : 'my-events-week-day'}>
            <span className={EYEBROW}>{d.weekday}</span>
            <span className={`grid h-7 w-7 place-items-center rounded-full font-mono text-[12px] ${d.today ? 'border-2 border-axal-violet font-extrabold dark:border-[#a78bfa]' : 'font-semibold'} ${INK}`}>{d.day}</span>
            <span className="flex h-1.5 gap-0.5">
              {Array.from({ length: d.going }, (_, i) => <i key={`g${i}`} className="block h-1.5 w-1.5 rounded-full bg-axal-violet dark:bg-[#a78bfa]" />)}
              {Array.from({ length: d.hosting }, (_, i) => <i key={`h${i}`} className="block h-1.5 w-1.5 rounded-full bg-[#0ea5e9]" />)}
            </span>
          </button>
        ))}
      </div>
      {chosen ? (
        <p className={`m-0 px-1 text-[12px] ${MUTED}`}>Showing one day. <button type="button" className={LINK} onClick={() => onChoose(null)} data-testid="my-events-week-clear">Show every day</button></p>
      ) : null}
    </section>
  );
}

/** MEV18a: the next event, full width: its pills, then Show ticket, Add to calendar and Join. */
function PhoneNext({ ticket, now, onAdd }) {
  const place = placeOf(ticket);
  const seat = seatSourceLabel(ticket);
  const online = ['virtual', 'online', 'hybrid'].includes(ticket.location_kind);
  const join = joinState(ticket, now);
  return (
    <section className={`${CARD} flex flex-col gap-2.5 p-3.5`} data-testid="my-events-next">
      <span className={EYEBROW}>Your next event</span>
      <EventLine event={ticket}>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <Pill tone={place.tone}>{place.label}</Pill>
          {seat ? <Pill tone="good" testId="my-events-seat-source">{seat}</Pill> : null}
          {ticket.is_speaker ? <Pill testId="my-events-presenting">You’re presenting</Pill> : null}
        </span>
      </EventLine>
      <span className="flex flex-wrap gap-2">
        <Link className={BTN} to={ticketPath(ticket.id)} data-testid="my-events-next-ticket">Show ticket</Link>
        <button type="button" className={BTN} onClick={() => onAdd(ticket)} data-testid="my-events-next-calendar">Add to calendar</button>
        {online ? join.available
          ? <a className={`${actionPrimary}`} href={ticket.location_url} target="_blank" rel="noopener noreferrer" data-testid="my-events-join">Join</a>
          : <button type="button" disabled className={`${BTN} opacity-60`} data-testid="my-events-join-quiet">Join</button> : null}
      </span>
      {online && join.note ? <p className={`m-0 text-[11.5px] ${MUTED}`} data-testid="my-events-join-note">{join.note}</p> : null}
    </section>
  );
}

/**
 * MEV18a: Upcoming on a phone. Needs you, the week strip, the next event and
 * Going as cards; the week's day filters Going. Add to calendar is a sheet.
 */
export function PhoneUpcoming({ attending, hosting, invitations, explorer, now, api, onAnswer, onPick }) {
  const zone = viewerZone();
  const { upcoming } = splitTickets(attending, now);
  const next = nextEvent(upcoming);
  const [chosen, setChosen] = useState(null);
  const [adding, setAdding] = useState(null);
  const needs = needsYouRows({ hosting, attending, invitations, now });
  const items = calendarItems({ upcoming, hosting, invitations, now });
  const rest = onDay(upcoming.filter((t) => t !== next), chosen, zone);
  const soon = explorer ? [] : hostingSoon(hosting, now);
  const nothing = !upcoming.length && !soon.length && !needs.rows.length;
  const pick = (t, it) => (it.key === 'calendar' ? setAdding(t) : onPick(t, it));
  return (
    <div className="flex flex-col gap-3" data-testid="my-events-phone-upcoming">
      <NeedsYouCard needs={needs} onAnswer={onAnswer} />
      <WeekStrip items={items} chosen={chosen} onChoose={setChosen} explorer={explorer} now={now} zone={zone} />
      {nothing ? <EmptyCard copy={EMPTY.upcoming} to={tabHref({ path: '/discover' })} testId="my-events-nothing" /> : null}
      {next ? <PhoneNext ticket={next} now={now} onAdd={setAdding} /> : null}
      {upcoming.length > (next ? 1 : 0) ? (
        <section className="flex flex-col gap-2" data-testid="my-events-going">
          <h2 className={`m-0 text-[15px] font-extrabold ${INK}`}>Going</h2>
          {rest.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="my-events-going-day-none">Nothing else on that day.</p> : goingGroups(rest, now).map((g) => (
            <div key={g.key} className="flex flex-col gap-2">
              <span className={EYEBROW}>{g.label}</span>
              {g.rows.map((t) => {
                const place = placeOf(t);
                return (
                  <div key={t.id} className={`${CARD} flex flex-col gap-2 p-3`} data-testid="my-events-going-card">
                    <EventLine event={t}><Pill tone={place.tone}>{place.label}</Pill></EventLine>
                    <span className="flex items-center justify-between gap-2">
                      <Link className={BTN} to={ticketPath(t.id)} data-testid="my-events-show-ticket">Show ticket</Link>
                      <RowMenu label={`Actions for ${t.title || 'this event'}`} items={placeMenu(t)} onPick={(it) => pick(t, it)} testId="my-events-place-menu" />
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      ) : null}
      {adding ? (
        <Lightbox label={`Add ${adding.title || 'this event'} to your calendar`} title={adding.title || 'Not recorded'} sub={timeLine(adding, zone)} onClose={() => setAdding(null)} width={420} phone="sheet" testId="my-events-add-calendar-dialog">
          <div className="px-5 py-4"><AddToCalendar id={adding.id} api={api} /></div>
        </Lightbox>
      ) : null}
    </div>
  );
}

/**
 * MEV18c: the camera sheet the row's "Check in" opens on the event's day.
 * Each scan goes through `POST /api/events/:id/checkin/:code` and says who was
 * let in; the count follows each new check-in. "Enter a code" is the typed
 * code; "Done" closes the sheet and the list re-reads.
 */
export function CheckInSheet({ event, onClose }) {
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(0);
  const [said, setSaid] = useState(null);
  const detect = async (code) => {
    setBusy(true); setSaid(null);
    try {
      const reply = await eventsApi.checkin(event.id, code);
      if (!reply?.already_checked_in) setAdded((x) => x + 1);
      setSaid({ ok: true, text: checkInResult(reply) });
    } catch (e) {
      setSaid({ ok: false, text: e?.message || 'The code could not be checked in.' });
    } finally { setBusy(false); }
  };
  const scanner = useScanner({ onDetect: detect, busy });
  const footer = (
    <div className="flex gap-2">
      <button type="button" className={`${actionGhost} flex-1 justify-center`} onClick={() => scanner.setMode('manual')} disabled={scanner.mode === 'manual'} data-testid="my-events-checkin-enter">Enter a code</button>
      <button type="button" className={`${actionPrimary} flex-1 justify-center`} onClick={() => onClose(added)} data-testid="my-events-checkin-done">Done</button>
    </div>
  );
  return (
    <Lightbox label="Check in" title="Check in" sub={checkInLine(event, added)} onClose={() => onClose(added)} width={480} phone="sheet" footer={footer} testId="my-events-checkin-sheet">
      <div className="flex flex-col gap-3 px-5 py-4">
        <ScannerView scanner={scanner} hint={POINT} dark />
        {said ? (
          <p role={said.ok ? 'status' : 'alert'} className={`m-0 text-[13px] font-semibold ${said.ok ? INK : 'text-red-700 dark:text-red-400'}`} data-testid="my-events-checkin-result">{said.text}</p>
        ) : null}
      </div>
    </Lightbox>
  );
}
