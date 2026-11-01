import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import StudioModules from '../studio/StudioModules';
import { CustomiseButton, StudioFixedLock } from '../studio/StudioParts';
import { PURPOSE, TILE } from '../studio/studioLayoutModel';
import { useStudioLayout } from '../studio/useStudioLayout';
import StudioInterview from '../../components/advisor/StudioInterview';
import ProfileFitSection from '../../components/profile/ProfileFitSection';
import { AWAITING_DECISION, isBookableSlot, slotMinutes, slotView } from './advisory/kit';
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

export default function AdvisorStudioHome({
  user,
  dashboard = null,
  previewing = false,
  dashboardUnavailable = '',
  onRetryDashboard,
}) {
  const [advisor, setAdvisor] = useState(loading);
  const [slots, setSlots] = useState(loading);
  const [bookings, setBookings] = useState(loading);
  const [calendar, setCalendar] = useState(loading);
  const [payouts, setPayouts] = useState(loading);
  const [commissions, setCommissions] = useState(loading);
  const [advisorAssistantAvailable, setAdvisorAssistantAvailable] = useState(true);

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
    setAdvisor(loading); setSlots(loading); setBookings(loading); setCalendar(loading); setPayouts(loading); setCommissions(loading);
    api.getMyAdvisor()
      .then((profile) => {
        if (!profile?.uid) { setAdvisor(unavailable('Your advisor profile is not available yet.')); setSlots(unavailable('Publish an advisor profile to manage slots.')); return; }
        setAdvisor(ready(profile));
        api.listAdvisorSlots(profile.uid, true).then((r) => setSlots(ready(asItems(r)))).catch((e) => setSlots(failed(e)));
      })
      .catch((e) => { setAdvisor(failed(e)); setSlots(failed(e)); });
    api.listMyAdvisorBookings().then((r) => setBookings(ready(asItems(r)))).catch((e) => setBookings(failed(e)));
    api.listCalendarEvents().then((r) => setCalendar(ready(asItems(r)))).catch((e) => setCalendar(failed(e)));
    api.payoutsMe().then((r) => setPayouts(ready(r || {}))).catch((e) => setPayouts(failed(e)));
    api.commissionsMe().then((r) => setCommissions(ready(r || {}))).catch((e) => setCommissions(failed(e)));
  }, [previewing]);

  useEffect(() => { load(); }, [load]);

  const todayItems = useMemo(() => {
    const now = new Date();
    const dayEnd = new Date(now); dayEnd.setHours(23, 59, 59, 999);
    const events = calendar.state === 'ready' ? calendar.data : [];
    const bookingEvents = events.filter((event) => {
      const start = itemStart(event);
      return (event.kind === 'advisor_booking' || event.type === 'advisor_booking') && new Date(start) >= now && new Date(start) <= dayEnd;
    });
    const bookingRows = bookings.state === 'ready' ? bookings.data.filter((b) => {
      const d = new Date(itemStart(b));
      return d >= now && d <= dayEnd && !['cancelled', 'no_show'].includes(b.status);
    }) : [];
    const seen = new Set();
    return [...bookingRows, ...bookingEvents].filter((item) => {
      const id = item.booking_id || item.id;
      if (seen.has(id)) return false; seen.add(id); return true;
    // This list MIXES two sources: advisor bookings, whose time is
    // `slot_starts_at` from the worker (or `scheduled_start` from the dev
    // backend), and calendar events, whose time is genuinely `start_at`. The
    // chain omitted `slot_starts_at`, so every worker booking sorted as
    // Invalid Date — NaN — and the order was undefined.
    }).sort((a, b) => new Date(itemStart(a)) - new Date(itemStart(b)));
  }, [bookings, calendar]);

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
  const todayOpenSlots = useMemo(() => {
    if (slots.state !== 'ready') return [];
    const now = new Date();
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    // This block carried a sixth private copy of the slot adapter — correct,
    // but private, which is precisely how the other five copies drifted and
    // how AdvisorsPage stayed broken. One implementation, in ./advisory/kit.
    return slots.data.filter((slot) => {
      if (!isBookableSlot(slot)) return false;
      const start = new Date(slotView(slot).startsAt);
      return start >= now && start <= end;
    }).sort((a, b) => new Date(slotView(a).startsAt) - new Date(slotView(b).startsAt));
  }, [slots]);

  const studio = useStudioLayout({ profile: 'advisor', viewer: user, readOnly: previewing });
  const withheld = { state: TILE.WITHHELD };
  const tiles = previewing ? Object.fromEntries(['today', 'storefront', 'engagements', 'consented_proof', 'earnings'].map((k) => [k, withheld])) : {
    today: calendar.state === 'loading' || bookings.state === 'loading' ? { state: TILE.LOADING }
      : (calendar.state === 'unavailable' && bookings.state === 'unavailable') ? { state: TILE.UNREADABLE, onRetry: load }
        : (todayItems.length === 0 && todayOpenSlots.length === 0) ? { state: TILE.EMPTY, empty: 'No sessions or open slots are scheduled for today.', href: '/calendar', openLabel: 'Open calendar' }
          : {
            state: TILE.READY,
            href: '/calendar',
            openLabel: 'Open calendar',
            body: (
              <div className="advisor-list">
                {todayItems.map((item, index) => <div className="advisor-row" key={item.id || index}><div><strong>{item.topic || item.title || 'Advisor session'}</strong><span>{formatWhen(itemStart(item))}{minutesLabel(item)}</span></div><Status tone={item.status === 'confirmed' ? 'good' : 'neutral'}>{item.status || 'Scheduled'}</Status></div>)}
                {todayOpenSlots.slice(0, 2).map((slot) => <div className="advisor-row advisor-row--open" key={slot.id}><div><strong>Open slot</strong><span>{formatWhen(slotView(slot).startsAt)}{minutesLabel(slot)} · date-specific</span></div><Status>Open</Status></div>)}
              </div>
            ),
          },
    storefront: advisor.state === 'loading' ? { state: TILE.LOADING }
      : advisor.failed ? { state: TILE.UNREADABLE, onRetry: load }
        : !profile ? { state: TILE.NOT_RECORDED, reason: advisor.message || 'Storefront details are not available.', href: '/expertise/profile', openLabel: 'Open storefront' }
          : { state: TILE.READY, href: '/expertise/profile', openLabel: 'Open storefront', body: <div className="advisor-keyvalues">{storefrontRows.map(([label, value, tone]) => <div key={label}><span>{label}</span><Status tone={tone}>{value}</Status></div>)}<div><span>Visibility</span><b>{profile.status || 'Not recorded'}</b></div></div> },
    engagements: bookings.state === 'loading' ? { state: TILE.LOADING }
      : bookings.state === 'unavailable' ? { state: TILE.UNREADABLE, onRetry: load }
        : !engagements.length ? { state: TILE.EMPTY, empty: 'Engagements appear once someone books a session with you.', href: '/advisor/advisory/engagements', openLabel: 'Open clients' }
          : {
            state: TILE.READY,
            note: `${engagements.filter((c) => c.upcoming).length} active`,
            href: '/advisor/advisory/engagements',
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
          <div className="advisor-studio__title"><h1>Studio</h1><Status tone="violet">Advisor</Status><span>Good to see you, {firstName(profile?.name || user?.name)}.</span></div>
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
