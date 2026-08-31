import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BarChart3, CalendarDays, CircleDollarSign, FileStack, Landmark, MessageCircle, Network, RefreshCw, Route, Sparkles } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import PersonalAdvisor from '../../components/advisor/PersonalAdvisor';
import ProfileFitSection from '../../components/profile/ProfileFitSection';
import { api, spinoutLab } from '../../lib/api';
import { reportError } from '../../lib/log';
import './founderStudioHome.css';

const array = (value, key) => Array.isArray(value) ? value : (Array.isArray(value?.[key]) ? value[key] : []);
const label = (value) => String(value || '').replace(/[_-]/g, ' ').trim() || 'Not recorded';
const value = (item, keys) => keys.map((key) => item?.[key]).find((v) => v !== undefined && v !== null && v !== '') ?? null;
const money = (number) => {
  const numeric = typeof number === 'number' || (typeof number === 'string' && number.trim() !== '') ? Number(number) : NaN;
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(numeric)
    : 'Not recorded';
};
const date = (input) => {
  if (!input) return 'Not recorded';
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime())
    ? 'Not recorded'
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
};

export default function FounderStudioHome({ user }) {
  const [searchParams] = useSearchParams();
  const requestedProjectId = searchParams.get('project_id');
  const [project, setProject] = useState(null);
  const [records, setRecords] = useState({});
  const [failures, setFailures] = useState({});
  const [advisorAvailable, setAdvisorAvailable] = useState(null);
  const [loading, setLoading] = useState(true);
  const [partial, setPartial] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setPartial(false);
    setFailures({});
    (async () => {
      try {
        const projects = array(await api.listProjects(), 'projects');
        const current = projects.find((item) => Number(item?.id) === Number(requestedProjectId))
          || projects.find((item) => item?.id)
          || null;
        if (!active) return;
        setProject(current);
        const calls = {
          subsidiaries: api.independentSubsidiaries(),
          bookings: api.listMyMenteeBookings(),
          intros: api.introPropositions({ status: 'pending' }),
          lab: spinoutLab.state(),
          lifecycle: current?.id ? api.getLifecycle(current.id) : Promise.resolve(null),
          deck: current?.id ? api.deckListVersions(current.id) : Promise.resolve(null),
          financials: current?.id ? api.getFinancialModel(current.id) : Promise.resolve(null),
          raise: current?.id ? api.raiseRound(current.id) : Promise.resolve(null),
        };
        const entries = Object.entries(calls);
        const settled = await Promise.allSettled(entries.map(([, request]) => request));
        if (!active) return;
        const next = {};
        const nextFailures = {};
        settled.forEach((result, index) => {
          const key = entries[index][0];
          if (result.status === 'fulfilled') next[key] = result.value;
          else {
            nextFailures[key] = result.reason?.message || 'Source unavailable';
            reportError(`FounderStudio:${key}`, result.reason);
          }
        });
        setRecords((previous) => ({ ...previous, ...next }));
        setFailures(nextFailures);
        setPartial(Object.keys(nextFailures).length > 0);
      } catch (error) {
        if (active) {
          setFailures({ projects: error?.message || 'Project source unavailable' });
          setPartial(true);
          reportError('FounderStudio:projects', error);
        }
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [requestedProjectId, retry]);

  const context = useMemo(() => ({
    lifecycle: records.lifecycle || null,
    deck: array(records.deck, 'versions')[0] || array(records.deck, 'items')[0] || null,
    financials: records.financials || null,
    raise: records.raise || null,
    bookings: array(records.bookings, 'items'),
    intros: array(records.intros, 'propositions'),
    subsidiaries: array(records.subsidiaries, 'subsidiaries'),
    lab: records.lab || null,
  }), [records]);

  const nextAction = context.lifecycle?.checklist?.find((item) => !item.done) || context.lifecycle?.next_action || null;
  const projectQuery = project?.id ? `?project_id=${project.id}` : '';
  const financialComputed = context.financials?.computed || {};
  const activeRound = context.raise?.round || null;
  const first = user?.name?.split(' ')[0] || user?.email?.split('@')[0] || 'Founder';

  return (
    <section className="fs-root" data-testid="founder-studio-home">
      <header className="fs-context">
        <div><span className="fs-kicker">Axal Studio / Founder cockpit</span><h2 data-testid="text-founder-studio-title">One company. One clear move.</h2><p>{project?.name || 'Your venture context'}{project?.stage ? ` · ${label(project.stage)}` : ''}</p></div>
        <div className="fs-date"><span>{first}'s operating view</span><button type="button" data-testid="button-refresh-founder-studio" onClick={() => setRetry((n) => n + 1)}><RefreshCw size={13} />Refresh context</button></div>
      </header>
      {partial && <div className="fs-partial" data-testid="status-founder-studio-partial">Some live sources are unavailable. Available operating records remain on screen.<button type="button" data-testid="button-retry-founder-studio" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>}

      <div className="fs-advisor" data-testid="section-founder-advisor">
        <PersonalAdvisor disablePersistedFullscreen onAvailabilityChange={setAdvisorAvailable} />
        {advisorAvailable === false && <AdvisorUnavailable />}
      </div>
      <div className="fs-profile" data-testid="section-founder-profile"><ProfileFitSection compact /></div>

      <div className="fs-grid" aria-busy={loading}>
        <StudioCard
          title="Venture next step"
          icon={Route}
          to={nextAction?.href || `/build/discovery${projectQuery}`}
          action="Continue next step"
          wide
          loading={loading}
          error={failures.projects || failures.lifecycle}
          empty={!project}
        >
          <MetricRow name="Lifecycle stage" result={context.lifecycle?.stage ? label(context.lifecycle.stage) : null} />
          <MetricRow name="Suggested next" accent result={nextAction?.label || null} />
        </StudioCard>
        <StudioCard title="Pitch deck" icon={FileStack} to={project?.id ? `/raise/pitch?mode=workspace&project_id=${project.id}` : '/raise/pitch?mode=workspace'} action="Open Pitch Deck" loading={loading} error={failures.projects || failures.deck} empty={!project}>
          <MetricRow name="Version" result={value(context.deck, ['version', 'version_name', 'title'])} />
          <MetricRow name="Slides" result={value(context.deck, ['slide_count', 'slides_count'])} />
          <MetricRow name="Last updated" result={context.deck?.updated_at ? date(context.deck.updated_at) : null} />
        </StudioCard>
        <StudioCard title="Raise" icon={CircleDollarSign} to={`/raise/capital${projectQuery}`} action="Open Round Manager" loading={loading} error={failures.projects || failures.raise} empty={!project}>
          <MetricRow name="Target" result={money(activeRound?.target_amount)} />
          <MetricRow name="Committed" accent result={money(context.raise?.raised)} />
          <MetricRow name="Next close" result={activeRound?.close_date ? date(activeRound.close_date) : null} />
        </StudioCard>
        <StudioCard title="Key metrics" icon={BarChart3} to={`/build/metrics${projectQuery}`} action="Open Metrics" loading={loading} error={failures.projects || failures.financials} empty={!project}>
          <MetricRow name="MRR" result={money(project?.mrr)} />
          <MetricRow name="Modelled burn / month" result={money(financialComputed.avg_monthly_burn)} />
          <MetricRow name="Modelled runway" result={financialComputed.runway_months != null ? `${financialComputed.runway_months} months` : null} />
        </StudioCard>
        <StudioCard title="Office hours" icon={CalendarDays} to="/build/team?tab=advisor" action="Open Bookings" loading={loading} error={failures.bookings}>
          <CompactList items={context.bookings} empty="No advisory bookings recorded." render={(booking) => <><strong>{booking?.advisor_name || booking?.advisor?.name || booking?.topic || 'Advisory booking'}</strong><small>{booking.scheduled_start ? date(booking.scheduled_start) : label(booking.status)}</small></>} />
        </StudioCard>
        <StudioCard title="Introductions in motion" icon={Network} to="/network?mode=workspace&tab=introductions" action="Open Network" loading={loading} error={failures.intros}>
          <CompactList items={context.intros} empty="No active introduction propositions." render={(intro) => <><strong>{intro?.target?.name || intro?.target_name || 'Target not recorded'}</strong><small>{label(intro.status)}</small></>} />
        </StudioCard>
        {context.subsidiaries.length > 0 && <StudioCard title="Independent subsidiaries" icon={Landmark} to="/legal-capital" action="Open Entities" wide>
          <CompactList items={context.subsidiaries} render={(sub) => <><strong>{sub.subsidiary_name || sub.name || 'Entity not recorded'}</strong><small>{[sub.jurisdiction, sub.status].filter(Boolean).join(' · ') || 'Not recorded'}</small></>} />
        </StudioCard>}
        <StudioCard title="Spin-Out Lab" icon={Sparkles} to="/spinout-lab" action="Continue in the Lab" loading={loading} error={failures.lab}>
          <MetricRow name={context.lab?.week ? `Week ${context.lab.week}` : 'Program'} accent result={context.lab?.active ? `${value(context.lab, ['completed_count', 'completed']) || 0} completed` : null} />
          <MetricRow name="Current focus" result={value(context.lab, ['phase_label', 'current_phase', 'week_title'])} />
        </StudioCard>
      </div>
    </section>
  );
}

function AdvisorUnavailable() {
  return (
    <section className="fs-advisor-unavailable" role="status" data-testid="status-founder-advisor-unavailable">
      <div className="fs-advisor-unavailable-main">
        <span className="fs-advisor-mark"><MessageCircle size={17} /></span>
        <div>
          <div className="fs-advisor-title">
            <h3>Eadwyn</h3>
            <span>Founder interview</span>
          </div>
          <p>The guided founder interview is not available in this environment. Your existing Studio records remain below.</p>
        </div>
      </div>
      <div className="fs-advisor-unavailable-note">
        <span>Live advisor</span>
        <strong>Source unavailable</strong>
        <small>No answers or assessment data have been inferred.</small>
      </div>
    </section>
  );
}

function StudioCard({ title, icon: Icon, to, action, wide, loading, error, empty, children }) {
  const slug = title.toLowerCase().replaceAll(' ', '-');
  return (
    <article className={`fs-card ${wide ? 'fs-wide' : ''}`} data-testid={`card-founder-${slug}`}>
      <div className="fs-card-head">
        <span><Icon size={15} />{title}</span>
        <Link to={to} data-testid={`link-founder-${slug}`}>{action}<ArrowUpRight size={13} /></Link>
      </div>
      {loading ? <CardStatus kind="loading">Loading live records…</CardStatus> : (
        <>
          {error && <CardStatus kind="error">Live source unavailable.</CardStatus>}
          {empty ? <CardStatus>Select or create a startup to populate this module.</CardStatus> : children}
        </>
      )}
    </article>
  );
}

function CardStatus({ kind = 'empty', children }) {
  return <p className={`fs-card-status fs-card-status-${kind}`}>{children}</p>;
}

function MetricRow({ name, result, accent }) { return <div className="fs-metric"><span>{name}</span><b className={accent ? 'fs-accent' : ''} data-testid={`value-founder-${name.toLowerCase().replaceAll(' ', '-')}`}>{result ?? 'Not recorded'}</b></div>; }
function CompactList({ items, empty, render }) { return <div className="fs-list">{items.length ? items.slice(0, 3).map((item, index) => <div className="fs-list-item" key={item?.id || item?.uid || index} data-testid={`row-founder-record-${item?.id || item?.uid || index}`}>{render(item)}</div>) : <p className="fs-empty">{empty || 'No records available.'}</p>}</div>; }