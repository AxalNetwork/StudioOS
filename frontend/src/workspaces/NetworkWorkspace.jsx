import React, { Suspense, lazy, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { WorkerRail, Skeleton } from '../ui';
import WorkspaceShell from './WorkspaceShell';
import BucketOverview from './BucketOverview';
import { bucketForPath, bucketTitle, zoneForPath } from './shellConfig';
import { zoneActionsFor } from './zoneActionsByRole';
import BucketBoard from './BucketBoard';
import { boardFor } from './boards';
import { api } from '../lib/api';

const FounderNetworkRelationships = lazy(() => import('../pages/founder/FounderNetworkRelationships'));
const FounderNetworkIntroductions = lazy(() => import('../pages/founder/FounderNetworkIntroductions'));
const FounderNetworkOrganizations = lazy(() => import('../pages/founder/FounderNetworkOrganizations'));
const InvestorNetworkWorkspace = lazy(() => import('../pages/investor/InvestorNetworkWorkspace'));
const AdvisorNetworkRelationships = lazy(() => import('../pages/advisor/network/RelationshipsZone'));
const AdvisorNetworkIntroductions = lazy(() => import('../pages/advisor/network/IntroductionsZone'));
const AdvisorNetworkOrganizations = lazy(() => import('../pages/advisor/network/OrganizationsZone'));
const NetworkPage = lazy(() => import('../pages/NetworkPage'));

/**
 * `/network/*` — the three zones, for every licence rather than just founders.
 *
 * THE BUG THIS CLOSES IS ONE THIS BRANCH CREATED. All four canvases specify the
 * same Network bucket, so the shell config declares its three zones for all
 * four roles and ZoneNav renders a pill for each. But the three zone routes
 * were guarded `['admin', 'founder']` — they were built for the founder shell
 * and nothing else had ever linked them. So an investor, advisor or operator
 * clicking their own Relationships pill was bounced to their role's default
 * path. Three of the four licences had visibly dead navigation.
 *
 * THE SECOND BUG, AND IT SURVIVED THE FIRST FIX. Making the routes reachable
 * did not make them distinct. Every advisor zone rendered `NetworkPage`, which
 * reads its active tab from `?tab=` and never from the pathname, and whose
 * fallback for a role that cannot see Contacts is Introductions. So an advisor
 * clicking **Relationships** got the **Introductions** tab under a heading that
 * said Relationships, and so did Organizations. The route said one thing and
 * the body showed another — which is the whole defect this bucket was reported
 * for. Advisors now have three real bodies, dispatched on the slug the shell
 * already resolved; `NetworkPage` keeps serving operators, and its tab now
 * follows the path there too.
 *
 * THE THIRD BUG WAS THE SAME SHAPE ON TWO MORE LICENCES, and it is closed
 * here. `InvestorNetworkWorkspace` renders all three sections stacked; mounted
 * on a zone route with no slug it rendered all three there too, so an investor
 * got the identical body on Relationships, Introductions and Organizations. It
 * now takes the slug. And the three founder pages each draw a whole frame of
 * their own — crumb, h1, zone nav, rail — which is correct where they mount
 * directly and was a second copy of everything inside this shell; they now
 * take `embedded`.
 *
 * HOW EACH ROLE IS SERVED. Founders keep the three dedicated pages they
 * already had, embedded. Investors get `InvestorNetworkWorkspace` narrowed to
 * the zone. Advisors get their own three body-only zones. Operators fall
 * through to `NetworkPage`.
 *
 * NO SCROLL-TO-ANCHOR ANY MORE. While the investor workspace rendered all
 * three sections on a zone route, this file polled for `#relationship-book`,
 * `#introductions-desk` or `#organizations` and scrolled to it. Now that a
 * zone route renders one section, there is nothing to scroll past — and
 * scrolling would have pushed the shell's own crumb and heading off the top.
 */

const FOUNDER_ZONE = {
  relationships: FounderNetworkRelationships,
  introductions: FounderNetworkIntroductions,
  organizations: FounderNetworkOrganizations,
};

const ADVISOR_ZONE = {
  relationships: AdvisorNetworkRelationships,
  introductions: AdvisorNetworkIntroductions,
  organizations: AdvisorNetworkOrganizations,
};

/**
 * Organizations is a real zone only where an organisation store is reachable.
 * Founders read `contacts.organization`; the investor workspace has its own
 * section. An advisor is 403'd from `/api/contacts` and an operator's
 * `NetworkPage` has no organizations tab at all — so for those two the zone
 * reads nothing, and the rail has to say so rather than call it covered.
 */
const ORG_BACKED = new Set(['founder', 'investor']);

/**
 * One line per zone, shared by the overview cards and the zone headers below
 * so the two cannot drift apart. Organizations is the one line that is not
 * true on every licence: an advisor is 403'd from `/api/contacts` and an
 * operator has no organizations tab, so on those licences the card says the
 * zone reads nothing rather than describing the roll-up it would perform —
 * `ORG_BACKED` is the same set the zone body and the rail already consult.
 */
const INTRO = {
  relationships: 'People you know and how strongly, from the records you keep here.',
  introductions: 'Double opt-in: an introduction cannot advance past a consent nobody has recorded.',
  organizations: 'Companies, funds and firms, rolled up from the people you know inside them.',
};

const ORG_NO_STORE = 'Organizations reads nothing on this licence — no store links a relationship to an organisation here.';

function NetworkOverview({ role }) {
  const bucket = bucketForPath(role, '/network');
  if (!bucket) return null;
  // Organizations is the one line that is not true on every licence, so the
  // gap is per-role: ORG_BACKED is the same set the zone body and rail read.
  const unbuilt = ORG_BACKED.has(role) ? {} : { organizations: ORG_NO_STORE };
  const board = boardFor(role, '/network', api);
  if (board) return <BucketBoard bucket={bucket} role={role} board={board} />;
  return <BucketOverview bucket={bucket} role={role} descriptions={INTRO} unbuilt={unbuilt} />;
}

function Loading() {
  return <div className="space-y-3"><Skeleton className="h-8" /><Skeleton className="h-56" /></div>;
}

export default function NetworkWorkspace({ role = 'founder' }) {
  const location = useLocation();
  const bucket = bucketForPath(role, location.pathname);
  const isRoot = bucket && location.pathname === bucket.prefix;
  const zone = isRoot ? null : zoneForPath(bucket, location.pathname);
  const slug = zone?.slug;

  const body = useMemo(() => {
    if (isRoot) {
      return <NetworkOverview role={role} />;
    }
    // `embedded`: the three founder pages each draw a full frame of their own
    // — crumb, h1, zone nav and Worker AI rail — because they were built to be
    // mounted directly, before this shell existed. Mounted bare here they drew
    // every one of those a second time, inside the shell's own: two crumbs, two
    // headings, two pill rows and two rails, each pair worded differently. This
    // is the same seam the advisor and investor arms below already had.
    if (role === 'founder') {
      const Zone = FOUNDER_ZONE[slug] || FounderNetworkRelationships;
      return <Suspense fallback={<Loading />}><Zone embedded /></Suspense>;
    }
    if (role === 'advisor') {
      const Zone = ADVISOR_ZONE[slug] || AdvisorNetworkRelationships;
      return <Suspense fallback={<Loading />}><Zone /></Suspense>;
    }
    // `embedded`: this shell already supplies the heading, the zone row and
    // the rail. InvestorNetworkWorkspace draws all three of its own on
    // /network, so without this an investor got two of each here — including
    // two Worker AI rails side by side.
    //
    // `zone`: and this is the half that was still missing. That page renders
    // all three sections stacked, which is right on `/network` and wrong on a
    // zone route: an investor clicking Relationships, Introductions or
    // Organizations got the identical stacked body every time. The pills moved
    // and the page did not. Passing the slug the shell has already resolved
    // narrows it to the one section the URL names.
    if (role === 'investor') {
      return <Suspense fallback={<Loading />}><InvestorNetworkWorkspace embedded zone={slug} /></Suspense>;
    }
    // The partner (and operator) arm. `NetworkPage`'s panels are shared with
    // other licences, so the row comes in as a function of the tab and its rows
    // rather than being wired inside them. Organizations is deliberately absent,
    // and NOT because the route misbehaves: `NetworkPage` catches a slug it has
    // no tab for (`unservedZone`) and suppresses every body (`unservedAlone`),
    // so that route already renders its own heading above a card saying the
    // roll-up needs an edge from a person to an organisation that nothing
    // stores. A header row would add nothing to a page that is entirely that
    // statement. (An earlier version of this comment said the route "lands on
    // contacts". It does not, and a partner has no contacts tab either.)
    return (
      <Suspense fallback={<Loading />}>
        <NetworkPage embedded zoneActions={(kind, rows) => (
          kind === 'relationships'
            ? zoneActionsFor(role, 'network/relationships', { view: {
                header: ['Person', 'Type', 'Status', 'Strength', 'Added'],
                rows,
                cells: (r) => [r.other?.name || r.other?.email, r.relationship_type, r.status, r.strength_score, r.created_at],
              } })
            : zoneActionsFor(role, 'network/introductions', { view: {
                header: ['Counterpart', 'Status', 'Score', 'Source'],
                rows,
                cells: (p) => [p.target?.name || p.target?.email, p.status, p.score, p.source],
              } })
        )} />
      </Suspense>
    );
  }, [role, slug, isRoot]);

  const orgGap = slug === 'organizations' && !ORG_BACKED.has(role);

  return (
    <WorkspaceShell
      role={role}
      title={isRoot ? bucketTitle(bucket) : undefined}
      activeSlug={isRoot ? null : undefined}
      rail={(
        <WorkerRail
          workspace="Network"
          role={role}
          stance="Stored records only"
          // The old wording said "This view ... does not change records", which
          // was read as a claim about the PAGE and was false on every zone: the
          // relationship editor writes, and accepting an introduction spends a
          // credit. The rail is what does nothing; the page acts on your click.
          note="This rail reports what each zone reads. It drafts no outreach and sends no message — and where a zone does write, it writes on your click, never on the rail's."
          coverage={[isRoot
            ? 'Network overview — 3 zones'
            : orgGap
              ? 'Organizations · no store behind it on this licence'
              : `${zone?.label || 'Relationships'} · stored records only`]}
          unavailable={[
            ['Outreach drafting', 'No message, sequence or introduction is written here. Every send is a human click.'],
            ...(orgGap
              ? [['Organisation roll-up', 'Nothing links a person you know to the organisation they are in, so this zone has nothing to group by.']]
              : []),
          ]}
        />
      )}
      scope={role === 'investor' ? 'One fund' : 'One book'}
      intro={isRoot ? 'Work your relationships — people, introductions, and the organizations behind them.' : (INTRO[slug] || INTRO.relationships)}
    >
      {body}
    </WorkspaceShell>
  );
}
