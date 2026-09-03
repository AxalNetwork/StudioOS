import React, { Suspense, lazy, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { WorkerRail, Skeleton } from '../ui';
import WorkspaceShell from './WorkspaceShell';
import BucketOverview from './BucketOverview';
import { bucketForPath, zoneForPath } from './shellConfig';

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
 * HOW EACH ROLE IS SERVED. Founders keep the three dedicated pages they
 * already had. Investors get `InvestorNetworkWorkspace`, which renders all
 * three sections and already scrolls to `#relationship-book`,
 * `#introductions-desk` or `#organizations`. Advisors get their own three
 * zones. Operators fall through to `NetworkPage`.
 *
 * The scroll for the investor workspace is driven off the pathname rather than
 * a hash, so the route stays the single source of truth for which zone is
 * active and ZoneNav's highlight cannot drift from the URL.
 */

const ANCHORS = {
  relationships: 'relationship-book',
  introductions: 'introductions-desk',
  organizations: 'organizations',
};

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

function NetworkOverview({ role }) {
  const bucket = bucketForPath(role, '/network');
  return (
    <BucketOverview
      bucket={bucket}
      role={role}
      descriptions={{
        relationships: 'People you know and how strongly, from the records you keep here.',
        introductions: 'Double opt-in: an introduction cannot advance past a consent nobody has recorded.',
        organizations: 'Companies, funds and firms, rolled up from the people you know inside them.',
      }}
    />
  );
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
  // Only the investor workspace renders all three sections on one page, and
  // only its markup carries the ids in ANCHORS. Running this anywhere else
  // polled for an element that has never existed, twenty times, on every load.
  const anchored = role === 'investor' && !isRoot;

  useEffect(() => {
    if (!anchored || !slug) return undefined;
    // That workspace renders all three sections; the route decides which one
    // you land on. Retry briefly — the surface loads its data first.
    let tries = 0;
    const id = window.setInterval(() => {
      const el = document.getElementById(ANCHORS[slug]);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.clearInterval(id);
      } else if ((tries += 1) > 20) {
        window.clearInterval(id);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [anchored, slug]);

  const body = useMemo(() => {
    if (isRoot) {
      return <NetworkOverview role={role} />;
    }
    if (role === 'founder') {
      const Zone = FOUNDER_ZONE[slug] || FounderNetworkRelationships;
      return <Suspense fallback={<Loading />}><Zone /></Suspense>;
    }
    if (role === 'advisor') {
      const Zone = ADVISOR_ZONE[slug] || AdvisorNetworkRelationships;
      return <Suspense fallback={<Loading />}><Zone /></Suspense>;
    }
    // `embedded`: this shell already supplies the heading, the zone row and
    // the rail. InvestorNetworkWorkspace draws all three of its own on
    // /network, so without this an investor got two of each here — including
    // two Worker AI rails side by side.
    if (role === 'investor') {
      return <Suspense fallback={<Loading />}><InvestorNetworkWorkspace embedded /></Suspense>;
    }
    return <Suspense fallback={<Loading />}><NetworkPage embedded /></Suspense>;
  }, [role, slug, isRoot]);

  const INTRO = {
    relationships: 'People you know and how strongly, from the records you keep here.',
    introductions: 'Double opt-in: an introduction cannot advance past a consent nobody has recorded.',
    organizations: 'Companies, funds and firms, rolled up from the people you know inside them.',
  };

  const orgGap = slug === 'organizations' && !ORG_BACKED.has(role);

  return (
    <WorkspaceShell
      role={role}
      title={isRoot ? 'Network' : undefined}
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
