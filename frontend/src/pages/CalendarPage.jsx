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
 * WHAT IS NOT DRAWN, AND WHY. A provider-level sync failure is not persisted
 * anywhere: `google_oauth_tokens` / `microsoft_oauth_tokens` carry
 * `last_synced_at` and no error column, and `calendar_sync_records.last_error`
 * records a refused CANCEL, not a refused sync. So the "Sync failed" state
 * below is reached only from a sync or connect this reader just ran — a cold
 * page load after last night's sync failed still reads "Connected". Stated
 * rather than invented.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { safeReadJSON } from '../lib/storage';
import { AlertTriangle, Download, Plus, RefreshCw, X } from 'lucide-react';
import { api } from '../lib/api';
import PageExplainer from '../components/PageExplainer';
import './calendarPage.css';

/**
 * The six kinds, in the canvas's reading order. `src` is the store the events
 * come from, which is what the rail's legend shows — a reader who wonders why
 * something is or is not here can see where each row originates.
 */
const KINDS = [
  { id: 'ic_meeting', label: 'IC meeting', src: 'ic_meetings' },
  { id: 'founder_checkin', label: 'Check-in', src: 'founder_checkins' },
  { id: 'advisor_booking', label: 'Advisor', src: 'advisor_bookings' },
  { id: 'partner_office_hour', label: 'Office hour', src: 'office_hours' },
  { id: 'calendly_event', label: 'Calendly', src: 'calendly' },
  { id: 'expert_booking', label: 'Expert session', src: 'expert_bookings' },
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
]);

const RANGES = [['week', 'Week'], ['month', 'Month'], ['agenda', 'Agenda']];
const PROVIDER_LABEL = { google: 'Google', microsoft: 'Outlook' };

// RSVP values the worker accepts, with the words a person uses for them.
const RSVP_CHOICES = [['accepted', 'Yes'], ['tentative', 'Maybe'], ['declined', 'No']];
const RSVP_WORD = { accepted: 'yes', declined: 'no', tentative: 'maybe', invited: 'not yet' };

const DAY_MS = 86_400_000;

/** Midnight today, then the window each range mode asks the worker for. */
function rangeFor(mode) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (mode === 'week') return { from: start, to: new Date(start.getTime() + 7 * DAY_MS) };
  if (mode === 'month') {
    return {
      from: new Date(start.getFullYear(), start.getMonth(), 1),
      to: new Date(start.getFullYear(), start.getMonth() + 1, 1),
    };
  }
  return { from: start, to: new Date(start.getTime() + 90 * DAY_MS) };
}

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
 */
function hostWord(uri) {
  try {
    const h = new URL(uri).hostname.toLowerCase();
    if (h.endsWith('meet.google.com')) return 'Meet';
    if (h.endsWith('zoom.us')) return 'Zoom';
    if (h.endsWith('teams.microsoft.com')) return 'Teams';
    if (h.endsWith('whereby.com')) return 'Whereby';
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
  const word = kind === 'video' ? 'Video' : kind === 'room' ? 'Room' : kind ? kind : 'Video';
  const host = ev.location_uri ? hostWord(ev.location_uri) : null;
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

export default function CalendarPage() {
  const [items, setItems] = useState(null);        // null = not read yet
  const [sources, setSources] = useState([]);       // per-source answer, from the worker
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState(null);       // null = All
  const [range, setRange] = useState('agenda');
  const [google, setGoogle] = useState(null);
  const [microsoft, setMicrosoft] = useState(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [msSyncBusy, setMsSyncBusy] = useState(false);
  const [googleResult, setGoogleResult] = useState(null);
  const [microsoftResult, setMicrosoftResult] = useState(null);
  const [showIc, setShowIc] = useState(false);
  const [showCk, setShowCk] = useState(false);

  const me = safeReadJSON('user', {});
  const role = String(me?.role || 'founder').toLowerCase();
  const myEmail = String(me?.email || '').toLowerCase() || null;
  // Mirrors canScheduleIc() in cloudflare-worker/src/routes/calendar.ts. A
  // control the route would refuse is not drawn; the strip states the limit.
  const canIC = role === 'admin' || role === 'investor';

  const window_ = useMemo(() => rangeFor(range), [range]);
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
    try { setGoogle(await api.googleCalStatus()); }
    catch (e) { setGoogle({ available: false, connected: false, error: e.message }); }
  }, []);
  const loadMicrosoft = useCallback(async () => {
    try { setMicrosoft(await api.microsoftCalStatus()); }
    catch (e) { setMicrosoft({ available: false, connected: false, error: e.message }); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    loadGoogle(); loadMicrosoft();
    // Surface OAuth callback result from query string.
    // Table-driven lookup intentionally — user-supplied query value is used as a
    // Map key (not a branch condition) and the resulting payload is a fixed
    // server-side display string. Nothing user-controlled ever gates a side effect.
    const qs = new URLSearchParams(window.location.search);
    const reason = qs.get('reason');
    const reasonSuffix = reason ? ` — ${humanizeOAuthReason(reason)}` : '';
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
    for (const k of KINDS) {
      out[k.id] = Array.isArray(inRange) ? inRange.filter((e) => e.kind === k.id).length : null;
    }
    return out;
  }, [inRange]);

  const pool = useMemo(() => {
    if (!Array.isArray(inRange)) return [];
    return filter ? inRange.filter((e) => e.kind === filter) : inRange;
  }, [inRange, filter]);

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

  async function connectGoogle() {
    try {
      const r = await api.googleCalConnect();
      window.location.assign(r.redirect_url || r.auth_url);
    } catch (e) {
      // Task #35 — typed 'oauth_config_missing' surfaces with a `missing`
      // list so an admin can fix the config without reading worker logs.
      const data = e?.data;
      if (data?.code === 'oauth_config_missing') {
        const miss = Array.isArray(data.missing) && data.missing.length ? ` (missing: ${data.missing.join(', ')})` : '';
        setGoogleResult({ kind: 'error', text: `Google Calendar isn't configured yet — contact an admin${miss}.` });
      } else {
        setGoogleResult({ kind: 'error', text: e.message });
      }
    }
  }
  async function disconnectGoogle() {
    if (!window.confirm('Disconnect Google Calendar? Already-pushed events stay on Google.')) return;
    await api.googleCalDisconnect();
    await loadGoogle();
    setGoogleResult({ kind: 'success', text: 'Google disconnected.' });
  }
  async function runSync() {
    setSyncBusy(true); setGoogleResult(null);
    try {
      const r = await api.googleCalSync();
      setGoogleResult({ kind: 'success', text: `Pushed ${r.pushed} new, updated ${r.updated}, ${r.failed} failed (of ${r.total}).` });
      await loadGoogle();
    } catch (e) { setGoogleResult({ kind: 'error', text: e.message }); }
    setSyncBusy(false);
  }
  async function connectMicrosoft() {
    try {
      const r = await api.microsoftCalConnect();
      window.location.assign(r.redirect_url || r.auth_url);
    } catch (e) {
      const data = e?.data;
      if (data?.code === 'oauth_config_missing') {
        const miss = Array.isArray(data.missing) && data.missing.length ? ` (missing: ${data.missing.join(', ')})` : '';
        setMicrosoftResult({ kind: 'error', text: `Outlook isn't configured yet — contact an admin${miss}.` });
      } else {
        setMicrosoftResult({ kind: 'error', text: e.message });
      }
    }
  }
  async function disconnectMicrosoft() {
    if (!window.confirm('Disconnect Outlook? Already-pushed events stay on Outlook.')) return;
    await api.microsoftCalDisconnect();
    await loadMicrosoft();
    setMicrosoftResult({ kind: 'success', text: 'Outlook disconnected.' });
  }
  async function runMsSync() {
    setMsSyncBusy(true); setMicrosoftResult(null);
    try {
      const r = await api.microsoftCalSync();
      setMicrosoftResult({ kind: 'success', text: `Pushed ${r.pushed} new, updated ${r.updated}, ${r.failed} failed (of ${r.total}).` });
      await loadMicrosoft();
    } catch (e) { setMicrosoftResult({ kind: 'error', text: e.message }); }
    setMsSyncBusy(false);
  }

  return (
    <div className="cal" data-testid="calendar-page">
      <header className="cal-head">
        <div style={{ minWidth: 0 }}>
          <h1>Calendar</h1>
          <p>
            Investment-committee meetings, founder check-ins, advisor sessions, partner office
            hours, expert sessions booked through wellbeing, and anything synced in from Calendly.
            Nothing else is aggregated here.
          </p>
          <PageExplainer pageKey="calendar" />
        </div>
        <div className="cal-head-actions">
          {canIC && (
            <button type="button" className="cal-btn cal-btn-p" onClick={() => setShowIc(true)}>
              <Plus className="w-4 h-4" aria-hidden="true" /> New IC meeting
            </button>
          )}
          <button type="button" className="cal-btn cal-btn-o" onClick={() => setShowCk(true)}>
            <Plus className="w-4 h-4" aria-hidden="true" /> New check-in
          </button>
          <a className="cal-btn cal-btn-o" href={api.calendarIcsUrl()}
             aria-label="Subscribe to or export this calendar as iCalendar">
            <Download className="w-4 h-4" aria-hidden="true" /> Subscribe · .ics
          </a>
          {/* Not on the canvas. Kept from the page this replaces because it
              works and nothing else re-reads the feed without changing the
              range — the quiet style keeps it out of the way of the three
              controls the canvas does draw. */}
          <button type="button" className="cal-btn cal-btn-q" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
          </button>
        </div>
      </header>

      {!canIC && (
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
          <div className="cal-seg" role="group" aria-label="Date range">
            {RANGES.map(([id, text]) => (
              <button key={id} type="button" className="cal-btn cal-btn-q"
                      aria-pressed={range === id} onClick={() => setRange(id)}>
                {text}
              </button>
            ))}
          </div>
          <span className="cal-range cal-mono">{label}</span>
          <span className="cal-meta">{meta}</span>
        </div>
        <div className="cal-chips" role="group" aria-label="Filter by kind">
          {/* No list, no number. A chip that showed a dash or a zero here would
              be inventing a count for a request that never answered — the
              banner above says what happened instead. */}
          <button type="button" className="cal-chip" aria-pressed={!filter} onClick={() => setFilter(null)}>
            All{Array.isArray(inRange) ? <b>{inRange.length}</b> : null}
          </button>
          {KINDS.map((k) => (
            <button key={k.id} type="button" className="cal-chip" aria-pressed={filter === k.id}
                    onClick={() => setFilter(filter === k.id ? null : k.id)}>
              <span className="cal-dot" data-kind={k.id} aria-hidden="true" />
              {k.label}
              {counts[k.id] === null ? null : <b>{counts[k.id]}</b>}
            </button>
          ))}
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
                  from this range — the rest of the calendar is complete. Their chip counts read 0 because
                  nothing came back, not because nothing is scheduled.
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
                  <button type="button" className="cal-btn cal-btn-o" onClick={() => setRange('agenda')}>
                    Show next 90 days
                  </button>
                )}
                <button type="button" className="cal-btn cal-btn-o" onClick={() => setShowCk(true)}>New check-in</button>
              </div>
            </div>
          )}

          {!loading && Array.isArray(inRange) && inRange.length > 0 && pool.length === 0 && (
            <div className="cal-empty">
              <div className="cal-eb">Nothing of this kind</div>
              <h2>No {KIND_LABEL[filter] || filter} events between {label}.</h2>
              <p>
                {failedKinds.has(filter)
                  ? 'This source did not respond, so the page cannot say whether any are scheduled.'
                  : `This source answered and returned nothing. ${inRange.length} ${inRange.length === 1 ? 'event' : 'events'} of other kinds ${inRange.length === 1 ? 'is' : 'are'} in this range.`}
              </p>
              <div>
                <button type="button" className="cal-btn cal-btn-o" onClick={() => setFilter(null)}>Show all kinds</button>
              </div>
            </div>
          )}

          {days.map((d) => (
            <div className="cal-day" key={d.key}>
              <div className="cal-day-head">
                <strong>{d.date}</strong>
                <span>{d.rel}</span>
                <span className="cal-mono">{d.events.length} {d.events.length === 1 ? 'event' : 'events'}</span>
              </div>
              <div className="cal-day-rows">
                {d.events.map((e) => (
                  <EventRow key={e.id} ev={e} myEmail={myEmail} role={role}
                            canPush={anyConnected} pushRemedy={pushRemedy} onChanged={load} />
                ))}
              </div>
            </div>
          ))}
        </section>

        <aside className="cal-rail">
          <div className="cal-eb">Connected calendars</div>
          <div className="cal-providers">
            <ProviderCard
              name="Google Calendar" state={gState} status={google} result={googleResult}
              busy={syncBusy} envVars="GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET"
              onConnect={connectGoogle} onSync={runSync} onDisconnect={disconnectGoogle}
            />
            <ProviderCard
              name="Microsoft Outlook" state={mState} status={microsoft} result={microsoftResult}
              busy={msSyncBusy} envVars="MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET"
              onConnect={connectMicrosoft} onSync={runMsSync} onDisconnect={disconnectMicrosoft}
            />
          </div>

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
              {KINDS.map((k) => (
                <div key={k.id}>
                  <span className="cal-dot" data-kind={k.id} aria-hidden="true" />
                  <span>{k.label}</span>
                  <span className="cal-mono">{k.src}</span>
                </div>
              ))}
            </div>
            <p className="cal-foot">
              Six sources, six kinds. The filters above are generated from this list, so a kind
              cannot exist without a way to reach it.
            </p>
          </div>
        </aside>
      </div>

      {showIc && <IcMeetingModal me={me} onClose={() => setShowIc(false)} onSaved={() => { setShowIc(false); load(); }} />}
      {showCk && <CheckinModal me={me} onClose={() => setShowCk(false)} onSaved={() => { setShowCk(false); load(); }} />}
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
function EventRow({ ev, myEmail, role, canPush, pushRemedy, onChanged }) {
  const [busy, setBusy] = useState('');
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
  const unpushable = !cancelled && !PUSHABLE_KINDS.has(ev.kind);

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
  async function doCancel() {
    if (!window.confirm(`Cancel "${ev.title}"? Everyone invited will lose it from their calendar.`)) return;
    const r = await run('cancel', () => (ev.kind === 'ic_meeting'
      ? api.cancelIcMeeting(ev.source_id)
      : api.cancelCheckin(ev.source_id)));
    if (r.ok) onChanged();
  }

  return (
    <div className="cal-row">
      <div className="cal-when">
        <strong>{fmtTime(ev.start_at)}</strong>
        {duration ? <span>{duration}</span> : <span className="cal-nr">Not recorded</span>}
      </div>
      <div className="cal-ev" data-kind={ev.kind} data-cancelled={cancelled ? 'true' : 'false'}
           data-testid={`calendar-event-${ev.id}`}>
        <div className="cal-ev-top">
          <span className="cal-dot" data-kind={ev.kind} aria-hidden="true" />
          <span className="cal-ev-kind" style={{ color: `var(--k-${ev.kind})` }}>
            {KIND_LABEL[ev.kind] || ev.kind}
          </span>
          {cancelled && <span className="cal-nr">Cancelled by organiser</span>}
          {tentative && <span className="cal-nr cal-nr-warn">Tentative</span>}
          {pushed.length > 0 && (
            <span className="cal-nr cal-nr-ok">
              Pushed to {pushed.map((p) => PROVIDER_LABEL[p] || p).join(' + ')}
            </span>
          )}
        </div>
        <h3>{ev.title}</h3>
        <div className="cal-ev-where">
          {where.uri
            ? <a href={where.uri} target="_blank" rel="noreferrer">{where.text}</a>
            : <span>{where.text}</span>}
          {where.missing && <span className="cal-nr">Not recorded</span>}
          {rsvp && <span>{rsvp}</span>}
        </div>
        {where.why && <p className="cal-ev-why">{where.why}</p>}
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
            A {KIND_LABEL[ev.kind] || ev.kind} event cannot be copied one at a time — it did not
            originate here, so there is nothing for StudioOS to write. Sync the calendar it came
            from, or subscribe to the .ics feed.
          </div>
        )}
        {said && <p className="cal-ev-said">{said}</p>}
      </div>
    </div>
  );
}

/**
 * Which of the five states a provider is in.
 *
 * Four are read from the server. `failed` is the exception and is deliberately
 * narrow: nothing persists a provider-level sync failure, so it is only ever
 * reached from a sync or connect THIS reader just ran. A cold load after an
 * overnight failure still reads "Connected" — see the file docblock.
 */
function providerState(status, result) {
  if (!status) return 'reading';
  if (status.available === false || status.configured === false) return 'unconfigured';
  if (!status.connected) return 'off';
  if (result?.kind === 'error') return 'failed';
  return 'connected';
}

function ProviderCard({ name, state, status, result, busy, envVars, onConnect, onSync, onDisconnect }) {
  const last = status?.last_synced_at ? new Date(status.last_synced_at) : null;
  const lastText = last && !Number.isNaN(last.getTime()) ? last.toLocaleString() : null;
  const account = status?.google_email || status?.microsoft_email || null;

  // Every state names its own reason for the missing last-sync time — never a
  // dash, and never a plausible "never" that could be read as a failure.
  const SPEC = {
    reading: {
      pill: 'Checking', tone: '',
      whyNoSync: 'The connection has not been read back yet.',
      why: 'This card fills in as soon as the server answers.',
      actions: [],
    },
    unconfigured: {
      pill: 'Not configured', tone: '',
      whyNoSync: 'Nothing can have synced, because the connection cannot be offered.',
      why: `This server has no ${name} OAuth credentials, so the connection is not available to anyone. An admin sets ${envVars}.`,
      actions: [],
    },
    off: {
      pill: 'Not connected', tone: '',
      whyNoSync: 'Nothing has synced, so there is no last-sync time to show.',
      why: 'Connect to push events automatically. Nothing is written to this calendar until you do.',
      actions: [['Connect', 'cal-btn-o', onConnect]],
    },
    connected: {
      pill: 'Connected', tone: 'cal-nr-ok',
      whyNoSync: 'Connected, but no sync has run yet — the first one writes this time.',
      why: `Every StudioOS event appears in this calendar and stays up to date${account ? `, as ${account}` : ''}.`,
      actions: [['Sync now', 'cal-btn-o', onSync], ['Disconnect', 'cal-btn-q', onDisconnect]],
    },
    failed: {
      pill: 'Sync failed', tone: 'cal-nr-warn',
      whyNoSync: 'No sync has completed, so there is no time to show.',
      why: 'The last attempt was refused. Events already pushed remain on this calendar; nothing new has been written since.',
      actions: [['Reconnect', 'cal-btn-p', onConnect], ['Disconnect', 'cal-btn-q', onDisconnect]],
    },
  };
  const s = SPEC[state] || SPEC.reading;

  return (
    <div className="cal-card" data-testid={`calendar-provider-${state}`}>
      <div className="cal-prov-top">
        <strong>{name}</strong>
        <span className={`cal-nr ${s.tone}`}>{s.pill}</span>
      </div>
      <div className="cal-prov-sync">
        <span>Last sync</span>
        {lastText ? <span className="cal-mono">{lastText}</span> : <span className="cal-nr">Not recorded</span>}
      </div>
      {!lastText && <p className="cal-prov-why">{s.whyNoSync}</p>}
      <p className="cal-prov-why">{s.why}</p>
      {s.actions.length > 0 && (
        <div className="cal-prov-actions">
          {s.actions.map(([text, cls, fn]) => (
            <button key={text} type="button" className={`cal-btn ${cls} cal-btn-sm`}
                    onClick={fn} disabled={busy}>
              {busy && text === 'Sync now' ? 'Syncing…' : text}
            </button>
          ))}
        </div>
      )}
      {result && <p className="cal-prov-said">{result.text}</p>}
    </div>
  );
}

function ModalShell({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function IcMeetingModal({ me, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: '', agenda: '', start_at: '', duration_min: 60,
    deal_id: '', location_uri: '', attendee_user_ids: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const ids = form.attendee_user_ids.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
      await api.createIcMeeting({
        title: form.title,
        agenda: form.agenda || null,
        start_at: new Date(form.start_at).toISOString(),
        duration_min: parseInt(form.duration_min, 10) || 60,
        deal_id: form.deal_id ? parseInt(form.deal_id, 10) : null,
        location_uri: form.location_uri || null,
        attendee_user_ids: ids,
      });
      onSaved();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <ModalShell title="Schedule IC meeting" onClose={onClose}>
      <div className="space-y-3">
        {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{err}</div>}
        <Field label="Title">
          <input className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                 value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Start">
          <input type="datetime-local" className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                 value={form.start_at} onChange={(e) => setForm({ ...form, start_at: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration (min)">
            <input type="number" min={10} max={600} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                   value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: e.target.value })} />
          </Field>
          <Field label="Deal id (optional)">
            <input className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                   value={form.deal_id} onChange={(e) => setForm({ ...form, deal_id: e.target.value })} />
          </Field>
        </div>
        <Field label="Agenda">
          <textarea rows={3} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                    value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })} />
        </Field>
        <Field label="Meeting link">
          <input className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                 placeholder="https://meet.google.com/…"
                 value={form.location_uri} onChange={(e) => setForm({ ...form, location_uri: e.target.value })} />
        </Field>
        <Field label="Attendee user ids (comma-separated)">
          <input className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                 placeholder={`e.g. 12, 17, 23 (you (#${me?.id || '?'}) are auto-added)`}
                 value={form.attendee_user_ids} onChange={(e) => setForm({ ...form, attendee_user_ids: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-sm px-3 py-1.5 border border-slate-300 rounded">Cancel</button>
          <button onClick={submit} disabled={busy || !form.title || !form.start_at}
                  className="text-sm px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50">
            {busy ? 'Saving…' : 'Schedule'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function CheckinModal({ me, onClose, onSaved }) {
  const [form, setForm] = useState({
    founder_user_id: '', counterpart_user_id: '', title: '', notes: '',
    start_at: '', duration_min: 30, location_uri: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      await api.createCheckin({
        founder_user_id: parseInt(form.founder_user_id, 10),
        counterpart_user_id: form.counterpart_user_id ? parseInt(form.counterpart_user_id, 10) : null,
        title: form.title,
        notes: form.notes || null,
        start_at: new Date(form.start_at).toISOString(),
        duration_min: parseInt(form.duration_min, 10) || 30,
        location_uri: form.location_uri || null,
      });
      onSaved();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <ModalShell title="Schedule founder check-in" onClose={onClose}>
      <div className="space-y-3">
        {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{err}</div>}
        <Field label="Founder user id">
          <input className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                 placeholder={me?.role === 'founder' ? `e.g. ${me?.id || ''}` : 'e.g. 42'}
                 value={form.founder_user_id} onChange={(e) => setForm({ ...form, founder_user_id: e.target.value })} />
        </Field>
        <Field label="Counterpart user id (optional)">
          <input className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                 placeholder={`leave blank to default to you (#${me?.id || '?'})`}
                 value={form.counterpart_user_id} onChange={(e) => setForm({ ...form, counterpart_user_id: e.target.value })} />
        </Field>
        <Field label="Title">
          <input className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                 value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Start">
          <input type="datetime-local" className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                 value={form.start_at} onChange={(e) => setForm({ ...form, start_at: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration (min)">
            <input type="number" min={10} max={240} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                   value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: e.target.value })} />
          </Field>
          <Field label="Meeting link">
            <input className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                   value={form.location_uri} onChange={(e) => setForm({ ...form, location_uri: e.target.value })} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea rows={3} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                    value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-sm px-3 py-1.5 border border-slate-300 rounded">Cancel</button>
          <button onClick={submit} disabled={busy || !form.founder_user_id || !form.title || !form.start_at}
                  className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Saving…' : 'Schedule'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
