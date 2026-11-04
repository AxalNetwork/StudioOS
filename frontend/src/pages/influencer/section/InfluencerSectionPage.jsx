import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card, RailFrame, WorkerRail } from '../../../ui';
import { influencerSectionReads } from './influencerSectionReads';
import { accentFor, headerView, tabFor } from './influencerSectionModel';
import { BlockUnreadable, INK, Loading, MUTED, SectionHeader } from './InfluencerParts';
import OverviewTab from './OverviewTab';
import LinksTab from './LinksTab';
import OffersTab from './OffersTab';
import EarningsTab from './EarningsTab';
import AudienceTab from './AudienceTab';
import ResourcesTab from './ResourcesTab';

/**
 * D4289 P7 (#4296) — the member's Influencer section, IN0–IN6, at
 * `/influencer` (Overview) and `/influencer/{links,offers,earnings,audience,resources}`.
 *
 * WHO. An admitted influencer in any role: the route passes `member` from
 * `/api/auth/me`'s `influencer_active`, and the page re-reads the membership
 * (`GET /api/influencer/me`). Anyone else meets "This is for Axal influencers"
 * and nothing is read for them. The viewer's role picks the accent only.
 *
 * WHAT IT READS, each only on the tab that draws it (`influencerSectionReads.js`):
 *   every tab   GET /api/influencer/me, GET /api/influencer/me/handle
 *   Overview    GET /api/influencer/me/analytics
 *   Links       GET /api/influencer/me/links, the analytics' channels
 *   Offers      GET /api/influencer/me/offers
 *   Earnings    the analytics, GET /api/influencer/me/payout-readiness,
 *               GET /api/network/payouts/me, GET /api/influencer/tiers
 *   Audience    the analytics
 *   Resources   nothing more (static)
 * A failed read is drawn as Unreadable in its block, with Try again; the rest
 * of the page still draws.
 */
const NEEDS = {
  overview: ['analytics'],
  links: ['links', 'analytics'],
  offers: ['offers'],
  earnings: ['analytics', 'readiness', 'payouts', 'tiers'],
  audience: ['analytics'],
  resources: [],
};

export default function InfluencerSectionPage({ member = false, role = 'founder', reads = influencerSectionReads }) {
  const { pathname } = useLocation();
  const tab = tabFor(pathname);
  const accent = accentFor(role);
  const [blocks, setBlocks] = useState({});

  const load = useCallback((keys) => {
    for (const k of keys) {
      setBlocks((b) => ({ ...b, [k]: { status: 'loading', data: b[k]?.data } }));
      Promise.resolve()
        .then(() => reads[k]())
        .then((data) => setBlocks((b) => ({ ...b, [k]: { status: 'ok', data } })))
        .catch(() => setBlocks((b) => ({ ...b, [k]: { status: 'error' } })));
    }
  }, [reads]);

  useEffect(() => { if (member) load(['me', 'handle']); }, [member, load]);
  useEffect(() => {
    if (!member) return;
    const missing = NEEDS[tab].filter((k) => !blocks[k] || blocks[k].status === 'error');
    if (missing.length) load(missing);
    // Each tab's blocks load once when it opens (`blocks` is read, not watched); a write reloads them through `reload`.
  }, [member, tab, load]);

  const reload = useCallback(() => load(['me', 'handle', ...NEEDS[tab]]), [load, tab]);
  const header = useMemo(() => headerView(blocks.me?.data, blocks.handle?.status === 'ok' ? blocks.handle.data : null), [blocks.me, blocks.handle]);

  if (!member) return <NotInfluencer role={role} />;
  const me = blocks.me;
  if (!me || me.status === 'loading') return <Shell role={role}><Loading /></Shell>;
  if (me.status === 'error') return <Shell role={role}><BlockUnreadable what="Your influencer membership" onRetry={reload} /></Shell>;
  if (!me.data?.membership || me.data.membership.status !== 'active') return <NotInfluencer role={role} />;

  const props = { accent, reads, onRetry: reload, onChanged: reload };
  return (
    <Shell role={role}>
      <SectionHeader header={header} tab={tab} accent={accent} />
      <div className="mt-5">
        {tab === 'overview' && <OverviewTab analytics={blocks.analytics} header={header} {...props} />}
        {tab === 'links' && <LinksTab handle={blocks.handle} links={blocks.links} analytics={blocks.analytics} {...props} />}
        {tab === 'offers' && <OffersTab offers={blocks.offers} {...props} />}
        {tab === 'earnings' && (
          <EarningsTab analytics={blocks.analytics} readiness={blocks.readiness} payouts={blocks.payouts} tiers={blocks.tiers}
            membership={me.data.membership} {...props} />
        )}
        {tab === 'audience' && <AudienceTab analytics={blocks.analytics} onRetry={reload} />}
        {tab === 'resources' && <ResourcesTab membership={me.data.membership} />}
      </div>
    </Shell>
  );
}

const RAIL_NOTE = 'Eadwyn reads back what this page has loaded, on a click. It does not change your handle, links, offers or payouts, and it never names a member.';

/** The viewer's own rail, one literal role per mount (the branch-rail guard reads them). */
function SectionRail({ role }) {
  if (role === 'investor') return <WorkerRail workspace="Influencer" stance="Your influencer figures" note={RAIL_NOTE} role="investor" />;
  if (role === 'advisor') return <WorkerRail workspace="Influencer" stance="Your influencer figures" note={RAIL_NOTE} role="advisor" />;
  if (role === 'partner') return <WorkerRail workspace="Influencer" stance="Your influencer figures" note={RAIL_NOTE} role="partner" />;
  if (role === 'super_admin') return <WorkerRail workspace="Influencer" stance="Your influencer figures" note={RAIL_NOTE} role="super_admin" />;
  if (role === 'branch_admin') return <WorkerRail workspace="Influencer" stance="Your influencer figures" note={RAIL_NOTE} role="branch_admin" />;
  if (role === 'admin') return <WorkerRail workspace="Influencer" stance="Your influencer figures" note={RAIL_NOTE} role="admin" />;
  return <WorkerRail workspace="Influencer" stance="Your influencer figures" note={RAIL_NOTE} role="founder" />;
}

/** The section owns its gutter (`SHARED_FULL_BLEED`), as Referrals does, beside the viewer's own rail. */
function Shell({ role, children }) {
  return (
    <RailFrame rail={<SectionRail role={role} />} data-testid="influencer-frame">
      <div className="mx-auto w-full max-w-7xl p-4 md:p-6" data-testid="influencer-section">{children}</div>
    </RailFrame>
  );
}

/** Not an admitted influencer (or the membership is paused or ended): nothing is read. */
export function NotInfluencer({ role }) {
  return (
    <Shell role={role}>
      <Card padding="lg" data-testid="influencer-not-member">
        <h1 className={`text-xl font-semibold ${INK}`}>This is for Axal influencers</h1>
        <p className={`mt-2 text-sm ${MUTED}`}>The Influencer section opens once HQ admits you to the program and while your membership is active.</p>
        <Link to="/referrals" className="mt-4 inline-block text-sm font-semibold text-violet-700 underline dark:text-violet-300">Go to Refer &amp; Earn</Link>
      </Card>
    </Shell>
  );
}
