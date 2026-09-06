import React, { Suspense, lazy, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Skeleton, WorkerRail } from '../../ui';
import WorkspaceShell from '../WorkspaceShell';
import { bucketForPath, zoneForPath } from '../shellConfig';

const InvestorDealsWorkspace = lazy(() => import('../../pages/investor/InvestorDealsWorkspace'));

/**
 * Deals — the four stages, as four routes.
 *
 * WHAT WAS ALREADY TRUE. `InvestorDealsWorkspace` has always defined the five
 * stages and rendered four sections — Pipeline, Screening desk, Commit room,
 * Closing — with an in-page nav of `#deals-pipeline`, `#deals-screening`,
 * `#deals-commit`, `#deals-closing`. The zone slugs in the shell config are
 * those anchor ids with the prefix stripped, because that is where the canvas
 * took them from. It also already renders on five different URLs (`/deals`,
 * `/pipeline`, and three `/pipeline/*`), none of which say which stage you are
 * looking at.
 *
 * WHAT THIS ADDS, AND WHAT IT DOES NOT. Four real URLs that are deep-linkable,
 * bookmarkable, and reachable with the browser's back button, each landing on
 * its own section. It does NOT split the workspace into four pages: the
 * component still renders all four sections and this scrolls to the right one.
 * That is the same `?tab=` → anchor arrangement `InvestorNetworkWorkspace`
 * already uses, and it is deliberate — turning one working page into four is a
 * content decision about what each stage owns, not a routing one, and the
 * Positions/Cap Table collision next door is a reminder of what happens when
 * those two get conflated.
 *
 * The scroll is `useEffect` on the pathname rather than a hash link so the URL
 * stays clean: the route is the state, and nothing has to keep a `#fragment`
 * in sync with it.
 */
export default function InvestorDealsRoutes() {
  const location = useLocation();
  const bucket = bucketForPath('investor', location.pathname);
  // Same root opt-out as NetworkWorkspace, ResearchWorkspace,
  // AdvisorBucketRoutes and PartnerBucketRoutes. `/deals` serves DealsPage
  // today so this is unreachable — but `zoneForPath` answers a bucket root
  // with its first zone, so a root mounted here would light "Pipeline" and
  // scroll to `#deals-pipeline` as if the reader had asked for it.
  const isRoot = Boolean(bucket) && location.pathname === bucket.prefix;
  const zone = zoneForPath(bucket, location.pathname);

  useEffect(() => {
    if (!zone || isRoot) return undefined;
    // The section may not be mounted on the first paint — the workspace loads
    // its deals before it renders them — so retry briefly rather than once.
    let tries = 0;
    const id = window.setInterval(() => {
      const el = document.getElementById(`deals-${zone.slug}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.clearInterval(id);
      } else if ((tries += 1) > 20) {
        window.clearInterval(id);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [zone?.slug]);

  const INTRO = {
    pipeline: 'Every live deal by stage, and how long each has been sitting where it is.',
    screening: 'The deal on the desk now — what it claims, and what has been checked.',
    commit: 'What the committee decided, and what the decision was based on.',
    closing: 'Signed terms, wired capital, and what is still outstanding.',
  };

  return (
    <WorkspaceShell
      role="investor"
      scope="One fund"
      title={isRoot ? bucket?.label : undefined}
      activeSlug={isRoot ? null : undefined}
      intro={INTRO[zone?.slug] || INTRO.pipeline}
      rail={(
        <WorkerRail
          workspace="Deals"
          role="investor"
          stance="Manual workspace"
          note="Your pipeline, deal rooms, votes and invitations work without AI. Scores and recommendations appear only when they exist in the live deal record. This view never invents a memo, cost, model, or result."
          coverage={[`${zone?.label || 'Pipeline'} · live deal records only`]}
          coverageNote="Founder-sourced and shared objects retain their provenance. Existing server access controls remain authoritative."
          unavailable={[
            ['Memos and scoring runs', 'Nothing on this page drafts a memo or produces a score.'],
          ]}
        />
      )}
    >
      {/* `embedded`: the shell above already draws the heading, the zone row
          and the rail. Without it the workspace drew all three again inside
          them — two h1s, two pill rows and two Worker AI rails on one page. */}
      <Suspense fallback={<div className="space-y-3"><Skeleton className="h-8" /><Skeleton className="h-64" /></div>}>
        <InvestorDealsWorkspace embedded />
      </Suspense>
    </WorkspaceShell>
  );
}
