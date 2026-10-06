import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../ui';
import HeldZone from './HeldZone';
import { Figure, laneOf, useHeldGlance } from './heldFigures';

/**
 * Admin · Programs on HQ-held accounts — S20's row (D286).
 *
 * FIVE LITERAL LINKS: the Spin-Out Lab applications tab, the Lab console
 * (cohort calendar and applications), advisor cohort access, the
 * Assessment Studio, and Profiling trends (D358, aggregates only). `/admin/advisor-cohorts` has this page and the
 * Approvals lane as its only doors on this shell, so the links are written
 * out for the reachability walk.
 *
 * ASSESSMENT IS NOT LABELLED "RESULTS ONLY". S22 says "shows assessment runs,
 * results only; authoring is HQ's", and the code says otherwise:
 * `requireHqAuthoring` (auth.ts) refuses only on a branch and its own doc
 * reads "a plain HQ admin authors these today and still does". A label that
 * withheld a power the route grants would be the chrome claiming what the
 * code does not do. The card says what is true; whether a plain HQ admin
 * SHOULD author is filed in D286 as the owner's question, and this page
 * narrows no gate.
 */
const OPEN = 'font-semibold text-axal-ink underline underline-offset-2';

export default function HeldPrograms() {
  // D555: the cohort lane's pending count; the cards with no queue say why.
  const glance = useHeldGlance();
  const cohort = laneOf(glance.hq, 'cohort');
  const advisorReason = glance.hq?.approvals?.noQueue?.find((n) => n.label === 'Advisor cohort access')?.reason;
  return (
    <HeldZone
      workspace="Programs"
      stance="Five consoles, each opened where it is decided"
      coverage={['Five programme consoles; cohort applications pending counted on the Studio glance']}
      coverageNote="Applications, cohorts and runs are counted in their consoles."
      unavailable={[
        ['A cohort figure for a branch', 'No branch is deployed; the Lab console reads HQ’s own cohorts.'],
      ]}
    >
      <h1 className="text-[18px] font-extrabold tracking-tight text-axal-ink">Programs</h1>
      <p className="mt-1 text-[12.5px] text-axal-muted">
        The Spin-Out Lab and the assessments around it, for accounts HQ holds.
      </p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="held-programs-consoles">
        <li>
          <Card className="h-full p-4" data-testid="held-programs-applications">
            <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Spin-Out Lab applications</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-axal-muted">
              The applications queue, on the Admin Console’s Lab tab.
            </p>
            <Figure state={glance} value={undefined} reason="The Lab's submission form (spinout_applications) is not one of the Approvals lanes, so no pending count of it is on the Studio glance." testId="held-programs-applications-count" />
            <p className="mt-2 text-[11.5px]"><Link to="/admin?tab=lab-applications" className={OPEN}>Open applications</Link></p>
          </Card>
        </li>
        <li>
          <Card className="h-full p-4" data-testid="held-programs-cohorts">
            <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Cohort calendar and applications</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-axal-muted">
              The Lab console: cohorts, their timing, grace and override, and the journey preview.
            </p>
            <Figure state={glance} value={cohort ? cohort.count : undefined} unit="cohort applications pending" reason={cohort?.reason || 'The cohort lane was not on the glance.'} testId="held-programs-cohorts-count" />
            <p className="mt-2 text-[11.5px]"><Link to="/admin/spinout-lab" className={OPEN}>Open the Lab console</Link></p>
          </Card>
        </li>
        <li>
          <Card className="h-full p-4" data-testid="held-programs-advisor-cohorts">
            <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Advisor cohort access</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-axal-muted">
              Which advisor may read which cohort’s founders. Also an Approvals lane.
            </p>
            <Figure state={glance} value={undefined} reason={advisorReason || 'Access is assigned, not requested, so there is no pending queue.'} testId="held-programs-advisor-cohorts-count" />
            <p className="mt-2 text-[11.5px]"><Link to="/admin/advisor-cohorts" className={OPEN}>Open advisor cohort access</Link></p>
          </Card>
        </li>
        <li>
          <Card className="h-full p-4" data-testid="held-programs-assessment">
            <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Assessment Studio</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-axal-muted">
              Assessment runs and their results, and the games behind them. On HQ a plain admin authors these
              today; the route refuses authoring only on a branch.
            </p>
            <Figure state={glance} value={undefined} reason="Assessment runs are not counted on the Studio glance." testId="held-programs-assessment-count" />
            <p className="mt-2 text-[11.5px]"><Link to="/admin/assessment" className={OPEN}>Open Assessment Studio</Link></p>
          </Card>
        </li>
        <li>
          <Card className="h-full p-4" data-testid="held-programs-profiling-trends">
            <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Profiling trends</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-axal-muted">
              How archetypes, skills and answers shift over time. Counts only; groups under 5 are hidden.
            </p>
            <Figure state={glance} value={undefined} reason="Profiling trends are read on their own page; no count of them is on the Studio glance." testId="held-programs-profiling-trends-count" />
            <p className="mt-2 text-[11.5px]"><Link to="/admin/profiling-trends" className={OPEN}>Open profiling trends</Link></p>
          </Card>
        </li>
      </ul>
    </HeldZone>
  );
}
