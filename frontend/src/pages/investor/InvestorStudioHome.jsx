/**
 * The investor's /studio (D321's honest states, D564's one Studio per profile).
 *
 * D1419 (#3698) — the Studio modularity canvas (SM2, SM11). The fixed blocks
 * stay: Eadwyn's chat and the profile-fit band, with its lock. The six cards
 * are modules now (`pages/studio/tiles/investorTiles.jsx`), drawn in the
 * member's saved layout or the investor default; the reads below are the
 * same, one per source, shared by the tiles. The header is Studio, the
 * purpose line and Customise. No AIRail on /studio (owner, #3698 G).
 */
import { useMemo, useState } from 'react';
import { CircleAlert, Sparkles } from 'lucide-react';
import StudioInterview from '../../components/advisor/StudioInterview';
import ProfileFitSection from '../../components/profile/ProfileFitSection';
import { quickStats } from './investorStudioParts';
import StudioModules from '../studio/StudioModules';
import { CustomiseButton, StudioFixedLock } from '../studio/StudioParts';
import { PURPOSE } from '../studio/studioLayoutModel';
import { INVESTOR_AGENDA_KINDS, calendarCoverage, upcomingActive } from '../studio/studioAgenda';
import { useStudioLayout } from '../studio/useStudioLayout';
import { investorTiles } from '../studio/tiles/investorTiles';
import InvestorThesisBand from './InvestorThesisBand';
import { useInvestorSources } from './useInvestorSources';
import './investorStudioHome.css';

const list = (data, keys = []) => Array.isArray(data) ? data : keys.reduce((found, key) => found || (Array.isArray(data?.[key]) ? data[key] : null), null) || [];

export default function InvestorStudioHome({
  user,
  dashboard,
  lifecycle,
  previewing = false,
  dashboardUnavailable = '',
  onRetryDashboard,
  onRetryLifecycle,
  // D4474 (#4474): a block on a multi-licence Studio. The page owns the "Studio" h1, so the home leaves out its own.
  embedded = false,
}) {
  const [advisorAvailable, setAdvisorAvailable] = useState(null);
  // #4622: each source is read, committed and retried on its own (`useInvestorSources`).
  const { records, failures, read, readAll, retryFailed } = useInvestorSources({ previewing });

  // D4362 (#4362): an admin previewing arranges their own Investor Studio; its tiles stay withheld (`withheld`).
  const studio = useStudioLayout({ profile: 'investor', viewer: user });
  const opportunities = useMemo(() => list(dashboard?.ai_scored_opportunities, ['items', 'opportunities']).filter(Boolean).slice(0, 4), [dashboard]);
  // D4620 (#4620): the count is the ELIGIBLE total the worker counted, never the preview's length (the
  // preview is capped, and was cut before eligibility); null when the read failed or the payload predates it.
  const dealSummary = dashboard?.proprietary_deal_flow_summary;
  const dealCount = dealSummary && Number.isFinite(dealSummary.total) ? dealSummary.total : null;
  const stages = list(lifecycle?.stages, ['items']);
  // Upcoming = active (not cancelled / no-show) and ahead of now, soonest first. A 200 whose relevant
  // sources failed is a partial answer, and the tile says so.
  const eventsCoverage = calendarCoverage(records.events, INVESTOR_AGENDA_KINDS);
  const events = upcomingActive(eventsCoverage.items, { limit: 2 });
  const refreshContext = () => {
    readAll();
    onRetryDashboard?.();
  };
  // Retry asks again only for the sources that failed (and for a calendar that answered incompletely).
  const retrySources = () => retryFailed(eventsCoverage.state !== 'ready');
  // The lifecycle is read by Dashboard.jsx. Where it passes no retry of its
  // own (the dashboard itself failed, so the lifecycle was never asked for),
  // retrying the dashboard is what reads it again.
  const retryLifecycle = onRetryLifecycle || refreshContext;
  const quick = quickStats({ previewing, dashboard, dashboardUnavailable, lifecycle, dealCount, dealCountIsLowerBound: dealSummary?.total_is_lower_bound === true });
  const tiles = investorTiles({
    user, previewing, dashboard, dashboardUnavailable, lifecycle, records, failures, opportunities, stages, events, eventsCoverage, quick, refreshContext, retryLifecycle, retrySources, retrySource: read,
  });

  return (
    <section className="is-root sm-tokens" data-testid="investor-studio-home">
      <header className="is-context">
        <div className="is-title">{!embedded && <h1 data-testid="text-investor-studio-title">Studio</h1>}<span className="is-role" data-testid="badge-investor-studio-role">Investor</span><p>{previewing ? 'Investor workspace preview · private investor records are withheld' : PURPOSE.investor}</p></div>
        <div className="is-date"><span data-testid="text-investor-studio-date">{new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date())}</span><CustomiseButton studio={studio} primary /></div>
      </header>
      {previewing && <div className="is-source-note" role="status" data-testid="status-investor-preview"><CircleAlert size={15} />You are previewing the Investor workspace as an administrator. Investor-scoped values are withheld because this session is not an investor identity.</div>}
      {!previewing && dashboardUnavailable && <div className="is-source-note" data-testid="status-investor-dashboard-unavailable"><CircleAlert size={15} />The deal-flow summary is temporarily unavailable. Independent Investor Studio sources remain visible.<button type="button" onClick={refreshContext}>Retry</button></div>}

      {/* D1424 (#3700, PH8, owner E): the thesis band, linking to its Settings card. Withheld in an admin preview. */}
      {!previewing && <InvestorThesisBand />}

      <div className={`is-advisor ${studio.editing ? 'sm-dim' : ''}`} data-testid="section-investor-advisor">
        {previewing ? <AdvisorUnavailable previewing /> : <StudioInterview persona="investor" disablePersistedFullscreen onAvailabilityChange={setAdvisorAvailable} />}
        {!previewing && advisorAvailable === false && <AdvisorUnavailable />}
      </div>
      <div className={`is-assessment sm-fixed ${studio.editing ? 'sm-dim' : ''}`} data-testid="section-investor-assessment">
        <StudioFixedLock />
        {previewing ? <AssessmentUnavailable /> : <ProfileFitSection compact audience="investor" />}
      </div>

      <StudioModules studio={studio} tiles={tiles} withheld={previewing} />
    </section>
  );
}

function AdvisorUnavailable({ previewing = false }) { return <section className="is-advisor-unavailable" data-testid="status-investor-advisor-unavailable"><Sparkles size={17} /><div><b>Eadwyn · Investor interview</b><p>{previewing ? 'Private interview answers are withheld in administrator preview. Sign in as an investor to continue the live interview.' : 'The guided investor interview is unavailable in this environment. Existing deal and portfolio records remain visible below.'}</p></div><span>{previewing ? 'Preview only' : 'Source unavailable'}</span></section>; }
function AssessmentUnavailable() { return <section className="is-assessment-unavailable" data-testid="status-investor-assessment-preview"><div><b>Skills</b><span>Investor-scoped assessment withheld</span></div><div><b>Values</b><span>Investor-scoped assessment withheld</span></div><div><b>Investor archetype</b><span>Investor-scoped assessment withheld</span></div></section>; }
