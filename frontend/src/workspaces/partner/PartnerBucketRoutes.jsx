import React, { Suspense, lazy, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card, Skeleton, WorkerRail } from '../../ui';
import { useAuth } from '../../hooks/useAuthSync';
import WorkspaceShell, { SeamChip } from '../WorkspaceShell';
import BucketOverview, { unbuiltFrom } from '../BucketOverview';
import { bucketForPath, zoneForPath } from '../shellConfig';

// NOT `PartnerOperationsWorkspace`, and that is the fix rather than an
// omission. That component is the legacy five-tab shell at
// /partner/operations/* — it draws its own PartnerWorkspaceShell, its own
// header and its own tab bar, and it derives its active tab by testing the
// pathname for `/capabilities`, `/portfolio`, `/engagements` or
// `/performance`. None of those strings occurs in `/pipeline/proposals`,
// `/pipeline/retainers`, `/delivery/board` or `/delivery/health`, so all four
// zones fell to its `overview` fallback and rendered the SAME page — under a
// second header whose workspace label came from the same fallback and read
// "Delivery · Ship the work" on a Pipeline route. Mounting its feature pages
// directly removes the doubled chrome and the wrong-bucket header together,
// and leaves /partner/operations/* exactly as it was.
const PartnerEngagements = lazy(() => import('../../pages/partner/operations/EngagementsPage'));
const NeedsBoardPage = lazy(() => import('../../pages/NeedsBoardPage'));
const PerksPage = lazy(() => import('../../pages/PerksPage'));
const ServiceCatalogPage = lazy(() => import('../../pages/ServiceCatalogPage'));
// Pipeline · analytics used to mount `PartnerInsightsPage` — Demand Insights,
// which answers where founder demand is concentrated across the whole board.
// The canvas asks this zone about the FIRM'S OWN pipeline: win rate, cycle
// time and forecast. Both are honest surfaces answering different questions;
// Demand Insights keeps its own mount at /partner/insights.
const PartnerPipelineAnalytics = lazy(() => import('../../pages/partner/pipeline/AnalyticsZone'));

/**
 * Pipeline, Delivery and Offers — the Partner shell's three owned buckets.
 *
 * THIS IS THE SHELL WITH THE MOST WORKING CODE AND THE LEAST CANONICAL URLS.
 * Its live surfaces were spread across five prefixes that share no logic —
 * `/partner/operations/*`, `/needs`, `/services`, `/perks`,
 * `/partner/insights` — and the shell mounted only some of them. Six of the
 * fifteen zones now render one: Pipeline's leads, proposals and analytics,
 * Delivery's board, and Offers' catalog and perk deals. Every legacy prefix
 * stays mounted; a zone and its legacy route are the same component at two
 * routes, which is not a fork.
 *
 * `/pipeline` IS NOW A SHARED PREFIX, and deliberately so. The investor shell
 * has held `/pipeline`, `/pipeline/screening`, `/pipeline/commit` and
 * `/pipeline/transactions` for a long time; the Partner canvas puts leads,
 * proposals, negotiations, retainers and analytics under the same prefix. The
 * two sets share no slug, and `bucketForPath` is role-scoped, so an investor
 * on `/pipeline/screening` and an operator on `/pipeline/leads` each resolve
 * to their own bucket. Worth knowing before adding a sixth slug to either.
 *
 * WHAT IS NOT WIRED. Negotiations and retainers, four of Delivery's five
 * zones, and three of Offers' five have no surface anywhere. They ship saying
 * what they would hold. Two of those absences are worth naming rather than glossing:
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

/**
 * Zone → the live body that answers it, as a render function rather than a
 * bare component, because two of these need props to be the right zone at all.
 *
 * `user` is the prop whose absence was a visible feature loss, not a style
 * one: `NeedsBoardPage` reads `user.role` to decide whether to offer the
 * partner's **My quotes** tab, and `PerksPage` reads it for **My listings**.
 * Mounted with no props, both saw `undefined` and silently dropped the one tab
 * the operator came for. `ResearchWorkspace` records fixing the identical
 * prop-drop for `SignalsPage`; this is the same bug on two more pages.
 *
 * `embedded` suppresses each page's own heading block — the shell above has
 * already drawn the crumb, the h1 and the zone pills. It deliberately does NOT
 * suppress their tab rows: Browse / My quotes / Engagements and Perks / My
 * perks / My listings are views WITHIN a zone, not sibling zones, so they are
 * this page's controls rather than a second copy of the navigation.
 *
 * `PartnerEngagements` takes no `embedded`, and that is deliberate rather than
 * an oversight: it draws no heading and no rail of its own — its host has
 * always supplied both — so there is nothing for the flag to suppress. The
 * class guard in `advisor_network_zones.test.mjs` catches a component handed
 * `embedded` that never reads it, and it caught this one; a prop that does
 * nothing reads as a seam that has been dealt with when it has not.
 *
 * TWO ZONES THAT USED TO BE HERE ARE NOW IN `COPY`. Pipeline · retainers and
 * Delivery · health both resolved to the operations Overview, so both looked
 * live and neither was. Neither is buildable: `engagements`
 * (sql/t13_t14_t15.sql:366) carries id, need, quote, partner, founder,
 * project, price, status, delivered/cancelled/invoiced timestamps and nothing
 * else — no recurrence, renewal date or consumption for retainers; no health,
 * risk, milestone or hours column for the board's health lens. They say so.
 */
const LIVE = {
  '/pipeline': {
    leads: (user) => <NeedsBoardPage user={user} embedded />,
    proposals: () => <PartnerEngagements view="proposals" />,
    analytics: () => <PartnerPipelineAnalytics />,
  },
  '/delivery': {
    board: () => <PartnerEngagements view="engagements" />,
  },
  '/offers': {
    catalog: (user) => <ServiceCatalogPage user={user} embedded />,
    'perk-deals': (user) => <PerksPage user={user} embedded />,
  },
};

const COPY = {
  '/pipeline': {
    negotiations: {
      heading: 'Negotiations has no tab of its own yet',
      what: 'Live deals at terms: what they asked, what the firm will hold, whose court the ball is in, and the landing that ends it.',
      why: 'Terms and ball-in-court state exist in the canvas record but nothing in the operations workspace tracks them — a proposal is either sent or decided, with the conversation between the two unmodelled.',
      links: [{ to: '/pipeline/proposals', label: 'Proposals →' }],
    },
    retainers: {
      heading: 'Retainers has no recurrence to read',
      what: 'Recurring revenue, what each client is actually consuming against what they bought, and when each one renews.',
      why: 'An engagement is a single accepted quote at a single price: `engagements` carries no cadence, no renewal date and no consumption, so there is no row that is a retainer rather than a project. Every figure on this zone would be one the store cannot distinguish from a one-off.',
      links: [{ to: '/delivery/board', label: 'Engagement board →' }],
    },
  },
  '/delivery': {
    health: {
      heading: 'Health has nothing to score',
      what: 'Engagement health across the book with the at-risk row first — drift against milestones, an embedded seat burning its cap, a client who has gone quiet.',
      why: 'Each of those reads a column that does not exist. `engagements` records a status, a price and the dates work was delivered, cancelled or invoiced — no milestones, no hours against a cap, no last client contact. A health pill computed from status alone would rate every live engagement identically and call it a judgement.',
      links: [{ to: '/delivery/board', label: 'Engagement board →' }],
    },
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
 * One line per zone, for the overview a bucket root renders — but only for the
 * zones with a page behind them. A zone with no store is deliberately absent:
 * its card is written from `COPY` — the same heading its own body renders — or
 * from the generic no-store card when it has neither. `NOTHING_YET` below
 * mirrors that fallback. The canvas's anchor nav names the same destinations;
 * the card grid is what the sidebar row opens.
 *
 * The first draft of this map described all eight unbacked partner zones as
 * working features — negotiations "live deals at terms", deliverables "shipped
 * and acknowledged", capacity "where the firm is over-committed", catalog "the
 * record lead scoring reads against" — every one of them a `NoStoreYet` card
 * one click away.
 */
const ZONE_LINES = {
  '/pipeline': {
    leads: 'Open founder needs with the RFP behind each, and the quotes you have out on them.',
    proposals: 'The proposal desk: every quote you have submitted, its status, and what it is worth.',
    // This line described Demand Insights for as long as the zone rendered it,
    // and the mismatch it recorded is now closed the other way: the zone
    // answers the canvas's question instead of the card describing a different
    // one. The loss taxonomy the canvas leads with stays absent — no quote
    // records why it was rejected — and the zone says so on itself.
    analytics: 'Win rate, decision cycle and weighted forecast over your own quotes, broken out by shape and by quarter.',
  },
  '/delivery': {
    board: 'Accepted work with its lifecycle actions and the invoice ledger beside it.',
  },
  '/offers': {
    // This zone used to be a card reading "the catalog lives at /services
    // today", declining to mount it on the grounds that doing so would fork a
    // second catalog. Mounting the same component at a second route is not a
    // fork — it is what Leads and Perk deals already do with /needs and
    // /perks — and the card was standing in front of a page that did not
    // work: both of its partner-facing tabs read a response shape the worker
    // does not send, so the catalogue was permanently empty either way.
    catalog: 'What the firm sells, at what price — the record lead scoring reads a match against.',
    'perk-deals': 'Deals that expire in public, with grants revoked when they do.',
  },
};

const NOTHING_YET = 'Nothing here yet';

/** Gap lines for every zone this bucket cannot serve: its own no-store heading
 *  where COPY has one, the generic card's heading where it does not. */
function gapsFor(prefix, bucket) {
  const gaps = unbuiltFrom(COPY[prefix]);
  for (const zone of bucket?.zones || []) {
    if (LIVE[prefix]?.[zone.slug] || gaps[zone.slug]) continue;
    gaps[zone.slug] = NOTHING_YET;
  }
  return gaps;
}

export default function PartnerBucketRoutes() {
  const location = useLocation();
  const { user } = useAuth();
  const bucket = bucketForPath('partner', location.pathname);
  const isRoot = bucket && location.pathname === bucket.prefix;
  const zone = isRoot ? null : zoneForPath(bucket, location.pathname);
  const prefix = bucket?.prefix;
  const slug = zone?.slug;

  const body = useMemo(() => {
    // The bucket root is the canvas overview — the sidebar row lands here,
    // not on the first zone. Zones stay one click away on the cards below.
    if (isRoot) {
      return (
        <BucketOverview
          bucket={bucket}
          role="partner"
          descriptions={ZONE_LINES[prefix]}
          unbuilt={gapsFor(prefix, bucket)}
        />
      );
    }
    const live = LIVE[prefix]?.[slug];
    if (live) return <Suspense fallback={<Loading />}>{live(user)}</Suspense>;
    const copy = COPY[prefix]?.[slug];
    if (copy) return <NoStoreYet {...copy} />;
    return <NoStoreYet
      heading="Nothing here yet"
      what="This zone is named by the canvas and has no surface behind it."
      why="It ships empty rather than as a placeholder that could be mistaken for real data."
    />;
  }, [prefix, slug, isRoot, bucket, user]);

  const INTRO = {
    '/pipeline': 'Win the work. One firm’s pipeline, from lead to signed retainer.',
    '/delivery': 'Ship the work. Projects report milestones; embedded seats report hours against a grant the client can revoke.',
    '/offers': 'Package what we sell. The storefront lead scoring reads against.',
  };

  /**
   * The Worker AI rail. This caller never filled the shell's `rail` slot and
   * did not even import `WorkerRail` — so all fifteen Partner zones and all
   * three bucket roots rendered with an empty right-hand column. It is the
   * same omission `AdvisorBucketRoutes` records having fixed for the advisor
   * shell, and by itself it was most of the product's rail gap.
   *
   * NO MODEL CARD, and that is not an oversight either. The rail names a model
   * and a per-million rate only for a surface registered in `ASSIST_SURFACES`
   * (`ui/eadwynConfig.js`), because that registration is what binds a surface
   * to a real aiRouter task class — and the task class is what decides the
   * model and the price. No workspace surface on any of the four licences is
   * registered; the four keys that exist are page-level features. Registering
   * `pipeline`, `delivery` or `offers` to make the card appear would attach a
   * model and a price to surfaces that call no router task, which is the exact
   * failure `WorkspaceShell`'s own docblock records the rail slot being created
   * to end.
   *
   * `coverage` reports what THIS route reads, so it cannot be more confident
   * than the body beside it: a zone whose card says no store says the same
   * here, and the two now come from the same `LIVE` map.
   */
  const live = Boolean(LIVE[prefix]?.[slug]);
  const coverage = isRoot
    ? [`${bucket?.label || 'This bucket'} overview — ${bucket?.zones?.length || 0} zones`]
    : [live
      ? `${zone?.label || 'This zone'} reads the stored record`
      : `${zone?.label || 'This zone'} has no store behind it`];
  const RAIL = {
    '/pipeline': {
      workspace: 'Pipeline',
      stance: 'Manual pipeline record',
      note: 'Leads, proposals and analytics read the stored needs, quotes and engagements. No proposal is drafted, no price is suggested, and no lead is passed or pursued except on your click.',
      unavailable: [
        ['Proposal drafting', 'Every word of a quote is one you typed. Nothing here writes, rewrites or scores a proposal on your behalf.'],
        ['Pricing suggestions', 'No rate is proposed, benchmarked or inferred from your other quotes. A price is yours.'],
      ],
    },
    '/delivery': {
      workspace: 'Delivery',
      stance: 'Manual delivery record',
      note: 'The board reads accepted work and the invoice ledger beside it. Nothing here messages a client, marks a milestone, or moves an engagement between states on its own.',
      unavailable: [
        ['Health and risk scoring', 'No engagement carries a milestone, an hours cap or a last-contact date, so nothing here can rate one at risk. A pill computed from status alone would rate every live engagement the same and call it a judgement.'],
        ['Status reports', 'No recurring client update is drafted or sent from this bucket. What is shipped and what is blocked are not recorded, so there is nothing to draft one from.'],
      ],
    },
    '/offers': {
      workspace: 'Offers',
      stance: 'Manual storefront record',
      note: 'What the firm publishes is what the firm typed. No listing, perk description or claim about the practice is written here.',
      unavailable: [
        ['Surface attribution', 'Nothing records which surface sourced an engagement, so no listing here can be credited with the work it produced.'],
        ['Published proof', 'An outcome is publishable only where the client agreed to it, and nothing stores that consent. Consent is a gate rather than a warning: without it there is no published form to suppress.'],
      ],
    },
  }[prefix];

  return (
    <WorkspaceShell
      role="partner"
      title={isRoot ? bucket?.label : undefined}
      scope="One firm"
      intro={INTRO[prefix]}
      activeSlug={isRoot ? null : undefined}
      rail={RAIL && (
        <WorkerRail
          workspace={RAIL.workspace}
          role="partner"
          stance={RAIL.stance}
          note={RAIL.note}
          coverage={coverage}
          unavailable={RAIL.unavailable}
        />
      )}
    >
      {body}
    </WorkspaceShell>
  );
}
