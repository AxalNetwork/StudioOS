import React, { Suspense, lazy, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card, WorkerRail, Skeleton } from '../ui';
import WorkspaceShell from './WorkspaceShell';
import BucketOverview, { unbuiltFrom } from './BucketOverview';
import { bucketForPath, zoneForPath } from './shellConfig';
import { zoneActionsFor } from './zoneActionsByRole';

/**
 * `/research/*` — one path, four zone lists.
 *
 * WHY SHARED. Every license researches, and three of the zones are the same
 * work in all four: Ask, Markets, Library. The zones that differ are the ones
 * that should — a founder researches funds, an investor benchmarks, an advisor
 * and an operator prepare for a client. So the route is shared and the zone
 * list comes from the shell config, exactly as `/network` has role-branched a
 * single route for a while now.
 *
 * ASK AND LIBRARY ARE ONE SYSTEM, and the canvases are emphatic about it: what
 * is indexed in Library is precisely what Ask can answer over, and a document
 * sitting unindexed is invisible to every question asked upstairs. BOTH ARE
 * BUILT NOW (migration 213, `routes/research.ts`), and they shipped together
 * for that reason — one without the other is a working page pointing at a card.
 *
 * The rule that governed them while they were cards still governs them built:
 * an Ask box wired to nothing answers from the model's general knowledge in
 * exactly the voice a cited answer uses, which is the single worst failure
 * available on a research surface. So retrieval runs first and the model is
 * called only when there is something to quote; below the score floor Ask
 * returns `no_source` and says what the closest passage actually scored.
 *
 * WHAT IS STILL NOT POSSIBLE, and the zones say so rather than implying an
 * empty list: nobody can send you a document. A founder sharing their own file
 * needs a grant type the product has for investors and for no one else, and
 * adding one is a decision about a founder's privacy rather than a table.
 *
 * MARKETS AND COMPANIES ARE REAL. Markets mounts the live signals feed.
 * Companies revives `CompetitorAnalysisPage`, which has existed all along and
 * was reachable only by deep link after being dropped from the sidebar — worth
 * reviving rather than rebuilding.
 *
 * THE ZONE PAGES GET THEIR PROPS NOW, AND FOR A LONG TIME THEY DID NOT.
 * `SignalsPage` was mounted with `embedded` alone; it destructures `{ user }`,
 * so BOTH props were dropped. `user` being undefined meant `mode` resolved to
 * `'founder'` for every role on this route — no advisor ordering, no advisor
 * strip, no `advisor_note` — while the founder hero rendered a second h1 inside
 * this shell's own. `CompetitorAnalysisPage` took no props at all and swallowed
 * its `embedded` the same way. Both are fixed at the source; `Markets` now
 * receives `user`, and `Companies` a `chromeless` flag that is deliberately not
 * `embedded` (see `components/CompetitorAnalysis.jsx` for why).
 *
 * ASK, LIBRARY AND COMPANIES CARRY A HISTORY WORTH KNOWING. Decisions D9 and
 * D12 withdrew four `/advisor/research/*` tabs — companies, AI research, news,
 * documents — because each rendered a fixture with no API behind it, and set
 * one condition for their return: a licensed PitchBook/Crunchbase-class source.
 * `frontend/test/research_tabs_withdrawn.test.mjs` exists because a later
 * reader sees an empty Research group and "restores" it. Nothing here restores
 * them. The distinction that matters, and that D12 did not have to consider:
 * the advisor canvas asks for a FIRST-PARTY surface — Ask over a client's own
 * shared documents, a library of client histories and the advisor's playbooks.
 * That is not third-party research data, so D12's licensing condition does not
 * govern it. It is unbuilt, not forbidden, and the cards below say which.
 *
 * CLIENT PREP'S CARD SAID SOMETHING FALSE UNTIL 2026-09-05, and the correction
 * is worth keeping because the mistake is an easy one to make again. It read
 * "nothing joins a booking to the client's own record". Checked against
 * production rather than `schema.sql`: `advisor_bookings.founder_user_id` →
 * `users.founder_id` → `projects.founder_id` is two hops over the column
 * `canAccessFounderResource` itself reads. The join was never the problem —
 * the access rule is, and it decides differently for the two roles that see
 * this zone (see `ClientPrepScopeNote`). A card that blames a missing table
 * for an access decision sends the next reader to write a migration that would
 * change nothing.
 */

const SignalsPage = lazy(() => import('../pages/SignalsPage'));
const CompetitorAnalysisPage = lazy(() => import('../pages/CompetitorAnalysisPage'));
const LibraryZone = lazy(() => import('../pages/research/LibraryZone'));
const AskZone = lazy(() => import('../pages/research/AskZone'));

function Loading() {
  return <div className="space-y-3"><Skeleton className="h-8" /><Skeleton className="h-40" /></div>;
}

/**
 * The honest state for a zone with no store behind it. It names what the zone
 * would hold, what would fill it, and — where one exists — the live surface
 * that answers the nearest question today.
 */
function NoStoreYet({ heading, what, why, link, accentClass = 'text-axal-violet' }) {
  return (
    <Card className="border-dashed bg-axal-surface-2 p-6">
      <div className="max-w-2xl">
        <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
          No store behind this yet
        </div>
        <h2 className="mt-2 text-lg font-extrabold tracking-tight">{heading}</h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-axal-ink-2">{what}</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-axal-ink-2">{why}</p>
        {link && (
          <p className="mt-3 text-[12px]">
            <Link to={link.to} className={`${accentClass} underline`}>{link.label}</Link>
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * Whose competitor analyses these are — stated, because the page cannot show it.
 *
 * `competitor_analyses` is scoped to `user_id`. It has no company column, so an
 * advisor with six clients has one shared workspace, not six. The startup
 * picker is filled from the caller's own projects, and an advisor's list is
 * normally empty — so what they actually get is the custom-market box. That is
 * the honest shape of the store; the alternative (a client selector wired to
 * nothing) would promise per-client research the data model cannot hold.
 */
function CompanyScopeNote({ role }) {
  if (role !== 'advisor') return null;
  return (
    <Card variant="sunken" padding="md" className="mb-4">
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
        These analyses are yours, not a client&rsquo;s
      </div>
      <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-axal-ink-2">
        An analysis is stored against the person who ran it and carries no company, so there is no
        client to switch between and no per-client history to open. Describe the market you are
        researching; if a startup picker below is empty, that is because company records are not
        shared with advisors, not because the analysis failed.
      </p>
    </Card>
  );
}

/**
 * Client prep is refused for a DIFFERENT REASON depending on who is reading,
 * and one sentence cannot be true for both — which is why this is a component
 * and not another line of `ZONE_COPY`.
 *
 * Both roles carry this zone (`shellConfig.js` RESEARCH_ZONES.advisor and
 * .partner), and `canAccessFounderResource` (`cloudflare-worker/src/auth.ts`)
 * treats them oppositely: it returns true outright for `partner`, and an
 * advisor matches neither that branch nor the owning-founder one. So the
 * card's old "the project read that would reach it excludes advisors" was
 * simply not a partner's obstacle, and the "on Practice · Sessions" pointer
 * sent a partner to a bucket only the advisor shell has.
 */
function ClientPrepScopeNote({ role }) {
  if (role !== 'advisor' && role !== 'partner') return null;
  const advisor = role === 'advisor';
  return (
    <Card variant="sunken" padding="md" className="mb-4">
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
        {advisor ? 'The client’s record is closed to you by rule' : 'Permission is not what stops this for a firm'}
      </div>
      <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-axal-ink-2">
        {advisor ? (
          <>
            The guard over founder data admits studio staff and the founder who owns the record.
            An advisor is neither, so a client’s project is unreadable to you deliberately rather
            than by oversight. Opening it would take a grant from the founder, and the product
            already has that exact shape for investors — one project, one named counterparty,
            revocable, expiring, and logged. Nothing equivalent exists for advisors, and adding
            one is a decision about a founder’s privacy, not a schema change. The half you do
            have — what the client wrote when they asked for the session — is on Practice ·
            Sessions.
          </>
        ) : (
          <>
            A firm passes the founder-data guard as studio staff, so the rule is not the
            obstacle here. What is missing is the link: no record on the firm side points at a
            client’s project, so there is nothing to hang a brief on. That is an assembly gap
            rather than a permission one, and it is why this zone waits on a store rather than
            on a decision.
          </>
        )}
      </p>
    </Card>
  );
}

// The zones with a live source behind them. Everything else in ZONE_COPY
// renders NoStoreYet, and the rail says so rather than implying a source.
//
// ASK AND LIBRARY JOINED THIS SET, and the pair had to move together. The
// docblock above says why: what is indexed in Library is exactly what Ask can
// answer over, so shipping one without the other would leave a working page
// pointing at a card, or an Ask box with nothing to read.
const LIVE_ZONES = new Set(['markets', 'companies', 'library', 'ask']);

const ZONE_COPY = {
  funds: {
    heading: 'Fund research is not built yet',
    what: 'Which funds invest at your stage, in your sector, on what terms, and who they have already backed that looks like you.',
    why: 'This is founder-facing fund research and does not overlap the investor-only fund pages, which are GP back-office tooling behind a different license. Nothing sources it today.',
    link: { to: '/raise/status', label: 'Your live raise →' },
  },
  diligence: {
    heading: 'Diligence evidence lives in its own surface today',
    what: 'The canvas puts diligence evidence under Research, alongside the questions being asked of it.',
    why: 'The live diligence case tooling already exists and is where this work happens now. Folding it in here is a routing decision that has not been made, so this zone links rather than duplicating.',
    link: { to: '/due-diligence', label: 'Open due diligence →' },
    accentClass: 'text-indigo-700',
  },
  benchmarking: {
    heading: 'Benchmarking is not built yet',
    what: 'Comparable companies at the same stage, on the metrics a decision actually turns on, with the sample size stated on every figure.',
    why: 'No benchmark set exists in the product. A benchmark drawn from three companies and presented without its base is arithmetic wearing a metric’s clothes.',
    accentClass: 'text-indigo-700',
  },
  'client-prep': {
    heading: 'The client brief is not built yet',
    what: 'One client per brief: what they asked for, what the engagement record says, what changed on their side, and what is still open.',
    why: 'Half of it exists: a session request already carries the topic and the questions the client wrote themselves when they asked for it. What is missing is the client’s own record — and not for want of a join. A client’s account carries their founder id and a project carries the same id, which is the very column the founder-data guard reads before it decides, so what stands in the way is an access decision, not an absent table. Which decision it is depends on who is reading; the note above says which applies to you. A brief assembled from one side only would be half a brief presented as a whole one.',
  },
};

/**
 * One line per zone, for the zones in `LIVE_ZONES` — the only two with a
 * source behind them. Every other zone is described from `ZONE_COPY`, the
 * same object its own page renders, so an overview card cannot promise what
 * the page behind it denies.
 *
 * The first draft of this grid did exactly that: Ask as "cited answers over
 * your own documents", Library as "the documents Ask reads from", Client prep
 * as "everything you need before the session" — a retrieval stack that exists
 * in no form (D9/D12 withdrew these zones on that finding) — and Companies as
 * showing "whether you have a relationship or only a file", a flag
 * `competitor_candidates` does not carry.
 *
 * `frontend/test/advisor_bucket_overview.test.mjs` fails if a zone outside
 * LIVE_ZONES reappears here.
 */
const ZONE_BLURB = {
  markets: 'Signals from the sectors you work in, with the date each one was gathered.',
  companies: 'The competitor and market analyses you have run yourself.',
  library: 'Documents you have added, and which of them Ask can actually read.',
  ask: 'Questions answered only from your own library, with the passage each answer used.',
};

function ResearchOverview({ role }) {
  const bucket = bucketForPath(role, '/research');
  if (!bucket) return null;
  return (
    <BucketOverview
      bucket={bucket}
      role={role}
      descriptions={ZONE_BLURB}
      unbuilt={unbuiltFrom(ZONE_COPY)}
    />
  );
}

export default function ResearchWorkspace({ role = 'founder', user = null }) {
  const location = useLocation();
  const bucket = bucketForPath(role, location.pathname);
  const isRoot = bucket && location.pathname === bucket.prefix;
  const zone = isRoot ? null : zoneForPath(bucket, location.pathname);
  const slug = zone?.slug;

  const accentClass = {
    founder: 'text-axal-violet', investor: 'text-indigo-700',
    advisor: 'text-emerald-700', partner: 'text-amber-700',
  }[role] || 'text-axal-violet';

  const body = useMemo(() => {
    if (isRoot) {
      return <ResearchOverview role={role} />;
    }
    if (slug === 'markets') {
      return (
        <Suspense fallback={<Loading />}>
          <SignalsPage user={user} mode={role === 'advisor' ? 'advisor' : 'founder'} embedded
            zoneActions={(rows) => zoneActionsFor(role, 'research/markets', { view: {
              header: ['Signal', 'Type', 'Sector', 'Niche', 'Region', 'Confidence', 'Freshness', 'Updated'],
              rows,
              cells: (g) => [g.title, g.type, g.sector, g.niche, g.region, g.confidence_score, g.freshness_score, g.updated_at],
            } })} />
        </Suspense>
      );
    }
    if (slug === 'companies') {
      return (
        <Suspense fallback={<Loading />}>
          {/* Whose analyses these are is not obvious from the page, and for an
              advisor it is the first question. `competitor_analyses` is keyed on
              `user_id` with no company column at all, so an analysis belongs to
              the person who ran it and to nobody else — there is no client
              dimension to switch between, which is why no company selector
              appears here and why one must not be invented. */}
          <CompanyScopeNote role={role} />
          <CompetitorAnalysisPage chromeless
            zoneActions={(rows) => zoneActionsFor(role, 'research/companies', { view: {
              header: ['Analysis', 'Mode', 'Edited', 'Updated'],
              rows,
              cells: (a) => [a.title, a.mode, a.edited, a.updated_at],
            } })} />
        </Suspense>
      );
    }
    if (slug === 'library') {
      return (
        <Suspense fallback={<Loading />}>
          <LibraryZone zoneActions={(rows) => zoneActionsFor(role, 'research/library', { view: {
            header: ['Document', 'Kind', 'Index state', 'Passages', 'Size (bytes)', 'Added'],
            rows,
            cells: (d) => [d.title, d.kind, d.index_state, d.chunk_count, d.size_bytes, d.created_at],
          } })} />
        </Suspense>
      );
    }
    if (slug === 'ask') {
      return (
        <Suspense fallback={<Loading />}>
          {/* The citations of the answer ON SCREEN, which is the whole session
              this surface stores: nothing keeps a history, and the zone says so
              rather than offering to export one that does not exist. */}
          <AskZone zoneActions={(rows) => zoneActionsFor(role, 'research/ask', { view: {
            header: ['#', 'Document', 'Score', 'Passage'],
            rows,
            cells: (c) => [c.n, c.title, c.score, c.chunk],
          } })} />
        </Suspense>
      );
    }
    // `funds` is the fallback rather than `ask`, which is now a real page: a
    // slug with no card would otherwise render the Library's working body
    // under some other zone's heading.
    const copy = ZONE_COPY[slug] || ZONE_COPY.funds;
    return (
      <>
        {slug === 'client-prep' && <ClientPrepScopeNote role={role} />}
        <NoStoreYet {...copy} accentClass={copy.accentClass || accentClass} />
      </>
    );
  }, [slug, accentClass, role, user, isRoot]);

  // Companies has a live store for everyone, but for an advisor the store holds
  // only what they ran themselves — saying it "reads a live source" and stopping
  // there implies a client book that does not exist.
  const ownAnalysesOnly = slug === 'companies' && role === 'advisor';
  const coverageLine = isRoot
    ? `Research overview — ${bucket?.zones?.length || 0} zones`
    : LIVE_ZONES.has(slug)
      ? (ownAnalysesOnly
        ? 'Companies · your own analyses, not a client book'
        : `${zone?.label || 'This zone'} reads a live source`)
      : `${zone?.label || 'This zone'} has no store behind it yet`;

  // The zone header's line, for the two zones with a source. Every other zone
  // takes the heading its own body renders — the same coupling the overview
  // cards use. This map previously described Ask as "cited answers over your
  // own documents" and Library as "the documents Ask reads from" directly
  // above the cards saying neither exists.
  const INTRO = { ...ZONE_BLURB, ...unbuiltFrom(ZONE_COPY) };

  return (
    <WorkspaceShell
      role={role}
      title={isRoot ? 'Research' : undefined}
      activeSlug={isRoot ? null : undefined}
      rail={(
        <WorkerRail
          workspace="Research"
          role={role}
          stance="Read-only source coverage"
          note="This rail reports which zones have a store behind them. It does not run research, answer questions, or take actions."
          coverage={[coverageLine]}
          unavailable={[
            // WAS "nothing here can cite", which stopped being true the moment
            // Ask shipped. What remains unavailable is narrower and worth
            // saying precisely: Ask cites your OWN library and nothing else,
            // so a question needing a source you have not added has no answer
            // here rather than a general-knowledge one.
            ['Answers from outside your library', 'Ask reads only documents you have added. It cannot search the web, company databases or market data — those need a licensed source the product does not have.'],
            ['Documents shared with you', 'Nobody can send you a document yet. A founder sharing their own file needs a grant the product has for investors and for nobody else.'],
            ...(ownAnalysesOnly
              ? [['Client-scoped research', 'An analysis is stored against you, not against a company, so nothing here can be filed under a client or reopened per client.']]
              : []),
          ]}
        />
      )}
      intro={isRoot ? 'Know more than the room — research over your own documents, markets, and companies.' : (INTRO[slug] || INTRO.ask)}
    >
      {body}
    </WorkspaceShell>
  );
}
