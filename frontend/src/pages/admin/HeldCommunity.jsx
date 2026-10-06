import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../ui';
import { COMMUNITY_CONSOLES } from '../branch/BranchCommunity';
import HeldZone from './HeldZone';
import { Figure, laneOf, useHeldGlance } from './heldFigures';

/**
 * Admin · Community on HQ-held accounts — S20's row (D286).
 *
 * FIVE LITERAL LINKS. Events, Jobs, Circles, Advisors & Partners and
 * Wellbeing (the last placed here by D283). The prose for the first three is
 * `BranchCommunity`'s own `COMMUNITY_CONSOLES` — read, never edited, so the
 * two shells describe one console in one voice — but every link below is
 * written out, because the reachability walk reads syntax and three of these
 * routes have no other door on this shell.
 *
 * ADVISORS & PARTNERS IS `/admin?tab=network-profiles`, NEVER
 * `/admin/network-profiles`. The standalone route stays wired for deep links
 * and is EXEMPT in the reachability guard for exactly that reason; a door
 * onto it here would make that exemption stale. `COMMUNITY_CONSOLES` points
 * its card at the standalone route for the branch shell; this page keeps the
 * text and not the target.
 */
const text = (key) => COMMUNITY_CONSOLES.find((c) => c.key === key) || {};

function Console({ label, scope, what, to, testId, figure, children }) {
  return (
    <li>
      <Card className="h-full p-4" data-testid={testId}>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">{label}</h2>
          {scope && (
            <span className="text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-muted">{scope}</span>
          )}
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-axal-muted">{what}</p>
        {figure}
        <p className="mt-2 text-[11.5px]">{children}</p>
      </Card>
    </li>
  );
}

/** The lanes with no pending notion, by label, with the Worker's reason. */
const noQueue = (glance, label) => glance.hq?.approvals?.noQueue?.find((n) => n.label === label)?.reason;

export default function HeldCommunity() {
  // D555: a card with a pending queue shows it; one without says why.
  const glance = useHeldGlance();
  const lane = (key) => laneOf(glance.hq, key);
  const events = text('events');
  const jobs = text('jobs');
  const circles = text('circles');
  const profiles = text('network-profiles');
  return (
    <HeldZone
      workspace="Community"
      stance="Five consoles, each opened where it is decided"
      coverage={['Five community consoles; Events and Jobs pending counted on the Studio glance']}
      coverageNote="Counts live in each console; this page links to them."
      unavailable={[
        ['A community figure for a branch', 'No branch is deployed, and these consoles read HQ’s own rows.'],
      ]}
    >
      <h1 className="text-[18px] font-extrabold tracking-tight text-axal-ink">Community</h1>
      <p className="mt-1 text-[12.5px] text-axal-muted">
        The consoles that moderate and author what HQ-held members write, and the rosters HQ curates.
      </p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="held-community-consoles">
        <Console label="Events" scope={events.scope} what={events.what} testId="held-community-events"
          figure={<Figure state={glance} value={lane('events') ? lane('events').count : undefined} unit="pending" reason={lane('events')?.reason || 'The Events lane was not on the glance.'} testId="held-community-events-count" />}>
          <Link to="/admin/events" className="font-semibold text-axal-ink underline underline-offset-2">Open events</Link>
        </Console>
        <Console label="Jobs" scope={jobs.scope} what={jobs.what} testId="held-community-jobs"
          figure={<Figure state={glance} value={lane('jobs') ? lane('jobs').count : undefined} unit="pending" reason={lane('jobs')?.reason || 'The Jobs lane was not on the glance.'} testId="held-community-jobs-count" />}>
          <Link to="/admin/jobs" className="font-semibold text-axal-ink underline underline-offset-2">Open job board</Link>
        </Console>
        <Console label="Circles" scope={circles.scope} what={circles.what} testId="held-community-circles"
          figure={<Figure state={glance} value={undefined} reason={noQueue(glance, 'Circles') || 'Circles have no pending queue.'} testId="held-community-circles-count" />}>
          <Link to="/admin/circles" className="font-semibold text-axal-ink underline underline-offset-2">Open circles</Link>
        </Console>
        <Console label="Advisors & Partners" scope={profiles.scope} what={profiles.what} testId="held-community-network-profiles"
          figure={<Figure state={glance} value={undefined} reason="This roster has no pending queue, and no count of it is on the Studio glance." testId="held-community-network-profiles-count" />}>
          <Link to="/admin?tab=network-profiles" className="font-semibold text-axal-ink underline underline-offset-2">Open advisors &amp; partners</Link>
        </Console>
        <Console
          label="Wellbeing"
          scope="Yours to curate"
          what="The wellbeing expert roster: who members can book, and in what capacity. Curated here, where the community it serves is run (D283)."
          testId="held-community-wellbeing"
          figure={<Figure state={glance} value={undefined} reason="The wellbeing roster has no pending queue, and no count of it is on the Studio glance." testId="held-community-wellbeing-count" />}
        >
          <Link to="/admin?tab=wellbeing" className="font-semibold text-axal-ink underline underline-offset-2">Open wellbeing</Link>
        </Console>
      </ul>
    </HeldZone>
  );
}
