import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import StudioModules from '../studio/StudioModules';
import { CustomiseButton, StudioFixedLock } from '../studio/StudioParts';
import { PURPOSE, TILE } from '../studio/studioLayoutModel';
import { useStudioLayout } from '../studio/useStudioLayout';
import StudioInterview from '../../components/advisor/StudioInterview';
import ProfileFitSection from '../../components/profile/ProfileFitSection';
import { useLocation } from 'react-router-dom';
import { AWAITING_DECISION } from './advisory/kit';
import { advisorToday, todayState } from './advisorToday';
import { STALE_AFTER_MS } from './advisorTodayView';
import { todayTile, useTodayReturn } from './AdvisorTodayTile';
import './advisorStudioHome.css';
import { earningsFigures } from './advisorEarnings';
import { ADVISOR_AGENDA_KINDS } from '../studio/studioAgenda';

const unavailable = (message = 'Unavailable in this environment') => ({ state: 'unavailable', message });
const loading = { state: 'loading' };
const ready = (data) => ({ state: 'ready', data });
// A read that FAILED, told apart from one that answered "not available" (D1419: the tile says could not be read).
const failed = (error) => ({ state: 'unavailable', failed: true, message: error?.message || 'Unavailable in this environment' });
const firstName = (value) => String(value || '').trim().split(/\s+/)[0] || 'there';
const asItems = (value) => Array.isArray(value) ? value : (Array.isArray(value?.items) ? value.items : []);

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
  // D8732 (SAV06F): while `keeping` is set, a source read again keeps what it returned in place, so Refresh keeps the rows.
  const keeping = useRef(false);
  const read = useCallback((key, set, ask, shape) => {
    const mine = (latest.current[key] || 0) + 1;
    latest.current[key] = mine;
    if (!keeping.current) set(loading);
    ask().then((r) => { if (latest.current[key] === mine) set(ready(shape(r))); })
      .catch((e) => { if (latest.current[key] === mine) set(failed(e)); });
  }, []);
  const loadBookings = useCallback(() => read('bookings', setBookings, () => api.listMyAdvisorBookings(), asItems), [read]);
  // The calendar answer is kept whole: its `sources` say whether the advisor-booking source was actually read.
  // D5203 (#5203): Today reads only the kinds it draws, never all of the calendar's sources.
  const loadCalendar = useCallback(() => read('calendar', setCalendar, () => api.listCalendarEvents({ kinds: ADVISOR_AGENDA_KINDS.join(',') }), (r) => r), [read]);
  const loadSlots = useCallback((uid) => read('slots', setSlots, () => api.listAdvisorSlots(uid, true), asItems), [read]);
  // D8732 (#8732): when Today was read, and the clock it is judged Stale by (SAV06F).
  const [readAt, setReadAt] = useState(() => new Date());
  const [clock, setClock] = useState(() => new Date());

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
    setReadAt(new Date()); setClock(new Date());
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

  // D8732 (SAV06F): the clock moves each minute and when the tab comes back, so Today says Stale after 30 minutes.
  useEffect(() => {
    if (previewing || typeof window === 'undefined') return undefined;
    const tick = () => setClock(new Date());
    const timer = window.setInterval(tick, 60_000);
    const back = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener?.('visibilitychange', back);
    return () => { window.clearInterval(timer); document.removeEventListener?.('visibilitychange', back); };
  }, [previewing]);

  // The Today list's reads: bookings, the calendar and the slots (D4620).
  // `clock` is a dependency so the list is judged again as time passes (a session that ends leaves Today).
  const today = useMemo(() => advisorToday({ bookings, calendar, slots }), [bookings, calendar, slots, clock]); // eslint-disable-line react-hooks/exhaustive-deps
  const todayKind = todayState(today);
  // D8732 (SAV03): back from a session's drawer, focus and scroll return to its row once Today has settled.
  const location = useLocation();
  useTodayReturn(location.state, todayKind !== 'loading' && bookings.state !== 'loading');
  // Retry asks again for the inputs that failed, and nothing else.
  const retryToday = useCallback(() => {
    if (today.failed.includes('bookings')) loadBookings();
    if (today.failed.includes('calendar')) loadCalendar();
    if (today.failed.includes('slots')) {
      if (advisor.state === 'ready' && advisor.data?.uid) loadSlots(advisor.data.uid); else load();
    }
  }, [today, advisor, loadBookings, loadCalendar, loadSlots, load]);
  // D8732 (SAV06F): Refresh reads all three again and keeps the rows while it reads.
  const refreshToday = useCallback(() => {
    setReadAt(new Date()); setClock(new Date());
    keeping.current = true;
    try {
      loadBookings(); loadCalendar();
      if (advisor.state === 'ready' && advisor.data?.uid) loadSlots(advisor.data.uid);
    } finally { keeping.current = false; }
  }, [advisor, loadBookings, loadCalendar, loadSlots]);
  const viewerZone = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } }, []);

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
    today: todayTile(today, todayKind, {
      now: clock, readAt, zone: viewerZone, from: `${location.pathname}${location.search || ''}`, onRetry: retryToday,
      onRefresh: clock.getTime() - readAt.getTime() >= STALE_AFTER_MS ? refreshToday : null,
    }),
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
