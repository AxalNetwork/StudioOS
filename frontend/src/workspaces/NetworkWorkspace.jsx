import React, { Suspense, lazy, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { WorkerRail, Skeleton } from '../ui';
import WorkspaceShell from './WorkspaceShell';
import BucketOverview from './BucketOverview';
import { bucketForPath, bucketTitle, zoneForPath } from './shellConfig';
import { zoneActionsFor } from './zoneActionsByRole';
import { zoneFiltersFor } from './zoneFiltersByRole';
import BucketBoard from './BucketBoard';
import { boardFor } from './boards';
import { api } from '../lib/api';
import { NETWORK_ORG_COPY } from './noStoreCopy';

const FounderNetworkRelationships = lazy(() => import('../pages/founder/FounderNetworkRelationships'));
const FounderNetworkIntroductions = lazy(() => import('../pages/founder/FounderNetworkIntroductions'));
const FounderNetworkOrganizations = lazy(() => import('../pages/founder/FounderNetworkOrganizations'));
const InvestorNetworkWorkspace = lazy(() => import('../pages/investor/InvestorNetworkWorkspace'));
const AdvisorNetworkRelationships = lazy(() => import('../pages/advisor/network/RelationshipsZone'));
const AdvisorNetworkIntroductions = lazy(() => import('../pages/advisor/network/IntroductionsZone'));
const AdvisorNetworkOrganizations = lazy(() => import('../pages/advisor/network/OrganizationsZone'));
const PartnerNetworkOrganizations = lazy(() => import('../pages/partner/OrganizationsZone'));
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
 * WHICH LICENCES HAVE A BODY FOR ORGANIZATIONS — NOT WHICH HAVE A STORE.
 *
 * This set used to be documented as the second thing, here and in two other
 * files, and the second thing has never been true of anybody. `contacts` has
 * no `organization` column: the table is sixteen columns and the only three
 * `ALTER TABLE contacts` in the repo add `promoted_ref_id`, `utm_json` and
 * `referrer`, so the founder page's grouping key skips every row and its list
 * is permanently empty. The investor side reaches `metadata.organization_name`
 * on `partner_relationships`, a free-text JSON column that would accept one —
 * and the only writer in the product sends `partner_id`, `relationship_type`
 * and `strength_score`, so no row has ever carried it.
 *
 * What the set actually decides is whether a body renders at all. Founder and
 * investor have one: a table, a stat block and prose that says plainly it found
 * nothing and refuses to infer membership from email domains. An advisor is
 * 403'd from `/api/contacts` — `'advisor'` is not even expressible in that
 * guard's parameter type — so on that licence the zone is a card whose whole
 * content is the gap. Both are honest; they are honest in different shapes, and
 * this set names which.
 *
 * PARTNER JOINED THE SET, AND IT IS THE ONE LICENCE WHERE THE SECOND THING IS
 * NOW TRUE TOO. Migration 224 put an `organization` column on every book
 * contact — as text, with no organization record behind it, which is exactly
 * what the `pn3` artboard is about — so a partner's zone groups real rows and
 * says on its own face that the roll-up is not built. That is a body, and a
 * fuller one than founder's: it has something to group. Nothing changes for the
 * other three; `contacts` still has no organisation column at all (task #94).
 */
const ORG_BACKED = new Set(['founder', 'investor', 'partner']);

/**
 * One line per zone, shared by the overview cards and the zone headers below
 * so the two cannot drift apart. Organizations is the one line that describes
 * an intention rather than a result: no licence stores a person-to-organisation
 * edge, so the roll-up it names produces nothing anywhere. On founder and
 * investor the body says so on the page, in its empty state and its stats and
 * now in four and five header-row notes; on advisor and operator there is no
 * body and the card carries the gap instead. `ORG_BACKED` is the same set the
 * zone body and the rail consult, and it distinguishes those two shapes.
 */
const INTRO = {
  relationships: 'People you know and how strongly, from the records you keep here.',
  introductions: 'Double opt-in: an introduction cannot advance past a consent nobody has recorded.',
  organizations: 'Companies, funds and firms, rolled up from the people you know inside them.',
};

// One object, read by the overview card, the board section and this module,
// so a reader cannot be told a softer reason on one surface than another.
const ORG_NO_STORE = NETWORK_ORG_COPY.heading;

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

  // The filter half of the canvas's header row, bound to the licence and the
  // zone the URL names. A BOUND BUILDER, not a render prop: actions need only
  // the rows, so `(rows) => items` works, but filters need `value` and
  // `onChange`, which are the body's own state and cannot be supplied from
  // here. So the body calls this with its state — the shape `ResearchWorkspace`
  // established and D53 records.
  //
  // A body that is handed nothing draws nothing: `zoneFiltersFor` returns `[]`
  // for a zone with no table entry, and `ZoneToolbar` renders exactly what
  // `ZoneActions` did. That is what makes this step invisible on screen and the
  // tables that follow it a per-zone decision rather than a big-bang one.
  const zoneFilters = useMemo(
    () => (slug ? (opts) => zoneFiltersFor(role, `network/${slug}`, opts) : null),
    [role, slug],
  );

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
      return <Suspense fallback={<Loading />}><Zone embedded role={role} zoneFilters={zoneFilters} /></Suspense>;
    }
    if (role === 'advisor') {
      const Zone = ADVISOR_ZONE[slug] || AdvisorNetworkRelationships;
      return <Suspense fallback={<Loading />}><Zone role={role} zoneFilters={zoneFilters} /></Suspense>;
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
      return (
        <Suspense fallback={<Loading />}>
          <InvestorNetworkWorkspace embedded zone={slug} role={role} zoneFilters={zoneFilters} />
        </Suspense>
      );
    }
    // ORGANIZATIONS IS THE PARTNER'S OWN ZONE NOW, and this is the paragraph
    // that used to explain why it was not. It read: "`NetworkPage` catches a
    // slug it has no tab for (`unservedZone`) and suppresses every body
    // (`unservedAlone`), so that route already renders its own heading above a
    // card saying the roll-up needs an edge from a person to an organisation
    // that nothing stores. A header row would add nothing to a page that is
    // entirely that statement." Every clause was true of the code and the middle
    // one stopped being true of the data: migration 224 put a company name on
    // every book contact. The `pn3` artboard is precisely about that state — a
    // company name as text with no organization record behind it — so the zone
    // gets a body that says so and groups the rows it does have. `NetworkPage`
    // keeps serving the other two panels here and the gap card for every
    // licence that still has no column at all.
    if (role === 'partner' && slug === 'organizations') {
      return (
        <Suspense fallback={<Loading />}>
          <PartnerNetworkOrganizations
            role={role}
            zoneFilters={zoneFilters}
            zoneActions={(orgs, handlers) => zoneActionsFor(role, 'network/organizations', { handlers, view: {
              header: ['Organization', 'Relationship', 'People known', 'Engagement sourced', 'Headcount'],
              rows: orgs,
              // The two absent columns ship as empty cells rather than as a
              // word: a spreadsheet reading "Not recorded" invites a formula
              // over it, and the whole point of both is that there is nothing
              // to compute.
              cells: (o) => [o.name, o.kind || '', o.people, '', ''],
            } })}
          />
        </Suspense>
      );
    }
    // The partner (and operator) arm. `NetworkPage`'s panels are shared with
    // other licences, so the row comes in as a function of the tab and its rows
    // rather than being wired inside them.
    // THE TWO-ARGUMENT SIGNATURE STAYS, AND IT IS NOT AN INCONSISTENCY. Every
    // other arm can bind the zone key from `slug`, because the slug IS what
    // renders. This page decides for itself: `?tab=` wins over the path
    // (`NetworkPage.jsx:53`), because notification deep links depend on it, so
    // the panel on screen is not always the zone the shell resolved. Only the
    // page knows which one it drew, so only the page can say which row it
    // wants. `zoneFilters` takes the same shape for the same reason, and
    // `NetworkPage` re-closes both into the one-argument form its panels speak.
    return (
      <Suspense fallback={<Loading />}>
        {/* No `role` prop, deliberately: `NetworkPage` already destructures
            `role` from `useAuth()`, and a prop of the same name would be a
            duplicate declaration. It passes its own down to the panels. */}
        <NetworkPage
          embedded
          zoneFilters={(kind, opts) => zoneFiltersFor(role, `network/${kind}`, opts)}
          zoneActions={(kind, rows, handlers) => (
          kind === 'relationships'
            /* THE COLUMNS ARE THE BOOK'S, and the ones they replace were the
               partner-to-partner edge's: `Person · Type · Status · Strength ·
               Added`, where `Strength` was `strength_score` — the hand-set
               0-100 number the artboard refuses and migration 224 does not
               store. Exporting it would have carried a figure off the page that
               the page itself will not print. What ships instead is what the
               reader is looking at, derivation included: the two numbers
               strength is computed from, so a spreadsheet can reach the same
               conclusion the table did rather than inheriting its verdict. */
            ? zoneActionsFor(role, 'network/relationships', { handlers, view: {
                header: ['Contact', 'Organization', 'Role', 'Firm owner', 'Last interaction', 'Interactions', 'Source'],
                rows,
                cells: (r) => [r.name, r.organization, r.role_title, r.firm_owner?.name || '',
                  r.last_interaction_at || '', r.interaction_count,
                  r.source === 'platform' ? (r.source_label || 'Platform') : 'Ours'],
              } })
            /* BOTH CONSENTS, NOT ONE STATUS. `Status` was the caller's own
               half of a double opt-in, so a spreadsheet of accepted rows said
               nothing about whether any introduction had happened. What ships
               is the pipeline the table shows: each side's answer, what the
               introduction is, and whether it was made. */
            : zoneActionsFor(role, 'network/introductions', { handlers, view: {
                header: ['Counterpart', 'You', 'They', 'Kind', 'Fee (bps)', 'Made on', 'Outcome', 'Score'],
                rows,
                cells: (p) => [p.target?.name || p.target?.email, p.status,
                  p.counterpart_status || 'not asked', p.terms?.kind || '',
                  p.terms?.fee_bps ?? '', p.terms?.made_at || '', p.terms?.outcome || '', p.score],
              } })
          )}
        />
      </Suspense>
    );
  }, [role, slug, isRoot, zoneFilters]);

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
