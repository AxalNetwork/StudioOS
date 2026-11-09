import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import StudioModules from '../studio/StudioModules';
import { CustomiseButton, StudioFixedLock } from '../studio/StudioParts';
import { PURPOSE, TILE } from '../studio/studioLayoutModel';
import { useStudioLayout } from '../studio/useStudioLayout';
import StudioInterview from '../../components/advisor/StudioInterview';
import ProfileFitSection from '../../components/profile/ProfileFitSection';
import { AWAITING_DECISION, slotMinutes, slotView } from './advisory/kit';
import { advisorToday, listNames, todayState } from './advisorToday';
import './advisorStudioHome.css';
import { earningsFigures } from './advisorEarnings';

/**
 * " · 45 min", or nothing at all.
 *
 * These rows read `duration_min` and printed "Duration not recorded" on every
 * one of them, forever: it is an INPUT to slot creation and no DTO returns it.
 * The window is what the worker sends, so the length is derived from it —
 * and when only one end is present the label is omitted rather than guessed.
 */
/**
 * When a row on the "today" list happens, across the two sources it mixes.
 * A booking's time lives on its slot; a calendar event carries its own.
 */
function itemStart(row) {
  return row.scheduled_start || row.slot_starts_at || row.start_at || row.start || null;
}

function minutesLabel(row) {
  const mins = slotMinutes({
    starts_at: row.starts_at || row.start_at || row.slot_starts_at || row.scheduled_start,
    ends_at: row.ends_at || row.slot_ends_at,
  });
  return mins == null ? '' : ` · ${mins} min`;
}

const unavailable = (message = 'Unavailable in this environment') => ({ state: 'unavailable', message });
const loading = { state: 'loading' };
const ready = (data) => ({ state: 'ready', data });
// A read that FAILED, told apart from one that answered "not available" (D1419: the tile says could not be read).
const failed = (error) => ({ state: 'unavailable', failed: true, message: error?.message || 'Unavailable in this environment' });
const firstName = (value) => String(value || '').trim().split(/\s+/)[0] || 'there';
const asItems = (value) => Array.isArray(value) ? value : (Array.isArray(value?.items) ? value.items : []);



function formatWhen(value) {
  if (!value) return 'Time not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time not recorded';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function Status({ children, tone = 'neutral' }) {
  return <span className={`advisor-status advisor-status--${tone}`} data-testid={`status-${String(children).toLowerCase().replace(/\s+/g, '-')}`}>{children}</span>;
}

function StateNote({ text, icon: Icon = ShieldCheck }) {
  return <div className="advisor-state-note"><Icon size={16} /><span>{text}</span></div>;
}

function bookingIdentity(booking) {
  // A person by name, never by email (D1419): the address is a key, not a label.
  return booking.client_name || booking.founder_name || booking.user_name || booking.name || 'Client identity not recorded';
}

/**
 * The Today tile from `advisorToday`'s answer. What an input returned is shown
 * even while another is loading or has failed, with the gap named; it is
 * Empty only when every input has answered, and Unreadable (never Empty) when
 * nothing came back and an input failed.
 */
function todayTile(today, onRetry) {
  const { items, openSlots, loading: pending, failed: broken } = today;
  const gap = [
    pending.length ? `Still reading ${listNames(pending)}.` : '',
    broken.length ? `Could not read ${listNames(broken)}, so this list may be incomplete.` : '',
  ].filter(Boolean).join(' ');
  const state = todayState(today);
  if (state === 'unreadable') return { state: TILE.UNREADABLE, onRetry };
  if (state === 'loading') return { state: TILE.LOADING };
  if (state === 'empty') return { state: TILE.EMPTY, empty: 'No sessions or open slots are scheduled for today.', href: '/calendar', openLabel: 'Open calendar' };
  return {
    state: TILE.READY,
    href: '/calendar',
    openLabel: 'Open calendar',
    body: (
      <div className="advisor-list">
        {items.map((item, index) => <div className="advisor-row" key={item.id || index}><div><strong>{item.topic || item.title || 'Advisor session'}</strong><span>{formatWhen(itemStart(item))}{minutesLabel(item)}</span></div><Status tone={item.status === 'confirmed' ? 'good' : 'neutral'}>{item.status || 'Scheduled'}</Status></div>)}
        {openSlots.slice(0, 2).map((slot) => <div className="advisor-row advisor-row--open" key={slot.id}><div><strong>Open slot</strong><span>{formatWhen(slotView(slot).startsAt)}{minutesLabel(slot)} · date-specific</span></div><Status>Open</Status></div>)}
        {gap && <div className="advisor-state-note" role="status" data-testid="status-advisor-today-partial"><span>{gap}</span>{broken.length > 0 && <button type="button" onClick={onRetry} data-testid="button-retry-advisor-today"><RefreshCw size={13} /> Retry</button>}</div>}
      </div>
    ),
  };
}

export default function AdvisorStudioHome({
  user,
  dashboard = null,
  previewing = false,
  dashboardUnavailable = '',
  onRetryDashboard,
  // D4474 (#4474): a block on a multi-licence Studio. The page owns the "Studio" h1, so the home leaves out its own.
  embedded = false,
}) {
  const [advisor, setAdvisor] = useState(loading);
  const [slots, setSlots] = useState(loading);
  const [bookings, setBookings] = useState(loading);
  const [calendar, setCalendar] = useState(loading);
  const [payouts, setPayouts] = useState(loading);
  const [commissions, setCommissions] = useState(loading);
  const [advisorAssistantAvailable, setAdvisorAssistantAvailable] = useState(true);

  // D4620 (#4620): one loader per source, so a retry asks again for the source
  // that failed and leaves what the others returned in place. `latest` drops an
  // answer that a newer ask for the same source has already replaced.
  const latest = useRef({});
  const read = useCallback((key, set, ask, shape) => {
    const mine = (latest.current[key] || 0) + 1;
    latest.current[key] = mine;
    set(loading);
    ask().then((r) => { if (latest.current[key] === mine) set(ready(shape(r))); })
      .catch((e) => { if (latest.current[key] === mine) set(failed(e)); });
  }, []);
  const loadBookings = useCallback(() => read('bookings', setBookings, () => api.listMyAdvisorBookings(), asItems), [read]);
  // The calendar answer is kept whole: its `sources` say whether the advisor-booking source was actually read.
  const loadCalendar = useCallback(() => read('calendar', setCalendar, () => api.listCalendarEvents(), (r) => r), [read]);
  const loadSlots = useCallback((uid) => read('slots', setSlots, () => api.listAdvisorSlots(uid, true), asItems), [read]);

  const load = useCallback(() => {
    if (previewing) {
      setAdvisor(unavailable('Advisor data is withheld in role preview.'));
      setSlots(unavailable('Availability is withheld in role preview.'));
      setBookings(unavailable('Client history is withheld in role preview.'));
      setCalendar(unavailable('Calendar is withheld in role preview.'));
      setPayouts(unavailable('Earnings are withheld in role preview.'));
      setCommissions(unavailable('Earnings are withheld in role preview.'));
      return;
    }
    setAdvisor(loading); setSlots(loading); setPayouts(loading); setCommissions(loading);
    api.getMyAdvisor()
      .then((profile) => {
        if (!profile?.uid) { setAdvisor(unavailable('Your advisor profile is not available yet.')); setSlots(unavailable('Publish an advisor profile to manage slots.')); return; }
        setAdvisor(ready(profile));
        loadSlots(profile.uid);
      })
      .catch((e) => { setAdvisor(failed(e)); setSlots(failed(e)); });
    loadBookings();
    loadCalendar();
    api.payoutsMe().then((r) => setPayouts(ready(r || {}))).catch((e) => setPayouts(failed(e)));
    api.commissionsMe().then((r) => setCommissions(ready(r || {}))).catch((e) => setCommissions(failed(e)));
  }, [previewing, loadBookings, loadCalendar, loadSlots]);

  useEffect(() => { load(); }, [load]);

  // The Today list's reads: bookings, the calendar and the slots (D4620).
  const today = useMemo(() => advisorToday({ bookings, calendar, slots }), [bookings, calendar, slots]);
  // Retry asks again for the inputs that failed, and nothing else.
  const retryToday = useCallback(() => {
    if (today.failed.includes('bookings')) loadBookings();
    if (today.failed.includes('calendar')) loadCalendar();
    if (today.failed.includes('slots')) {
      if (advisor.state === 'ready' && advisor.data?.uid) loadSlots(advisor.data.uid); else load();
    }
  }, [today, advisor, loadBookings, loadCalendar, loadSlots, load]);

  const engagements = useMemo(() => {
    if (bookings.state !== 'ready') return [];
    const map = new Map();
    bookings.data.forEach((b) => {
      const key = b.client_user_id || b.founder_user_id || b.requester_user_id || b.client_email || b.founder_email || bookingIdentity(b);
      const current = map.get(key) || { key, name: bookingIdentity(b), total: 0, completed: 0, upcoming: 0, latest: null };
      current.total += 1;
      if (b.status === 'completed') current.completed += 1;
      if ([...AWAITING_DECISION, 'confirmed'].includes(b.status)) current.upcoming += 1;
      const at = b.scheduled_start || b.slot_starts_at;
      if (!current.latest || new Date(at) > new Date(current.latest)) current.latest = at;
      map.set(key, current);
    });
    return [...map.values()].sort((a, b) => new Date(b.latest || 0) - new Date(a.latest || 0));
  }, [bookings]);

  const profile = advisor.state === 'ready' ? advisor.data : null;
  const isDevPayoutShim = import.meta.env.DEV
    && payouts.state === 'ready'
    && Number(payouts.data?.balance_cents) === 0
    && Number(payouts.data?.lifetime_cents) === 0
    && asItems(payouts.data?.commissions).length === 0
    && asItems(payouts.data?.payouts).length === 0;
  const earnings = earningsFigures(
    commissions.state === 'ready' ? commissions.data : null,
    payouts.state === 'ready' ? payouts.data : null,
  );
  const publicProfileLive = profile?.listed === true || profile?.is_active === true;
  const storefrontRows = profile ? [
    ['Public profile', publicProfileLive ? 'Listed' : profile.listed === false || profile.is_active === false ? 'Not listed' : 'Not recorded', publicProfileLive ? 'good' : 'neutral'],
    ['Bookings', profile.accepting_bookings === true ? 'Accepting' : profile.accepting_bookings === false ? 'Not accepting' : 'Not recorded', profile.accepting_bookings === true ? 'good' : 'neutral'],
  ] : [];
  // D4362 (#4362): an admin previewing arranges their own Advisor Studio; its tiles stay withheld (`withheld`).
  const studio = useStudioLayout({ profile: 'advisor', viewer: user });
  const withheld = { state: TILE.WITHHELD };
  const tiles = previewing ? Object.fromEntries(['today', 'storefront', 'engagements', 'consented_proof', 'earnings'].map((k) => [k, withheld])) : {
    today: todayTile(today, retryToday),
    storefront: advisor.state === 'loading' ? { state: TILE.LOADING }
      : advisor.failed ? { state: TILE.UNREADABLE, onRetry: load }
        : !profile ? { state: TILE.NOT_RECORDED, reason: advisor.message || 'Storefront details are not available.', href: '/expertise/profile', openLabel: 'Open storefront' }
          : { state: TILE.READY, href: '/expertise/profile', openLabel: 'Open storefront', body: <div className="advisor-keyvalues">{storefrontRows.map(([label, value, tone]) => <div key={label}><span>{label}</span><Status tone={tone}>{value}</Status></div>)}<div><span>Visibility</span><b>{profile.status || 'Not recorded'}</b></div></div> },
    engagements: bookings.state === 'loading' ? { state: TILE.LOADING }
      : bookings.state === 'unavailable' ? { state: TILE.UNREADABLE, onRetry: load }
        : !engagements.length ? { state: TILE.EMPTY, empty: 'Engagements appear once someone books a session with you.', href: '/practice/engagements', openLabel: 'Open clients' }
          : {
            state: TILE.READY,
            note: `${engagements.filter((c) => c.upcoming).length} active`,
            href: '/practice/engagements',
            openLabel: 'Open clients',
            body: <div className="advisor-list">{engagements.slice(0, 3).map((client) => <div className="advisor-row" key={client.key}><div><strong>{client.name}</strong><span>{client.total} session{client.total === 1 ? '' : 's'} · {client.completed} held{client.upcoming ? ` · ${client.upcoming} upcoming` : ''}</span></div><Status tone={client.upcoming ? 'good' : 'neutral'}>{client.upcoming ? 'Active' : 'History'}</Status></div>)}</div>,
          },
    consented_proof: { state: TILE.EMPTY, empty: 'Consented client outcomes are unavailable because no authoritative proof source is connected yet. Self-reported metrics are never shown as proof.', href: '/advisor/advisory/clients', openLabel: 'Open clients' },
    earnings: payouts.state === 'loading' || commissions.state === 'loading' ? { state: TILE.LOADING }
      : (payouts.failed || commissions.failed) ? { state: TILE.UNREADABLE, onRetry: load }
        : isDevPayoutShim ? { state: TILE.NOT_RECORDED, reason: 'Advisor earnings are not recorded in the local development service.' }
          : (payouts.state === 'unavailable' || commissions.state === 'unavailable') ? { state: TILE.NOT_RECORDED, reason: payouts.state === 'unavailable' ? payouts.message : commissions.message }
            : { state: TILE.READY, href: '/wellbeing/expert-dashboard', openLabel: 'Open payout settings', body: <div className="advisor-keyvalues"><div><span>Available balance</span><b>{earnings.balance}</b></div><div><span>Lifetime paid</span><b>{earnings.paid}</b></div><div><span>Payout account</span><b>{profile?.stripe_account_status || profile?.stripe?.account_status || 'Not recorded'}</b></div></div> },
  };
  const dim = studio.editing ? 'sm-dim' : '';

  // Owner request: Advisor Studio keeps its interview and modules without a side rail.
  return (
    <main className="advisor-studio sm-tokens" data-testid="advisor-studio-home">
      {previewing && <div className="advisor-preview" role="status" data-testid="status-advisor-preview"><Eye size={15} /> Advisor role preview. Practice data and actions are withheld.</div>}
      {dashboardUnavailable && !previewing && <div className="advisor-warning"><span>{dashboardUnavailable}</span>{onRetryDashboard && <button type="button" onClick={onRetryDashboard} data-testid="button-retry-dashboard"><RefreshCw size={13} /> Retry</button>}</div>}

      <header className="advisor-studio__masthead">
        <div>
          <div className="advisor-studio__title">{!embedded && <h1>Studio</h1>}<Status tone="violet">Advisor</Status><span>Good to see you, {firstName(profile?.name || user?.name)}.</span></div>
          <p className="mt-1 text-[13px] text-axal-muted dark:text-gray-400">{PURPOSE.advisor}</p>
        </div>
        <div className="flex items-center gap-3">
          <time>{new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</time>
          <CustomiseButton studio={studio} primary />
        </div>
      </header>

      <section className={`advisor-assistant-shell ${dim}`} data-testid="module-eadwyn">
        {previewing ? <div className="advisor-complete-row"><div className="advisor-assistant-mark"><Sparkles size={18} /></div><div><strong>Eadwyn</strong><span>Advisor interview is unavailable in role preview.</span></div><Status>Preview only</Status></div>
          : advisorAssistantAvailable ? <StudioInterview persona="advisor" disablePersistedFullscreen onAvailabilityChange={setAdvisorAssistantAvailable} /> : <StateNote text="Eadwyn is unavailable in this environment. Your practice data remains available below." />}
      </section>

      <div className={`sm-fixed ${dim}`} data-testid="section-advisor-profile">
        <StudioFixedLock />
        {!previewing && <ProfileFitSection compact studio audience="advisor" className="advisor-fit-section" />}
        {previewing && <section className="advisor-preview-fit" data-testid="module-assessment"><Sparkles size={18} /><div><strong>Assessment profile</strong><p>Skills, values, and archetype are withheld in this visual role preview.</p></div></section>}
      </div>

      <StudioModules studio={studio} tiles={tiles} withheld={previewing} />
    </main>
  );
}
