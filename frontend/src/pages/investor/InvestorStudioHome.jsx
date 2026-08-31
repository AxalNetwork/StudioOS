import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CircleAlert, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import PersonalAdvisor from '../../components/advisor/PersonalAdvisor';
import ProfileFitSection from '../../components/profile/ProfileFitSection';
import InvestorQuotaBars from '../../components/InvestorQuotaBars';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import './investorStudioHome.css';

const list = (data, keys = []) => Array.isArray(data) ? data : keys.reduce((found, key) => found || (Array.isArray(data?.[key]) ? data[key] : null), null) || [];
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const readable = (value) => String(value || '').replace(/[_-]/g, ' ').trim() || 'Not recorded';
const score = (item) => number(item?.score ?? item?.ai_score ?? item?.match_score);
const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date) : 'Date not recorded';
};

export default function InvestorStudioHome({
  user,
  dashboard,
  lifecycle,
  previewing = false,
  dashboardUnavailable = '',
  onRetryDashboard,
}) {
  const [advisorAvailable, setAdvisorAvailable] = useState(null);
  const [records, setRecords] = useState({ portfolio: undefined, events: undefined });
  const [failures, setFailures] = useState({});
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    if (previewing) {
      setRecords({ portfolio: null, events: null });
      setFailures({});
      return () => { alive = false; };
    }
    setRecords({ portfolio: undefined, events: undefined });
    setFailures({});
    // listCalendarEvents has no "upcoming" flag contract; filtering locally
    // retains only dated future records and never invents a calendar item.
    const calls = [['portfolio', api.positionsAnalytics()], ['events', api.listCalendarEvents()]];
    Promise.allSettled(calls.map(([, fn]) => fn)).then((outcomes) => {
      if (!alive) return;
      const next = {}; const errors = {};
      outcomes.forEach((result, index) => {
        const key = calls[index][0];
        if (result.status === 'fulfilled') next[key] = result.value;
        else { errors[key] = result.reason?.message || 'Source unavailable'; reportError(`InvestorStudio:${key}`, result.reason); }
      });
      setRecords(next); setFailures(errors);
    });
    return () => { alive = false; };
  }, [previewing, retry]);

  const opportunities = useMemo(() => list(dashboard?.ai_scored_opportunities, ['items', 'opportunities']).filter(Boolean).slice(0, 4), [dashboard]);
  const dealCount = list(dashboard?.proprietary_deal_flow, ['items', 'deals']).length;
  const stages = list(lifecycle?.stages, ['items']);
  const counts = lifecycle?.counts || {};
  const portfolio = records.portfolio;
  const events = list(records.events, ['events', 'items']).filter((event) => {
    const when = event?.start_at || event?.starts_at || event?.date;
    return when && new Date(when).getTime() >= Date.now();
  }).sort((a, b) => new Date(a.start_at || a.starts_at || a.date) - new Date(b.start_at || b.starts_at || b.date)).slice(0, 2);
  const first = user?.name?.split(' ')[0] || user?.email?.split('@')[0] || 'Investor';
  const refreshContext = () => {
    setRetry((n) => n + 1);
    onRetryDashboard?.();
  };

  return (
    <section className="is-root" data-testid="investor-studio-home">
      <header className="is-context">
        <div><span className="is-kicker">Axal Studio / Investor cockpit</span><h1 data-testid="text-investor-studio-title">Thesis in motion.</h1><p>{previewing ? 'Investor workspace preview · private investor records are withheld' : `${first}'s allocation view · live records only`}</p></div>
        <button type="button" className="is-refresh" onClick={refreshContext} data-testid="button-refresh-investor-studio"><RefreshCw size={14} />Refresh context</button>
      </header>
      {previewing && <div className="is-source-note" data-testid="status-investor-preview"><CircleAlert size={15} />You are previewing the Investor workspace as an administrator. Investor-scoped values are withheld because this session is not an investor identity.</div>}
      {!previewing && dashboardUnavailable && <div className="is-source-note" data-testid="status-investor-dashboard-unavailable"><CircleAlert size={15} />The deal-flow summary is temporarily unavailable. Independent Investor Studio sources remain visible.<button type="button" onClick={refreshContext}>Retry</button></div>}
      {Object.keys(failures).length > 0 && <div className="is-source-note" data-testid="status-investor-studio-partial"><CircleAlert size={15} />Some private sources are unavailable. No values have been estimated.<button type="button" onClick={() => setRetry((n) => n + 1)} data-testid="button-retry-investor-studio">Retry</button></div>}

      <div className="is-advisor" data-testid="section-investor-advisor">
        {previewing ? <AdvisorUnavailable previewing /> : <PersonalAdvisor disablePersistedFullscreen onAvailabilityChange={setAdvisorAvailable} />}
        {!previewing && advisorAvailable === false && <AdvisorUnavailable />}
      </div>
      <div className="is-assessment" data-testid="section-investor-assessment">
        {previewing ? <AssessmentUnavailable /> : <ProfileFitSection compact audience="investor" />}
      </div>

      <div className="is-top-grid">
        <article className="is-card" data-testid="card-investor-quota"><CardHead title="Usage & quota" to="/pricing/investor" label="Open account" /><InvestorQuotaBars user={user} compact /></article>
        <article className="is-card is-lifecycle" data-testid="card-investor-lifecycle"><CardHead title="Deal lifecycle" to="/deals" label="Open deals" />
          {previewing ? <Status>Investor-scoped lifecycle is withheld in administrator preview.</Status> : lifecycle === undefined ? <Loading /> : lifecycle === null ? <Status error>Deal lifecycle unavailable.</Status> : stages.length ? <div className="is-funnel">{stages.slice(0, 5).map((stage) => <Link to={stage.href || '/deals'} key={stage.id || stage.label} data-testid={`link-investor-stage-${stage.id || stage.label}`}><b>{number(stage.count) ?? 0}</b><span>{stage.label || readable(stage.id)}</span></Link>)}</div> : <Status>No lifecycle records yet.</Status>}
          <p className="is-card-note">Read-only here — stages move in Deals, never from this surface.</p>
        </article>
      </div>

      <div className="is-main-grid">
        <article className="is-card is-opportunities" data-testid="card-investor-opportunities"><CardHead title="AI-scored opportunities" to="/deals" label="Open deals" />
          {previewing ? <Status>Investor-scoped opportunities are withheld in administrator preview.</Status> : dashboardUnavailable ? <Status error>Deal-flow opportunities are temporarily unavailable.</Status> : !dashboard ? <Loading /> : opportunities.length ? <div className="is-opportunity-list">{opportunities.map((item, index) => <Opportunity key={item.id || item.deal_id || index} item={item} index={index} />)}</div> : <Status>No scored opportunities are recorded against your thesis.</Status>}
          <p className="is-card-note">Scores are match signals against your thesis answers — Eadwyn proposes; it never places a deal.</p>
        </article>
        <article className="is-card" data-testid="card-investor-quick-stats"><CardHead title="Quick stats" to="/portfolio/positions" label="Open portfolio" />
          <Row label="Deals in flow" value={previewing || dashboardUnavailable ? null : dealCount} /><Row label="Avg AI match" value={previewing || dashboardUnavailable ? null : number(dashboard?.quick_stats?.ai_score_avg)} /><Row label="Watching" value={previewing ? null : counts.watching} /><Row label="Active deal rooms" value={previewing ? null : counts.dealrooms} />
        </article>
      </div>
      <div className="is-bottom-grid">
        <article className="is-card" data-testid="card-investor-portfolio"><CardHead title="Portfolio glance" to="/portfolio/performance" label="Open portfolio" />
          {previewing ? <Status>Investor-scoped performance is withheld in administrator preview.</Status> : portfolio === undefined ? <Loading /> : failures.portfolio ? <Status error>Portfolio performance is unavailable.</Status> : <PortfolioRows data={portfolio} />}
          <p className="is-card-note">IRR reads “Not recorded” until enough dated cash flows exist to calculate it honestly.</p>
        </article>
        <article className="is-card" data-testid="card-investor-events"><CardHead title="Upcoming events" to="/calendar" label="Open events" />
          {previewing ? <Status>Investor-scoped events are withheld in administrator preview.</Status> : records.events === undefined ? <Loading /> : failures.events ? <Status error>Upcoming events are unavailable.</Status> : events.length ? <div className="is-event-list">{events.map((event, index) => <Link to="/calendar" key={event.id || index} data-testid={`link-investor-event-${event.id || index}`}><b>{event.title || event.name || 'Event title not recorded'}</b><span>{formatDate(event.start_at || event.starts_at || event.date)}</span></Link>)}</div> : <Status>No upcoming events recorded.</Status>}
        </article>
      </div>
    </section>
  );
}

function AdvisorUnavailable({ previewing = false }) { return <section className="is-advisor-unavailable" data-testid="status-investor-advisor-unavailable"><Sparkles size={17} /><div><b>Eadwyn · Investor interview</b><p>{previewing ? 'Private interview answers are withheld in administrator preview. Sign in as an investor to continue the live interview.' : 'The guided investor interview is unavailable in this environment. Existing deal and portfolio records remain visible below.'}</p></div><span>{previewing ? 'Preview only' : 'Source unavailable'}</span></section>; }
function AssessmentUnavailable() { return <section className="is-assessment-unavailable" data-testid="status-investor-assessment-preview"><div><b>Skills</b><span>Investor-scoped assessment withheld</span></div><div><b>Values</b><span>Investor-scoped assessment withheld</span></div><div><b>Investor archetype</b><span>Investor-scoped assessment withheld</span></div></section>; }
function CardHead({ title, to, label }) { return <header className="is-card-head"><h2>{title}</h2><Link to={to} data-testid={`link-investor-${title.toLowerCase().replaceAll(' ', '-')}`}>{label}<ArrowUpRight size={13} /></Link></header>; }
function Loading() { return <div className="is-loading" data-testid="status-investor-loading"><Loader2 size={15} className="animate-spin" />Loading live records…</div>; }
function Status({ children, error }) { return <p className={`is-status ${error ? 'is-status-error' : ''}`} data-testid="status-investor-empty">{children}</p>; }
function Row({ label, value }) { return <div className="is-row"><span>{label}</span><b>{value === null || value === undefined ? 'Not recorded' : value}</b></div>; }
function Opportunity({ item, index }) { const id = item.deal_id || item.id; const value = score(item); return <div className="is-opportunity" data-testid={`row-investor-opportunity-${id || index}`}><span className="is-score">{value == null ? '—' : Math.round(value)}</span><div><b>{item.deal_name || item.name || 'Confidential deal'}</b><p>{[item.sector, item.stage, item.source].filter(Boolean).map(readable).join(' · ') || 'Details not recorded'}</p><nav><Link to={id ? `/projects/${id}` : '/deals'} data-testid={`link-investor-open-deal-${id || index}`}>Open</Link><Link to="/watchlist" data-testid={`link-investor-watchlist-${id || index}`}>Watchlist</Link><Link to="/deals" data-testid={`link-investor-request-intro-${id || index}`}>Request intro</Link></nav></div></div>; }
function PortfolioRows({ data }) { const source = data?.analytics || data || {}; return <><Row label="IRR" value={source.irr != null ? `${source.irr}%` : null} /><Row label="TVPI" value={source.tvpi != null ? `${source.tvpi}×` : null} /><Row label="MOIC" value={source.moic != null ? `${source.moic}×` : null} /></>; }