import React, { Suspense, lazy, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { FounderWorkerRail, Skeleton } from '../ui';
import WorkspaceShell from './WorkspaceShell';
import { bucketForPath, zoneForPath } from './shellConfig';

const FounderNetworkRelationships = lazy(() => import('../pages/founder/FounderNetworkRelationships'));
const FounderNetworkIntroductions = lazy(() => import('../pages/founder/FounderNetworkIntroductions'));
const FounderNetworkOrganizations = lazy(() => import('../pages/founder/FounderNetworkOrganizations'));
const InvestorNetworkWorkspace = lazy(() => import('../pages/investor/InvestorNetworkWorkspace'));
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
 * HOW EACH ROLE IS SERVED. Founders keep the three dedicated pages they
 * already had. Investors get `InvestorNetworkWorkspace`, which renders all
 * three sections and already scrolls to `#relationship-book`,
 * `#introductions-desk` or `#organizations`. Advisors and operators fall
 * through to `NetworkPage`, which is exactly what `/network` gives them today
 * — the same element, now reachable at a URL that says which zone you are in.
 *
 * The scroll for the shared workspaces is driven off the pathname rather than
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

function Loading() {
  return <div className="space-y-3"><Skeleton className="h-8" /><Skeleton className="h-56" /></div>;
}

export default function NetworkWorkspace({ role = 'founder' }) {
  const location = useLocation();
  const bucket = bucketForPath(role, location.pathname);
  const zone = zoneForPath(bucket, location.pathname);
  const slug = zone?.slug;
  const sharedSurface = role !== 'founder';

  useEffect(() => {
    if (!sharedSurface || !slug) return undefined;
    // The shared workspaces render all three sections; the route decides which
    // one you land on. Retry briefly — the surface loads its data first.
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
  }, [sharedSurface, slug]);

  const body = useMemo(() => {
    if (!sharedSurface) {
      const Zone = FOUNDER_ZONE[slug] || FounderNetworkRelationships;
      return <Suspense fallback={<Loading />}><Zone /></Suspense>;
    }
    const Shared = role === 'investor' ? InvestorNetworkWorkspace : NetworkPage;
    return <Suspense fallback={<Loading />}><Shared /></Suspense>;
  }, [sharedSurface, role, slug]);

  const INTRO = {
    relationships: 'People you know, what you last actually did together, and how recently.',
    introductions: 'Double opt-in: an introduction cannot advance past a consent nobody has recorded.',
    organizations: 'Companies, funds and firms, rolled up from the people you know inside them.',
  };

  return (
    <WorkspaceShell
      role={role}
      rail={(
        <FounderWorkerRail
          workspace="Network"
          stance="Read-only coverage"
          note="This view summarizes stored relationship records. It does not draft outreach, send messages, or change records."
          coverage={[`${zone?.label || 'Relationships'} · stored records only`]}
          unavailable={[['Outreach drafting', 'No message, sequence or introduction is written here. Every send is a human click.']]}
        />
      )}
      scope={role === 'investor' ? 'One fund' : 'One book'}
      intro={INTRO[slug] || INTRO.relationships}
    >
      {body}
    </WorkspaceShell>
  );
}
