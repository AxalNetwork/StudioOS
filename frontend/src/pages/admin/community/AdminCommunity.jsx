import React, { useCallback, useMemo, useRef } from 'react';
import ActivityLightbox from './ActivityLightbox';
import CirclesLightbox from './CirclesLightbox';
import EventsLightbox from './EventsLightbox';
import JobsLightbox from './JobsLightbox';
import { AdminPageHeader, RailFrame, WorkerRail } from '../../../ui';
import { usePhoneWidth } from '../../../ui/phone/usePhoneWidth.js';
import { EMPTY_LINE, MOVED_KEY, MOVED_NOTICE, NOT_RECORDED, PAGE_LINE, PAGE_UNREADABLE, PERIODS, SCOPE_LABEL, SCOPE_TITLE, asOfLabel, buildActivity, buildCircles, buildConsoles, buildEventsFunnel, buildJobs, buildNeeds, buildNextUp, buildTiles, buildWellbeing, buildWho, clockOf, isEmptyCommunity, pageFailed, searchWithWeeks, weeksFrom } from './communityModel';
import { openFrom, searchWith } from './lightboxModel';
import { RecentCard } from './page/RecentCard';
import { ActivityCard, CirclesCard, EventsCard, JobsCard, NeedsCard, WellbeingCard, WhoCard } from './page/cards';
import { Console, DANGER, EYE, GHOST, H2, LINK, PRIMARY, SUB, Tile } from './page/parts';
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
 * D934 (#2718): the four lightboxes, CM3–CM6. `?open=events|jobs|circles|
 * activity` opens one, so a link can; Esc or Close takes it off the address,
 * and focus goes back to the opener. Below 1024px a lightbox is the page.
 */

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
      {Box && phone ? <Box onClose={closeBox} now={now} /> : (
      <div className="flex flex-col gap-5 pb-24 lg:pb-10" data-testid="admin-community-page">
        <AdminPageHeader
          title="Community"
          line={PAGE_LINE}
          notice={{ text: moved ? MOVED_NOTICE : null, onDismiss: dismissMoved }}
        />
        <div className="flex flex-col gap-[7px]" data-testid="community-toolbar">
          {empty && (
            <div className="flex flex-wrap items-center gap-3" data-testid="community-empty">
              <span className="text-[13.5px] text-axal-ink dark:text-gray-100">{EMPTY_LINE}</span>
              <Link to="/admin/circles" className={PRIMARY}>Create a circle</Link>
              <Link to="/admin/events" className={GHOST}>See events</Link>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
            <span title={SCOPE_TITLE} className="cursor-help rounded-full border border-axal-hairline bg-white px-3 py-1 font-mono text-[11.5px] font-medium text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="community-scope-chip">{SCOPE_LABEL}</span>
            <div role="radiogroup" aria-label="Period" className="flex gap-[3px] rounded-[9px] bg-axal-ground p-[3px] dark:bg-gray-800" data-testid="community-period"
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
                  className={`min-h-[32px] whitespace-nowrap rounded-[7px] px-2.5 py-1.5 text-[12px] font-bold ${p.weeks === weeks ? 'bg-white text-axal-ink shadow-sm dark:bg-gray-900 dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`}>{p.label}</button>
              ))}
            </div>
            <span className="ml-auto flex items-center gap-2.5">
              <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="community-asof">{asOf ? `Updated ${asOfLabel(asOf)}` : 'Reading…'}</span>
              <button type="button" aria-label="Refresh" onClick={reload} data-testid="community-refresh" className="grid h-9 w-9 place-items-center rounded-[9px] border border-axal-hairline text-axal-muted dark:border-gray-700"><RefreshCw size={16} aria-hidden="true" /></button>
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

        {!failed && (
          <>
            <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="community-tiles">
              {tiles.map((t) => (t.key === 'waiting'
                ? <Tile key={t.key} t={t} onRetry={reload}><Link to="/admin/approvals" className={`${LINK} self-start`}>Open Approvals</Link></Tile>
                : <Tile key={t.key} t={t} onRetry={reload} />))}
            </div>
            <div className="grid grid-cols-12 gap-3.5">
              <ActivityCard activity={activity} onRetry={reload} onOpen={openBox} />
              <EventsCard next={next} ev={ev} weeks={weeks} onRetry={reload} onOpen={openBox} />
              <WhoCard who={who} onRetry={reload} />
              <JobsCard jobs={jobs} onRetry={reload} onOpen={openBox} />
              <CirclesCard circles={circ.circles} roster={circ.roster} onRetry={reload} onOpen={openBox} />
              <WellbeingCard wb={wb} onRetry={reload} />
              <NeedsCard needs={needs} onRetry={reload} />
              <RecentCard refresh={tick} onOpen={openBox} />
              {NOT_RECORDED.map((n) => (
                <section key={n.key} className="col-span-12 flex flex-col gap-2 rounded-[12px] border border-dashed border-axal-hairline px-[18px] py-4 dark:border-gray-700 lg:col-span-6" data-testid={`community-unrecorded-${n.key}`}>
                  <span className="flex items-baseline justify-between gap-2">
                    <h2 className={H2}>{n.title}</h2>
                    <span className={EYE}>Not recorded</span>
                  </span>
                  <span className={SUB}>{n.reason}</span>
                </section>
              ))}
            </div>
          </>
        )}

        <section aria-labelledby="community-h-consoles" className="flex flex-col gap-2.5">
          <h2 id="community-h-consoles" className={H2}>Consoles</h2>
          <ul className="m-0 grid list-none grid-cols-1 gap-3.5 p-0 sm:grid-cols-2 lg:grid-cols-3" data-testid="community-consoles">
            <Console testId="community-console-events" name="Events" what="Review, publish and run events" figure={doors.events}>
              <Link to="/admin/events" className={LINK}>Open events</Link>
            </Console>
            <Console testId="community-console-jobs" name="Job board" what="Approve or reject postings members write" figure={doors.jobs}>
              <Link to="/admin/jobs" className={LINK}>Open job board</Link>
            </Console>
            <Console testId="community-console-circles" name="Circles" what="Create, publish and feature circles" figure={doors.circles}>
              <Link to="/admin/circles" className={LINK}>Open circles</Link>
            </Console>
            <Console testId="community-console-roster" name="Advisors & Partners" what="The roster shown on decks and pages" figure={doors.roster}>
              <Link to="/admin/advisors-partners" className={LINK}>Open advisors &amp; partners</Link>
            </Console>
            <Console testId="community-console-wellbeing" name="Wellbeing" what="Verify experts and keep the library" figure={doors.wellbeing}>
              <Link to="/admin/wellbeing" className={LINK}>Open wellbeing</Link>
            </Console>
            <Console testId="community-console-partner-invitations" name="Partner invitations" what="Bring operating partners in and keep their deals healthy" figure={{ state: 'unrecorded', text: 'Not recorded · Partner invitations have no pending queue.' }}>
              <Link to="/admin/partner-invitations" className={LINK}>Open partner invitations</Link>
            </Console>
          </ul>
        </section>
      </div>
      )}
      {Box && !phone ? <Box onClose={closeBox} now={now} /> : null}
    </RailFrame>
  );
}
