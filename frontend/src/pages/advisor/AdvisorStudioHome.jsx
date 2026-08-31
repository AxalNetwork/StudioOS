import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays, ChevronRight, CircleDollarSign, Clock3, ExternalLink, Eye,
  Loader2, MapPin, RefreshCw, ShieldCheck, Sparkles, Store, Users,
} from 'lucide-react';
import { api } from '../../lib/api';
import PersonalAdvisor from '../../components/advisor/PersonalAdvisor';
import ProfileFitSection from '../../components/profile/ProfileFitSection';
import './advisorStudioHome.css';

const unavailable = (message = 'Unavailable in this environment') => ({ state: 'unavailable', message });
const loading = { state: 'loading' };
const ready = (data) => ({ state: 'ready', data });
const failed = (error) => ({ state: 'unavailable', message: error?.message || 'Unavailable in this environment' });
const firstName = (value) => String(value || '').trim().split(/\s+/)[0] || 'there';
const asItems = (value) => Array.isArray(value) ? value : (Array.isArray(value?.items) ? value.items : []);

function formatMoney(cents, currency = 'USD') {
  if (cents == null) return 'Not recorded';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: String(currency || 'USD').toUpperCase(),
    }).format(Number(cents) / 100);
  } catch {
    return `${(Number(cents) / 100).toFixed(2)} ${String(currency || 'USD').toUpperCase()}`;
  }
}

function formatWhen(value) {
  if (!value) return 'Time not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time not recorded';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function Status({ children, tone = 'neutral' }) {
  return <span className={`advisor-status advisor-status--${tone}`} data-testid={`status-${String(children).toLowerCase().replace(/\s+/g, '-')}`}>{children}</span>;
}

function Module({ title, action, to, children, testid, className = '' }) {
  return (
    <section className={`advisor-module ${className}`} data-testid={testid}>
      <header className="advisor-module__header">
        <h2>{title}</h2>
        {to && <Link to={to} data-testid={`link-${testid}`}>{action || 'Open'} <ChevronRight size={13} /></Link>}
      </header>
      {children}
    </section>
  );
}

function Pending({ lines = 2 }) {
  return <div className="advisor-skeleton" aria-label="Loading">{Array.from({ length: lines }).map((_, i) => <i key={i} style={{ width: `${82 - i * 18}%` }} />)}</div>;
}

function StateNote({ text, icon: Icon = ShieldCheck }) {
  return <div className="advisor-state-note"><Icon size={16} /><span>{text}</span></div>;
}

function bookingIdentity(booking) {
  return booking.client_name || booking.founder_name || booking.user_name || booking.name || booking.client_email || booking.founder_email || 'Client identity not recorded';
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
  const [assistantProgress, setAssistantProgress] = useState(loading);
  const [assistantExpanded, setAssistantExpanded] = useState(false);
  const [advisorAssistantAvailable, setAdvisorAssistantAvailable] = useState(true);

  const load = useCallback(() => {
    if (previewing) {
      setAdvisor(unavailable('Advisor data is withheld in role preview.'));
      setSlots(unavailable('Availability is withheld in role preview.'));
      setBookings(unavailable('Client history is withheld in role preview.'));
      setCalendar(unavailable('Calendar is withheld in role preview.'));
      setPayouts(unavailable('Earnings are withheld in role preview.'));
      setAssistantProgress(unavailable('Advisor interview is withheld in role preview.'));
      return;
    }
    setAdvisor(loading); setSlots(loading); setBookings(loading); setCalendar(loading); setPayouts(loading); setAssistantProgress(loading);
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
    api.advisor.progress().then((r) => setAssistantProgress(ready(r || {}))).catch((e) => setAssistantProgress(failed(e)));
  }, [previewing]);

  useEffect(() => { load(); }, [load]);

  const todayItems = useMemo(() => {
    const now = new Date();
    const dayEnd = new Date(now); dayEnd.setHours(23, 59, 59, 999);
    const events = calendar.state === 'ready' ? calendar.data : [];
    const bookingEvents = events.filter((event) => {
      const start = event.start_at || event.start || event.scheduled_start;
      return (event.kind === 'advisor_booking' || event.type === 'advisor_booking') && new Date(start) >= now && new Date(start) <= dayEnd;
    });
    const bookingRows = bookings.state === 'ready' ? bookings.data.filter((b) => {
      const d = new Date(b.scheduled_start || b.slot_starts_at);
      return d >= now && d <= dayEnd && !['cancelled', 'no_show'].includes(b.status);
    }) : [];
    const seen = new Set();
    return [...bookingRows, ...bookingEvents].filter((item) => {
      const id = item.booking_id || item.id;
      if (seen.has(id)) return false; seen.add(id); return true;
    }).sort((a, b) => new Date(a.scheduled_start || a.start_at || a.start) - new Date(b.scheduled_start || b.start_at || b.start));
  }, [bookings, calendar]);

  const engagements = useMemo(() => {
    if (bookings.state !== 'ready') return [];
    const map = new Map();
    bookings.data.forEach((b) => {
      const key = b.founder_user_id || b.client_user_id || b.client_email || b.founder_email || bookingIdentity(b);
      const current = map.get(key) || { key, name: bookingIdentity(b), total: 0, completed: 0, upcoming: 0, latest: null };
      current.total += 1;
      if (b.status === 'completed') current.completed += 1;
      if (['requested', 'confirmed'].includes(b.status)) current.upcoming += 1;
      const at = b.scheduled_start || b.slot_starts_at;
      if (!current.latest || new Date(at) > new Date(current.latest)) current.latest = at;
      map.set(key, current);
    });
    return [...map.values()].sort((a, b) => new Date(b.latest || 0) - new Date(a.latest || 0));
  }, [bookings]);

  const profile = advisor.state === 'ready' ? advisor.data : null;
  const progress = assistantProgress.state === 'ready' ? assistantProgress.data : null;
  const interviewComplete = Boolean(progress?.complete || (Number(progress?.total) > 0 && Number(progress?.percent) >= 100));
  const isDevPayoutShim = import.meta.env.DEV
    && payouts.state === 'ready'
    && Number(payouts.data?.balance_cents) === 0
    && Number(payouts.data?.lifetime_cents) === 0
    && asItems(payouts.data?.commissions).length === 0
    && asItems(payouts.data?.payouts).length === 0;
  const storefrontRows = profile ? [
    ['Public profile', profile.listed === true ? 'Listed' : profile.listed === false ? 'Not listed' : 'Not recorded', profile.listed === true ? 'good' : 'neutral'],
    ['Bookings', profile.accepting_bookings === true ? 'Accepting' : profile.accepting_bookings === false ? 'Not accepting' : 'Not recorded', profile.accepting_bookings === true ? 'good' : 'neutral'],
  ] : [];

  return (
    <main className="advisor-studio" data-testid="advisor-studio-home">
      {previewing && <div className="advisor-preview" data-testid="status-advisor-preview"><Eye size={15} /> Advisor role preview. Practice data and actions are withheld.</div>}
      {dashboardUnavailable && !previewing && <div className="advisor-warning"><span>{dashboardUnavailable}</span>{onRetryDashboard && <button type="button" onClick={onRetryDashboard} data-testid="button-retry-dashboard"><RefreshCw size={13} /> Retry</button>}</div>}

      <header className="advisor-studio__masthead">
        <div>
          <div className="advisor-eyebrow">Advisor practice</div>
          <div className="advisor-studio__title"><h1>Studio</h1><Status tone="violet">Advisor</Status><span>Good to see you, {firstName(profile?.name || user?.name)}.</span></div>
        </div>
        <time>{new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</time>
      </header>

      <div className="advisor-evidence-strip">
        <span>Intro call filter</span><Link to="/office-hours" data-testid="link-storefront-filter">Open storefront <ExternalLink size={12} /></Link>
        <span>Consent to show client outcomes</span><Link to="/advisor/advisory/clients" data-testid="link-client-consent">Open clients <ExternalLink size={12} /></Link>
        <span>Session-note auto-send</span><Link to="/settings" data-testid="link-session-settings">Open settings <ExternalLink size={12} /></Link>
      </div>

      <section className="advisor-assistant-shell" data-testid="module-eadwyn">
        {previewing ? <div className="advisor-complete-row"><div className="advisor-assistant-mark"><Sparkles size={18} /></div><div><strong>Eadwyn</strong><span>Advisor interview is unavailable in role preview.</span></div><Status>Preview only</Status></div>
          : interviewComplete && !assistantExpanded ? (
            <div className="advisor-complete-row" data-testid="status-advisor-interview-complete">
              <div className="advisor-assistant-mark"><Sparkles size={18} /></div>
              <div>
                <strong>Eadwyn</strong>
                <span>Advisor · {progress?.answered || progress?.total}/{progress?.total} answered (100%) · interview complete</span>
              </div>
              <div className="advisor-complete-actions">
                <button type="button" onClick={() => setAssistantExpanded(true)}>Resume <ChevronRight size={13} /></button>
              </div>
            </div>
          ) : advisorAssistantAvailable ? <PersonalAdvisor disablePersistedFullscreen onAvailabilityChange={setAdvisorAssistantAvailable} /> : <StateNote text="Eadwyn is unavailable in this environment. Your practice data remains available below." />}
      </section>

      {!previewing && <ProfileFitSection compact studio audience="advisor" className="advisor-fit-section" />}
      {previewing && <section className="advisor-preview-fit" data-testid="module-assessment"><Sparkles size={18} /><div><strong>Assessment profile</strong><p>Skills, values, and archetype are withheld in this visual role preview.</p></div></section>}

      <div className="advisor-practice-grid">
        <Module title="Today" action="Open calendar" to="/calendar" testid="module-today" className="advisor-module--today">
          {calendar.state === 'loading' || bookings.state === 'loading' ? <Pending lines={3} /> : (calendar.state === 'unavailable' && bookings.state === 'unavailable') ? <StateNote text="Today’s schedule could not be loaded." icon={CalendarDays} /> : (
            <div className="advisor-list">
              {todayItems.map((item, index) => <div className="advisor-row" key={item.id || index}><div><strong>{item.topic || item.title || 'Advisor session'}</strong><span>{formatWhen(item.scheduled_start || item.start_at || item.start)} · {item.duration_min ? `${item.duration_min} min` : 'Duration not recorded'}</span></div><Status tone={item.status === 'confirmed' ? 'good' : 'neutral'}>{item.status || 'Scheduled'}</Status></div>)}
              {slots.state === 'ready' && slots.data.filter((s) => !s.taken && new Date(s.start_at) >= new Date()).slice(0, 2).map((slot) => <div className="advisor-row advisor-row--open" key={slot.id}><div><strong>Open slot</strong><span>{formatWhen(slot.start_at)} · {slot.duration_min || 'Duration not recorded'} min · date-specific</span></div><Status>Open</Status></div>)}
              {todayItems.length === 0 && !(slots.state === 'ready' && slots.data.length) && <StateNote text="No sessions or open slots are scheduled for today." icon={Clock3} />}
            </div>
          )}
        </Module>

        <Module title="Storefront" action="Open storefront" to="/office-hours" testid="module-storefront">
          {advisor.state === 'loading' ? <Pending /> : profile ? <div className="advisor-keyvalues">{storefrontRows.map(([label, value, tone]) => <div key={label}><span>{label}</span><Status tone={tone}>{value}</Status></div>)}<div><span>Visibility</span><b>{profile.status || 'Not recorded'}</b></div></div> : <StateNote text={advisor.message || 'Storefront details are not available.'} icon={Store} />}
        </Module>

        <Module title="Engagements" action="Open clients" to="/advisor/advisory/engagements" testid="module-engagements">
          {bookings.state === 'loading' ? <Pending /> : bookings.state === 'unavailable' ? <StateNote text={bookings.message} icon={Users} /> : engagements.length ? <div className="advisor-list">{engagements.slice(0, 3).map((client) => <div className="advisor-row" key={client.key}><div><strong>{client.name}</strong><span>{client.total} session{client.total === 1 ? '' : 's'} · {client.completed} held{client.upcoming ? ` · ${client.upcoming} upcoming` : ''}</span></div><Status tone={client.upcoming ? 'good' : 'neutral'}>{client.upcoming ? 'Active' : 'History'}</Status></div>)}</div> : <StateNote text="Engagements appear once someone books a session with you." icon={Users} />}
        </Module>

        <Module title="Consented proof" action="Open clients" to="/advisor/advisory/clients" testid="module-consented-proof" className="advisor-module--proof">
          <StateNote text="No consented proof connected yet. Self-reported metrics are never shown as proof. When a client grants consent to share an outcome, it appears here and on your storefront." icon={ShieldCheck} />
        </Module>

        <Module title="Earnings" action="Open payout settings" to="/wellbeing/expert-dashboard" testid="module-earnings">
          {payouts.state === 'loading' ? <Pending /> : payouts.state === 'unavailable' || isDevPayoutShim ? <StateNote text={isDevPayoutShim ? 'Advisor earnings are not recorded in the local development service.' : payouts.message} icon={CircleDollarSign} /> : <div className="advisor-keyvalues"><div><span>Available balance</span><b>{formatMoney(payouts.data.balance_cents, profile?.currency)}</b></div><div><span>Lifetime paid</span><b>{formatMoney(payouts.data.lifetime_cents, profile?.currency)}</b></div><div><span>Payout account</span><b>{profile?.stripe_account_status || profile?.stripe?.account_status || 'Not recorded'}</b></div></div>}
        </Module>
      </div>
    </main>
  );
}