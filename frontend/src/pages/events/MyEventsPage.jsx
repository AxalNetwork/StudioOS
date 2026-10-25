// Task #40 (E2) — MyEventsPage. D1030 (#2387): on a desktop, the owner's "My
// events" canvas — Upcoming, Hosting, Discover and Past, each at its own
// address under /my/events, drawn from the reads that exist (myEventsModel.js).
// The phone keeps D700's A7m sections until D1030's phone part.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Plus, Calendar, MapPin, Ticket } from 'lucide-react';
import { eventsApi } from '../../lib/eventsApi';
import { eventsPublic } from '../../lib/api';
import { useAuth } from '../../hooks/useAuthSync';
import { useToast } from '../../components/useToast';
import PageExplainer from '../../components/PageExplainer';
import EventQRCode from '../../components/events/EventQRCode';
import { Unreadable } from '../../ui';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth';
import { AccountPhonePage, phonePending } from '../account/AccountPhonePage';
import { ACCOUNT_PHONE_PAGES } from '../account/accountPhone';
import {
  EXPLORER_LINE, LINE, NOT_READ, REPLAY_LINE, TITLE,
  dateBlock, discoverAction, goingGroups, hostAction, hostingGroups, hostingSoon, isExplorer, needsYou, nextEvent,
  pastRows, placeOf, priceOf, splitTickets, statusOf, tabCounts, tabHref, tabOf, tabsFor, timeLine, visibilityWord, whereOf as eventWhere,
} from './myEventsModel';

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  pending_review: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  published: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const REG_STATUS_STYLES = {
  registered: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  confirmed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  waitlisted: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  attended: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  declined: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

function fmtDate(value, tz) {
  if (!value) return 'Date TBD';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  try {
    return d.toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      ...(tz ? { timeZone: tz } : {}),
    });
  } catch { return d.toLocaleString(); }
}

function StatusBadge({ status, map = STATUS_STYLES }) {
  const cls = map[status] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {String(status || '').replace(/_/g, ' ') || 'draft'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// D700 (#1662) — A7m, the page on a phone.
// ---------------------------------------------------------------------------

const GOING = new Set(['registered', 'confirmed']);
const shortDay = (value) => {
  const d = new Date(value);
  return value && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'Date TBD';
};
const whereOf = (e) => e.location_text || e.location_kind || '';

/** A ticket's pill: Going, Waitlist, Attended, or its own status word. */
function ticketPill(status, upcoming) {
  if (upcoming && GOING.has(status)) return { label: 'Going', tone: 'ok' };
  if (status === 'waitlisted') return { label: 'Waitlist', tone: 'warn' };
  if (status === 'attended') return { label: 'Attended', tone: 'ok' };
  return { label: String(status || '').replace(/_/g, ' ') || 'registered', tone: 'neutral' };
}

/**
 * A7m's sections from `eventsApi.list` (`events`: { status, hosting,
 * attending, reload }) and `eventsApi.suggested` (`suggested`: the events, or
 * null while it is out or after it failed — best-effort, as on the desktop).
 * Past has no Replay pill, and Hosting is a third section (decision 10).
 */
export function eventsPhoneGroups({ events, suggested, now = new Date() }) {
  const [upTitle, pastTitle] = ACCOUNT_PHONE_PAGES.events.sections;
  const upcoming = { label: upTitle, rows: [], testid: 'events-phone-upcoming' };
  const past = { label: pastTitle, rows: [], testid: 'events-phone-past' };
  const hosting = { label: 'Hosting', rows: [], testid: 'events-phone-hosting', cta: { label: 'New event', to: '/events/new', testid: 'events-phone-new' } };
  if (events.status !== 'ready') {
    const note = phonePending(events.status, 'Your events', 'This is not a claim that you have none.', events.reload);
    return [{ ...upcoming, note }, { ...past, note }, { ...hosting, note }];
  }
  const at = (e) => new Date(e.starts_at).getTime();
  const tickets = [...events.attending].sort((a, b) => (at(a) || 0) - (at(b) || 0));
  for (const t of tickets) {
    const ahead = !(at(t) < now.getTime());
    (ahead ? upcoming : past).rows.push({
      key: t.id || t.registration_id,
      title: `${shortDay(t.starts_at)} · ${t.title || t.event_title}`,
      description: [fmtDate(t.starts_at, t.timezone), whereOf(t)].filter(Boolean).join(' · '),
      pill: ticketPill(t.reg_status, ahead),
      testid: 'events-phone-ticket',
    });
  }
  for (const ev of suggested || []) {
    upcoming.rows.push({
      key: `suggested-${ev.id}`,
      title: `${shortDay(ev.starts_at)} · ${ev.title}`,
      description: ev.suggestion_reason || whereOf(ev) || fmtDate(ev.starts_at, ev.timezone),
      pill: { label: 'RSVP', tone: 'info' },
      to: `/events/${ev.slug || ev.id}`,
      testid: 'events-phone-suggested',
    });
  }
  past.rows.reverse();
  if (!upcoming.rows.length) upcoming.note = 'No upcoming events.';
  if (!past.rows.length) past.note = 'No past events.';
  hosting.rows = events.hosting.map((ev) => ({
    key: ev.id,
    title: `${shortDay(ev.starts_at)} · ${ev.title}`,
    description: [String(ev.status || 'draft').replace(/_/g, ' '), ev.visibility].filter(Boolean).join(' · '),
    value: 'Manage',
    to: `/events/${ev.id}/manage`,
    testid: 'events-phone-hosted',
  }));
  if (!hosting.rows.length) hosting.note = "You're not hosting any events yet.";
  return [upcoming, past, hosting];
}

/** A7m — the bar and the sections, then `children`: the explainer and the tickets' check-in codes. */
export function EventsPhoneView({ events, suggested, now, children = null }) {
  return (
    <AccountPhonePage pageKey="events" testid="events-phone" groups={eventsPhoneGroups({ events, suggested, now })}>
      {children}
    </AccountPhonePage>
  );
}

/** `GET /events/suggested`, best-effort: the events, or null. */
function useSuggestedEvents() {
  const [data, setData] = useState(null); // { archetype, track, events }
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await eventsApi.suggested();
        if (alive) setData(res || null);
      } catch { if (alive) setData(null); }
    })();
    return () => { alive = false; };
  }, []);
  return data;
}

export default function MyEventsPage() {
  const [hosting, setHosting] = useState([]);
  const [attending, setAttending] = useState([]);
  const [loading, setLoading] = useState(true);
  // D332 — a failed read used to fall back to `[]` and render "not hosting
  // any events yet", which is the same screen a genuinely empty account
  // gets. The toast that told the truth disappears; this does not.
  const [loadError, setLoadError] = useState('');
  const { toast, showToast } = useToast();
  const { user } = useAuth();
  const location = useLocation();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await eventsApi.list();
      setHosting(Array.isArray(res?.hosting) ? res.hosting : (Array.isArray(res) ? res : []));
      setAttending(Array.isArray(res?.attending) ? res.attending : []);
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not load your events.' });
      setLoadError(e?.message || 'Could not load your events.');
      setHosting([]); setAttending([]);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);
  const suggested = useSuggestedEvents();
  const phone = usePhoneWidth();

  const toastEl = toast && (
    <div className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${
      toast.kind === 'error' ? 'bg-red-600' : 'bg-gray-900 dark:bg-gray-700'
    }`}>
      {toast.msg}
    </div>
  );

  if (phone) {
    const events = { status: loading ? 'loading' : loadError ? 'unreadable' : 'ready', hosting, attending, reload: load };
    const coded = attending.filter((t) => t.checkin_code || t.code || t.qr_code);
    return (
      <EventsPhoneView events={events} suggested={Array.isArray(suggested?.events) ? suggested.events : null}>
        <PageExplainer pageKey="my_events" />
        {events.status === 'ready' && coded.length > 0 && (
          <div>
            <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-gray-300">Check-in codes</h2>
            <AttendingList tickets={coded} />
          </div>
        )}
        {toastEl}
      </EventsPhoneView>
    );
  }

  const explorer = isExplorer(user);
  const tab = tabOf(location.pathname);
  const counts = tabCounts({ attending, hosting, ok: !loading && !loadError });
  const held = new Set(attending.map((t) => t.id));
  const tips = Array.isArray(suggested?.events) ? suggested.events : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6" data-testid="my-events">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{TITLE}</h1>
          <p className={`m-0 text-[13px] ${MUTED}`}>{LINE}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
          <Link className={LINK} to="/events">Public calendar</Link>
          <Link className={LINK} to="/calendar">My calendar</Link>
          {explorer ? null : (
            <Link to="/events/new" className="inline-flex items-center gap-2 rounded-[9px] bg-axal-violet px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep" data-testid="my-events-new">
              <Plus size={15} /> New event
            </Link>
          )}
        </div>
      </div>

      <PageExplainer pageKey="my_events" />

      {explorer ? (
        <p className="mt-3 rounded-[10px] border border-violet-200 bg-violet-50 px-3 py-2 text-[12.5px] text-axal-ink dark:border-violet-900 dark:bg-violet-950/30 dark:text-gray-100" data-testid="my-events-explorer-line">
          {EXPLORER_LINE} <Link className={LINK} to="/exploring">Set up your profile</Link>
        </p>
      ) : null}

      <nav aria-label="Events" className="mt-4 flex gap-1 overflow-x-auto border-b border-axal-hairline dark:border-gray-700" data-testid="my-events-tabs">
        {tabsFor(user).map((t) => {
          const n = counts[t.key];
          return (
            <Link key={t.key} to={tabHref(t)} aria-current={t.key === tab ? 'page' : undefined}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] ${t.key === tab
                ? 'border-axal-violet font-extrabold text-axal-ink dark:border-violet-400 dark:text-gray-100'
                : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
              data-testid={`my-events-tab-${t.key}`}>
              {t.label}{t.key === 'discover' ? '' : <span className="ml-1.5 font-mono text-[11px]">{n == null ? '—' : n}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="mt-4">
        {tab === 'discover' ? (
          <DiscoverTab held={held} suggested={tips} />
        ) : loading ? (
          <Reading />
        ) : loadError ? (
          <div className={`${CARD} p-5`} data-testid="my-events-unreadable">
            <Unreadable what="Your events" claim="That is not the same as having none." onRetry={load} />
          </div>
        ) : tab === 'hosting' && !explorer ? (
          <HostingTab hosting={hosting} admin={String(user?.role || '').toLowerCase() === 'admin'} />
        ) : tab === 'past' ? (
          <PastTab attending={attending} hosting={explorer ? [] : hosting} />
        ) : (
          <UpcomingTab attending={attending} hosting={explorer ? [] : hosting} suggested={tips} explorer={explorer} />
        )}
      </div>

      {toastEl}
    </div>
  );
}

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const TONES = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  warn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
  bad: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  muted: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};

function Pill({ tone = 'muted', children, testId }) {
  return <span className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${TONES[tone] || TONES.muted}`} data-testid={testId}>{children}</span>;
}

function Reading() {
  return <div className="h-28 w-full animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" aria-label="Reading…" data-testid="my-events-loading" />;
}

/** The 58px date tile: "NOV" over "14" over "THU". */
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

const viewerZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } };

function EventLine({ event, children }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <DateTile event={event} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className={`truncate text-[14px] font-extrabold ${INK}`}>{event.title || 'Not recorded'}</span>
        <span className={`text-[12px] ${MUTED}`}>{timeLine(event, viewerZone())}</span>
        <span className={`inline-flex items-center gap-1 text-[12px] ${MUTED}`}><MapPin size={12} /> {eventWhere(event)}</span>
        {children}
      </div>
    </div>
  );
}

function UpcomingTab({ attending, hosting, suggested, explorer }) {
  const { upcoming } = splitTickets(attending);
  const next = nextEvent(upcoming);
  const rest = upcoming.filter((t) => t !== next);
  const needs = needsYou(hosting);
  const soon = hostingSoon(hosting);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-3.5 lg:col-span-2">
        {needs.length ? (
          <section className={CARD} data-testid="my-events-needs">
            <h2 className={`m-0 border-b border-axal-hairline px-4 py-3 text-[15px] font-extrabold dark:border-gray-800 ${INK}`}>Needs you</h2>
            {needs.slice(0, 4).map((n) => (
              <div key={n.key} className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-ground px-4 py-2.5 last:border-b-0 dark:border-gray-800" data-testid="my-events-needs-row">
                <span className="flex items-center gap-2 text-[12.5px]"><Pill tone="bad">{n.pill}</Pill> <span className={INK}>{n.text}</span></span>
                <Link className={`${LINK} text-[12.5px]`} to={n.action.to}>{n.action.label}</Link>
              </div>
            ))}
          </section>
        ) : null}
        <section className={`${CARD} p-4`} data-testid="my-events-next">
          <h2 className={`m-0 mb-3 ${EYEBROW}`}>Your next event</h2>
          {next ? <NextEvent ticket={next} /> : (
            <p className={`m-0 text-[13px] ${MUTED}`} data-testid="my-events-nothing">Nothing coming up. <Link className={LINK} to={tabHref({ path: '/discover' })}>Find an event in Discover.</Link></p>
          )}
        </section>
        {rest.length ? (
          <section className={`${CARD} p-4`} data-testid="my-events-going">
            <h2 className={`m-0 mb-2 text-[15px] font-extrabold ${INK}`}>Going</h2>
            {goingGroups(rest).map((g) => (
              <div key={g.key} className="mt-2 flex flex-col gap-2">
                <span className={EYEBROW}>{g.label}</span>
                {g.rows.map((t) => {
                  const place = placeOf(t);
                  return (
                    <div key={t.id} className="flex flex-wrap items-center justify-between gap-2" data-testid="my-events-going-row">
                      <EventLine event={t}><Pill tone={place.tone}>{place.label}</Pill></EventLine>
                      <Link className={`${LINK} text-[12px]`} to={`/events/${t.id}`}>Open event page</Link>
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        ) : null}
        {!explorer && soon.length ? (
          <section className={`${CARD} p-4`} data-testid="my-events-hosting-soon">
            <h2 className={`m-0 mb-2 text-[15px] font-extrabold ${INK}`}>Hosting soon</h2>
            {soon.map((e) => {
              const st = statusOf(e);
              const act = hostAction(e);
              return (
                <div key={e.id} className="mt-2 flex flex-wrap items-center justify-between gap-2" data-testid="my-events-hosting-soon-row">
                  <EventLine event={e}><Pill tone={st.tone}>{st.label}</Pill></EventLine>
                  {act.label ? <Link className={`${LINK} text-[12px]`} to={act.to}>{act.label}</Link> : <span className={`text-[12px] ${MUTED}`}>{act.note}</span>}
                </div>
              );
            })}
            <p className={`m-0 mt-2 text-[11.5px] ${MUTED}`}>Seats, waitlist and approvals per event: {NOT_READ}.</p>
          </section>
        ) : null}
      </div>
      <div className="flex flex-col gap-3.5">
        <SuggestedCard events={suggested.slice(0, 3)} />
      </div>
    </div>
  );
}

function NextEvent({ ticket }) {
  const place = placeOf(ticket);
  const code = ticket.checkin_code || null;
  const online = ticket.location_kind !== 'in_person' && ticket.location_kind !== 'physical' && ticket.location_url;
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <EventLine event={ticket}>
        <span className="mt-1 flex flex-wrap items-center gap-2">
          <Pill tone={place.tone}>{place.label}</Pill>
          {ticket.comp ? <Pill tone="good">Free seat</Pill> : null}
        </span>
        <span className="mt-2 flex flex-wrap gap-3 text-[12.5px]">
          <a className={LINK} href={eventsApi.icsUrl(ticket.id)}>Download .ics</a>
          {online ? <a className={LINK} href={ticket.location_url} target="_blank" rel="noopener noreferrer">Join</a> : null}
          <Link className={LINK} to={`/events/${ticket.id}`}>Open event page</Link>
        </span>
      </EventLine>
      {code ? (
        <div className="flex flex-col items-center" data-testid="my-events-ticket">
          <EventQRCode value={code} size={120} />
          <span className="mt-1 font-mono text-[11px] text-axal-ink dark:text-gray-100">{code}</span>
          <span className={`text-[11px] ${MUTED}`}>Show this at the door.</span>
        </div>
      ) : (
        <p className={`m-0 w-[160px] text-[11.5px] ${MUTED}`} data-testid="my-events-no-code">The check-in code appears once your seat is confirmed and paid.</p>
      )}
    </div>
  );
}

function SuggestedCard({ events }) {
  return (
    <section className={`${CARD} p-4`} data-testid="my-events-suggested">
      <h2 className={`m-0 mb-2 text-[15px] font-extrabold ${INK}`}>Suggested for you</h2>
      {events.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`}>Nothing to suggest right now.</p> : events.map((ev) => (
        <Link key={ev.id} to={`/events/${ev.slug || ev.id}`} className="mt-2 flex flex-col gap-0.5 rounded-[10px] border border-axal-hairline p-2.5 hover:border-axal-violet dark:border-gray-700" data-testid="my-events-suggested-row">
          <span className={`text-[13px] font-bold ${INK}`}>{ev.title}</span>
          <span className={`text-[11.5px] ${MUTED}`}>{timeLine(ev, viewerZone())}</span>
          {ev.suggestion_reason ? <Pill tone="muted">{ev.suggestion_reason}</Pill> : null}
        </Link>
      ))}
      <Link className={`${LINK} mt-2 inline-block text-[12px]`} to={tabHref({ path: '/discover' })}>See all in Discover</Link>
    </section>
  );
}

function HostingTab({ hosting, admin }) {
  const [q, setQ] = useState('');
  const groups = hostingGroups(hosting, Date.now(), q);
  return (
    <div className="flex flex-col gap-3.5">
      {admin ? (
        <p className="m-0 rounded-[10px] border border-violet-200 bg-violet-50 px-3 py-2 text-[12.5px] text-axal-ink dark:border-violet-900 dark:bg-violet-950/30 dark:text-gray-100" data-testid="my-events-review-line">
          You also review members’ public events. <Link className={LINK} to="/admin/events/review">Open the review desk</Link>
        </p>
      ) : null}
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your events" aria-label="Search your events"
        className="w-full max-w-sm rounded-[7px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
      {hosting.length === 0 ? (
        <div className={`${CARD} flex flex-col items-start gap-2 p-5`} data-testid="my-events-hosting-none">
          <span className={`text-[13.5px] ${INK}`}>You’re not hosting anything yet. Host a workshop, office hours or a demo day for the people you work with.</span>
          <Link className={LINK} to="/events/new">New event</Link>
        </div>
      ) : groups.length === 0 ? (
        <p className={`m-0 text-[12.5px] ${MUTED}`}>No hosted event matches “{q}”.</p>
      ) : groups.map((g) => (
        <section key={g.key} className={CARD} data-testid={`my-events-group-${g.key}`}>
          <h2 className={`m-0 border-b border-axal-hairline px-4 py-3 text-[14px] font-extrabold dark:border-gray-800 ${INK}`}>{g.label} <span className={`font-mono text-[12px] ${MUTED}`}>{g.rows.length}</span></h2>
          {g.rows.map((e) => {
            const st = statusOf(e);
            const act = hostAction(e);
            return (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-ground px-4 py-3 last:border-b-0 dark:border-gray-800" data-testid="my-events-hosted-row">
                <EventLine event={e}>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-[12px]"><Pill tone={st.tone}>{st.label}</Pill><span className={MUTED}>{visibilityWord(e.visibility)}</span></span>
                </EventLine>
                <span className="flex flex-wrap items-center gap-3 text-[12px]">
                  {act.label ? <Link className={LINK} to={act.to} data-testid="my-events-host-action">{act.label}</Link> : act.note ? <span className={MUTED}>{act.note}</span> : null}
                  {e.status !== 'draft' && e.status !== 'rejected' ? <Link className={LINK} to={`/events/${e.id}/edit`}>Edit details</Link> : null}
                </span>
              </div>
            );
          })}
        </section>
      ))}
      {hosting.length ? <p className={`m-0 text-[11.5px] ${MUTED}`}>Seats, waitlist, approvals and open invitations per event: {NOT_READ}.</p> : null}
    </div>
  );
}

const PAGE = 25;

function DiscoverTab({ held, suggested }) {
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [read, setRead] = useState({ status: 'loading', events: [] });
  const [reload, setReload] = useState(0);
  const term = q.trim().length >= 2 ? q.trim() : '';
  useEffect(() => {
    let alive = true;
    setRead({ status: 'loading', events: [] });
    eventsPublic.list({ limit: PAGE, offset, q: term || undefined, from: new Date().toISOString() })
      .then((res) => { if (alive) setRead({ status: 'ready', events: Array.isArray(res?.events) ? res.events : [] }); })
      .catch(() => { if (alive) setRead({ status: 'error', events: [] }); });
    return () => { alive = false; };
  }, [term, offset, reload]);
  return (
    <div className="flex flex-col gap-3.5" data-testid="my-events-discover">
      {suggested.length ? (
        <section className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-4">
          {suggested.slice(0, 4).map((ev) => (
            <Link key={ev.id} to={`/events/${ev.slug || ev.id}`} className={`${CARD} flex flex-col gap-1 p-3 hover:border-axal-violet`} data-testid="my-events-discover-suggested">
              <span className={`text-[13px] font-bold ${INK}`}>{ev.title}</span>
              <span className={`text-[11.5px] ${MUTED}`}>{timeLine(ev, viewerZone())}</span>
              {ev.suggestion_reason ? <Pill tone="muted">{ev.suggestion_reason}</Pill> : null}
            </Link>
          ))}
        </section>
      ) : null}
      <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder="Search events" aria-label="Search events"
        className="w-full max-w-sm rounded-[7px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
      <section className={CARD}>
        {read.status === 'loading' ? <div className="p-4"><Reading /></div>
          : read.status === 'error' ? <div className="p-4" data-testid="my-events-discover-unreadable"><Unreadable what="The public calendar" claim="This is not a claim that nothing is on." onRetry={() => setReload((n) => n + 1)} /></div>
          : read.events.length === 0 ? <p className={`m-0 p-4 text-[12.5px] ${MUTED}`} data-testid="my-events-discover-none">{term ? `No upcoming event matches “${term}”.` : 'No upcoming events on the public calendar.'}</p>
          : read.events.map((ev) => {
            const act = discoverAction(ev, held);
            return (
              <div key={ev.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-ground px-4 py-3 last:border-b-0 dark:border-gray-800" data-testid="my-events-discover-row">
                <EventLine event={ev}><span className={`text-[12px] ${MUTED}`}>{priceOf(ev)}</span></EventLine>
                <Link className={`${LINK} text-[12px]`} to={act.to}>{act.label}</Link>
              </div>
            );
          })}
      </section>
      {read.status === 'ready' && (offset > 0 || read.events.length === PAGE) ? (
        <div className="flex items-center gap-3 text-[12px]" data-testid="my-events-discover-pages">
          <span className={`font-mono ${MUTED}`}>{offset + 1}–{offset + read.events.length}</span>
          {offset > 0 ? <button type="button" className={LINK} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button> : null}
          {read.events.length === PAGE ? <button type="button" className={LINK} onClick={() => setOffset(offset + PAGE)}>Next</button> : null}
        </div>
      ) : null}
    </div>
  );
}

function PastTab({ attending, hosting }) {
  const { past } = splitTickets(attending);
  const rows = pastRows(past, hosting);
  return (
    <div className="flex flex-col gap-3.5">
      <section className={CARD} data-testid="my-events-past">
        {rows.length === 0 ? <p className={`m-0 p-4 text-[12.5px] ${MUTED}`} data-testid="my-events-past-none">No past events yet.</p> : rows.map((r) => (
          <div key={r.key} className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-ground px-4 py-3 last:border-b-0 dark:border-gray-800" data-testid="my-events-past-row">
            <EventLine event={r.event}><Pill tone="muted">{r.result}</Pill></EventLine>
            <span className={`text-[11.5px] ${MUTED}`} title={REPLAY_LINE}>Replay: Not recorded</span>
          </div>
        ))}
      </section>
      <p className={`m-0 text-[11.5px] ${MUTED}`}>{REPLAY_LINE} Places you cancelled or the host declined: {NOT_READ}.</p>
    </div>
  );
}

function AttendingList({ tickets }) {
  if (!tickets.length) {
    return (
      <div className="py-12 text-center">
        <Ticket size={32} className="mx-auto text-gray-300 dark:text-gray-600" />
        <p className="mt-3 text-gray-500 dark:text-gray-400">You don't have any tickets yet.</p>
      </div>
    );
  }
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2">
      {tickets.map((t) => {
        const code = t.checkin_code || t.code || t.qr_code;
        return (
          <li key={t.id || t.registration_id} className="flex gap-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">{t.title || t.event_title}</h3>
              <div className="mt-1 space-y-1 text-sm text-gray-500 dark:text-gray-400">
                <div className="inline-flex items-center gap-1"><Calendar size={14} /> {fmtDate(t.starts_at, t.timezone)}</div>
                {(t.location_text || t.location_kind) && (
                  <div className="inline-flex items-center gap-1"><MapPin size={14} /> {t.location_text || t.location_kind}</div>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge status={t.reg_status} map={REG_STATUS_STYLES} />
                {t.comp ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    Free seat
                  </span>
                ) : null}
              </div>
            </div>
            {code ? (
              <div className="flex flex-col items-center">
                <EventQRCode value={code} size={120} />
                <span className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">Show at check-in</span>
              </div>
            ) : (
              <div className="flex w-[120px] items-center justify-center text-center text-[11px] text-gray-400 dark:text-gray-500">
                QR available once confirmed
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
