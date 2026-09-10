import React, { Suspense, lazy } from 'react';
import { useLocation } from 'react-router-dom';
import { Skeleton, WorkerRail } from '../../ui';
import WorkspaceShell from '../WorkspaceShell';
import { bucketForPath, bucketTitle, zoneForPath } from '../shellConfig';

const InvestorDealsWorkspace = lazy(() => import('../../pages/investor/InvestorDealsWorkspace'));
/**
 * ONE ZONE AT A TIME, AS EACH ARTBOARD LANDS.
 *
 * `Pages · Investor Deals.dc.html` draws four artboards, ID1–ID4, and each is
 * a full composition: a four-up strip, an instrument with its own columns, the
 * note that carries the finding, and the AI band. The workspace below renders
 * all four zones as one card each, which is what shipped and what the artboards
 * are not. They are replaced one at a time rather than in one commit, so a zone
 * is either its artboard or the card that preceded it — never a half-built
 * page. `ZONES` is the registry; a slug that is not in it falls through to the
 * workspace.
 */
const ZONES = {
  pipeline: lazy(() => import('../../pages/investor/deals/PipelineZone')),
  screening: lazy(() => import('../../pages/investor/deals/ScreeningZone')),
  commit: lazy(() => import('../../pages/investor/deals/CommitZone')),
  closing: lazy(() => import('../../pages/investor/deals/ClosingZone')),
};

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
 * WHAT THIS ADDS. Four real URLs that are deep-linkable, bookmarkable and
 * reachable with the browser's back button, each rendering its own section.
 *
 * IT USED TO SCROLL, AND SCROLLING WAS THE WRONG ANSWER. The first version kept
 * all four sections on every route and ran a `useEffect` that polled every
 * 100 ms, up to twenty times, for `#deals-<slug>` to appear so it could scroll
 * there — the workspace loads its deals before it renders them, so the element
 * is not there on first paint. It said, in these words, that splitting was "a
 * content decision, not a routing one".
 *
 * The comparison it drew was to `InvestorNetworkWorkspace`, and that is exactly
 * what settles it the other way: Network takes a `zone` prop and renders ONE
 * section per zone route, from one component, one `load()` and one set of
 * derivations. Its docblock says why — "the pills moved, the page did not".
 * That was verbatim this file's behaviour. Narrowing is not splitting: there is
 * still one component and one `api.listDeals` call, and all four sections
 * derive from it, so `/deals` still stacks them as the bucket overview.
 *
 * What made it worth doing now is the filter row. Four zones sharing one
 * scrolling page can carry four action rows — a button repeated is noise. Four
 * FILTER rows is four stateful controls making four different claims about what
 * the reader is looking at, and the pipeline counts above them do not move when
 * the wrong one is clicked.
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

  // The bucket root still stacks all four sections from the workspace, so a
  // zone component is chosen only on its own route.
  const Zone = ZONES[zone?.slug];

  const INTRO = {
    // The stale flag is the sentence the artboard's note is entirely about, and
    // it belongs on the one line the shell prints — the zone below says it once
    // or not at all.
    pipeline: 'Every live deal by stage, and how long each has been sitting where it is. '
      + 'The stale flag is the product: a stage count cannot say who stopped moving.',
    // WAS "the deal on the desk now", which described the one-record panel
    // rather than the artboard. ID2 is a desk over every scored deal, its
    // flags and the fund's pass memory.
    screening: 'Every deal that has been scored, what the rubric said, and every pass the fund has recorded.',
    // WAS "what the committee decided, and what the decision was based on",
    // over a panel that showed three deal columns and no vote at all. ID3
    // is the ledger: every vote with the reason its author wrote.
    commit: 'Every vote on the decision, with the reason its author wrote beside it. '
      + 'A tally without reasons is not a record a fund can defend.',
    // WAS "signed terms, wired capital, and what is still outstanding" — over
    // three hard-coded rows, one of which said wired capital is not recorded
    // here. ID4 is the paper: every envelope raised against a deal at
    // closing, with its signature state.
    closing: 'Every document raised against a deal at closing, and how far through signature it is. '
      + 'The platform records the movement of money; it does not move it.',
  };

  return (
    <WorkspaceShell
      role="investor"
      scope="One fund"
      title={isRoot ? bucketTitle(bucket) : undefined}
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
          them — two h1s, two pill rows and two Worker AI rails on one page.

          `zone`: which one section this route is for. `null` on the root, where
          all four stack — the same two props, for the same two reasons, that
          `NetworkWorkspace` passes `InvestorNetworkWorkspace`. */}
      <Suspense fallback={<div className="space-y-3"><Skeleton className="h-8" /><Skeleton className="h-64" /></div>}>
        {Zone && !isRoot
          ? <Zone />
          : <InvestorDealsWorkspace embedded zone={isRoot ? null : zone?.slug} />}
      </Suspense>
    </WorkspaceShell>
  );
}
