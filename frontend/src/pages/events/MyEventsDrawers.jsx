// D1035 (#2876, part 5 of #2387) — My events' drawers and dialogs, to the
// owner's canvas: the ticket (MEV3, MEV3a–d) at /my/events/ticket/[id], the
// hosted event (MEV5, MEV5b) at /my/events/hosting/[id], the publish dialogs
// (MEV6a–c), the cancel dialogs (MEV7a–b) and MEV17. Each is the shared
// Lightbox, so it traps focus, closes on Escape and gives focus back to what
// opened it. Every change opens a dialog that says what it changes and who is
// told; nothing here uses a browser pop-up. The words and rules are in
// eventDrawersModel.js.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { eventsApi } from '../../lib/eventsApi';
import { Lightbox, Unreadable, actionDanger, actionGhost, actionPrimary } from '../../ui';
import EventQRCode from '../../components/events/EventQRCode';
import { onEventDay } from './hostHeaderModel';
import { dateBlock, statusOf, visibilityWord } from './myEventsModel';
import { BRIGHTNESS } from './myEventsPhoneModel';
import {
  CODE_LINE, EXPLORER_CLOSED, HOST_NOT_READ, JOIN_FOOT, NOT_HOST, NO_CODE, NO_PLACE,
  agendaRows, canCancelEvent, canCancelPlace, cancelEventDialog, cancelPlaceDialog, cancelledLine, gateOf, hostPages,
  hostedTiles, mayManage, nextStep, placeFromDetail, placeIn, publishDialog, seatLine, ticketCard, ticketState, whenWhere,
  whoMayRegister,
} from './eventDrawersModel';

const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const SECTION = 'flex flex-col gap-2 border-t border-axal-hairline px-5 py-3.5 first:border-t-0 dark:border-gray-800';
const TONES = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  warn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
  bad: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  info: 'border-violet-200 bg-violet-50 text-axal-ink dark:border-violet-900 dark:bg-violet-950/30 dark:text-gray-100',
  muted: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};
const viewerZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } };

function Pill({ tone = 'muted', children, testId }) {
  return <span className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${TONES[tone] || TONES.muted}`} data-testid={testId}>{children}</span>;
}

function Section({ title, children, foot, testId }) {
  return (
    <section className={SECTION} data-testid={testId}>
      {title ? <h3 className={`m-0 ${EYEBROW}`}>{title}</h3> : null}
      {children}
      {foot ? <p className={`m-0 text-[11.5px] ${MUTED}`}>{foot}</p> : null}
    </section>
  );
}

/** One read: `{ status: 'loading' | 'ready' | 'error', data, error }`, re-run on `retry`. */
function useRead(load, key) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (key == null) { setState({ status: 'error', data: null, error: { status: 404 } }); return undefined; }
    let live = true;
    setState({ status: 'loading', data: null, error: null });
    Promise.resolve().then(load).then(
      (data) => { if (live) setState({ status: 'ready', data, error: null }); },
      (error) => { if (live) setState({ status: 'error', data: null, error }); },
    );
    return () => { live = false; };
    // `load` is rebuilt each render; `key` and `n` say when to read.
  }, [key, n]); // eslint-disable-line react-hooks/exhaustive-deps
  return [state, () => setN((x) => x + 1)];
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

/** The drawer's head: the date tile, the eyebrow, the title, the pills and "Open event page". */
function Head({ event, eye, pills, testId }) {
  return (
    <div className="flex items-start gap-3.5 px-5 pb-3 pt-4" data-testid={testId}>
      <DateTile event={event} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={EYEBROW}>{eye}</span>
        <h2 className={`m-0 text-[18px] font-extrabold leading-snug ${INK}`}>{event?.title || 'Not recorded'}</h2>
        <span className="flex flex-wrap items-center gap-1.5">{pills}</span>
      </div>
      {event?.id ? <Link className={`${LINK} shrink-0 text-[12.5px]`} to={`/events/${event.slug || event.id}`}>Open event page</Link> : null}
    </div>
  );
}

function Reading({ testId }) {
  return <p className={`m-0 px-5 py-6 text-[13px] ${MUTED}`} aria-live="polite" data-testid={testId}>Reading…</p>;
}

/**
 * A dialog that says what it changes and who is told (MEV6, MEV7). The
 * refusal stays inside it; the dialog stays open until the change is saved.
 */
export function ChangeDialog({ copy, onClose, onConfirm, danger = false, note = false, testId }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [text, setText] = useState('');
  const go = async () => {
    setBusy(true); setRefusal('');
    try { await onConfirm(note ? text.trim() : undefined); } catch (e) { setRefusal(e?.message || 'This could not be saved. Nothing changed.'); setBusy(false); }
  };
  const close = () => { if (!busy) onClose(); };
  return (
    <Lightbox label={copy.title} title={copy.title} sub={copy.sub || undefined} onClose={close} width={480} phone="sheet" testId={testId}
      footer={(
        <div className="flex flex-col gap-2">
          {refusal ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid={`${testId}-refusal`}>{refusal}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={actionGhost} onClick={close} disabled={busy} data-testid={`${testId}-keep`}>{copy.keep || 'Back'}</button>
            <button type="button" className={danger ? actionDanger : actionPrimary} onClick={go} disabled={busy} data-testid={`${testId}-go`}>{busy ? (copy.busy || 'Saving…') : copy.action}</button>
          </div>
        </div>
      )}>
      <div className="flex flex-col gap-2.5 px-5 py-4" data-testid={`${testId}-body`}>
        <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-normal text-axal-ink dark:text-gray-100">
          {copy.lines.map((l) => <li key={l}>{l}</li>)}
        </ul>
        {copy.paidBox ? <p className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${TONES.warn}`} data-testid={`${testId}-paid`}>! {copy.paidBox}</p> : null}
        {note ? (
          <label className="flex flex-col gap-1">
            <span className={EYEBROW}>{copy.noteLabel}</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a note…" rows={3} maxLength={1000}
              className="rounded-[7px] border border-axal-hairline bg-white px-3 py-2 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid={`${testId}-note`} />
          </label>
        ) : null}
      </div>
    </Lightbox>
  );
}

/** MEV6: publish or send for review, through `POST /api/events/:id/submit-review`. */
export function PublishDialog({ event, counts, onClose, onDone }) {
  const copy = publishDialog(event, counts);
  if (!copy) return null;
  return (
    <ChangeDialog copy={{ ...copy, keep: 'Back' }} onClose={onClose} testId="my-events-publish"
      onConfirm={async () => { await eventsApi.submitReview(event.id); onDone(copy.done); }} />
  );
}

/* ------------------------------------------------------------------ *
 * The ticket (MEV3)
 * ------------------------------------------------------------------ */

/**
 * D1037 (MEV18b): with `page`, the ticket is a page of its own below 1024px
 * (`Lightbox`'s page mode under `bar`, the phone's "‹ Events"): the code
 * larger, the brightness line under it, and Close left to the bar.
 */
export function TicketDrawer({ id, list, onClose, onDone, page = false, bar = undefined }) {
  const [detail, retryDetail] = useRead(() => eventsApi.get(id), id);
  const [links, retryLinks] = useRead(() => eventsApi.calendarLinks(id), id);
  const [asking, setAsking] = useState(false);
  const fromList = list.status === 'ready' ? placeIn(list.data, id) : null;
  const place = fromList || (detail.status === 'ready' ? placeFromDetail(detail.data) : null);
  const waiting = !place && (list.status === 'loading' || detail.status === 'loading');
  const unread = !place && list.status === 'error' && detail.status === 'error' && ![403, 404].includes(Number(detail.error?.status));
  const card = place ? ticketCard(place) : null;
  const state = place ? ticketState(place) : null;
  const where = place ? whenWhere(place, viewerZone()) : null;
  const seat = place ? seatLine(place) : null;
  const title = place?.title || (detail.data?.event?.title) || 'Ticket';
  const footer = (
    <div className="flex flex-wrap justify-between gap-2">
      {place && canCancelPlace(place) ? (
        <button type="button" className={actionDanger} onClick={() => setAsking(true)} data-testid="my-events-ticket-cancel">{state === 'waitlist' ? 'Leave the waitlist' : 'Cancel my place'}</button>
      ) : <span />}
      {page ? null : <button type="button" className={actionGhost} onClick={onClose} data-testid="my-events-ticket-close">Close</button>}
    </div>
  );
  return (
    <>
      <Lightbox label={title} onClose={onClose} width={600} testId="my-events-ticket-drawer" footer={footer} pageBelow={page ? 'lg' : undefined} bar={page ? bar : undefined}>
        {waiting ? <Reading testId="my-events-ticket-reading" /> : unread ? (
          <div className="px-5 py-5"><Unreadable what="Your ticket" claim="That is not the same as having none." onRetry={() => { list.reload?.(); retryDetail(); }} /></div>
        ) : !place ? (
          <div className="flex flex-col items-start gap-2 px-5 py-5" data-testid="my-events-ticket-none">
            <p className={`m-0 text-[13.5px] ${INK}`}>{NO_PLACE}</p>
            <Link className={`${LINK} text-[12.5px]`} to={`/events/${id}`}>Open event page</Link>
          </div>
        ) : (
          <div data-testid="my-events-ticket-body">
            <Head event={place} eye="TICKET" testId="my-events-ticket-head"
              pills={card
                ? <Pill tone={card.pill.tone} testId="my-events-ticket-place">{card.pill.label}</Pill>
                : <Pill tone="good" testId="my-events-ticket-place">{place.reg_status === 'attended' ? 'Checked in' : 'Going'}</Pill>} />
            {card ? (
              <Section testId={`my-events-ticket-state-${card.state}`} foot={card.foot}>
                <p className={`m-0 rounded-[10px] border px-3 py-2 text-[13px] font-semibold leading-normal ${TONES[card.tone] || TONES.info}`} data-testid="my-events-ticket-note">{card.note}</p>
                {card.action?.to ? <Link className={`${actionPrimary} w-fit`} to={card.action.to} data-testid="my-events-ticket-pay">{card.action.label}</Link> : null}
              </Section>
            ) : (
              <Section testId="my-events-ticket-code">
                {place.checkin_code ? (
                  <div className="flex flex-col items-center gap-1.5">
                    <EventQRCode value={place.checkin_code} size={page ? 240 : 210} />
                    <span className={`font-mono text-[13px] ${INK}`} data-testid="my-events-ticket-code-text">{place.checkin_code}</span>
                    <span className={`text-center text-[12.5px] ${MUTED}`} data-testid="my-events-ticket-code-line">{page ? `${CODE_LINE} ${BRIGHTNESS}` : CODE_LINE}</span>
                  </div>
                ) : <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="my-events-ticket-no-code">{NO_CODE}</p>}
              </Section>
            )}
            <Section title="When and where" foot={state === 'going' || state === 'pay' ? JOIN_FOOT : null} testId="my-events-ticket-where">
              <span className={`text-[13px] ${INK}`}>{where.when}</span>
              <span className={`flex flex-wrap items-center gap-2 text-[13px] ${INK}`}>
                <MapPin size={13} /> {where.where}
                {where.maps ? <a className={`${LINK} text-[12px]`} href={where.maps} target="_blank" rel="noopener noreferrer" data-testid="my-events-ticket-maps">Open in maps</a> : null}
              </span>
              {state === 'going' && where.join ? (
                <span className="flex flex-wrap items-center gap-2 text-[12.5px]" data-testid="my-events-ticket-join">
                  <span className={`font-mono text-[11.5px] ${MUTED}`}>{where.join}</span>
                  <button type="button" className={LINK} onClick={() => navigator.clipboard?.writeText?.(where.join)} aria-label="Copy the join link">Copy</button>
                  <a className={LINK} href={where.join} target="_blank" rel="noopener noreferrer">Join</a>
                </span>
              ) : null}
            </Section>
            <Section title="Add to calendar" testId="my-events-ticket-calendar">
              <span className="flex flex-wrap items-center gap-3 text-[12.5px]">
                {links.status === 'ready' && links.data?.google ? <a className={LINK} href={links.data.google} target="_blank" rel="noopener noreferrer" data-testid="my-events-ticket-google">Google Calendar</a> : null}
                {links.status === 'ready' && links.data?.outlook ? <a className={LINK} href={links.data.outlook} target="_blank" rel="noopener noreferrer" data-testid="my-events-ticket-outlook">Outlook</a> : null}
                <a className={LINK} href={eventsApi.icsUrl(place.id)} data-testid="my-events-ticket-ics">Download .ics</a>
              </span>
              {links.status === 'loading' ? <span className={`text-[11.5px] ${MUTED}`}>Reading the calendar links…</span> : null}
              {links.status === 'error' ? (
                <p className="m-0 flex flex-wrap items-center gap-2 text-[12px] text-red-700 dark:text-red-300" role="alert" data-testid="my-events-ticket-calendar-unread">
                  Google and Outlook links could not be read.
                  <button type="button" className="font-semibold underline" onClick={retryLinks}>Try again</button>
                </p>
              ) : null}
            </Section>
            <Section title="Your seat" testId="my-events-ticket-seat">
              <span className={`text-[13px] font-semibold ${INK}`}>{seat.text}</span>
              {seat.sub ? <span className={`text-[12px] ${MUTED}`}>{seat.sub}</span> : null}
            </Section>
            <Section title="Agenda" testId="my-events-ticket-agenda">
              {detail.status === 'loading' ? <span className={`text-[12px] ${MUTED}`}>Reading…</span>
                : detail.status === 'error' ? (
                  <p className="m-0 flex flex-wrap items-center gap-2 text-[12px] text-red-700 dark:text-red-300" role="alert" data-testid="my-events-ticket-agenda-unread">
                    The agenda could not be read. That is not the same as none.
                    <button type="button" className="font-semibold underline" onClick={retryDetail}>Try again</button>
                  </p>
                ) : agendaRows(detail.data?.agenda, place.timezone).length === 0 ? <span className={`text-[12.5px] ${MUTED}`}>No agenda yet.</span>
                  : agendaRows(detail.data.agenda, place.timezone).map((a) => (
                    <div key={a.key} className="flex gap-3 text-[12.5px]" data-testid="my-events-ticket-agenda-row">
                      <span className={`w-11 shrink-0 font-mono font-bold ${INK}`}>{a.at || '—'}</span>
                      <span className="flex flex-col"><span className={INK}>{a.title}</span>{a.speaker ? <span className={MUTED}>{a.speaker}</span> : null}</span>
                    </div>
                  ))}
            </Section>
            <Section testId="my-events-ticket-host"><span className={`text-[12.5px] ${MUTED}`}>{HOST_NOT_READ}</span></Section>
          </div>
        )}
      </Lightbox>
      {asking && place ? (
        <ChangeDialog copy={cancelPlaceDialog(place)} danger onClose={() => setAsking(false)} testId="my-events-cancel-place"
          onConfirm={async () => { await eventsApi.cancelPlace(place.id); setAsking(false); onDone(cancelPlaceDialog(place).done); }} />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The hosted event (MEV5) and MEV17
 * ------------------------------------------------------------------ */

export function NotHostCard({ event, onClose }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-8 text-center" data-testid="my-events-not-host">
      <span aria-hidden="true" className={`text-[22px] ${MUTED}`}>⊘</span>
      <p className={`m-0 text-[15px] font-extrabold ${INK}`}>{NOT_HOST}</p>
      {event?.title ? <p className={`m-0 text-[12.5px] ${MUTED}`}>{`${event.title} is not an event you host.`}</p> : null}
      <span className="mt-1 flex flex-wrap justify-center gap-2">
        {event?.id ? <Link className={actionGhost} to={`/events/${event.slug || event.id}`}>Open event page</Link> : null}
        <button type="button" className={actionGhost} onClick={onClose}>Close</button>
      </span>
    </div>
  );
}

/** MEV17b: the Explorer card, drawn only if the owner closes My events to Explorers (D1030 opened it). */
export function ExplorerClosedCard() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-6 py-12 text-center" data-testid="my-events-explorer-closed">
      <span aria-hidden="true" className={`text-[22px] ${MUTED}`}>⊘</span>
      <p className={`m-0 text-[16px] font-extrabold ${INK}`}>{EXPLORER_CLOSED.title}</p>
      <p className={`m-0 text-[13px] ${MUTED}`}>{EXPLORER_CLOSED.line}</p>
      <span className="mt-1 flex flex-wrap justify-center gap-2">
        {EXPLORER_CLOSED.actions.map((a) => <Link key={a.to} className={actionGhost} to={a.to}>{a.label}</Link>)}
      </span>
    </div>
  );
}

export function HostedDrawer({ id, list, user, onClose, onDone }) {
  const mine = list.status === 'ready' ? (list.data?.hosting || []).find((e) => Number(e.id) === Number(id)) || null : null;
  // Only an event the list does not hold is read alone: an admin's view of another host's, or MEV17.
  const needDetail = list.status !== 'loading' && !mine;
  const [detail, retryDetail] = useRead(() => eventsApi.get(id), needDetail ? id : undefined);
  const [asking, setAsking] = useState(null);
  const event = mine || (detail.status === 'ready' ? detail.data?.event : null);
  const counts = mine ? mine.counts : null;
  const manage = mine ? true : mayManage(event, user);
  const waiting = list.status === 'loading' || (needDetail && detail.status === 'loading');
  const missing = needDetail && detail.status === 'error';
  const label = event?.title || 'Hosted event';
  const step = event && manage ? nextStep(event, counts) : null;
  const gate = event && manage ? gateOf(event) : null;
  const who = event && manage ? whoMayRegister(event) : null;
  const st = event ? statusOf(event) : null;
  const done = (line) => { setAsking(null); onDone(line); };
  const footer = event && manage ? (
    <div className="flex flex-wrap justify-between gap-2">
      {canCancelEvent(event) ? <button type="button" className={actionDanger} onClick={() => setAsking('cancel')} data-testid="my-events-hosted-cancel">Cancel event</button> : <span />}
      <button type="button" className={actionGhost} onClick={onClose} data-testid="my-events-hosted-close">Close</button>
    </div>
  ) : null;
  return (
    <>
      <Lightbox label={label} onClose={onClose} width={600} phone="sheet" testId="my-events-hosted-drawer" footer={footer}>
        {waiting ? <Reading testId="my-events-hosted-reading" /> : missing ? (
          [403, 404].includes(Number(detail.error?.status))
            ? <NotHostCard event={null} onClose={onClose} />
            : <div className="px-5 py-5"><Unreadable what="This event" claim="It may still be yours." onRetry={retryDetail} /></div>
        ) : !manage ? <NotHostCard event={event} onClose={onClose} /> : (
          <div data-testid="my-events-hosted-body">
            <Head event={event} eye="HOSTING" testId="my-events-hosted-head" pills={(<>
              <Pill tone={st.tone} testId="my-events-hosted-status">{st.label}</Pill>
              <Pill tone="muted">{visibilityWord(event.visibility)}</Pill>
              {event.status === 'published' && onEventDay(event) ? <Pill tone="info">● Today</Pill> : null}
            </>)} />
            {gate ? (
              <div className="px-5 pb-3">
                <p className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-bold leading-normal ${gate.tone === 'warn' ? TONES.warn : TONES.muted}`} data-testid="my-events-hosted-gate">
                  <span className={`mr-2 ${EYEBROW}`}>Publish gate</span>{gate.text}
                </p>
              </div>
            ) : null}
            {step ? (
              <Section testId="my-events-hosted-next">
                <span className={EYEBROW}>{step.eye}</span>
                <span className={`text-[15px] font-extrabold ${INK}`} data-testid="my-events-hosted-next-title">{step.title}</span>
                {step.note ? <span className={`text-[12.5px] ${MUTED}`}>{step.note}</span> : null}
                {step.progress ? (
                  <span className="flex items-center gap-3">
                    <span className={`font-mono text-[13px] font-bold ${INK}`}>{step.progress.text}</span>
                    <span className="block h-2 w-[220px] overflow-hidden rounded-full border border-violet-200 bg-white dark:border-violet-900 dark:bg-gray-900">
                      <span className="block h-full bg-axal-violet" style={{ width: `${step.progress.pct}%` }} />
                    </span>
                  </span>
                ) : null}
                {step.actions.length ? (
                  <span className="flex flex-wrap gap-2">
                    {step.actions.map((a) => (a.dialog
                      ? <button key={a.label} type="button" className={actionPrimary} onClick={() => setAsking('publish')} data-testid="my-events-hosted-publish">{a.label}</button>
                      : a.href ? <a key={a.label} className={actionGhost} href={a.href}>{a.label}</a>
                        : <Link key={a.label} className={a.primary ? actionPrimary : actionGhost} to={a.to}>{a.label}</Link>))}
                  </span>
                ) : null}
              </Section>
            ) : null}
            <Section testId="my-events-hosted-tiles">
              <div className="grid grid-cols-2 gap-2.5">
                {hostedTiles(event, counts).map((t) => (
                  <div key={t.key} className="flex flex-col gap-0.5 rounded-[10px] border border-axal-hairline p-2.5 dark:border-gray-700" data-testid={`my-events-hosted-tile-${t.key}`}>
                    <span className={EYEBROW}>{t.label}</span>
                    <span className={`font-mono text-[16px] font-bold ${INK}`}>{t.value == null ? 'Not read here yet' : t.value}</span>
                    {t.sub ? <span className={`text-[11px] ${MUTED}`}>{t.sub}</span> : null}
                  </div>
                ))}
              </div>
              {counts ? null : <p className={`m-0 text-[11.5px] ${MUTED}`}>The counts are read for the events you host; another host’s are on its Registrations page.</p>}
            </Section>
            <Section title="Who may register" testId="my-events-hosted-who">
              {who ? who.map((l) => <span key={l} className={`text-[13px] ${INK}`}>{l}</span>) : <span className={`text-[12.5px] ${MUTED}`}>Not read here yet.</span>}
              <Link className={`${LINK} text-[12.5px]`} to={`/events/${event.id}/manage`}>Change</Link>
            </Section>
            <Section title="Host pages" testId="my-events-hosted-pages">
              {hostPages(event.id).map((p) => (
                <span key={p.key} className="flex items-center justify-between gap-3">
                  <span className="flex flex-col"><span className={`text-[13px] font-semibold ${INK}`}>{p.label}</span><span className={`text-[11.5px] ${MUTED}`}>{p.sub}</span></span>
                  <Link className={`${LINK} text-[12.5px]`} to={p.to} data-testid={`my-events-hosted-page-${p.key}`}>Open</Link>
                </span>
              ))}
            </Section>
          </div>
        )}
      </Lightbox>
      {asking === 'publish' && event ? <PublishDialog event={event} counts={counts} onClose={() => setAsking(null)} onDone={done} /> : null}
      {asking === 'cancel' && event ? (
        <ChangeDialog copy={cancelEventDialog(event, counts)} danger note onClose={() => setAsking(null)} testId="my-events-cancel-event"
          onConfirm={async (note) => { const reply = await eventsApi.cancel(event.id, note); done(cancelledLine(reply)); }} />
      ) : null}
    </>
  );
}

