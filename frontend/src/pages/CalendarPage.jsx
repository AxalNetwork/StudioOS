/**
 * `/calendar` — `design/incoming/Calendar.dc.html`, boards C1–C6.
 *
 * SIX BOARDS, ONE PAGE. C1–C6 are states of this file, not six per-profile
 * designs: populated light, populated dark, one kind filtered with the IC
 * control gated off, an empty range, no provider connected, and a degraded
 * source alongside a failed provider. The only role variation the canvas draws
 * is whether the viewer may create an IC meeting, and it matches
 * `canScheduleIc` in `routes/calendar.ts` word for word (`admin || investor`).
 *
 * ONE KIND TABLE. `KINDS` below is the single source of truth for the filter
 * chips, the rail's legend and every event's dot. It used to be three
 * hardcoded lists — `KIND_LABEL`, `KIND_COLOR` and a literal filter array —
 * and they had drifted: `partner_office_hour` was in two of the three, so
 * office hours were reachable only under "All" and no chip could ever select
 * them. `frontend/test/calendar_page_c1.test.mjs` now compares this table
 * against the `CalendarEvent` union the worker can actually emit, so a seventh
 * kind cannot be added without a chip.
 *
 * SIX KINDS, NOT THE CANVAS'S FIVE. The canvas omits `expert_booking` on the
 * stated grounds that it is "in the type union and produced by nothing". It IS
 * produced — `services/wellbeing/bookings.ts` mirrors every confirmed wellbeing
 * booking — but the write named four columns `calendar_events` did not have, so
 * the row never arrived. Migration 235 and the fixes shipped with this page
 * make those rows real, so the kind gets a chip, a legend row and a dot. Its
 * mark is derived in the canvas's own idiom: a distinct shape first
 * (`0 50% 0 50%`, a lens, against circle / square / pill / hard square /
 * teardrop) and one low-saturation hue second (`#be123c`, lifting to `#fda4af`
 * on a dark ground), chosen to sit apart from the five drawn hues and from the
 * violet accent.
 *
 * EVERY COUNT COMES FROM ONE LIST. The All chip, each kind chip and each day
 * group are all derived from `inRange` — the single fetched list — so a chip
 * can never advertise events the agenda cannot show. That is this codebase's
 * repeat failure: `/pipeline/negotiations` shipped an inert chip row, and a
 * Retainers chip once narrowed a different list from the tile above it. The
 * All chip counts the UNFILTERED list on purpose: it says what clicking it
 * would show, not what is showing now.
 *
 * PUSH IS DRAWN ONLY WHERE IT WORKS, which is the one place this page departs
 * from the canvas on purpose. `PUSHABLE_KINDS` in `routes/calendar.ts` is four
 * kinds; the canvas draws a push control on a Calendly event, which that route
 * refuses with a 400. A control that would be refused is not drawn — the same
 * rule the canvas applies to the IC gate — and the reason is stated in its
 * place.
 *
 * ABSENT IS NOT EMPTY. No bare dash and no plausible zero anywhere: a fact the
 * reader's own record does not carry renders as "Not recorded" with the reason
 * it is missing. And the three ways this page can have nothing to show are kept
 * apart, because they mean different things — an empty range (every source
 * answered and returned nothing, so the calendar is working), a degraded source
 * (some sources answered; the banner names which did not and its chip count is
 * disclosed as stale), and a failed request (nothing answered at all).
 *
 * EIGHT KINDS SINCE D1033 (#2874). A member's event tickets (`event_ticket`,
 * one per registration) and the events they host (`event_hosted`) come from
 * `services/calendar/myEvents.ts`. The canvas predates them, so their marks are
 * derived as `expert_booking`'s was: two shapes no other kind uses (a dome and
 * a bowl) and two hues apart from the drawn six and the violet accent — sky for
 * hosting, as the My events canvas draws it (MEV1), and lime for a ticket. A
 * ticket's place ("Waitlist · #3", "Pay to confirm") is in its title and notes,
 * and its join link is present only when the Worker gave it (#2623).
 *
 * NINE SINCE D1190 (#3124). A founder's meeting or call with an investor,
 * logged with a start in Capital relationships (`investor_meeting`,
 * `services/calendar/investorMeetings.ts`), in the same idiom: a shape no other
 * kind uses (a leaf, round but for its top right) and emerald, the Meetings
 * family's colour in #2420's Calendar canvas. It invites nobody and carries no
 * place, so its row is its title and its note.
 *
 * A PUSH RECORD SURVIVES A DISCONNECT, which is the third and smallest place
 * this page departs from the canvas. The canvas suppresses its "Pushed to …"
 * pill when no provider was ever connected, reasoning that such a record could
 * not exist. Here it can and does: `pushed_to` is read from
 * `calendar_sync_records`, so the pill states a fact rather than inferring one
 * — and a reader who disconnected Google still has that copy sitting on their
 * Google calendar, which is exactly what the disconnect prompt tells them
 * ("Already-pushed events stay on Google"). Hiding it would be the dishonest
 * reading.
 *
 * WHAT IS NOT DRAWN, AND WHY. A provider-level sync failure is not persisted
 * anywhere: `google_oauth_tokens` / `microsoft_oauth_tokens` carry
 * `last_synced_at` and no error column, and `calendar_sync_records.last_error`
 * records a refused CANCEL, not a refused sync. So the "Sync failed" state
 * below is reached only from a sync or connect this reader just ran — a cold
 * page load after last night's sync failed still reads "Connected". Stated
 * rather than invented.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { safeReadJSON } from '../lib/storage';
import { AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import PageExplainer from '../components/PageExplainer';
import { usePhoneWidth } from '../ui';
import { AccountPhonePage, phonePending } from './account/AccountPhonePage';
import { ACCOUNT_PHONE_PAGES } from './account/accountPhone';
import { NOT_YET, VIEWS, WAITS, chipCount, viewOf, windowFor } from './calendarViews';
import CalendarItemDrawer, { CancelDialog } from './CalendarItemDrawer';
import { NewCheckinDialog, NewIcDialog, NewMenu } from './CalendarNewDialogs';
import { NewComplianceDialog } from './CalendarComplianceSheet';
import { COMPLIANCE_KIND, stateLine, stateOf } from './calendarComplianceModel';
import { itemOf, itemPath } from './calendarItemModel';
import { DayPopover, KindsPanel, MonthGrid, WeekGrid } from './CalendarGrids';
import AgentSessionSheet, { ScheduleAgentSheet } from './CalendarAgentSessions';
import { AGENT_KIND } from './calendarAgentModel';
import AskButton from './team/AskButton.jsx';
import { ConnectedPanel, ConnectedSummary, GooglePanel, SubscribeDialog } from './CalendarConnected';
import { CONNECTED_PATH, connectedOf, stripLabel, weekStrip } from './calendarConnectedModel';
import {
  anchorOf, familiesFor, kindsFrom, kindsOfFamilies, needsFrom, needsMe, shiftAnchor, withDate, withKinds, withNeeds,
} from './calendarGrid';
import './calendarPage.css';

/**
 * The six kinds, in the canvas's reading order. `from` is the module the events
 * come from, which is what the rail's legend shows — a reader who wonders why
 * something is or is not here can see where each row originates. D1613 (#3723):
 * it names the module in plain words. It used to print the D1 table each kind
 * is read from (`ic_meetings`, `raise_prospect_events`), and the page never
 * shows a table name.
 * D1384 (#3692): `compliance_due` is the Compliance layer, which replaced the
 * /compliance page; the canvas draws no deadline kind, so its mark is derived
 * in the same idiom as the others (calendarPage.css).
 */
const KINDS = [
  { id: 'ic_meeting', label: 'IC meeting', from: 'Deal room' },
  { id: 'founder_checkin', label: 'Check-in', from: 'Check-ins' },
  { id: 'advisor_booking', label: 'Advisor', from: 'Advisors' },
  { id: 'partner_office_hour', label: 'Office hour', from: 'Office hours' },
  { id: 'calendly_event', label: 'Calendly', from: 'Calendly' },
  { id: 'expert_booking', label: 'Expert session', from: 'Wellbeing' },
  { id: 'event_ticket', label: 'Event ticket', from: 'Events · your tickets' },
  { id: 'event_hosted', label: 'Hosting', from: 'Events · you host' },
  { id: 'investor_meeting', label: 'Investor meeting', from: 'Raise › Capital relationships' },
  { id: 'compliance_due', label: 'Compliance', from: 'Compliance' },
  // #3959: the Learning source.
  { id: 'learning', label: 'Learning', from: 'Learning · your plan' },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.id, k.label]));

/**
 * Mirrors `PUSHABLE_KINDS` in `cloudflare-worker/src/routes/calendar.ts`. The
 * two lists are asserted equal by `frontend/test/calendar_page_c1.test.mjs`,
 * because the whole point of drawing the control conditionally is that the
 * condition is the route's.
 */
const PUSHABLE_KINDS = new Set([
  'advisor_booking', 'ic_meeting', 'founder_checkin', 'partner_office_hour',
  'event_ticket', 'event_hosted',
]);

const PROVIDER_LABEL = { google: 'Google', microsoft: 'Outlook' };

// RSVP values the worker accepts, with the words a person uses for them.
const RSVP_CHOICES = [['accepted', 'Yes'], ['tentative', 'Maybe'], ['declined', 'No']];
const RSVP_WORD = { accepted: 'yes', declined: 'no', tentative: 'maybe', invited: 'not yet' };

const DAY_MS = 86_400_000;

/** The label beside the segment. `to` is exclusive, so the last day is to-1. */
function rangeLabel(mode, from, to) {
  if (mode === 'month') return from.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const last = new Date(to.getTime() - DAY_MS);
  const sameMonth = from.getFullYear() === last.getFullYear() && from.getMonth() === last.getMonth();
  const a = from.toLocaleDateString(undefined, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
  const b = last.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${a} – ${b}`;
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "45m", "1h", "1h 30m" — or null when the record has no end. */
function fmtDuration(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const mins = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000);
  if (!Number.isFinite(mins) || mins <= 0) return null;
  if (mins < 120) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function relativeDay(date, today) {
  const days = Math.round((date.getTime() - today.getTime()) / DAY_MS);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/**
 * The host word for a meeting link, derived from the URI rather than assumed.
 * A link this page cannot name is still shown as a link — it just says
 * "Video" without claiming which service it is.
 *
 * EXACT HOST, OR A REAL SUBDOMAIN OF IT. This was four `endsWith` checks, and
 * `endsWith('meet.google.com')` is also true of `evilmeet.google.com` —
 * CodeQL's "incomplete URL substring sanitization", and correct. The label is
 * cosmetic, so the reachable harm was small, but a name printed beside a link
 * is exactly the thing a reader trusts, and the right comparison costs
 * nothing. `us02web.zoom.us` is why the subdomain arm exists at all.
 */
const MEETING_HOSTS = [
  ['meet.google.com', 'Meet'],
  ['zoom.us', 'Zoom'],
  ['teams.microsoft.com', 'Teams'],
  ['whereby.com', 'Whereby'],
];
function hostWord(uri) {
  try {
    const h = new URL(uri).hostname.toLowerCase();
    for (const [host, word] of MEETING_HOSTS) {
      if (h === host || h.endsWith(`.${host}`)) return word;
    }
    return null;
  } catch { return null; }
}

/**
 * Where an event happens, or why the page cannot say. `location_kind` and
 * `location_uri` are both nullable on every kind, and Calendly in particular
 * returns bookings with neither — which is worth spelling out, because an
 * unlabelled Calendly booking is NOT a video call by default.
 */
function locationOf(ev) {
  const kind = ev.location_kind ? String(ev.location_kind) : null;
  if (!kind && !ev.location_uri) {
    return {
      text: 'Location',
      missing: true,
      why: ev.kind === 'calendly_event'
        ? 'Calendly did not return a location for this booking. It is not a video call by default — check the invitation.'
        : 'No location was recorded when this was scheduled.',
    };
  }
  const word = kind === 'video' ? 'Video' : kind === 'room' ? 'Room' : kind === 'hybrid' ? 'Hybrid' : kind ? kind : 'Video';
  // D1033: an event's venue words, when the Worker sends them, come before the link's host.
  const host = ev.place || (ev.location_uri ? hostWord(ev.location_uri) : null);
  return { text: host ? `${word} · ${host}` : word, missing: false, why: null, uri: ev.location_uri || null };
}

/** "RSVP 4 of 5 · you: yes" — only for a meeting that actually has attendees. */
function rsvpLine(ev, myEmail) {
  const rows = Array.isArray(ev.attendees) ? ev.attendees : [];
  if (!rows.length) return null;
  const yes = rows.filter((a) => a.rsvp === 'accepted').length;
  const mine = myEmail
    ? rows.find((a) => String(a.email || '').toLowerCase() === myEmail)
    : null;
  const you = mine ? (RSVP_WORD[mine.rsvp] || 'not yet') : null;
  return `RSVP ${yes} of ${rows.length}${you ? ` · you: ${you}` : ''}`;
}

/**
 * Task #69 — translate the worker's OAuth-callback `reason` query-string
 * code into a short, user-facing sentence. Unknown codes fall through with
 * the raw code in parentheses so support can still triage.
 */
function humanizeOAuthReason(reason) {
  if (!reason) return '';
  if (reason === 'google_already_linked_other_user') return 'that Google account is already connected to another Axal VC user — disconnect it there first, then try again';
  if (reason === 'email_mismatch') return "that Google account doesn't match your StudioOS email";
  if (reason === 'email_unverified') return 'Google reports that account as unverified';
  if (reason === 'invalid_state') return 'the sign-in link expired, please try again';
  if (reason === 'no_refresh_token') return 'the provider did not return a refresh token (revoke access and reconnect)';
  if (reason === 'oauth_unavailable') return 'the server is missing OAuth credentials';
  if (reason === 'db_write') return 'the server could not save the connection';
  if (reason === 'secret_missing') return 'the server is missing an encryption secret — contact support';
  if (reason === 'encrypt') return 'the server could not encrypt the token';
  // Task #71 follow-up — step-tagged encrypt failures from cryptoBox.
  // Surface the step + sanitized slug verbatim so support can trace it.
  const encStep = typeof reason === 'string' ? reason.match(/^encrypt:(importkey|derive|aesgcm)(?::(.+))?$/) : null;
  if (encStep) {
    const stepLabel = encStep[1] === 'importkey' ? 'key import'
      : encStep[1] === 'derive' ? 'PBKDF2 key derivation'
      : 'AES-GCM encrypt';
    const slug = encStep[2] ? ` (${encStep[2]})` : '';
    return `the server crypto step failed at ${stepLabel}${slug} — please share this code with support`;
  }
  if (reason === 'timeout') return 'the request to the provider timed out';
  const tx = reason.match(/^token_exchange:(\d+):(.+)$/);
  if (tx) {
    const [, status, code] = tx;
    if (code === 'redirect_uri_mismatch') return 'redirect URL is not authorized in the OAuth client settings';
    if (code === 'invalid_grant') return 'the authorization code was rejected (please try connecting again)';
    if (code === 'invalid_client') return 'the OAuth client credentials are invalid';
    return `the provider rejected the token exchange (${status} ${code})`;
  }
  if (reason.startsWith('unknown:')) return `unexpected error (${reason.slice(8)})`;
  return `(${reason})`;
}

// ---------------------------------------------------------------------------
// D700 (#1662) — A6m, the page on a phone.
// ---------------------------------------------------------------------------

/** The pill each provider state reads on the phone's sources (D700). */
const PROVIDER_PILL = {
  reading: 'Checking', unreadable: 'Unreadable', unconfigured: 'Not configured',
  off: 'Not connected', connected: 'Connected', failed: 'Sync failed',
};
const PROVIDER_TONE = { connected: 'ok', failed: 'warn', unreadable: 'warn' };
export const NO_END_REASON = 'This event has no end time recorded, so its length is not known.';

/**
 * A6m's three sections. `events` is the page's own `listCalendarEvents` read
 * ({ status, items, reload }); Today and This week are the next seven days
 * of it. A duration the record cannot give reads Not recorded with its
 * reason, never 0. Sources carry each provider's own state word
 * (`providerState`), not only Connected or Reconnect (decision 10).
 */
export function calendarPhoneGroups({ events, providers, now = new Date() }) {
  const [todayTitle, weekTitle, sourcesTitle] = ACCOUNT_PHONE_PAGES.calendar.sections;
  const today = { label: todayTitle, rows: [], testid: 'calendar-phone-today' };
  const week = { label: weekTitle, rows: [], testid: 'calendar-phone-week' };
  if (events.status !== 'ready') {
    today.note = phonePending(events.status, 'The calendar', 'This is not a claim that nothing is scheduled.', events.reload);
    week.note = phonePending(events.status, 'The calendar', 'This is not a claim that nothing is scheduled.', events.reload);
  } else {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const tomorrow = start.getTime() + DAY_MS;
    const end = start.getTime() + 7 * DAY_MS;
    const sorted = [...events.items].sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)));
    for (const ev of sorted) {
      const at = new Date(ev.start_at).getTime();
      if (!Number.isFinite(at) || at < start.getTime() || at >= end) continue;
      const isToday = at < tomorrow;
      const when = isToday
        ? fmtTime(ev.start_at)
        : `${new Date(ev.start_at).toLocaleDateString(undefined, { weekday: 'short' })} ${fmtTime(ev.start_at)}`;
      const duration = fmtDuration(ev.start_at, ev.end_at);
      (isToday ? today : week).rows.push({
        key: `${ev.kind}-${ev.id}`,
        title: `${when} · ${ev.title}`,
        description: KIND_LABEL[ev.kind] || ev.kind,
        ...(duration ? { value: duration } : { notRecorded: true, notRecordedReason: NO_END_REASON }),
        testid: 'calendar-phone-event',
      });
    }
    if (!today.rows.length) today.note = 'Nothing scheduled today.';
    if (!week.rows.length) week.note = 'Nothing else scheduled in the next seven days.';
  }
  const sources = {
    label: sourcesTitle,
    testid: 'calendar-phone-sources',
    rows: providers.map(({ name, state, status }) => {
      const last = status?.last_synced_at ? new Date(status.last_synced_at) : null;
      const lastText = last && !Number.isNaN(last.getTime()) ? `Synced ${last.toLocaleString()}` : 'Last sync not recorded';
      return { key: name, title: name, description: lastText, pill: { label: PROVIDER_PILL[state] || PROVIDER_PILL.reading, tone: PROVIDER_TONE[state] || 'neutral' }, testid: 'calendar-phone-source' };
    }),
  };
  return [today, week, sources];
}

/** A6m — the bar and the three sections, then `children`: the controls, the agenda and the provider cards. */
export function CalendarPhoneView({ events, providers, now, children = null }) {
  return (
    <AccountPhonePage pageKey="calendar" testid="calendar-phone" groups={calendarPhoneGroups({ events, providers, now })}>
      {children}
    </AccountPhonePage>
  );
}

export default function CalendarPage() {
  const [items, setItems] = useState(null);        // null = not read yet
  const [sources, setSources] = useState([]);       // per-source answer, from the worker
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [kindsOpen, setKindsOpen] = useState(false); // D1210: the Kinds panel (CAL6)
  const [dayOpen, setDayOpen] = useState(null);      // D1210: the day popover (CAL12)
  // D1205: the view is the address (Month /calendar, /week, /agenda).
  // D1211: /calendar/item/:kind/:id opens the drawer over the view it came
  // from (the link carries it in `state.from`), else over Month.
  const location = useLocation();
  const navigate = useNavigate();
  const opened = itemOf(location.pathname);
  // D1212: /calendar/connected (and /google) opens its panel over the view it came from, else over Month.
  const connected = connectedOf(location.pathname);
  const behind = opened || connected ? (location.state?.from || '/calendar') : location.pathname;
  const pathname = behind;
  const phone = usePhoneWidth();
  // D1210: `?date=` anchors the view (else today); `?kinds=` and `?needs=1` narrow it.
  const search = opened || connected ? '' : location.search;
  // D1212 (CAL21a): on a phone Agenda is the default; Month is `/calendar?view=month`.
  const phoneAgenda = phone && viewOf(pathname) === 'month' && !/(^|[?&])view=month(&|$)/.test(search.replace(/^\?/, ''));
  const range = phoneAgenda ? 'agenda' : viewOf(pathname);
  const anchor = useMemo(() => anchorOf(search), [search]);
  const [google, setGoogle] = useState(null);
  const [microsoft, setMicrosoft] = useState(null);
  const [subscribing, setSubscribing] = useState(false); // D1212: Subscribe (CAL11)
  const [googleResult, setGoogleResult] = useState(null);
  const [microsoftResult, setMicrosoftResult] = useState(null);
  const [showIc, setShowIc] = useState(false);
  const [showCk, setShowCk] = useState(false);
  const [showAgent, setShowAgent] = useState(false); // D1613 (CAL8): Schedule an AI agent
  const [showCompliance, setShowCompliance] = useState(false);

  const me = safeReadJSON('user', {});
  const role = String(me?.role || 'founder').toLowerCase();
  const myEmail = String(me?.email || '').toLowerCase() || null;
  // Mirrors canScheduleIc() in cloudflare-worker/src/routes/calendar.ts. A
  // control the route would refuse is not drawn; the strip states the limit.
  const canIC = role === 'admin' || role === 'investor';
  // D1210 (CAL14): an Explorer's calendar is Events and From other calendars, and has no New.
  const explorer = role === 'exploring';
  const families = familiesFor(role);
  const allowedKinds = useMemo(() => kindsOfFamilies(families).filter((k) => KINDS.some((x) => x.id === k)), [families]);
  const shownKinds = useMemo(() => KINDS.filter((k) => allowedKinds.includes(k.id)), [allowedKinds]);
  const chosen = useMemo(() => kindsFrom(search, allowedKinds), [search, allowedKinds]);
  const needs = needsFrom(search);

  const window_ = useMemo(() => windowFor(range, anchor), [range, anchor]);
  const label = rangeLabel(range, window_.from, window_.to);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await api.listCalendarEvents({
        from: window_.from.toISOString(),
        to: window_.to.toISOString(),
      });
      setItems(Array.isArray(r?.items) ? r.items : []);
      setSources(Array.isArray(r?.sources) ? r.sources : []);
    } catch (e) {
      // Nothing answered — different from a source that failed, and the
      // agenda says so rather than showing an empty range that would read as
      // "you have nothing scheduled".
      setItems(null);
      setSources([]);
      setError(e?.message || 'The calendar could not be read.');
    }
    setLoading(false);
  }, [window_.from, window_.to]);

  const loadGoogle = useCallback(async () => {
    // D332 — a failed STATUS READ used to set `available: false`, the exact
    // shape `providerState` reads as "this server has no OAuth credentials
    // configured" — a claim about the DEPLOYMENT, not about this one request
    // failing. `unreadable: true` is a fetch failure; `available: false` is
    // now only ever the server's own, successfully-read answer.
    try { setGoogle(await api.googleCalStatus()); }
    catch (e) { setGoogle({ unreadable: true, connected: false, error: e.message }); }
  }, []);
  const loadMicrosoft = useCallback(async () => {
    try { setMicrosoft(await api.microsoftCalStatus()); }
    catch (e) { setMicrosoft({ unreadable: true, connected: false, error: e.message }); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    loadGoogle(); loadMicrosoft();
    // Surface OAuth callback result from query string.
    // Table-driven lookup intentionally — user-supplied query value is used as a
    // Map key (not a branch condition) and the resulting payload is a fixed
    // server-side display string. Nothing user-controlled ever gates a side effect.
    const qs = new URLSearchParams(window.location.search);
    // `humanizeOAuthReason` answers '' when there is no reason, so it runs
    // unconditionally and only its own sentence decides the suffix.
    const reasonText = humanizeOAuthReason(qs.get('reason'));
    const reasonSuffix = reasonText ? ` — ${reasonText}` : '';
    const GOOGLE_OUTCOMES = Object.freeze({
      connected: { kind: 'success', text: 'Google Calendar connected.' },
      error: { kind: 'error', text: `Google connection failed${reasonSuffix}.` },
      failed: { kind: 'error', text: `Google connection failed${reasonSuffix}.` },
    });
    const MS_OUTCOMES = Object.freeze({
      connected: { kind: 'success', text: 'Outlook / Microsoft 365 calendar connected.' },
      error: { kind: 'error', text: `Outlook connection failed${reasonSuffix}.` },
      failed: { kind: 'error', text: `Outlook connection failed${reasonSuffix}.` },
    });
    const gOutcome = Object.prototype.hasOwnProperty.call(GOOGLE_OUTCOMES, qs.get('google') || '') // codeql[js/user-controlled-bypass] -- query value only selects a frozen UI-message map entry (hasOwnProperty-guarded); gates no sensitive action
      ? GOOGLE_OUTCOMES[qs.get('google')] : null;
    const mOutcome = Object.prototype.hasOwnProperty.call(MS_OUTCOMES, qs.get('microsoft') || '') // codeql[js/user-controlled-bypass] -- query value only selects a frozen UI-message map entry (hasOwnProperty-guarded); gates no sensitive action
      ? MS_OUTCOMES[qs.get('microsoft')] : null;
    if (gOutcome) setGoogleResult(gOutcome);
    if (mOutcome) setMicrosoftResult(mOutcome);
    if (gOutcome || mOutcome) window.history.replaceState({}, '', window.location.pathname);
  }, [loadGoogle, loadMicrosoft]);

  // ── THE ONE LIST. Every figure on this page is derived from `inRange`, so
  // the All chip, the six kind chips and each day group's count can never
  // contradict one another. `null` means the request itself failed, which is
  // not the same as an empty range.
  const inRange = items;
  const failedSources = useMemo(() => sources.filter((s) => s && s.ok === false), [sources]);
  const failedKinds = useMemo(() => new Set(failedSources.map((s) => s.kind)), [failedSources]);
  const counts = useMemo(() => {
    const out = {};
    // D1205: a kind whose source did not answer counts a dash, never 0.
    for (const k of shownKinds) out[k.id] = chipCount(inRange, k.id, failedKinds);
    return out;
  }, [inRange, failedKinds, shownKinds]);

  const pool = useMemo(() => {
    if (!Array.isArray(inRange)) return [];
    // D1210: the Kinds filter (`?kinds=`) and "Only what needs me" (`?needs=1`) narrow the one list.
    return inRange.filter((e) => (!chosen || chosen.has(e.kind)) && (!needs || needsMe(e, myEmail)));
  }, [inRange, chosen, needs, myEmail]);
  const narrowed = Boolean(chosen) || needs;
  const kindsOn = chosen ? chosen.size : allowedKinds.length;
  const goSearch = (q) => navigate(`${pathname}${q}`);

  const days = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const out = new Map();
    for (const e of pool) {
      const d = new Date(e.start_at);
      if (Number.isNaN(d.getTime())) continue;
      const midnight = new Date(d); midnight.setHours(0, 0, 0, 0);
      const key = midnight.toISOString();
      if (!out.has(key)) {
        out.set(key, {
          key,
          date: d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
          rel: relativeDay(midnight, today),
          events: [],
        });
      }
      out.get(key).events.push(e);
    }
    return Array.from(out.values());
  }, [pool]);

  const gState = providerState(google, googleResult);
  const mState = providerState(microsoft, microsoftResult);
  // A provider whose sync was just refused cannot take a push either — the
  // canvas is explicit about this, drawing C6's expired Google as no provider
  // at all and putting the reconnect wording in place of the push control.
  const anyConnected = gState === 'connected' || mState === 'connected';
  // Connect and reconnect are different remedies and the note must name the
  // right one: a provider whose sync was just refused was demonstrably
  // connected, so telling its owner to "connect" would send them nowhere.
  const pushRemedy = (gState === 'failed' || mState === 'failed')
    ? 'Push needs a working connection. A calendar connection was refused — reconnect it in the panel on the right, then this event can be copied there once.'
    : 'Push needs a connected calendar. Connect Google or Outlook in the panel on the right, then this event can be copied there once.';

  const answered = sources.filter((s) => s && s.ok !== false).length;
  const meta = error
    ? 'no source answered'
    : loading
      ? `reading ${KINDS.length} sources`
      : failedSources.length
        ? `${answered} of ${KINDS.length} sources answered`
        : sources.length === 0
          // An older worker returns items with no `sources`. The page will not
          // claim every source answered on the strength of a field that is not
          // in the response.
          ? 'source coverage not reported'
          : `${sources.length} sources · all answered${Array.isArray(inRange) && inRange.length === 0 ? ' · 0 events' : ''}`;

  const page = (
    <div className="cal" data-testid="calendar-page">
      <header className="cal-head">
        {/* On a phone A6m's bar is the heading (D700). */}
        {!phone && (
          <div style={{ minWidth: 0 }}>
            <h1>Calendar</h1>
            <p>
              Investment-committee meetings, founder check-ins, advisor sessions, partner office
              hours, expert sessions booked through wellbeing, and anything synced in from Calendly.
              Nothing else is aggregated here.
            </p>
          </div>
        )}
        <div className="cal-head-actions">
          {/* D1211 (CAL8 A): one New menu. IC meeting is in it only where
              canScheduleIc allows (`newMenu`), so the gate strip below says why. */}
          {!explorer && <NewMenu role={role} onPick={(k) => (k === 'agent' ? setShowAgent(true) : k === 'compliance' ? setShowCompliance(true) : k === 'ic' && canIC ? setShowIc(true) : setShowCk(true))} />}
          {/* D1613 (CAL1b): Ask beside New. It draws nothing until #3706's Ask panel exists (Team's D1497 rule). */}
          {!explorer && <AskButton />}
          {/* D1212 (CAL11): Subscribe opens its dialog: the private whole-calendar link, and the one-off .ics. */}
          <button type="button" className="cal-btn cal-btn-o" onClick={() => setSubscribing(true)} data-testid="cal-subscribe-open">
            <Download className="w-4 h-4" aria-hidden="true" /> Subscribe
          </button>
          {/* Not on the canvas. Kept from the page this replaces because it
              works and nothing else re-reads the feed without changing the
              range — the quiet style keeps it out of the way of the three
              controls the canvas does draw. */}
          <button type="button" className="cal-btn cal-btn-q" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
          </button>
        </div>
      </header>

      {/* Its own full-width strip, like the gate below it. Inside the header's
          left column it stretched the flex row and pushed the canvas's three
          actions onto a line of their own, left-aligned, which is not the
          header the canvas draws. */}
      <div className="cal-explainer"><PageExplainer pageKey="calendar" /></div>

      {!canIC && !explorer && (
        <div className="cal-gate">
          <span className="cal-eb">Not available to you</span>
          <span>
            Creating an IC meeting is limited to admins and investors, so the control is not
            drawn. Check-ins are open to everyone.
          </span>
        </div>
      )}

      <div className="cal-controls">
        <div>
          <nav className="cal-seg" aria-label="Calendar views">
            {VIEWS.map((v) => (
              <Link key={v.key} to={phone && v.key === 'month' ? '/calendar?view=month' : v.path} className="cal-btn cal-btn-q"
                    aria-current={range === v.key ? 'page' : undefined} data-testid={`cal-view-${v.key}`}>
                {v.label}
              </Link>
            ))}
          </nav>
          <span className="cal-step" role="group" aria-label="Move the calendar">
            <Link to={`${pathname}${withDate(search, shiftAnchor(range, anchor, -1))}`} className="cal-btn cal-btn-q cal-btn-sm" aria-label="Earlier" data-testid="cal-prev">‹</Link>
            <Link to={`${pathname}${withDate(search, null)}`} className="cal-btn cal-btn-q cal-btn-sm" data-testid="cal-today">Today</Link>
            <Link to={`${pathname}${withDate(search, shiftAnchor(range, anchor, 1))}`} className="cal-btn cal-btn-q cal-btn-sm" aria-label="Later" data-testid="cal-next">›</Link>
          </span>
          <span className="cal-range cal-mono">{label}</span>
          <span className="cal-meta">{meta}</span>
        </div>
        <div className="cal-kinds-wrap">
          {/* D1210 (CAL6): the Kinds filter replaces the chip row. Its counts are
              still the one list's (`counts`, from inRange), a dash for a source
              that did not answer, and none at all when the list was not read. */}
          <button type="button" className="cal-chip" aria-expanded={kindsOpen} aria-pressed={narrowed}
                  onClick={() => setKindsOpen((x) => !x)} data-testid="cal-kinds">
            Kinds<b>{needs ? 'needs me' : `${kindsOn} on`}</b>
          </button>
          {narrowed ? <Link to={`${pathname}${withNeeds(withKinds(search, null, allowedKinds), false)}`} className="cal-btn cal-btn-q cal-btn-sm" data-testid="cal-kinds-clear">Show everything</Link> : null}
          {kindsOpen && (
            <KindsPanel families={families} kindLabel={(k) => KIND_LABEL[k] || k} counts={counts} items={inRange}
              chosen={chosen} needs={needs} onClose={() => setKindsOpen(false)}
              onApply={(pick, onlyNeeds) => goSearch(withNeeds(withKinds(search, pick, allowedKinds), onlyNeeds))} />
          )}
        </div>
      </div>

      <div className="cal-body">
        <section className="cal-main">
          {error && (
            <div className="cal-alert" role="alert">
              <AlertTriangle className="w-4 h-4 flex-none" aria-hidden="true" />
              <div style={{ minWidth: 0 }}>
                <strong>The calendar could not be read.</strong>
                <p style={{ margin: '4px 0 0', fontSize: '11.5px', lineHeight: 1.55 }}>{error}</p>
              </div>
              <button type="button" className="cal-btn cal-btn-o cal-btn-sm" onClick={load}>Retry</button>
            </div>
          )}

          {failedSources.length > 0 && (
            <div className="cal-degraded" role="status">
              <span className="cal-eb">{failedSources.length} of {KINDS.length} sources</span>
              <div style={{ minWidth: 0 }}>
                <strong>
                  {failedSources.map((s) => KIND_LABEL[s.kind] || s.kind).join(', ')} did not respond.
                  The other {KINDS.length - failedSources.length} sources loaded.
                </strong>
                <p>
                  Events from {failedSources.length === 1 ? 'that source are' : 'those sources are'} missing
                  from this range — the rest of the calendar is complete. Their chips show a dash, not a
                  count: nothing came back, which is not the same as nothing scheduled.
                </p>
              </div>
              <button type="button" className="cal-btn cal-btn-o cal-btn-sm" onClick={load}>Retry this source</button>
            </div>
          )}

          {loading && !Array.isArray(inRange) && (
            <div className="cal-skel" aria-hidden="true"><i /><i /><i /></div>
          )}

          {!loading && Array.isArray(inRange) && inRange.length === 0 && (
            <div className="cal-empty">
              <div className="cal-eb">Nothing scheduled</div>
              <h2>No events between {label}.</h2>
              <p>
                {failedSources.length
                  ? `${answered} of ${KINDS.length} sources answered and returned nothing for this range. The rest did not respond, so this may not be the whole picture.`
                  : sources.length === 0
                    ? 'The request returned no events for this range and did not report which sources answered. Widen the range, or create the first event.'
                    : `All ${sources.length} sources answered and returned nothing for this range. That means the calendar is working — there is simply nothing booked. Widen the range, or create the first event.`}
              </p>
              <div>
                {range !== 'agenda' && (
                  <Link to="/calendar/agenda" className="cal-btn cal-btn-o">Show next 90 days</Link>
                )}
                {!explorer && <button type="button" className="cal-btn cal-btn-o" onClick={() => setShowCk(true)}>New check-in</button>}
              </div>
            </div>
          )}

          {!loading && Array.isArray(inRange) && inRange.length > 0 && pool.length === 0 && (
            <div className="cal-empty" data-testid="cal-empty-filtered">
              <div className="cal-eb">Filtered to nothing</div>
              <h2>{needs ? `Nothing waits on your answer between ${label}.` : `None of the kinds you chose are on between ${label}.`}</h2>
              <p>
                {chosen && [...chosen].some((k) => failedKinds.has(k))
                  ? 'A kind you chose did not answer, so the page cannot say whether any are scheduled.'
                  : `${inRange.length} ${inRange.length === 1 ? 'item' : 'items'} of other kinds ${inRange.length === 1 ? 'is' : 'are'} in this range.`}
              </p>
              <div>
                <Link to={`${pathname}${withNeeds(withKinds(search, null, allowedKinds), false)}`} className="cal-btn cal-btn-o">Show everything</Link>
              </div>
            </div>
          )}

          {/* D1210: Month and Week are grids (CAL1, CAL2); Agenda is the day list (CAL3). */}
          {range === 'month' && Array.isArray(inRange) && (
            <MonthGrid anchor={anchor} items={pool} read={!error} from={pathname} onOpenDay={setDayOpen} dots={phone} />
          )}
          {range === 'week' && Array.isArray(inRange) && (
            <WeekGrid anchor={anchor} items={pool} read={!error} from={pathname} onOpenDay={setDayOpen} />
          )}
          {phone && range === 'agenda' && Array.isArray(inRange) && (
            <WeekStrip anchor={anchor} items={pool} pathname={pathname} search={search} />
          )}
          {range === 'agenda' && days.map((d) => (
            <div className="cal-day" key={d.key}>
              <div className="cal-day-head">
                <strong>{d.date}</strong>
                <span>{d.rel}</span>
                <span className="cal-mono">{d.events.length} {d.events.length === 1 ? 'event' : 'events'}</span>
              </div>
              <div className="cal-day-rows">
                {d.events.map((e) => (
                  <EventRow key={e.id} ev={e} myEmail={myEmail} role={role} from={pathname}
                            canPush={anyConnected} pushRemedy={pushRemedy} onChanged={load} />
                ))}
              </div>
            </div>
          ))}
        </section>

        <aside className="cal-rail">
          {/* D1212 (CAL1's rail): one line per calendar, and Manage opens /calendar/connected (CAL9). */}
          <ConnectedSummary gState={gState} mState={mState} google={google} microsoft={microsoft} />
          {[googleResult, microsoftResult].filter(Boolean).map((r) => (
            <p key={r.text} role="status" className="cal-prov-said" data-testid="cal-oauth-result">{r.text}</p>
          ))}

          <div className="cal-card" style={{ marginTop: 14 }}>
            <div className="cal-eb">Three different promises</div>
            <div className="cal-promises">
              <div>
                <strong>Sync a calendar</strong>
                <p>Ongoing, per provider. Every StudioOS event appears there and keeps up to date.</p>
              </div>
              <div>
                <strong>Push one event</strong>
                <p>One-time, per event. A copy is written once; later changes here do not follow it.</p>
              </div>
              <div>
                <strong>Subscribe · .ics</strong>
                <p>Read-only feed for any client. No account connection, no write access.</p>
              </div>
            </div>
          </div>

          <div className="cal-card" style={{ marginTop: 12 }}>
            <div className="cal-eb">What is on this calendar</div>
            <div className="cal-sources">
              {shownKinds.map((k) => (
                <div key={k.id}>
                  <span className="cal-dot" data-kind={k.id} aria-hidden="true" />
                  <span>{k.label}</span>
                  <span className="cal-mono">{k.from}</span>
                </div>
              ))}
            </div>
            <p className="cal-foot">
              {shownKinds.length} kinds in {families.filter((f) => f.kinds.length).length} families. The Kinds filter above is generated
              from this list, so a kind cannot exist without a way to reach it.
            </p>
          </div>

          {/* D1205 (#2420): what the canvas draws that no read carries yet. */}
          <div className="cal-card" style={{ marginTop: 12 }} data-testid="cal-waits">
            <div className="cal-eb">{NOT_YET}</div>
            {['deadlines', 'interviews'].map((k) => (
              <p key={k} className="cal-foot" data-testid={`cal-wait-${k}`}>{WAITS[k]}</p>
            ))}
          </div>
        </aside>
      </div>

      {dayOpen && <DayPopover date={dayOpen} items={pool} read={Array.isArray(inRange)} from={pathname} onClose={() => setDayOpen(null)} />}
      {showIc && <NewIcDialog meetAvailable={gState === 'connected'} onClose={() => setShowIc(false)} onSaved={() => { setShowIc(false); load(); }} />}
      {showCompliance && <NewComplianceDialog onClose={() => setShowCompliance(false)} onDone={() => { setShowCompliance(false); load(); }} />}
      {showAgent && <ScheduleAgentSheet zone={Intl.DateTimeFormat().resolvedOptions().timeZone} onClose={() => setShowAgent(false)} onSaved={() => { setShowAgent(false); load(); }} />}
      {showCk && <NewCheckinDialog role={role} meetAvailable={gState === 'connected'} onClose={() => setShowCk(false)} onSaved={() => { setShowCk(false); load(); }} />}
      {connected === 'list' && (
        <ConnectedPanel google={google} microsoft={microsoft} gState={gState} mState={mState}
                        reloadGoogle={loadGoogle} reloadMicrosoft={loadMicrosoft} onClose={() => navigate(behind)} />
      )}
      {connected === 'google' && (
        <GooglePanel google={google} gState={gState} reloadGoogle={loadGoogle} onClose={() => navigate(CONNECTED_PATH)} />
      )}
      {subscribing && <SubscribeDialog onClose={() => setSubscribing(false)} />}
      {/* D1613 (CAL10, CAL11): a session has its own sheet and its own seam. */}
      {opened?.kind === AGENT_KIND && <AgentSessionSheet id={opened.id} onClose={() => navigate(behind)} onChanged={load} />}
      {opened && opened.kind !== AGENT_KIND && (
        <CalendarItemDrawer kind={opened.kind} id={opened.id} canCopy={anyConnected} onChanged={load}
                            onClose={() => navigate(behind)} />
      )}
    </div>
  );

  if (!phone) return page;
  // D1212 (CAL21): on a phone the bar is A6m's (D700), and the page under it is
  // the canvas's: the week strip over the agenda, Month as dots, an item and
  // the connected calendars as full pages. A6m's Today and This week sections
  // are the agenda now, so they are not drawn twice.
  return (
    <AccountPhonePage pageKey="calendar" testid="calendar-phone" groups={[]}>
      <div className="-mx-[22px]">{page}</div>
    </AccountPhonePage>
  );
}

/** CAL21a: Monday to Sunday of the anchor's week; a day opens the agenda from that day. */
function WeekStrip({ anchor, items, pathname, search }) {
  const strip = weekStrip(anchor, items);
  return (
    <div className="cal-strip" role="tablist" aria-label={stripLabel(strip)} data-testid="cal-strip">
      {strip.map((d) => (
        <Link key={d.key} role="tab" aria-selected={d.selected} aria-label={d.label} to={`${pathname}${withDate(search, d.date)}`}
              className={`cal-strip-day${d.selected ? ' is-on' : ''}${d.isToday ? ' is-today' : ''}`} data-testid={`cal-strip-${d.key}`}>
          <span className="cal-eb">{d.letter}</span>
          <b className="cal-mono">{d.day}</b>
          <span className="cal-strip-kinds" aria-hidden="true">{d.kinds.map((k, i) => <span key={i} className="cal-dot" data-kind={k} />)}</span>
        </Link>
      ))}
    </div>
  );
}

/**
 * One agenda row: a 74px time column beside the event card, per the canvas.
 *
 * EVERY CONTROL HERE IS DRAWN ONLY WHEN THE ROUTE WOULD ACCEPT IT, which is
 * decidable from the feed alone:
 *   · RSVP — `POST /calendar/ic-meetings/:id/rsvp` needs an attendee row, and
 *     the feed lists the attendees, so the viewer's own email settles it.
 *   · Cancel — an IC meeting takes admin or the organiser (`organizer_email`
 *     is in the feed); a check-in takes admin or either party, and a
 *     non-admin only ever SEES check-ins they are party to, so any check-in
 *     on this page is cancellable by whoever is reading it.
 *   · Push — `PUSHABLE_KINDS` plus at least one connected provider. With no
 *     provider the control is absent and the note names the remedy instead.
 */
function EventRow({ ev, myEmail, role, from, canPush, pushRemedy, onChanged }) {
  const [busy, setBusy] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [said, setSaid] = useState('');
  const [rsvpOpen, setRsvpOpen] = useState(false);

  const cancelled = String(ev.status || '').toLowerCase() === 'cancelled';
  const tentative = String(ev.status || '').toLowerCase() === 'tentative';
  const where = locationOf(ev);
  const rsvp = ev.kind === 'ic_meeting' ? rsvpLine(ev, myEmail) : null;
  const duration = fmtDuration(ev.start_at, ev.end_at);
  const attendees = Array.isArray(ev.attendees) ? ev.attendees : [];
  const isAttendee = !!myEmail && attendees.some((a) => String(a.email || '').toLowerCase() === myEmail);
  const isOrganiser = !!myEmail && String(ev.organizer_email || '').toLowerCase() === myEmail;
  const isAdmin = role === 'admin';
  const pushed = Array.isArray(ev.pushed_to) ? ev.pushed_to : [];
  // D1384: a compliance deadline is a whole day with a state, changed in its Sheet.
  const deadline = ev.kind === COMPLIANCE_KIND;

  const mayRsvp = !cancelled && ev.kind === 'ic_meeting' && isAttendee;
  const mayCancel = !cancelled && (
    (ev.kind === 'ic_meeting' && (isAdmin || isOrganiser))
    || ev.kind === 'founder_checkin'
  );
  const mayPush = !cancelled && PUSHABLE_KINDS.has(ev.kind) && canPush;
  // The reason the control is absent, stated where it would have been. Only
  // for the kinds where a connection is the only thing missing — a Calendly
  // event has no push route at all, which is a different sentence.
  const pushNote = !cancelled && PUSHABLE_KINDS.has(ev.kind) && !canPush ? pushRemedy : null;
  const unpushable = !cancelled && !deadline && !PUSHABLE_KINDS.has(ev.kind);

  // `ok` rather than the returned value: a cancel that answers with an empty
  // body is a success, and gating the reload on truthiness would silently skip
  // it. Only a throw means the write did not happen.
  async function run(what, fn) {
    setBusy(what); setSaid('');
    try { return { ok: true, value: await fn() }; }
    catch (e) { setSaid(e?.message || 'That did not work.'); return { ok: false, value: null }; }
    finally { setBusy(''); }
  }

  async function doPush() {
    const r = await run('push', () => api.pushOneToExternal(ev.kind, ev.source_id));
    if (!r.ok) return;
    const targets = [r.value?.pushed?.google && 'Google', r.value?.pushed?.microsoft && 'Outlook'].filter(Boolean);
    setSaid(targets.length ? `Copied to ${targets.join(' + ')}.` : 'Already on the connected calendars.');
    onChanged();
  }
  async function doRsvp(value) {
    const r = await run('rsvp', () => api.rsvpIcMeeting(ev.source_id, value));
    if (!r.ok) return;
    setRsvpOpen(false);
    onChanged();
  }
  // D1211 (CAL19): Cancel opens its dialog, never a browser pop-up.
  function doCancel() { setCancelling(true); }

  return (
    <div className="cal-row">
      <div className="cal-when">
        {deadline ? <strong>All day</strong> : <strong>{fmtTime(ev.start_at)}</strong>}
        {deadline ? null : duration ? <span>{duration}</span> : <span className="cal-nr">Not recorded</span>}
      </div>
      <div className="cal-ev" data-kind={ev.kind} data-cancelled={cancelled ? 'true' : 'false'}
           data-testid={`calendar-event-${ev.id}`}>
        <div className="cal-ev-top">
          <span className="cal-dot" data-kind={ev.kind} aria-hidden="true" />
          <span className="cal-ev-kind" style={{ color: `var(--k-${ev.kind})` }}>
            {KIND_LABEL[ev.kind] || ev.kind}
          </span>
          {deadline && <span className="cal-nr" data-state={stateOf(ev)} data-testid={`calendar-state-${ev.id}`}>{stateLine(ev)}</span>}
          {cancelled && <span className="cal-nr">Cancelled by organiser</span>}
          {tentative && <span className="cal-nr cal-nr-warn">Tentative</span>}
          {pushed.length > 0 && (
            <span className="cal-nr cal-nr-ok">
              Pushed to {pushed.map((p) => PROVIDER_LABEL[p] || p).join(' + ')}
            </span>
          )}
        </div>
        <h3><Link to={itemPath(ev.kind, ev.source_id)} state={{ from }} data-testid={`calendar-open-${ev.id}`}>{ev.title}</Link></h3>
        {deadline ? (
          <div className="cal-ev-where">
            <span>{ev.project_name || 'Venture not recorded'}</span>
          </div>
        ) : (
          <div className="cal-ev-where">
            {where.uri
              ? <a href={where.uri} target="_blank" rel="noreferrer">{where.text}</a>
              : <span>{where.text}</span>}
            {where.missing && <span className="cal-nr">Not recorded</span>}
            {rsvp && <span>{rsvp}</span>}
            {ev.url && <a href={ev.url}>Event page</a>}
          </div>
        )}
        {!deadline && where.why && <p className="cal-ev-why">{where.why}</p>}
        {ev.notes && <p className="cal-ev-why">{ev.notes}</p>}

        {(mayRsvp || mayPush || mayCancel) && (
          <div className="cal-ev-actions">
            {mayRsvp && !rsvpOpen && (
              <button type="button" className="cal-btn cal-btn-p cal-btn-sm"
                      onClick={() => setRsvpOpen(true)} disabled={busy !== ''}>RSVP</button>
            )}
            {mayRsvp && rsvpOpen && RSVP_CHOICES.map(([value, text]) => (
              <button key={value} type="button" className="cal-btn cal-btn-o cal-btn-sm"
                      onClick={() => doRsvp(value)} disabled={busy !== ''}>
                {busy === 'rsvp' ? '…' : text}
              </button>
            ))}
            {mayPush && (
              <button type="button" className="cal-btn cal-btn-o cal-btn-sm"
                      onClick={doPush} disabled={busy !== ''}>
                {busy === 'push' ? 'Copying…' : pushed.length ? 'Push again' : 'Push to calendar'}
              </button>
            )}
            {mayCancel && (
              <button type="button" className="cal-btn cal-btn-q cal-btn-sm"
                      onClick={doCancel} disabled={busy !== ''}>
                {busy === 'cancel' ? 'Cancelling…' : 'Cancel'}
              </button>
            )}
          </div>
        )}
        {pushNote && <div className="cal-ev-note">{pushNote}</div>}
        {unpushable && (
          <div className="cal-ev-note">
            This event cannot be copied one at a time — it did not originate here, so there is
            nothing for StudioOS to write. Sync the calendar it came from, or subscribe to the
            .ics feed.
          </div>
        )}
        {said && <p className="cal-ev-said">{said}</p>}
      </div>
      {cancelling && (
        <CancelDialog item={{ ...ev, people: Array.isArray(ev.attendees) ? ev.attendees : [] }}
                      onClose={() => setCancelling(false)} onDone={() => { setCancelling(false); onChanged(); }} />
      )}
    </div>
  );
}

/**
 * Which of CAL9's six states a provider is in (`calendarConnectedModel.js` STATES).
 *
 * All are read from the server. `failed` is D1209's persisted `sync_error`, or
 * a connect THIS reader just ran that came back refused.
 */
function providerState(status, result) {
  if (!status) return 'reading';
  // D332 — checked before `unconfigured`: a request that never reached the
  // server (or that the server itself refused to answer) says nothing about
  // whether OAuth credentials are configured, and must not be read as if it
  // did.
  if (status.unreadable) return 'unreadable';
  if (status.available === false || status.configured === false) return 'unconfigured';
  if (!status.connected) return 'off';
  // D1212: D1209 persists the last sync's failure, so a cold load reads it too.
  if (status.sync_error || result?.kind === 'error') return 'failed';
  return 'connected';
}
