import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight, BriefcaseBusiness, Building2, Eye, RefreshCw, ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { api } from '../../lib/api';
import PersonalAdvisor from '../../components/advisor/PersonalAdvisor';
import ProfileFitSection from '../../components/profile/ProfileFitSection';
import './partnerStudioHome.css';

const loading = { state: 'loading' };
const unavailable = (message) => ({ state: 'unavailable', message: message || 'Not available from a connected source.' });
const ready = (data) => ({ state: 'ready', data });
const asItems = (data) => {
  if (Array.isArray(data)) return data;
  for (const key of ['items', 'engagements', 'pitches', 'attributions', 'rows']) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
};
const label = (value) => String(value || 'Not recorded').replace(/[_-]/g, ' ');
const titleCase = (value) => label(value).replace(/\b\w/g, (letter) => letter.toUpperCase());

function money(value) {
  if (value == null || value === '') return 'Not recorded';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'Not recorded';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function date(value) {
  if (!value) return 'Date not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Date not recorded' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(parsed);
}

function Skeleton({ lines = 2 }) {
  return <div className="partner-skeleton" aria-label="Loading">{Array.from({ length: lines }, (_, index) => <i key={index} style={{ width: `${92 - index * 17}%` }} />)}</div>;
}

function State({ children }) {
  return <div className="partner-state"><ShieldCheck size={15} /><span>{children}</span></div>;
}

function Status({ children, tone = 'neutral' }) {
  return <span className={`partner-status partner-status--${tone}`}>{children}</span>;
}

function Module({ title, to, action = 'Open', testid, previewing, children, wide = false }) {
  return (
    <section className={`partner-module ${wide ? 'partner-module--wide' : ''}`} data-testid={testid}>
      <header className="partner-module__header">
        <h2>{title}</h2>
        {previewing
          ? <span className="partner-inert">{action} <ShieldCheck size={12} /></span>
          : <Link to={to} data-testid={`link-${testid}`}>{action} <ArrowUpRight size={12} /></Link>}
      </header>
      {children}
    </section>
  );
}

export default function PartnerStudioHome({
  user,
  dashboard = null,
  previewing = false,
  dashboardUnavailable = '',
  onRetryDashboard,
}) {
  const [profile, setProfile] = useState(loading);
  const [analytics, setAnalytics] = useState(loading);
  const [engagements, setEngagements] = useState(loading);
  const [pitches, setPitches] = useState(loading);
  const [attributions, setAttributions] = useState(loading);
  const [referrals, setReferrals] = useState(loading);
  const [assistantAvailable, setAssistantAvailable] = useState(true);

  const load = useCallback(() => {
    if (previewing) {
      setProfile(unavailable('Partner identity is withheld in role preview.'));
      setAnalytics(unavailable('Business development analytics are withheld in role preview.'));
      setEngagements(unavailable('Delivery work is withheld in role preview.'));
      setPitches(unavailable('Co-marketing records are withheld in role preview.'));
      setAttributions(unavailable('Attribution records are withheld in role preview.'));
      setReferrals(unavailable('Referral records are withheld in role preview.'));
      return;
    }
    setProfile(loading); setAnalytics(loading); setEngagements(loading); setPitches(loading); setAttributions(loading); setReferrals(loading);
    api.partnerPortal.getProfile().then((r) => setProfile(ready(r?.partner || null))).catch((e) => setProfile(unavailable(e?.message)));
    api.quotesAnalytics().then((r) => setAnalytics(ready(r || null))).catch((e) => setAnalytics(unavailable(e?.message)));
    api.listEngagements().then((r) => setEngagements(ready(asItems(r)))).catch((e) => setEngagements(unavailable(e?.message)));
    api.referralOverview().then((r) => setReferrals(ready(r || null))).catch((e) => setReferrals(unavailable(e?.message)));
    if (typeof api.listMyCoMarketingPitches === 'function') {
      api.listMyCoMarketingPitches().then((r) => setPitches(ready(asItems(r)))).catch((e) => setPitches(unavailable(e?.message)));
    } else setPitches(unavailable('Co-marketing is not connected in this environment.'));
    if (typeof api.listMyCoMarketingAttributions === 'function') {
      api.listMyCoMarketingAttributions().then((r) => setAttributions(ready(asItems(r)))).catch((e) => setAttributions(unavailable(e?.message)));
    } else setAttributions(unavailable('Attribution records are not connected in this environment.'));
  }, [previewing]);

  useEffect(() => { load(); }, [load]);

  const partner = profile.state === 'ready' ? profile.data : null;
  const pipeline = analytics.state === 'ready' ? analytics.data?.pipeline : null;
  const delivery = analytics.state === 'ready' ? analytics.data?.delivery : null;
  const engagementRows = engagements.state === 'ready' ? engagements.data : [];
  const taskRows = useMemo(() => engagementRows.filter((item) => (
    item && (item.task_title || item.assigned_task_title || item.due_at || item.due_date)
  )).slice(0, 3), [engagementRows]);
  const activeRelationships = useMemo(() => engagementRows.filter((item) => item?.status || item?.founder_name || item?.project_name || item?.client_name).slice(0, 2), [engagementRows]);
  const publishedPitches = pitches.state === 'ready' ? pitches.data.filter((pitch) => ['published', 'live'].includes(String(pitch?.status || '').toLowerCase())) : [];
  const first = String(partner?.name || user?.name || '').trim().split(/\s+/)[0] || 'there';
  const referralCounts = referrals.state === 'ready' ? referrals.data?.counts : null;

  return (
    <main className="partner-studio" data-testid="partner-studio-home">
      {previewing && <div className="partner-preview" data-testid="status-partner-preview"><Eye size={15} /> Partner role preview. Private firm records and actions are withheld.</div>}
      {dashboardUnavailable && <div className="partner-warning"><span>{dashboardUnavailable}</span>{onRetryDashboard && <button type="button" onClick={onRetryDashboard} data-testid="button-retry-dashboard"><RefreshCw size={13} /> Retry</button>}</div>}

      <header className="partner-masthead">
        <div>
          <div className="partner-eyebrow">Service Partner / Operator</div>
          <div className="partner-title"><h1>Studio</h1><Status tone="violet">Partner</Status><span>Good to see you, {first}.</span></div>
        </div>
        <time>{new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</time>
      </header>

      <div className="partner-context">
        <span><Building2 size={12} /> {previewing ? 'Firm context withheld' : (partner?.company || 'Firm not recorded')}</span>
        <span><BriefcaseBusiness size={12} /> {previewing ? 'Specialization withheld' : (partner?.specialization || 'Specialization not recorded')}</span>
        {!previewing && <Link to="/account" data-testid="link-partner-settings">Partner settings <ArrowUpRight size={12} /></Link>}
      </div>

      <section className="partner-assistant" data-testid="module-eadwyn">
        {previewing ? <div className="partner-assistant-placeholder"><Sparkles size={18} /><div><strong>Eadwyn</strong><span>Partner/Operator assessment is unavailable in role preview.</span></div><Status>Preview only</Status></div>
          : assistantAvailable ? <PersonalAdvisor disablePersistedFullscreen onAvailabilityChange={setAssistantAvailable} />
            : <State>Eadwyn is unavailable in this environment. Your studio data remains available below.</State>}
      </section>

      {previewing
        ? <section className="partner-assessment-preview" data-testid="module-partner-assessment"><Sparkles size={18} /><div><strong>Partner/Operator assessment</strong><p>Skills, working values, and archetype are withheld in this visual role preview.</p></div></section>
        : <ProfileFitSection compact studio audience="partner" className="partner-fit" />}

      <div className="partner-grid">
        <Module title="Assigned delivery tasks" action="Open delivery" to="/partner/operations/engagements" testid="module-assigned-tasks" previewing={previewing} wide>
          {engagements.state === 'loading' ? <Skeleton lines={3} /> : engagements.state === 'unavailable' ? <State>{engagements.message}</State> : taskRows.length ? <div className="partner-list">{taskRows.map((item, index) => <div className="partner-row" key={item.id || item.uid || index}><div><strong>{item.task_title || item.assigned_task_title || item.need_title || item.title || 'Assigned task'}</strong><span>{item.due_at || item.due_date ? `Due ${date(item.due_at || item.due_date)}` : 'Due date not recorded'}</span></div><Status tone={['accepted', 'in_progress', 'active'].includes(item.status) ? 'good' : 'neutral'}>{titleCase(item.status)}</Status></div>)}</div> : <State>Assigned delivery tasks are not available from a connected source.</State>}
        </Module>

        <Module title="BD pipeline" action="Open pipeline" to="/partner/insights" testid="module-bd-pipeline" previewing={previewing}>
          {analytics.state === 'loading' ? <Skeleton /> : !pipeline ? <State>{analytics.message || 'Pipeline analytics are not recorded.'}</State> : <div className="partner-kv">
            {pipeline.open != null && <div><span>Live proposals</span><b>{pipeline.open}</b></div>}
            {pipeline.pending != null && <div><span>Pending</span><b>{pipeline.pending}</b></div>}
            {pipeline.open_value != null && <div><span>Open value</span><b>{money(pipeline.open_value)}</b></div>}
            {pipeline.win_rate_pct != null && <div><span>Win rate</span><b>{pipeline.win_rate_pct}%</b></div>}
            {pipeline.accepted != null && <div><span>Accepted</span><b>{pipeline.accepted}</b></div>}
          </div>}
        </Module>

        <Module title="Relationship health" action="Open relationships" to="/partner/operations/portfolio" testid="module-relationship-health" previewing={previewing}>
          {engagements.state === 'loading' ? <Skeleton /> : engagements.state === 'unavailable' ? <State>{engagements.message}</State> : activeRelationships.length ? <div className="partner-list">{activeRelationships.map((item, index) => <div className="partner-row" key={item.id || item.uid || index}><div><strong>{item.project_name || item.client_name || item.founder_name || item.need_title || 'Engagement'}</strong><span>{item.updated_at ? `Updated ${date(item.updated_at)}` : item.created_at ? `Created ${date(item.created_at)}` : 'Activity date not recorded'}</span></div><Status tone={['accepted', 'in_progress', 'active'].includes(item.status) ? 'good' : 'neutral'}>{titleCase(item.status)}</Status></div>)}</div> : <State>No relationship state is available from connected engagements.</State>}
        </Module>

        <Module title="Co-marketing" action="Open co-marketing" to="/comarketing" testid="module-comarketing" previewing={previewing}>
          <div className="partner-kv">
            <div><span>Published</span><b>{pitches.state === 'loading' ? 'Loading…' : pitches.state === 'ready' ? `${publishedPitches.length} pitch${publishedPitches.length === 1 ? '' : 'es'}` : 'Unavailable'}</b></div>
            <div><span>Attributed leads</span><b>{attributions.state === 'loading' ? 'Loading…' : attributions.state === 'ready' ? attributions.data.length : 'Unavailable'}</b></div>
          </div>
          {pitches.state === 'unavailable' && attributions.state === 'unavailable' && <State>Co-marketing records are not available from connected sources.</State>}
        </Module>

        <Module title="Referrals" action="Open referrals" to="/referrals" testid="module-referrals" previewing={previewing}>
          {referrals.state === 'loading' ? <Skeleton /> : referrals.state === 'unavailable' ? <State>{referrals.message}</State> : <div className="partner-kv">
            <div><span>Submitted</span><b>{referralCounts?.total ?? 'Not recorded'}</b></div>
            <div><span>Converted</span><b>{referralCounts?.converted ?? 'Not recorded'}</b></div>
            <div><span>Rewards issued</span><b>{referralCounts?.reward_issued ?? 'Not recorded'}</b></div>
          </div>}
        </Module>

        <Module title="Delivery book" action="Open engagements" to="/partner/operations/engagements" testid="module-delivery-book" previewing={previewing}>
          {analytics.state === 'loading' ? <Skeleton /> : !delivery ? <State>{analytics.message || 'Delivery analytics are not recorded.'}</State> : <div className="partner-kv">
            {delivery.active != null && <div><span>Active engagements</span><b>{delivery.active}</b></div>}
            {delivery.active_value != null && <div><span>Active value</span><b>{money(delivery.active_value)}</b></div>}
            {delivery.delivered != null && <div><span>Delivered</span><b>{delivery.delivered}</b></div>}
            {delivery.delivered_value != null && <div><span>Delivered value</span><b>{money(delivery.delivered_value)}</b></div>}
          </div>}
        </Module>
      </div>
    </main>
  );
}