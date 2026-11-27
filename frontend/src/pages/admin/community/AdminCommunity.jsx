import React, { useCallback, useMemo, useRef } from 'react';
import ActivityLightbox from './ActivityLightbox';
import CirclesLightbox from './CirclesLightbox';
import EventsLightbox from './EventsLightbox';
import JobsLightbox from './JobsLightbox';
import { AdminPageHeader, RailFrame, WorkerRail } from '../../../ui';
import { BELOW_MD_QUERY, usePhoneWidth } from '../../../ui/phone/usePhoneWidth.js';
import { INSIGHTS_EMPTY_LEAD, KPI_KEYS, MANAGE_LINE, MANAGE_TITLE, MOVED_KEY, MOVED_NOTICE, PAGE_LINE, PAGE_UNREADABLE, PERIODS, SCOPE_LABEL, SCOPE_TITLE, asOfLabel, buildActivity, buildCircles, buildConsoles, buildEventsFunnel, buildJobs, buildNeeds, buildNextUp, buildTiles, buildWellbeing, buildWho, clockOf, isEmptyCommunity, pageFailed, searchWithWeeks, weeksFrom } from './communityModel';
import { openFrom, searchWith } from './lightboxModel';
import { PhoneDashboard } from './page/PhoneDashboard';
import { RecentCard } from './page/RecentCard';
import { ActivityCard, AttentionCard, EventsCard, JobsCard, NetworkCard, WellbeingCard, WhoCard } from './page/cards';
import { CARD, DANGER, H2, LINK, ManageRow, SUB, Tile } from './page/parts';
import { AdditionalInsights, BuildCommunity } from './page/sections';
import { useCommunityReads } from './page/useCommunityReads';
import { RefreshCw } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

/**
 * D930 (#2367) — Admin › Community at /admin/community, built to the owner's
 * "Community overview" canvas (CM1–CM13). /admin/held/community redirects
 * here through `HeldCommunityRedirect` (CM13's notice).
 *
 * D930 drew the shell and the blocks whose reads existed. D933 (#2717)
 * draws the rest on D931's Community read and D932's activity read: the
 * period control (`?weeks=4|12|52`, 12 by default), every tile and delta,
 * the weekly chart and its table, the funnel and events by type, who takes
 * part, wellbeing, the waits in Needs a decision, and Recent activity.
 *
 * EACH READ ANSWERS ALONE. A failed read costs only the blocks it feeds and
 * says so; Try again reads everything again. When every read fails, the banner
 * says nothing here is a zero, and the consoles strip still opens every console
 * (CM10). Nothing on this page names a member, and nothing is decided here:
 * Review opens the console that decides.
 *
 * D4820 (#4820), Community v2: four KPIs (Waiting on you, Upcoming events,
 * Event registrations, Job applications), Needs your attention directly under
 * them, cards that collapse to one line when they have nothing to draw, one
 * View details and one Manage … → per domain, the figures no store records
 * behind one Additional insights row, and Manage Community's six rows. A
 * genuinely empty Community (`isEmptyCommunity`, never one it could not read)
 * shows Build your community instead of the analytics.
 *
 * D4820 part 2: below 768px the overview is CM09's phone hierarchy
 * (`PhoneDashboard`): 2 × 2 KPIs, the queue at three rows, the next event, an
 * activity summary with View chart, More analytics as disclosure rows, four
 * recent rows, then Manage Community and Additional insights. 44px targets.
 *
 * D934 (#2718): the four lightboxes, CM3–CM6. `?open=events|jobs|circles|
 * activity` opens one, so a link can; Esc or Close takes it off the address,
 * and focus goes back to the opener. Below 1024px a lightbox is the page.
 */

/** A Manage Community door's name for assistive tech: the visible "Open" and its destination. */
const openLabel = (name) => `Open ${name}`;

const BOXES = { events: EventsLightbox, jobs: JobsLightbox, circles: CirclesLightbox, activity: ActivityLightbox };

export default function AdminCommunity() {
  const loc = useLocation();
  const navigate = useNavigate();
  const weeks = weeksFrom(loc.search);
  const { reads, asOf, reload, tick } = useCommunityReads(weeks);
  const moved = new URLSearchParams(loc.search).get('moved') === MOVED_KEY;
  // #4717: one clock for every time-relative figure, the Community read's own
  // `as_of`, so Refresh moves days open, waits and Overdue with the rows.
  const now = useMemo(() => clockOf(reads, asOf), [reads, asOf]);
  const phone = usePhoneWidth();
  // D4820 part 2 (CM09): below 768px the overview has its own hierarchy; a tablet keeps the two-column grid.
  const small = usePhoneWidth(BELOW_MD_QUERY);
  const periodRefs = useRef({});
  const box = openFrom(loc.search);
  const Box = box ? BOXES[box] : null;
  // Opening pushes, so Back closes it too; closing replaces, so it is not reopened by Back.
  const openBox = useCallback((b) => {
    navigate({ pathname: loc.pathname, search: searchWith(loc.search, b), hash: loc.hash }, { replace: !b });
  }, [loc.search, loc.pathname, loc.hash, navigate]);
  const closeBox = useCallback(() => openBox(null), [openBox]);

  const dismissMoved = useCallback(() => {
    const next = new URLSearchParams(loc.search);
    next.delete('moved');
    const q = next.toString();
    navigate({ pathname: loc.pathname, search: q ? `?${q}` : '', hash: loc.hash }, { replace: true });
  }, [loc.search, loc.pathname, loc.hash, navigate]);

  const tiles = useMemo(() => buildTiles(reads), [reads]);
  // D4820: four of the eight figures are the KPI row; the rest are drawn in their domain's card.
  const fig = useMemo(() => Object.fromEntries(tiles.map((t) => [t.key, t])), [tiles]);
  const next = useMemo(() => buildNextUp(reads), [reads]);
  const jobs = useMemo(() => buildJobs(reads), [reads]);
  const circ = useMemo(() => buildCircles(reads), [reads]);
  const needs = useMemo(() => buildNeeds(reads), [reads]);
  const activity = useMemo(() => buildActivity(reads), [reads]);
  const ev = useMemo(() => buildEventsFunnel(reads), [reads]);
  const who = useMemo(() => buildWho(reads), [reads]);
  const wb = useMemo(() => buildWellbeing(reads), [reads]);
  const setWeeks = useCallback((w) => {
    navigate({ pathname: loc.pathname, search: searchWithWeeks(loc.search, w), hash: loc.hash }, { replace: true });
  }, [loc.search, loc.pathname, loc.hash, navigate]);
  const doors = useMemo(() => buildConsoles(reads), [reads]);
  const failed = pageFailed(reads);
  // D4820 part 4: the Events lightbox's strip and tabs read what the overview already holds, so they cannot disagree with it.
  const community = useMemo(() => ({ ev, fig, weeks, onRetry: reload }), [ev, fig, weeks, reload]);
  const empty = isEmptyCommunity(reads);

  const rail = (
    <WorkerRail
      workspace="Community"
      role="admin"
      stance="What members did in Community, as counts"
      note="This rail reads HQ’s own database, the accounts HQ holds on axal.vc, and no other."
      coverage={[
        'Approvals waiting, events in the next 30 days and their seats, job postings by status, circles by type and the advisors and partners roster, from the Community read',
        'Registrations, applications and expert bookings by week, show-up, events by type, who takes part, experts by state and the check-in band, as counts, from the Community read',
        'The ten newest community items, with no member named, from the activity read',
      ]}
      coverageNote="Each figure is read alone; one that cannot be read says so and the others still answer."
      unavailable={[
        ['A community figure for a branch', 'No branch is deployed, and these consoles read HQ’s own rows.'],
      ]}
      data-testid="community-rail"
    />
  );

  return (
    <RailFrame rail={rail} data-testid="admin-community">
      {Box && phone ? <Box onClose={closeBox} now={now} community={community} /> : (
      <div className="flex flex-col gap-5 pb-24 lg:pb-10" data-testid="admin-community-page">
        <AdminPageHeader
          title="Community"
          line={PAGE_LINE}
          notice={{ text: moved ? MOVED_NOTICE : null, onDismiss: dismissMoved }}
        />
        <div className="flex flex-col gap-[7px]" data-testid="community-toolbar">
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
            <span title={SCOPE_TITLE} className="cursor-help rounded-full border border-axal-hairline bg-white px-3 py-1 font-mono text-[11.5px] font-medium text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="community-scope-chip">{SCOPE_LABEL}</span>
            <div role="radiogroup" aria-label="Period" className="grid w-full grid-cols-3 gap-[3px] md:flex md:w-auto rounded-[9px] bg-axal-ground p-[3px] dark:bg-gray-800" data-testid="community-period"
              onKeyDown={(e) => {
                // #4717 package 6: the radio group's keys (WAI-ARIA): arrows move and wrap, Home and End go to
                // the ends, and focus moves WITH the choice, so the next arrow starts from where it is.
                const i = PERIODS.findIndex((p) => p.weeks === weeks);
                const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
                const to = e.key === 'Home' ? 0 : e.key === 'End' ? PERIODS.length - 1 : step ? (i + step + PERIODS.length) % PERIODS.length : -1;
                if (to < 0) return;
                e.preventDefault();
                setWeeks(PERIODS[to].weeks);
                periodRefs.current[PERIODS[to].weeks]?.focus();
              }}>
              {PERIODS.map((p) => (
                <button key={p.weeks} type="button" role="radio" aria-checked={p.weeks === weeks} tabIndex={p.weeks === weeks ? 0 : -1}
                  ref={(el) => { periodRefs.current[p.weeks] = el; }}
                  onClick={() => setWeeks(p.weeks)} data-testid={`community-period-${p.weeks}`}
                  className={`min-h-[32px] max-md:min-h-[44px] whitespace-nowrap rounded-[7px] px-2.5 py-1.5 text-[12px] font-bold ${p.weeks === weeks ? 'bg-white text-axal-ink shadow-sm dark:bg-gray-900 dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`}>{p.label}</button>
              ))}
            </div>
            <span className="ml-auto flex items-center gap-2.5">
              <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="community-asof">{asOf ? `Updated ${asOfLabel(asOf)}` : 'Reading…'}</span>
              <button type="button" aria-label="Refresh" onClick={reload} data-testid="community-refresh" className="grid h-9 w-9 max-md:h-11 max-md:w-11 place-items-center rounded-[9px] border border-axal-hairline text-axal-muted dark:border-gray-700"><RefreshCw size={16} aria-hidden="true" /></button>
            </span>
          </div>
          <p className="m-0 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="community-period-line">{`Period figures cover the last ${weeks} weeks, Monday weeks in UTC, this week so far. Deltas compare with the ${weeks} weeks before.`}</p>
        </div>

        {failed && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-axal-destructive-edge bg-axal-destructive-tint px-3.5 py-3 text-[13px] text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" data-testid="community-unreadable">
            <span>{PAGE_UNREADABLE}</span>
            <button type="button" className={DANGER} onClick={reload}>Try again</button>
          </div>
        )}

        {!failed && empty && (
          // D4820 CM04a: a genuinely empty Community: no analytics wall, no zero series.
          <>
            <BuildCommunity />
            <div className="grid grid-cols-12 gap-3.5"><AttentionCard needs={needs} onRetry={reload} /></div>
          </>
        )}

        {!failed && !empty && small && (
          <PhoneDashboard reads={reads} fig={fig} needs={needs} next={next} activity={activity} ev={ev} who={who} jobs={jobs} circ={circ} wb={wb} weeks={weeks} tick={tick} onRetry={reload} onOpen={openBox} />
        )}

        {!failed && !empty && !small && (
          <>
            <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="community-tiles">
              {KPI_KEYS.map((k) => <Tile key={k} t={fig[k]} onRetry={reload} />)}
            </div>
            <div className="grid grid-cols-12 gap-3.5">
              <AttentionCard needs={needs} onRetry={reload} />
              <ActivityCard activity={activity} span={needs.state === 'ready' && needs.clear ? 12 : 7} onRetry={reload} onOpen={openBox} />
              <EventsCard next={next} ev={ev} showUp={fig['show-up']} weeks={weeks} onRetry={reload} onOpen={openBox} />
              <WhoCard who={who} onRetry={reload} />
              <JobsCard jobs={jobs} onRetry={reload} onOpen={openBox} />
              <NetworkCard circles={circ.circles} roster={circ.roster} figures={fig} onRetry={reload} onOpen={openBox} />
              <WellbeingCard wb={wb} experts={fig.experts} weeks={weeks} onRetry={reload} />
              <RecentCard refresh={tick} onOpen={openBox} />
            </div>
          </>
        )}

        {/* CM01 puts Additional insights above Manage Community; CM04a, the empty Community, and CM09, the phone, below it. */}
        {!failed && !empty && !small ? <AdditionalInsights /> : null}
        {/* D4820 CM01: Manage Community, six destination rows, each a literal Link (the shell's reachability guards read this file). */}
        <section aria-labelledby="community-h-manage" className={`${CARD} flex flex-col`}>
          <span className="flex flex-wrap items-baseline justify-between gap-2 px-4 pb-1 pt-3.5">
            <h2 id="community-h-manage" className={H2}>{MANAGE_TITLE}</h2>
            <span className={SUB}>{MANAGE_LINE}</span>
          </span>
          <ul className="m-0 list-none p-0" data-testid="community-manage">
            <ManageRow testId="community-manage-events" name="Events" what="Review, publish and run events" figure={doors.events}>
              <Link to="/admin/events" className={LINK} aria-label={openLabel('Events')}>Open →</Link>
            </ManageRow>
            <ManageRow testId="community-manage-jobs" name="Job board" what="Review and manage opportunities" figure={doors.jobs}>
              <Link to="/admin/jobs" className={LINK} aria-label={openLabel('Job board')}>Open →</Link>
            </ManageRow>
            <ManageRow testId="community-manage-circles" name="Circles" what="Create, publish and feature circles" figure={doors.circles}>
              <Link to="/admin/circles" className={LINK} aria-label={openLabel('Circles')}>Open →</Link>
            </ManageRow>
            <ManageRow testId="community-manage-roster" name="Advisors & Partners" what="Manage the network roster">
              <Link to="/admin/advisors-partners" className={LINK} aria-label={openLabel('Advisors & Partners')}>Open →</Link>
            </ManageRow>
            <ManageRow testId="community-manage-wellbeing" name="Wellbeing" what="Verify experts and manage the library" figure={doors.wellbeing}>
              <Link to="/admin/wellbeing" className={LINK} aria-label={openLabel('Wellbeing')}>Open →</Link>
            </ManageRow>
            {/* D923: Partner invitations have no pending queue, so no figure is invented. */}
            <ManageRow testId="community-manage-partner-invitations" name="Partner invitations" what="Invite and manage operating partners">
              <Link to="/admin/partner-invitations" className={LINK} aria-label={openLabel('Partner invitations')}>Open →</Link>
            </ManageRow>
          </ul>
        </section>
        {!failed && empty ? <AdditionalInsights lead={INSIGHTS_EMPTY_LEAD} /> : null}
        {!failed && !empty && small ? <AdditionalInsights /> : null}
      </div>
      )}
      {Box && !phone ? <Box onClose={closeBox} now={now} community={community} /> : null}
    </RailFrame>
  );
}
