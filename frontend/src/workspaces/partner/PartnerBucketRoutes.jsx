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
// #45 — the two Pipeline zones migration 208 gave a store to. Both read
// `/api/partner/pipeline/*` and nothing else; neither has a legacy route,
// because neither has ever had a surface anywhere in the product.
const PartnerNegotiations = lazy(() => import('../../pages/partner/pipeline/NegotiationsZone'));
const PartnerRetainers = lazy(() => import('../../pages/partner/pipeline/RetainersZone'));
// #45 — the three Offers zones migration 209 gave a store to. These are the
// only bucket a partner can use TODAY: their stores key on `partners.id` rather
// than on an engagement or a quote, so a firm with no marketplace activity yet
// still has something to record.
const PartnerVisibility = lazy(() => import('../../pages/partner/offers/VisibilityZone'));
const PartnerProof = lazy(() => import('../../pages/partner/offers/ProofZone'));
const PartnerAudienceFit = lazy(() => import('../../pages/partner/offers/AudienceFitZone'));
// #45 — the last four. Health is the one that reads across the others: it
// derives a rating over milestones, blockers, deliverables and the retainer
// record, and returns null rather than "on track" when none of them carries
// anything.
const PartnerHealth = lazy(() => import('../../pages/partner/delivery/HealthZone'));
const PartnerDeliverables = lazy(() => import('../../pages/partner/delivery/DeliverablesZone'));
const PartnerCapacity = lazy(() => import('../../pages/partner/delivery/CapacityZone'));
const PartnerStatusReports = lazy(() => import('../../pages/partner/delivery/StatusReportsZone'));

/**
 * Pipeline, Delivery and Offers — the Partner shell's three owned buckets.
 *
 * THIS IS THE SHELL WITH THE MOST WORKING CODE AND THE LEAST CANONICAL URLS.
 * Its live surfaces were spread across five prefixes that share no logic —
 * `/partner/operations/*`, `/needs`, `/services`, `/perks`,
 * `/partner/insights` — and the shell mounted only some of them. Eight of the
 * fifteen zones now render one: Pipeline's leads, proposals, negotiations,
 * retainers and analytics, Delivery's board, and Offers' catalog and perk
 * deals. Every legacy prefix stays mounted; a zone and its legacy route are the
 * same component at two routes, which is not a fork.
 *
 * NEGOTIATIONS AND RETAINERS ARE THE TWO WITHOUT A LEGACY ROUTE. Every other
 * live zone mounts a page that already existed somewhere; these two are new
 * files reading stores migration 208 created, and they are the first two of the
 * nine no-store zones to be closed.
 *
 * `/pipeline` IS NOW A SHARED PREFIX, and deliberately so. The investor shell
 * has held `/pipeline`, `/pipeline/screening`, `/pipeline/commit` and
 * `/pipeline/transactions` for a long time; the Partner canvas puts leads,
 * proposals, negotiations, retainers and analytics under the same prefix. The
 * two sets share no slug, and `bucketForPath` is role-scoped, so an investor
 * on `/pipeline/screening` and an operator on `/pipeline/leads` each resolve
 * to their own bucket. Worth knowing before adding a sixth slug to either.
 *
 * WHAT IS NOT WIRED. Four of Delivery's five zones and three of Offers' five
 * have no surface anywhere. They ship saying what they would hold. Two of those
 * absences are worth naming rather than glossing:
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
 * TWO ZONES ONCE RESOLVED HERE BY ACCIDENT, and the trail is worth keeping.
 * Pipeline · retainers and Delivery · health both fell through to the
 * operations Overview, so both looked live and neither was; both were moved to
 * `COPY` to say so. `engagements` (sql/t13_t14_t15.sql:366) carries id, need,
 * quote, partner, founder, project, price, status and the
 * delivered/cancelled/invoiced timestamps — and nothing else, which is why
 * neither was buildable on it.
 *
 * Both are live now, for the reason their cards described: migration 208 added
 * `partner_retainers` (shape, cadence, amount, retained hours, renewal) and
 * `retainer_usage` for the first, and `engagement_milestones` and
 * `engagement_blockers` for the second — exactly the columns `engagements`
 * lacks. Health is computed from those rows at read time and stored nowhere,
 * which `partner_delivery_stores.test.mjs` asserts against the schema.
 *
 * This paragraph said "Delivery · health stays in `COPY` until its own store
 * lands — nothing reads them yet" until 2026-09-04, while sitting six lines
 * above a `LIVE` map containing `health` and an empty `COPY`. It described the
 * state of the change it was inside, which is the one thing a comment next to
 * the code cannot be trusted to do on its own.
 */
const LIVE = {
  '/pipeline': {
    leads: (user) => <NeedsBoardPage user={user} embedded />,
    proposals: () => <PartnerEngagements view="proposals" />,
    negotiations: () => <PartnerNegotiations />,
    retainers: () => <PartnerRetainers />,
    analytics: () => <PartnerPipelineAnalytics />,
  },
  '/delivery': {
    board: () => <PartnerEngagements view="engagements" />,
    health: () => <PartnerHealth />,
    deliverables: () => <PartnerDeliverables />,
    capacity: () => <PartnerCapacity />,
    'status-reports': () => <PartnerStatusReports />,
  },
  '/offers': {
    catalog: (user) => <ServiceCatalogPage user={user} embedded />,
    'perk-deals': (user) => <PerksPage user={user} embedded />,
    visibility: () => <PartnerVisibility />,
    proof: () => <PartnerProof />,
    'audience-fit': () => <PartnerAudienceFit />,
  },
};

// NOTHING UNDER `/pipeline` ANY MORE, and the two cards that stood here are
// worth recording as they were. Negotiations said "terms and ball-in-court
// state exist in the canvas record but nothing tracks them"; retainers said
// "`engagements` carries no cadence, no renewal date and no consumption".
// Migration 208 added `quote_negotiations`, `quote_terms`, `partner_retainers`
// and `retainer_usage`, and both zones now read them — so both cards were
// DELETED rather than reworded. A no-store card left standing in front of a
// store is the same false claim as one that overstates; it merely fails in the
// direction that looks humble.
/**
 * EMPTY, AND THAT IS THE POINT OF THIS PASS.
 *
 * Nine zones shipped a `NoStoreYet` card, and every one of those cards was TRUE
 * when it was written. Migrations 208 and 209 built the fifteen tables they
 * named — a store per card — and the routes and bodies now read them, so all
 * nine cards were DELETED rather than reworded. A no-store card standing in
 * front of a store is as false as one that overstates; it merely fails in the
 * direction that looks humble.
 *
 * The four `/delivery` cards said: "no milestones, no hours against a cap, no
 * last client contact"; "nothing records acknowledgment"; "there is no seat
 * register and no hours record"; "it would read the deliverables log and the
 * engagement's blockers, neither of which is recorded". 208 added
 * `engagement_milestones`, `engagement_deliverables`, `engagement_seats`,
 * `engagement_hours`, `engagement_blockers` and `engagement_status_reports`.
 *
 * TWO OF THOSE SENTENCES WERE NOT FULLY ANSWERED, and the zones say so on
 * themselves rather than a card saying it for them:
 *
 *   · "an embedded seat burning its cap" — nothing records the firm's CAP.
 *     Capacity shows real hours and real seats and refuses to mark anyone over,
 *     because a threshold nobody set is not a finding.
 *   · "whether the client opened it" — `opened_at` is the CLIENT'S to set and
 *     no surface in this product lets them. Deliverables shows every sent item
 *     as unopened and says the absence is ours, not theirs.
 *
 * "A client who has gone quiet" has no store at all and Health states it.
 *
 * The structure stays rather than being deleted with its last entry: it is what
 * `gapsFor` and `unbuiltFrom` read, and the next zone added to this shell
 * without a store belongs here.
 */
const COPY = {};

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
    // "Live deals at terms" was banned as a phrase for as long as no store
    // carried a term — `partner_bucket_overview.test.mjs` failed the build on
    // it. Migration 208 carries stage, ball-in-court and clause-level positions,
    // so the ban lifted with this line rather than the line being softened
    // around it.
    negotiations: 'Live deals at terms: what each side asked, where it lands, whose move it is, and how long since it moved.',
    retainers: 'Recurring work with what each client is consuming against what they bought, and when it renews.',
  },
  '/delivery': {
    board: 'Accepted work with its lifecycle actions and the invoice ledger beside it.',
    // "Where the firm is over-committed" and "shipped and acknowledged" were
    // both banned phrases, and both stay unsaid — not because the stores are
    // missing now, but because the firm's cap and the client's acknowledgment
    // still are. These lines describe what the zones actually hold.
    health: 'A rating read across milestones, blockers, deliverables and the retainer record — with the unrated ones counted rather than called healthy.',
    deliverables: 'What was shipped and when, with the ones sent and not marked opened named as unknown rather than as ignored.',
    capacity: 'Who holds a seat inside a client’s systems and what they logged this period.',
    'status-reports': 'The recurring client update, composed from the record and sent by a person — with each blocker carrying whose side it is on.',
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
    // Written to what the store can support. "Views" is deliberately absent
    // from this line as it is from the zone: nothing records an impression, so
    // naming it here would promise a column that renders as an absence.
    visibility: 'Where the firm appears and what each surface produced, ranked by engagements rather than by reach.',
    proof: 'Case studies and outcomes, each showing whether the client agreed to publish it — or that nobody has.',
    'audience-fit': 'Who the firm is for and who it is not, with the sentence a pass quotes instead of going silent.',
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
   * THE MODEL CARD IS NOW REAL, and the order it arrived in is the point. The
   * rail names a model and a per-million rate only for a surface registered in
   * `ASSIST_SURFACES` (`ui/eadwynConfig.js`), because that registration binds a
   * surface to an aiRouter task class and the task class decides the model and
   * the price. For a long time no workspace surface was registered and the card
   * was correctly absent: registering `pipeline`, `delivery` or `offers` to
   * make it appear would have attached a model and a price to surfaces that
   * called no router task. `POST /api/ai/workspace/explain` came first; the
   * single `workspace` surface followed it. `WorkerRail` reads that surface
   * itself, so nothing here passes it — which is why this route file has no
   * model prop to get wrong.
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
      note: 'Leads, proposals, negotiations, retainers and analytics read the stored needs, quotes, engagements and retainer records. No proposal is drafted, no price is suggested, no stage moves and no lead is passed or pursued except on your click.',
      // BOTH OF THESE STAY TRUE after #45. The new zones record what a person
      // typed — a stage, a clause position, an amount, hours used — and compute
      // only what is derivable from it (days since a move, utilisation, MRR).
      // Nothing drafts a position, suggests a rate or predicts a close, and the
      // negotiations zone says on itself that a close probability is not
      // computable from the store.
      unavailable: [
        ['Proposal drafting', 'Every word of a quote, a term position and an open question is one you typed. Nothing here writes, rewrites or scores a proposal on your behalf.'],
        ['Pricing suggestions', 'No rate is proposed, benchmarked or inferred from your other quotes or retainers. A price is yours.'],
      ],
    },
    '/delivery': {
      workspace: 'Delivery',
      stance: 'Manual delivery record',
      note: 'Every rating, milestone, blocker, seat and hour here is one a person entered, and health is read back from them at the moment you load the page. Nothing messages a client, marks a milestone, or moves an engagement between states on its own.',
      // BOTH TUPLES REWRITTEN, because both described absences 208 filled.
      // Health IS now rated — from stored milestones, blockers, deliverables
      // and retainer usage — and a report IS composed from the record. What is
      // still unavailable is narrower and truer: no words are written for you,
      // and nothing is delivered to anyone.
      unavailable: [
        ['Drafted words', 'A status report is composed from your own record — what was shipped, what is open, what is blocked — and every sentence in it is one you write. Nothing here drafts, rewrites or summarises on your behalf.'],
        ['Delivery of any kind', 'Marking a report sent records that YOU sent it. No email leaves this product, no client is notified, and no client-side surface exists — which is also why every deliverable reads unopened.'],
      ],
    },
    '/offers': {
      workspace: 'Offers',
      stance: 'Manual storefront record',
      note: 'What the firm publishes is what the firm typed. No listing, perk description, case study or fit rule is written here, and no lead is scored against one.',
      // BOTH OF THESE FLIPPED WITH MIGRATION 209, so they are replaced rather
      // than kept. Attribution and consent are now recorded — which means the
      // rail would be asserting two absences the store no longer has, exactly
      // the drift `WorkerRail`'s own docblock warns about. What remains
      // genuinely unavailable is what nothing in this bucket does even now.
      unavailable: [
        ['Fit scoring', 'Your fit rules are a record a person reads, not a filter that runs. No lead is scored, ranked or auto-declined against a budget floor or a declined sector — a pass is still your click and still your sentence.'],
        ['Publishing on your say-so', 'An outcome is publishable only where the client agreed to it, and only the client can record that agreement. Nothing here can mark your own evidence as confirmed, including this rail.'],
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
