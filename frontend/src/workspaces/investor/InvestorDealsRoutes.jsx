import React, { Suspense, lazy, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Skeleton, WorkerRail } from '../../ui';
import WorkspaceShell from '../WorkspaceShell';
import MyTasks from '../../pages/work/MyTasks.jsx';
import { bucketForPath, zoneForPath } from '../shellConfig';
import { COMPARE, PAGE_LINE as DEAL_FLOW_LINE, TITLE as DEAL_FLOW_TITLE, compareIds, dealsPageTitle, viewOf as dealFlowViewOf } from '../../pages/investor/dealflow/dealFlowModel';

const COMPARE_TITLE = 'Compare';
const DealRoomsPanel = lazy(() => import('../../components/deals/DealRoomsPanel'));
// D1236 (#2423): Deal flow at the root and Compare at /deals/compare.
const DealFlow = lazy(() => import('../../pages/investor/dealflow/DealFlow'));
const DealCompare = lazy(() => import('../../pages/investor/dealflow/DealFlow').then((m) => ({ default: m.DealCompare })));
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
// D1243 (#3256): Pipeline (ID1) is retired; `/deals/pipeline` forwards to Deal flow's table.
const ZONES = {
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
/**
 * One line per zone, printed by the shell's intro on a zone route.
 *
 * D4815 (canvas DX6–DX8): each line says what the zone is for, in the
 * reader's words. WAS a sentence of method per zone ("a tally without reasons
 * is not a record a fund can defend"; "the platform records the movement of
 * money; it does not move it"); the canvas keeps that under the zone's own
 * "How this works", and once at the first transfer, rather than in the intro.
 */
const ZONE_LINES = {
  screening: 'Decide which ventures deserve deeper work.',
  commit: 'Decisions, votes, reasons and conditions.',
  closing: 'Paper, conditions and recorded transfers required to complete each investment.',
};

export default function InvestorDealsRoutes() {
  const location = useLocation();
  const bucket = bucketForPath('investor', location.pathname);
  // Same root opt-out as NetworkWorkspace, ResearchWorkspace,
  // AdvisorBucketRoutes and PartnerBucketRoutes: `zoneForPath` answers a bucket
  // root with its FIRST zone, so without this a reader landing on `/deals`
  // would get its first zone lit in the pill row as if they had asked for it.
  const isRoot = Boolean(bucket) && location.pathname === bucket.prefix;
  const isCompare = location.pathname === COMPARE;
  const zone = zoneForPath(bucket, location.pathname);

  const Zone = ZONES[zone?.slug];
  const pageTitle = dealsPageTitle({ isRoot, isCompare, slug: zone?.slug });
  useEffect(() => { document.title = pageTitle; }, [pageTitle]);

  // NO `scope` PROP. It read `scope="One fund"` — a literal, on one of only
  // three surfaces in the product that passed the prop at all. `WorkspaceShell`
  // fills that slot from `ActiveCompanyContext` now, so the badge names the
  // company instead of restating the rule. A fund-scoped label belongs here only
  // once a fund is actually selected on this route, and nothing selects one yet.
  return (
    <WorkspaceShell
      role="investor"
      title={isRoot ? DEAL_FLOW_TITLE : isCompare ? COMPARE_TITLE : undefined}
      activeSlug={isRoot || isCompare ? null : undefined}
      intro={isRoot || isCompare ? DEAL_FLOW_LINE : (ZONE_LINES[zone?.slug] || DEAL_FLOW_LINE)}
      rail={(
        <WorkerRail
          workspace="Deals"
          role="investor"
          stance="Manual workspace"
          note="Your pipeline, deal rooms, votes and invitations work without AI. Scores appear only when they exist in the live deal record. Eadwyn drafts only when you ask. This view never invents a memo, cost, model, or result."
          coverage={[`${isRoot || isCompare ? DEAL_FLOW_TITLE : zone?.label || DEAL_FLOW_TITLE} · live deal records only`]}
          coverageNote="Founder-sourced and shared objects retain their provenance. Existing server access controls remain authoritative."
          unavailable={[
            // WAS "Nothing on this page drafts a memo or produces a score" —
            // false the day ID1–ID4 landed: every zone mounts its own draft
            // band (memos, stale-deal notes, a cover note), run on your press.
            // What no zone does is produce a SCORE: a score is read from a
            // stored run, and nothing here starts a batch one.
            ['Scoring runs', 'No score is produced on this page — a score is read from a stored run, one project at a time. Each zone’s own band drafts its memo, notes or cover note on your press.'],
          ]}
        />
      )}
    >
      {/* THE ROOT IS MY DEAL FLOW (D4815, canvas DX1). It was the zones'
          bucket board under the flow, which read as several applications
          stacked on one page; the zones are now one line inside `DealFlow`,
          each linking to its route, and `DealsRoot` below says what else stays.

          `embedded`: the shell above already draws the heading, the zone row and
          the rail. Without it the workspace drew all three again inside them —
          two h1s, two pill rows and two Worker AI rails on one page. */}
      <Suspense fallback={<div className="space-y-3"><Skeleton className="h-8" /><Skeleton className="h-64" /></div>}>
        {isCompare
          ? <DealCompare ids={compareIds(location.search)} />
          : isRoot
          ? <DealsRoot search={location.search} />
          : (Zone ? <Zone /> : <InvestorDealsWorkspace embedded zone={zone?.slug} />)}
      </Suspense>
    </WorkspaceShell>
  );
}

/**
 * The `/deals` root: My Deal Flow (D4815, canvas DX1).
 *
 * WAS the zones' bucket board (Screening desk, Commit room, Closing) and the
 * deal rooms, under a disclosure beneath the flow. The canvas gives the root
 * one job; the zones are one "Other deal activity" line inside `DealFlow`,
 * each linking to its route. The deal rooms (D630) and My tasks (D1614 W8)
 * have no route of their own yet, so they stay here, collapsed under that
 * line, rather than being lost.
 */
function DealsRoot({ search }) {
  const { view, scope } = dealFlowViewOf(search);
  const more = (
    <>
      <DealRoomsPanel />
      {/* D1614 W8 (#3994): every task given to me, across my Teams. */}
      <MyTasks licence="investor" testId="deals-my-tasks" />
    </>
  );
  return <DealFlow view={view} scope={scope} more={more} />;
}
