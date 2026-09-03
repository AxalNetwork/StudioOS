import React, { Suspense, lazy, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card, Skeleton } from '../../ui';
import WorkspaceShell, { SeamChip } from '../WorkspaceShell';
import BucketOverview from '../BucketOverview';
import { bucketForPath, zoneForPath } from '../shellConfig';

const PartnerOperationsWorkspace = lazy(() => import('../../pages/partner/operations/PartnerOperationsWorkspace'));
const NeedsBoardPage = lazy(() => import('../../pages/NeedsBoardPage'));
const PartnerInsightsPage = lazy(() => import('../../pages/PartnerInsightsPage'));
const PerksPage = lazy(() => import('../../pages/PerksPage'));

/**
 * Pipeline, Delivery and Offers — the Partner shell's three owned buckets.
 *
 * THIS IS THE SHELL WITH THE MOST WORKING CODE AND THE LEAST CANONICAL URLS.
 * Nine of its fifteen zones already have a live surface; they are just spread
 * across five prefixes that share no logic — `/partner/operations/*`,
 * `/needs`, `/services`, `/perks`, `/partner/insights`. Offers is the extreme
 * case: three of its five zones live under three different prefixes.
 *
 * `/pipeline` IS NOW A SHARED PREFIX, and deliberately so. The investor shell
 * has held `/pipeline`, `/pipeline/screening`, `/pipeline/commit` and
 * `/pipeline/transactions` for a long time; the Partner canvas puts leads,
 * proposals, negotiations, retainers and analytics under the same prefix. The
 * two sets share no slug, and `bucketForPath` is role-scoped, so an investor
 * on `/pipeline/screening` and an operator on `/pipeline/leads` each resolve
 * to their own bucket. Worth knowing before adding a sixth slug to either.
 *
 * WHAT IS NOT WIRED. Negotiations, three of Delivery's five zones, and three
 * of Offers' five have no surface anywhere. They ship saying what they would
 * hold. Two of those absences are worth naming rather than glossing:
 *
 *   · Delivery·Capacity is the page that would show an operator over-committed
 *     while holding a granted seat inside a client's systems — a trust
 *     exposure rather than a scheduling one. There is no seat register and no
 *     hours record to build it from.
 *   · Offers·Proof is seam-fed by definition: every item is generated from a
 *     completed engagement the client was party to, and carries their consent
 *     state. Consent is a gate, not a warning — an unconsented outcome has no
 *     published form to suppress. Nothing stores that consent today.
 */

function Loading() {
  return <div className="space-y-3"><Skeleton className="h-8" /><Skeleton className="h-56" /></div>;
}

function NoStoreYet({ heading, what, why, links = [], seam }) {
  return (
    <Card className="border-dashed bg-axal-surface-2 p-6">
      <div className="max-w-2xl">
        <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
          No store behind this yet
        </div>
        <h2 className="mt-2 text-lg font-extrabold tracking-tight">{heading}</h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-axal-ink-2">{what}</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-axal-ink-2">{why}</p>
        {seam && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-axal-ink-3">
            <SeamChip>From the client</SeamChip>
            read-only — the outcome belongs to the engagement record the client can also see
          </p>
        )}
        {links.length > 0 && (
          <p className="mt-3 flex flex-wrap gap-3 text-[12px]">
            {links.map((l) => <Link key={l.to} to={l.to} className="text-amber-700 underline">{l.label}</Link>)}
          </p>
        )}
      </div>
    </Card>
  );
}

// Zone → the live component that already answers it.
const LIVE = {
  '/pipeline': { leads: NeedsBoardPage, proposals: PartnerOperationsWorkspace,
    retainers: PartnerOperationsWorkspace, analytics: PartnerInsightsPage },
  '/delivery': { board: PartnerOperationsWorkspace, health: PartnerOperationsWorkspace },
  '/offers': { 'perk-deals': PerksPage },
};

const COPY = {
  '/pipeline': {
    negotiations: {
      heading: 'Negotiations has no tab of its own yet',
      what: 'Live deals at terms: what they asked, what the firm will hold, whose court the ball is in, and the landing that ends it.',
      why: 'Terms and ball-in-court state exist in the canvas record but nothing in the operations workspace tracks them — a proposal is either sent or decided, with the conversation between the two unmodelled.',
      links: [{ to: '/pipeline/proposals', label: 'Proposals →' }],
    },
  },
  '/delivery': {
    deliverables: {
      heading: 'The shipped log is not built yet',
      what: 'What was shipped, when, and whether the client opened it. A deliverable sent and never opened is the firm’s most expensive state — invoiced, unreviewed, and blocking the next milestone.',
      why: 'Nothing records acknowledgment. The workspace knows an engagement’s progress but not whether anything sent against it was read.',
      links: [{ to: '/delivery/board', label: 'Engagement board →' }],
    },
    capacity: {
      heading: 'Capacity has no seat register to read',
      what: 'People rather than projects: who is committed to what, and where the firm is over-committed.',
      why: 'The consequential row is an over-committed person who also holds a granted seat inside a client’s systems — a trust exposure, not only a throughput one, because the grant assumes attention the calendar no longer has. There is no seat register and no hours record to build it from.',
      links: [{ to: '/delivery/board', label: 'Engagement board →' }],
    },
    'status-reports': {
      heading: 'Status reports are not a surface yet',
      what: 'The recurring client-facing update — shipped, next, blocked — drafted with assistance and sent by a person.',
      why: 'It would read the deliverables log and the engagement’s blockers, neither of which is recorded. Where the blocker is on the client’s side the report has to say so plainly without treating it as an excuse, and that is a copy decision as much as a data one.',
    },
  },
  '/offers': {
    catalog: {
      heading: 'The catalog lives at /services today',
      what: 'Productised services with an engagement model and a price — the record lead scoring reads against.',
      why: 'The live Services page is that catalog under a different name. Whether it moves here is part of the open question about retiring the legacy prefixes, so this zone links rather than forking a second catalog.',
      links: [{ to: '/services', label: 'Open Services →' }],
    },
    visibility: {
      heading: 'Surface attribution is not built yet',
      what: 'Which surfaces the firm appears on and what each produced — views, leads, engagements. Volume is not the ranking: a directory listing with thousands of views and no engagements reads worse than a referral with two leads and one.',
      why: 'Engagements do not record the surface that sourced them, so the column that matters cannot be counted. Modelling it would make the widest column the least true.',
    },
    proof: {
      heading: 'Proof needs a consent record that does not exist',
      what: 'Case studies and outcomes, each carrying which engagement produced it and whether the client agreed to publish it.',
      why: 'Consent is a gate rather than a warning — an unconsented outcome has no published form to suppress, so it simply is not one. Nothing stores that consent, which means every item here would be the firm reporting a metric about itself.',
      seam: true,
    },
    'audience-fit': {
      heading: 'Audience fit is not built yet',
      what: 'Who the firm is for and — the working half — who it is not: a stated budget floor, sectors declined, capabilities honestly absent.',
      why: 'This is what lets Pipeline pass a lead with a named reason instead of silence. No fit rules are stored, so a pass today has nothing to cite.',
      links: [{ to: '/pipeline/leads', label: 'Leads →' }],
    },
  },
};

/**
 * One line per zone, for the overview a bucket root renders. The canvas's
 * anchor nav names the same destinations; the card grid is what the sidebar
 * row opens.
 */
const ZONE_LINES = {
  '/pipeline': {
    leads: 'Lead sources with provenance — where the work comes from is as useful as how much of it there is.',
    proposals: 'The proposal desk: what is open, what it is worth, and the activity on each.',
    negotiations: 'Live deals at terms — their ask, your line, and whose court the ball is in.',
    retainers: 'Recurring engagements and the renewals coming due.',
    analytics: 'Win rate, cycle time and source quality across the pipeline.',
  },
  '/delivery': {
    board: 'Both modes on one board: projects with milestones, and embedded seats with founder-granted scope.',
    deliverables: 'Shipped and acknowledged, or shipped and ignored — the firm’s most expensive state.',
    capacity: 'People rather than projects: who is committed to what, and where the firm is over-committed.',
    'status-reports': 'The recurring client-facing update — shipped, next, blocked.',
    health: 'Engagement health across the book, with the at-risk row first.',
  },
  '/offers': {
    catalog: 'Productised services with an engagement model and a price — the record lead scoring reads against.',
    'perk-deals': 'Deals that expire in public, with grants revoked when they do.',
    visibility: 'Which surfaces the firm appears on and what each produced.',
    proof: 'Case studies and outcomes, each carrying which engagement produced it and whether the client agreed to publish it.',
    'audience-fit': 'Who the firm is for — and the working half, who it is not.',
  },
};

export default function PartnerBucketRoutes() {
  const location = useLocation();
  const bucket = bucketForPath('partner', location.pathname);
  const isRoot = bucket && location.pathname === bucket.prefix;
  const zone = isRoot ? null : zoneForPath(bucket, location.pathname);
  const prefix = bucket?.prefix;
  const slug = zone?.slug;

  const body = useMemo(() => {
    // The bucket root is the canvas overview — the sidebar row lands here,
    // not on the first zone. Zones stay one click away on the cards below.
    if (isRoot) {
      return <BucketOverview bucket={bucket} role="partner" descriptions={ZONE_LINES[prefix]} />;
    }
    const Live = LIVE[prefix]?.[slug];
    if (Live) return <Suspense fallback={<Loading />}><Live /></Suspense>;
    const copy = COPY[prefix]?.[slug];
    if (copy) return <NoStoreYet {...copy} />;
    return <NoStoreYet
      heading="Nothing here yet"
      what="This zone is named by the canvas and has no surface behind it."
      why="It ships empty rather than as a placeholder that could be mistaken for real data."
    />;
  }, [prefix, slug, isRoot, bucket]);

  const INTRO = {
    '/pipeline': 'Win the work. One firm’s pipeline, from lead to signed retainer.',
    '/delivery': 'Ship the work. Projects report milestones; embedded seats report hours against a grant the client can revoke.',
    '/offers': 'Package what we sell. The storefront lead scoring reads against.',
  };

  return (
    <WorkspaceShell
      role="partner"
      title={isRoot ? bucket?.label : undefined}
      scope="One firm"
      intro={INTRO[prefix]}
      activeSlug={isRoot ? null : undefined}
    >
      {body}
    </WorkspaceShell>
  );
}
