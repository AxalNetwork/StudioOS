import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarDays, CircleDollarSign, FileStack, Landmark, MessageCircle, Network, RefreshCw, Route, Sparkles } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import StudioInterview from '../../components/advisor/StudioInterview';
import ProfileFitSection from '../../components/profile/ProfileFitSection';
import { api, spinoutLab } from '../../lib/api';
import { CardStatus, CompactList, DeckRows, LabRows, MetricRow, RaiseProgress, StudioCard, deckSummary, labSummary, raisePercent } from './founderStudioCards';
import { reportError } from '../../lib/log';
import './founderStudioHome.css';

const array = (value, key) => Array.isArray(value) ? value : (Array.isArray(value?.[key]) ? value[key] : []);
const label = (value) => String(value || '').replace(/[_-]/g, ' ').trim() || 'Not recorded';
const money = (number) => {
  const numeric = typeof number === 'number' || (typeof number === 'string' && number.trim() !== '') ? Number(number) : NaN;
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(numeric)
    : null;
};
const date = (input) => {
  if (!input) return null;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime())
    ? null
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
        // The newest deck version's slides and engagement are two further
        // reads, keyed on that version's id, so they wait for the list.
        const latestDeckId = array(next.deck, 'versions')[0]?.id;
        if (latestDeckId) {
          const deckCalls = [['deckDetail', api.deckGet(latestDeckId)], ['engagement', api.deckEngagement(latestDeckId)]];
          const deckSettled = await Promise.allSettled(deckCalls.map(([, request]) => request));
          if (!active) return;
          deckSettled.forEach((result, index) => {
            const key = deckCalls[index][0];
            if (result.status === 'fulfilled') next[key] = result.value;
            else {
              nextFailures[key] = result.reason?.message || 'Source unavailable';
              reportError(`FounderStudio:${key}`, result.reason);
            }
          });
        }
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
    deck: deckSummary({ versions: array(records.deck, 'versions'), detail: records.deckDetail, engagement: records.engagement }),
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
  const lab = labSummary(context.lab);
  const again = () => setRetry((n) => n + 1);

  return (
    <section className="fs-root" data-testid="founder-studio-home">
      <header className="fs-context">
        <div className="fs-title"><h2 data-testid="text-founder-studio-title">Studio</h2><span className="fs-role" data-testid="badge-founder-studio-role">Founder</span><p>{project?.name ? `${project.name} — one company, one context` : `${first}'s venture context`}{project?.stage ? ` · ${label(project.stage)}` : ''}</p></div>
        <div className="fs-date"><span data-testid="text-founder-studio-date">{new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date())}</span><button type="button" data-testid="button-refresh-founder-studio" onClick={() => setRetry((n) => n + 1)}><RefreshCw size={13} />Refresh context</button></div>
      </header>
      {partial && <div className="fs-partial" data-testid="status-founder-studio-partial">Some live sources are unavailable. Available operating records remain on screen.<button type="button" data-testid="button-retry-founder-studio" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>}

      <div className="fs-advisor" data-testid="section-founder-advisor">
        <StudioInterview persona="founder" disablePersistedFullscreen onAvailabilityChange={setAdvisorAvailable} />
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
          claim="This is not a claim that no next step is recorded."
          onRetry={again}
          empty={!project}
        >
          <MetricRow name="Lifecycle stage" result={context.lifecycle?.stage ? label(context.lifecycle.stage) : null} />
          <MetricRow name="Suggested next" accent result={nextAction?.label || null} />
        </StudioCard>
        <StudioCard title="Pitch deck" icon={FileStack} to={project?.id ? `/raise/pitch?mode=workspace&project_id=${project.id}` : '/raise/pitch?mode=workspace'} action="Open Pitch Deck" loading={loading} error={failures.projects || failures.deck} claim="This is not a claim that no deck exists." onRetry={again} empty={!project}>
          {context.deck
            ? <DeckRows deck={context.deck} detailError={failures.deckDetail} engagementError={failures.engagement} onRetry={again} />
            : <CardStatus>No deck version is saved for this company yet.</CardStatus>}
        </StudioCard>
        <StudioCard title="Raise" icon={CircleDollarSign} to={`/raise/capital${projectQuery}`} action="Open Round Manager" loading={loading} error={failures.projects || failures.raise} claim="This is not a claim that nothing is committed." onRetry={again} empty={!project}>
          <MetricRow name="Target" result={money(activeRound?.target_amount)} />
          <MetricRow name="Committed" accent result={money(context.raise?.raised)} />
          <RaiseProgress pct={raisePercent(context.raise?.raised, activeRound?.target_amount)} />
          <MetricRow name="Next close" result={activeRound?.close_date ? date(activeRound.close_date) : null} />
        </StudioCard>
        <StudioCard title="Key metrics" icon={BarChart3} to={`/build/metrics${projectQuery}`} action="Open Metrics" loading={loading} error={failures.projects || failures.financials} claim="This is not a claim that no metrics are recorded." onRetry={again} empty={!project}>
          <MetricRow name="MRR" result={money(project?.mrr)} />
          <MetricRow name="Modelled burn / month" result={money(financialComputed.avg_monthly_burn)} />
          <MetricRow name="Modelled runway" result={financialComputed.runway_months != null ? `${financialComputed.runway_months} months` : null} />
        </StudioCard>
        <StudioCard title="Office hours" icon={CalendarDays} to="/build/team?mode=workspace&tab=advisor" action="Open Bookings" loading={loading} error={failures.bookings} claim="This is not a claim that nothing is booked." onRetry={again}>
          <CompactList items={context.bookings} empty="No advisory bookings recorded." render={(booking) => <><strong>{booking?.advisor_name || booking?.advisor?.name || booking?.topic || 'Advisory booking'}</strong><small>{booking.scheduled_start ? date(booking.scheduled_start) : label(booking.status)}</small></>} />
        </StudioCard>
        <StudioCard title="Introductions in motion" icon={Network} to="/network?mode=workspace&tab=introductions" action="Open Network" loading={loading} error={failures.intros} claim="This is not a claim that no introduction is in motion." onRetry={again}>
          <CompactList items={context.intros} empty="No active introduction propositions." render={(intro) => <><strong>{intro?.target?.name || intro?.target_name || 'Target not recorded'}</strong><small>{label(intro.status)}</small></>} />
        </StudioCard>
        {(context.subsidiaries.length > 0 || failures.subsidiaries) && <StudioCard title="Independent subsidiaries" icon={Landmark} to="/legal-capital" action="Open Entities" wide error={failures.subsidiaries} claim="This is not a claim that no subsidiary is recorded." onRetry={again}>
          <CompactList items={context.subsidiaries} render={(sub) => <><strong>{sub.subsidiary_name || sub.name || 'Entity not recorded'}</strong><small>{[sub.jurisdiction, sub.status].filter(Boolean).join(' · ') || 'Not recorded'}</small></>} />
        </StudioCard>}
        <StudioCard title="Spin-Out Lab" icon={Sparkles} to="/spinout-lab" action="Continue in the Lab" loading={loading} error={failures.lab} claim="This is not a claim that no milestone is complete." onRetry={again}>
          <LabRows lab={lab} />
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
        <span>Live interview</span>
        <strong>Source unavailable</strong>
        <small>No answers or assessment data have been inferred.</small>
      </div>
    </section>
  );
}
