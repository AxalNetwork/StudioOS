// Task #40 (E2) — MyEventsPage. D1030 (#2387): on a desktop, the owner's "My
// events" canvas — Upcoming, Hosting, Discover and Past, each at its own
// address under /my/events, drawn from the reads that exist (myEventsModel.js).
// The phone keeps D700's A7m sections until D1030's phone part.
// D1035 (#2876): the ticket and hosted-event drawers open over their tab at
// /my/events/ticket/[id] and /my/events/hosting/[id] (MyEventsDrawers.jsx).
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Plus, Calendar, MapPin, Ticket } from 'lucide-react';
import { eventsApi } from '../../lib/eventsApi';
import { eventsPublic } from '../../lib/api';
import { adminEvents } from '../../lib/api';
import { eventTime } from './eventTime';
import { waitingWords } from './hostHeaderModel';
import { useAuth } from '../../hooks/useAuthSync';
import { useToast } from '../../components/useToast';
import PageExplainer from '../../components/PageExplainer';
import EventQRCode from '../../components/events/EventQRCode';
import { Lightbox, Unreadable } from '../../ui';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth';
import { AccountPhonePage, phonePending } from '../account/AccountPhonePage';
import { ACCOUNT_PHONE_PAGES } from '../account/accountPhone';
import {
  EXPLORER_LINE, LINE, TITLE,
  JOIN_LEAD_MS, joinState, seatSourceLabel, goingGroups, hostAction, hostingSoon, isExplorer, nextEvent,
  placeOf, splitTickets, statusOf, tabHref, tabOf, tabsFor, timeLine,
} from './myEventsModel';
import { MY_EVENTS_OPEN_TO_EXPLORERS, drawerOf, hostedPath, tabUnder, ticketPath } from './eventDrawersModel';
import { ExplorerClosedCard, HostedDrawer, PublishDialog, TicketDrawer } from './MyEventsDrawers';
import { EMPTY, HOST_DEFAULTS, calendarItems, monthOf, needsYouRows, onDay, tabCountsFull } from './myEventsTabsModel';
import {
  AddToCalendar, CARD, DiscoverTabFull, EmptyCard, EventLine, HostCountsLine, HostingList, InvitationDialog, MiniCalendar, MonthView, NeedsYouCard,
  PastTabFull, Pill, RowMenu, Segmented, Skeleton, SubscribeCard, SubscribeDialog, placeMenu,
} from './MyEventsTabs';

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

/** D1131: suggestions fail as their own block and can be retried. */
function useSuggestedEvents() {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', data: null });
    Promise.resolve().then(() => eventsApi.suggested())
      .then(data => { if (alive) setState({ status: 'ready', data }); })
      .catch(() => { if (alive) setState({ status: 'error', data: null }); });
    return () => { alive = false; };
  }, [revision]);
  return { ...state, reload: () => setRevision(n => n + 1) };
}

export default function MyEventsPage() {
  const [hosting, setHosting] = useState([]);
  const [attending, setAttending] = useState([]);
  const [past, setPast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const nextOpen = attending.map(t => eventTime(t.starts_at)).filter(t => t != null).map(t => t - JOIN_LEAD_MS).filter(t => t > now);
    const delay = Math.max(1, Math.min(60_000, ...nextOpen.map(t => t - Date.now())));
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [now, attending]);
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
      // D1034: Past reads 100 places at a time (D1032's ceiling), so its chart and years count what is there.
      const res = await eventsApi.list({ pastLimit: PAST_READ });
      setHosting(Array.isArray(res?.hosting) ? res.hosting : (Array.isArray(res) ? res : []));
      setAttending(Array.isArray(res?.attending) ? res.attending : []);
      setPast(res?.past && Array.isArray(res.past.places) ? res.past : null);
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not load your events.' });
      setLoadError(e?.message || 'Could not load your events.');
      setHosting([]); setAttending([]); setPast(null);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);
  const suggested = useSuggestedEvents();
  // D1034: my pending invitations (D1032) and whether Subscribe is set up (D1033), each its own read.
  const invitations = useOwnRead(() => eventsApi.invitations());
  const feed = useOwnRead(() => eventsApi.feedStatus());
  const phone = usePhoneWidth();
  const navigate = useNavigate();
  const [answer, setAnswer] = useState(null);
  const [subscribing, setSubscribing] = useState(false);
  const [older, setOlder] = useState(null);
  const api = {
    publicList: (p) => eventsPublic.list(p),
    eligibility: (id) => eventsApi.eligibility(id),
    register: (id) => eventsApi.register(id),
    answerInvitation: (id, action) => eventsApi.answerInvitation(id, action),
    calendarLinks: (id) => eventsApi.calendarLinks(id),
    makeFeed: () => eventsApi.makeFeed(),
    removeFeed: () => eventsApi.removeFeed(),
  };
  const changed = (line) => { load(); invitations.reload(); showToast({ kind: 'ok', msg: line }); };
  const readOlder = async () => {
    if (!past) { load(); return; }
    setOlder('loading');
    try {
      const res = await eventsApi.list({ pastLimit: PAST_READ, pastOffset: past.places.length });
      const more = Array.isArray(res?.past?.places) ? res.past.places : [];
      setPast({ ...past, places: [...past.places, ...more], total: res?.past?.total ?? past.total });
      setOlder(null);
    } catch { setOlder('error'); }
  };

  // D1035: the drawer the address names, over the tab it opens from. Closing
  // goes back to that tab; a change made inside closes it, re-reads the list
  // and says what happened.
  const drawer = drawerOf(location.pathname);
  const list = { status: loading ? 'loading' : loadError ? 'error' : 'ready', data: { hosting, attending, past }, reload: load };
  const closeDrawer = () => navigate(tabHref({ path: tabUnder(drawer) === 'hosting' ? '/hosting' : '' }));
  const doneDrawer = (line) => { closeDrawer(); load(); showToast({ kind: 'ok', msg: line }); };
  const drawerEl = drawer?.kind === 'ticket'
    ? <TicketDrawer key={`t-${drawer.id}`} id={drawer.id} list={list} onClose={closeDrawer} onDone={doneDrawer} />
    : drawer?.kind === 'hosted'
      ? <HostedDrawer key={`h-${drawer.id}`} id={drawer.id} list={list} user={user} onClose={closeDrawer} onDone={doneDrawer} />
      : null;

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
      <EventsPhoneView events={events} suggested={Array.isArray(suggested.data?.events) ? suggested.data.events : null}>
        <PageExplainer pageKey="my_events" />
        {drawerEl}
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
  // MEV17b: only if the owner closes My events to Explorers (D1030 opened it to them).
  if (explorer && !MY_EVENTS_OPEN_TO_EXPLORERS) return <ExplorerClosedCard />;
  const tab = tabOf(location.pathname);
  const counts = tabCountsFull({ attending, hosting: explorer ? [] : hosting, past, ok: !loadError, loading });
  const held = new Set(attending.map((t) => t.id));
  const tips = Array.isArray(suggested.data?.events) ? suggested.data.events : [];
  const invites = invitations.status === 'ready' && Array.isArray(invitations.data?.invitations) ? invitations.data.invitations : [];

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
          const c = counts[t.key];
          return (
            <Link key={t.key} to={tabHref(t)} aria-current={t.key === tab ? 'page' : undefined}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] ${t.key === tab
                ? 'border-axal-violet font-extrabold text-axal-ink dark:border-violet-400 dark:text-gray-100'
                : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
              data-testid={`my-events-tab-${t.key}`}>
              {t.label}{t.key === 'discover' || !c ? '' : (
                <span className="ml-1.5 font-mono text-[11px]" title={c.why || undefined} data-testid={`my-events-count-${t.key}`}>
                  {c.value == null ? '—' : c.value}{c.why && c.value == null ? <span className="sr-only"> ({c.why})</span> : null}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-4">
        {tab === 'discover' ? (
          <DiscoverTabFull api={api} held={held} invitations={invites} suggested={tips} suggestionsRead={suggested} now={now}
            onRegistered={changed} onAccept={(inv) => setAnswer({ invitation: inv, action: 'accept' })} />
        ) : loading ? (
          <Reading />
        ) : loadError ? (
          <div className={`${CARD} p-5`} data-testid="my-events-unreadable">
            <Unreadable what="Your events" claim="That is not the same as having none." onRetry={load} />
          </div>
        ) : tab === 'hosting' && !explorer ? (
          <HostingTab hosting={hosting} now={now} admin={String(user?.role || '').toLowerCase() === 'admin'} onDone={(line) => { load(); showToast({ kind: 'ok', msg: line }); }}
            onCopy={(path) => copyLink(path, showToast)} onCancel={(e) => navigate(hostedPath(e.id))} />
        ) : tab === 'past' ? (
          <PastTabFull past={past} hosting={explorer ? [] : hosting} now={now} onOlder={readOlder} older={older} onRetry={load} />
        ) : (
          <UpcomingTab attending={attending} hosting={explorer ? [] : hosting} invitations={invites} invitationsRead={invitations} feed={feed}
            suggested={tips} suggestionsRead={suggested} explorer={explorer} now={now} api={api}
            onAnswer={(inv, action) => setAnswer({ invitation: inv, action })} onSubscribe={() => setSubscribing(true)}
            onPick={(t, it) => (it.key === 'ticket' || it.key === 'cancel' ? navigate(ticketPath(t.id)) : null)} />
        )}
      </div>

      {answer ? <InvitationDialog answer={answer} api={api} onClose={() => setAnswer(null)} onDone={(line) => { setAnswer(null); changed(line); }} /> : null}
      {subscribing ? <SubscribeDialog read={feed} api={api} onClose={() => setSubscribing(false)} onChanged={feed.reload} /> : null}
      {drawerEl}
      {toastEl}
    </div>
  );
}

/** D1034: Past reads this many places at a time, D1032's ceiling. */
const PAST_READ = 100;

/** A read of its own, with a retry: a failed one never blanks the page. */
function useOwnRead(fn) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', data: null });
    Promise.resolve().then(fn)
      .then(data => { if (alive) setState({ status: 'ready', data }); })
      .catch(() => { if (alive) setState({ status: 'error', data: null }); });
    return () => { alive = false; };
  }, [revision]);
  return { ...state, reload: () => setRevision(n => n + 1) };
}

/** Copy link: the event's public address, through the clipboard; a refused copy says so. */
function copyLink(path, showToast) {
  const url = `${typeof window !== 'undefined' && window.location ? window.location.origin : ''}${path}`;
  Promise.resolve().then(() => navigator.clipboard.writeText(url))
    .then(() => showToast({ kind: 'ok', msg: 'The event’s link is copied.' }))
    .catch(() => showToast({ kind: 'error', msg: `The link could not be copied. It is ${url}` }));
}

const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const INK = 'text-axal-ink dark:text-gray-100';
const viewerZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } };

/** MEV15: the tab while its read is out, as the canvas's grey bars. */
function Reading() {
  return (
    <div className="grid gap-4 lg:grid-cols-3" aria-label="Reading…" data-testid="my-events-loading">
      <div className="flex flex-col gap-3.5 lg:col-span-2"><Skeleton lines={3} /><Skeleton lines={5} /></div>
      <div className="flex flex-col gap-3.5"><Skeleton lines={5} /><Skeleton lines={3} /></div>
    </div>
  );
}

function UpcomingTab({ attending, hosting, invitations, invitationsRead, feed, suggested, suggestionsRead, explorer, now, api, onAnswer, onSubscribe, onPick }) {
  const zone = viewerZone();
  const { upcoming } = splitTickets(attending, now);
  const next = nextEvent(upcoming);
  const [chosen, setChosen] = useState(null);
  const [monthPick, setMonthPick] = useState(null);
  const [view, setView] = useState('List');
  const [adding, setAdding] = useState(null);
  const month = monthPick || monthOf(now, zone);
  const rest = onDay(upcoming.filter((t) => t !== next), chosen, zone);
  const needs = needsYouRows({ hosting, attending, invitations, now });
  const soon = hostingSoon(hosting, now);
  const items = calendarItems({ upcoming, hosting, invitations, now });
  const toggle = <Segmented options={['List', 'Month']} value={view} onChange={setView} label="Show as" testId="my-events-going-view" />;
  const pick = (t, it) => (it.key === 'calendar' ? setAdding(t) : onPick(t, it));
  if (view === 'Month') {
    return (
      <div className="flex flex-col gap-3.5">
        <NeedsYouCard needs={needs} onAnswer={onAnswer} />
        <MonthView month={month} setMonth={setMonthPick} items={explorer ? items.filter((x) => x.kind !== 'hosting') : items} now={now} zone={zone} api={api} onSubscribe={onSubscribe} toggle={toggle} />
      </div>
    );
  }
  const nothing = !upcoming.length && !soon.length && !needs.rows.length;
  return (
    <div className="flex flex-col gap-3.5">
      <NeedsYouCard needs={needs} onAnswer={onAnswer} />
      {invitationsRead.status === 'error' ? (
        <div className={`${CARD} p-3`} data-testid="my-events-invitations-unreadable"><Unreadable what="Your invitations" claim="This is not a claim that you have none." onRetry={invitationsRead.reload} /></div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-3.5 lg:col-span-2">
          {nothing ? <EmptyCard copy={EMPTY.upcoming} to={tabHref({ path: '/discover' })} testId="my-events-nothing" /> : (
            <section className={`${CARD} p-4`} data-testid="my-events-next">
              <h2 className={`m-0 mb-3 ${EYEBROW}`}>Your next event</h2>
              {next ? <NextEvent ticket={next} now={now} /> : (
                <p className={`m-0 text-[13px] ${MUTED}`}>Nothing coming up. <Link className={LINK} to={tabHref({ path: '/discover' })}>Find an event in Discover.</Link></p>
              )}
            </section>
          )}
          {upcoming.length > (next ? 1 : 0) ? (
            <section className={`${CARD} p-4`} data-testid="my-events-going">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className={`m-0 text-[15px] font-extrabold ${INK}`}>Going</h2>
                {toggle}
              </div>
              {rest.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="my-events-going-day-none">Nothing else on that day.</p> : goingGroups(rest, now).map((g) => (
                <div key={g.key} className="mt-2 flex flex-col gap-2">
                  <span className={EYEBROW}>{g.label}</span>
                  {g.rows.map((t) => {
                    const place = placeOf(t);
                    return (
                      <div key={t.id} className="flex flex-wrap items-center justify-between gap-2" data-testid="my-events-going-row">
                        <EventLine event={t}><Pill tone={place.tone}>{place.label}</Pill></EventLine>
                        <span className="flex items-center gap-2">
                          <Link className={`${LINK} text-[12px]`} to={ticketPath(t.id)} data-testid="my-events-show-ticket">Show ticket</Link>
                          <RowMenu label={`Actions for ${t.title || 'this event'}`} items={placeMenu(t)} onPick={(it) => pick(t, it)} testId="my-events-place-menu" />
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </section>
          ) : null}
          {!explorer && soon.length ? (
            <section className={`${CARD} p-4`} data-testid="my-events-hosting-soon">
              <h2 className={`m-0 mb-2 flex items-center justify-between text-[15px] font-extrabold ${INK}`}>Hosting soon <span className={`font-mono text-[11.5px] font-bold ${MUTED}`}>{soon.length} of {hosting.length}</span></h2>
              {soon.map((e) => {
                const st = statusOf(e);
                const act = hostAction(e, now);
                return (
                  <div key={e.id} className="mt-2 flex flex-wrap items-center justify-between gap-2" data-testid="my-events-hosting-soon-row">
                    <EventLine event={e} to={hostedPath(e.id)}>
                      <Pill tone={st.tone}>{st.label}</Pill>
                      {e.status === 'published' || e.status === 'pending_review' ? <HostCountsLine event={e} /> : null}
                    </EventLine>
                    {act.to ? <Link className={`${LINK} text-[12px]`} to={act.to}>{act.label}</Link>
                      : act.dialog ? <Link className={`${LINK} text-[12px]`} to={hostedPath(e.id)}>{act.label}</Link>
                        : <span className={`text-[12px] ${MUTED}`}>{act.note}</span>}
                  </div>
                );
              })}
              <Link className={`${LINK} mt-2 inline-block text-[12px]`} to={tabHref({ path: '/hosting' })} data-testid="my-events-open-hosting">Open Hosting</Link>
            </section>
          ) : null}
        </div>
        <div className="flex flex-col gap-3.5">
          <MiniCalendar month={month} setMonth={setMonthPick} items={items} chosen={chosen} onChoose={setChosen} explorer={explorer} now={now} zone={zone} />
          <SubscribeCard read={feed} onOpen={onSubscribe} />
          <SuggestedCard events={suggested.slice(0, 3)} read={suggestionsRead} explorer={explorer} />
        </div>
      </div>
      {adding ? (
        <Lightbox label={`Add ${adding.title || 'this event'} to your calendar`} title={adding.title || 'Not recorded'} sub={timeLine(adding, zone)} onClose={() => setAdding(null)} width={420} testId="my-events-add-calendar-dialog">
          <div className="px-5 py-4"><AddToCalendar id={adding.id} api={api} onSubscribe={() => { setAdding(null); onSubscribe(); }} /></div>
        </Lightbox>
      ) : null}
    </div>
  );
}

function NextEvent({ ticket, now }) {
  const place = placeOf(ticket);
  const code = ticket.checkin_code || null;
  const online = ['virtual', 'online', 'hybrid'].includes(ticket.location_kind);
  const join = joinState(ticket, now);
  const seat = seatSourceLabel(ticket);
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <EventLine event={ticket}>
        <span className="mt-1 flex flex-wrap items-center gap-2">
          <Pill tone={place.tone}>{place.label}</Pill>
          {seat ? <Pill tone="good" testId="my-events-seat-source">{seat}</Pill> : null}
          {ticket.is_speaker ? <Pill testId="my-events-presenting">You’re presenting</Pill> : null}
        </span>
        <span className="mt-2 flex flex-wrap gap-3 text-[12.5px]">
          <Link className={LINK} to={ticketPath(ticket.id)} data-testid="my-events-next-ticket">Show ticket</Link>
          <a className={LINK} href={eventsApi.icsUrl(ticket.id)}>Download .ics</a>
          {online ? join.available ? <a className={LINK} href={ticket.location_url} target="_blank" rel="noopener noreferrer" data-testid="my-events-join">Join</a> : <button type="button" disabled className={MUTED} data-testid="my-events-join-quiet">Join</button> : null}
          <Link className={LINK} to={`/events/${ticket.id}`}>Open event page</Link>
        </span>
        {online && join.note ? <span className={`mt-1 text-[11.5px] ${MUTED}`} data-testid="my-events-join-note">{join.note}</span> : null}
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

function SuggestedCard({ events, read, explorer = false }) {
  return (
    <section className={`${CARD} p-4`} data-testid="my-events-suggested">
      <h2 className={`m-0 mb-2 text-[15px] font-extrabold ${INK}`}>Suggested for you</h2>
      {read?.status === 'loading' ? <Skeleton lines={3} testId="my-events-suggested-loading" /> : read?.status === 'error' ? <Unreadable what="Suggested events" claim="This is not a claim that none are available." onRetry={read.reload} /> : events.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`}>Nothing to suggest right now.</p> : events.map(ev => {
        const closed = ev.registration_eligible === false;
        const unknown = typeof ev.registration_eligible !== 'boolean';
        return <div key={ev.id} className="mt-2 flex flex-col gap-0.5 rounded-[10px] border border-axal-hairline p-2.5 dark:border-gray-700" data-testid="my-events-suggested-row">
          <Link to={`/events/${ev.slug || ev.id}`} className={`text-[13px] font-bold ${INK}`}>{ev.title}</Link>
          <span className={`text-[11.5px] ${MUTED}`}>{timeLine(ev, viewerZone())}</span>
          {ev.suggestion_reason ? <Pill tone="muted">{ev.suggestion_reason}</Pill> : null}
          {closed ? <><span className={`text-[12px] font-bold ${MUTED}`} data-testid="my-events-suggested-closed">{explorer ? 'Not open to Explorers' : 'Not open to your profile'}</span><span className={`text-[11.5px] ${MUTED}`}>The host opened this event to selected profiles.</span></> : unknown ? <span className={`text-[12px] ${MUTED}`}>Eligibility not recorded</span> : <Link className={`${LINK} text-[12px]`} to={`/events/${ev.slug || ev.id}`} data-testid="my-events-suggested-register">Register</Link>}
        </div>;
      })}
      <Link className={`${LINK} mt-2 inline-block text-[12px]`} to={tabHref({ path: '/discover' })}>See all in Discover</Link>
    </section>
  );
}

function HostingTab({ hosting, admin, now, onDone, onCopy, onCancel }) {
  const [f, setF] = useState(HOST_DEFAULTS);
  // D1035: a draft's Send for review or Publish opens MEV6's dialog here, without the drawer.
  const [publishing, setPublishing] = useState(null);
  // D1036 (MEV13): the review desk's waiting count, its own read; a failed read is said, never a 0.
  const [waiting, setWaiting] = useState(admin ? { state: 'loading' } : null);
  useEffect(() => {
    if (!admin) return undefined;
    let live = true;
    Promise.resolve().then(() => adminEvents.list({ status: 'pending_review', limit: 1 }))
      .then((reply) => { if (live) setWaiting({ state: 'ready', words: waitingWords(reply) }); })
      .catch(() => { if (live) setWaiting({ state: 'unreadable' }); });
    return () => { live = false; };
  }, [admin]);
  return (
    <div className="flex flex-col gap-3.5">
      {admin ? (
        <p className="m-0 rounded-[10px] border border-violet-200 bg-violet-50 px-3 py-2 text-[12.5px] text-axal-ink dark:border-violet-900 dark:bg-violet-950/30 dark:text-gray-100" data-testid="my-events-review-line">
          You also review members’ public events.{' '}
          {waiting?.state === 'ready' && waiting.words ? <span data-testid="my-events-review-waiting">{waiting.words} </span> : null}
          {waiting?.state === 'unreadable' || (waiting?.state === 'ready' && !waiting.words) ? <span className={MUTED} data-testid="my-events-review-waiting">The waiting count could not be read. </span> : null}
          <Link className={LINK} to="/admin/events/review">Open the review desk</Link>
        </p>
      ) : null}
      {hosting.length === 0
        ? <EmptyCard copy={EMPTY.hosting} to="/events/new" glyph="+" testId="my-events-hosting-none" />
        : <HostingList hosting={hosting} now={now} f={f} setF={setF} onPublish={setPublishing} onCopy={onCopy} onCancel={onCancel} />}
      {publishing ? <PublishDialog event={publishing} counts={publishing.counts} onClose={() => setPublishing(null)} onDone={(line) => { setPublishing(null); onDone(line); }} /> : null}
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
