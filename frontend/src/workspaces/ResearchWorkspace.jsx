import React, { Suspense, lazy, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Card, WorkerRail, Skeleton } from '../ui';
import WorkspaceShell from './WorkspaceShell';
import BucketOverview, { unbuiltFrom } from './BucketOverview';
import { accentLinkClass, bucketForPath, bucketTitle, zoneForPath } from './shellConfig';
import { zoneActionsFor } from './zoneActionsByRole';
import { zoneFiltersFor } from './zoneFiltersByRole';
import NoStoreYet from './NoStoreYet';
import { RESEARCH_STORE_GAPS } from './noStoreCopy';
import BucketBoard from './BucketBoard';
import { boardFor } from './boards';
import { api } from '../lib/api';

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
 * MARKETS NO LONGER MOUNTS THE SIGNALS FEED, and the paragraph that stood here
 * described the props that feed needed. The finding is worth keeping: mounted
 * with `embedded` alone, `SignalsPage` dropped `user`, so `mode` resolved to
 * `'founder'` for every role on this route — no advisor ordering, no advisor
 * strip, no `advisor_note`. That was fixed, and then the zone turned out to be
 * about a different object altogether: the `pr3` artboard's comparable RANGES
 * for the firm's own service lines, not sector signals. `MarketZone` is that
 * page and the feed keeps `/signals`. `CompetitorAnalysisPage` had the same
 * swallowed-props defect and keeps its fix — `Companies` takes a `chromeless`
 * flag that is deliberately not `embedded` (see `components/CompetitorAnalysis.jsx`).
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
 * `canAccessFounderResource` itself reads. The join was never the problem — the
 * access rule was. A card that blames a missing table for an access decision
 * sends the next reader to write a migration that would change nothing.
 *
 * THAT ACCESS RULE IS NOW A DECISION A FOUNDER MAKES. Migration 218 gives them
 * `advisor_client_grants`: one project, one named advisor, revocable, expiring,
 * and scoped — the project record, the data room and the client's other
 * sessions are three separate ticks. So the zone has a body, the card is gone,
 * and the per-role reason it used to carry lives in the zone's own empty state,
 * where it is read by someone who has actually opened the page. A partner still
 * has no grant path — the grant is founder→advisor by role check — and the
 * empty state says so in its own words.
 */

const MarketZone = lazy(() => import('../pages/research/MarketZone'));
const CompetitorAnalysisPage = lazy(() => import('../pages/CompetitorAnalysisPage'));
const LibraryZone = lazy(() => import('../pages/research/LibraryZone'));
const AskZone = lazy(() => import('../pages/research/AskZone'));
const FundsZone = lazy(() => import('../pages/research/FundsZone'));
const BenchmarkingZone = lazy(() => import('../pages/research/BenchmarkingZone'));
const DiligenceZone = lazy(() => import('../pages/research/DiligenceZone'));
const ClientPrepZone = lazy(() => import('../pages/research/ClientPrepZone'));

function Loading() {
  return <div className="space-y-3"><Skeleton className="h-8" /><Skeleton className="h-40" /></div>;
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

// The zones with a live source behind them. Everything else in ZONE_COPY
// renders NoStoreYet, and the rail says so rather than implying a source.
//
// ASK AND LIBRARY JOINED THIS SET, and the pair had to move together. The
// docblock above says why: what is indexed in Library is exactly what Ask can
// answer over, so shipping one without the other would leave a working page
// pointing at a card, or an Ask box with nothing to read.
// Migrations 216 and 217 gave `funds` and `benchmarking` a store; `diligence`
// needed none — its canvas artboard is "room access", assembled from the
// `data_room_grants` an investor already holds. All three leave ZONE_COPY here
// and join the zones that read something.
const LIVE_ZONES = new Set(['markets', 'companies', 'library', 'ask', 'funds', 'benchmarking', 'diligence', 'client-prep']);

/**
 * EMPTY, AND THAT IS THE STATE RATHER THAN AN OVERSIGHT. Every zone this
 * workspace serves now reads a store: `funds` and `benchmarking` got one in
 * migrations 216 and 217, `diligence` turned out to need none — its artboard is
 * room access, assembled from grants that already existed — and `client-prep`
 * got its second side from the advisor grant in 218. The object stays as the
 * structure a future unbacked zone would use, and `unbuiltFrom` over an empty
 * map correctly produces no gaps.
 */
const ZONE_COPY = {};

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
  'client-prep': 'One client per brief, assembled from what they opened to you and what you already hold.',
  funds: 'Every fund you have researched, whether they write at your stage, and whether you have a route in.',
  diligence: 'The rooms founders have opened to you, and how much of each they actually staged.',
  benchmarking: 'What you are measuring, what the peer set says, and how many it was measured over.',
  markets: 'Signals from the sectors you work in, with the date each one was gathered.',
  companies: 'The competitor and market analyses you have run yourself.',
  library: 'Documents you have added, and which of them Ask can actually read.',
  ask: 'Questions answered only from your own library, with the passage each answer used.',
};

function ResearchOverview({ role }) {
  const bucket = bucketForPath(role, '/research');
  if (!bucket) return null;
  const board = boardFor(role, '/research', api);
  if (board) return <BucketBoard bucket={bucket} role={role} board={board} />;
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

  const accentClass = accentLinkClass(role);

  const body = useMemo(() => {
    if (isRoot) {
      return <ResearchOverview role={role} />;
    }
    if (slug === 'markets') {
      // THE ZONE'S OBJECT CHANGED, WHICH IS WHY THE MOUNT DID. This rendered
      // `SignalsPage` embedded — the `market_intel_rows` sector feed — and the
      // `pr3` artboard is about comparable RANGES for the firm's own service
      // lines, each attachable to a proposal. A sector signal is not a price.
      // The feed keeps its own route at `/signals`, which every licence that
      // had it here still reaches, and `MarketZone` links to it in as many
      // words rather than leaving a reader to find it.
      return (
        <Suspense fallback={<Loading />}>
          <MarketZone
            role={role}
            zoneFilters={(opts) => zoneFiltersFor(role, 'research/markets', opts)}
            zoneActions={(rows, handlers) => zoneActionsFor(role, 'research/markets', { handlers, view: {
            zone: 'markets',
            header: ['Reading', 'Low (USD cents)', 'High (USD cents)', 'Comparables', 'Run date', 'Age (days)', 'Attachment'],
            rows,
            cells: (r) => [r.metric, r.range_low_cents, r.range_high_cents, r.comparable_count,
              r.ran_at, r.days, r.band === 'stale' ? 'blocked' : (r.days === null ? 'nothing to attach' : (r.attached ? 'attached' : 'attachable'))],
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
            role={role}
            zoneFilters={(opts) => zoneFiltersFor(role, 'research/companies', opts)}
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
          <LibraryZone
            role={role}
            zoneFilters={(opts) => zoneFiltersFor(role, 'research/library', opts)}
            /* `handlers` — dropped here until now, and the drop was invisible:
               `Add document` and `Re-index` are `kind: 'handler'` in all four
               tables, the builder finds no callable and returns null rather
               than a dead control, so two of the artboard's three ops simply
               were not on the page. A closure that takes only `rows` cannot
               carry a page's own functions. */
            zoneActions={(rows, handlers) => zoneActionsFor(role, 'research/library', { handlers, view: {
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
          {/* THE THREAD, NOT THE CITATIONS OF ONE ANSWER. This exported
              `['#', 'Document', 'Score', 'Passage']` — the passages behind
              whichever answer happened to be on screen — because that was the
              whole of what the surface held. Migration 221 stores the session,
              so `Export` now carries what the reader is actually looking at:
              the questions, what came back, whether it was answered at all, and
              what each one cost. `rows` is the NARROWED list, so exporting
              under `Unanswered` gives the unanswered ones. */}
          <AskZone
            role={role}
            zoneFilters={(opts) => zoneFiltersFor(role, 'research/ask', opts)}
            zoneActions={(rows, handlers) => zoneActionsFor(role, 'research/ask', { handlers, view: {
            zone: 'ask',
            header: ['Asked', 'Question', 'Outcome', 'Answer', 'Sources', 'Cost (USD)', 'Kept'],
            rows,
            cells: (t) => [t.created_at, t.question, t.reason, t.answer || '',
              (t.citations || []).map((ct) => ct.title).join('; '), t.cost_usd, t.saved ? 'yes' : 'no'],
          } })} />
        </Suspense>
      );
    }
    if (slug === 'funds') {
      return (
        <Suspense fallback={<Loading />}>
          <FundsZone
            role={role}
            zoneFilters={(opts) => zoneFiltersFor(role, 'research/funds', opts)}
            zoneActions={(rows) => zoneActionsFor(role, 'research/funds', { view: {
            scope: null,
            zone: 'funds',
            header: ['Fund', 'Cheque min (cents)', 'Cheque max (cents)', 'Stage fit', 'Path', 'State', 'Pass reason'],
            rows,
            cells: (f) => [f.name, f.cheque_min_cents, f.cheque_max_cents, f.stage_fit, f.path, f.status, f.pass_reason],
          } })} />
        </Suspense>
      );
    }
    if (slug === 'benchmarking') {
      return (
        <Suspense fallback={<Loading />}>
          <BenchmarkingZone
            role={role}
            zoneFilters={(opts) => zoneFiltersFor(role, 'research/benchmarking', opts)}
            zoneActions={(rows) => zoneActionsFor(role, 'research/benchmarking', { view: {
            scope: null,
            zone: 'benchmarking',
            header: ['Metric', 'Ours', 'Peer', 'Peer source', 'Sample size', 'As of', 'Read'],
            rows,
            cells: (b) => [b.metric, b.our_value, b.peer_value, b.peer_source, b.peer_sample_size, b.peer_as_of, b.reading],
          } })} />
        </Suspense>
      );
    }
    if (slug === 'client-prep') {
      return (
        <Suspense fallback={<Loading />}>
          <ClientPrepZone
            role={role}
            zoneFilters={(opts) => zoneFiltersFor(role, 'research/client-prep', opts)}
            zoneActions={(rows, handlers) => zoneActionsFor(role, 'research/client-prep', { handlers, view: {
            scope: null,
            zone: 'client-prep',
            header: ['Section', 'What it says', 'Source'],
            rows,
            cells: (r) => [r.section, r.value, r.source === 'client' ? 'From the client' : 'Mine'],
          } })} />
        </Suspense>
      );
    }
    if (slug === 'diligence') {
      return (
        <Suspense fallback={<Loading />}>
          <DiligenceZone
            role={role}
            zoneFilters={(opts) => zoneFiltersFor(role, 'research/diligence', opts)}
            zoneActions={(rows) => zoneActionsFor(role, 'research/diligence', { view: {
            scope: null,
            zone: 'diligence',
            header: ['Company', 'Open to you', 'In the room', 'Behind an NDA', 'You last opened'],
            rows,
            cells: (r) => [r.project_name, r.file_open, r.file_total, r.withheld_behind_nda, r.last_opened_at],
          } })} />
        </Suspense>
      );
    }
    // Reachable only if `shellConfig` names a zone before this file serves it.
    // It borrowed another zone's card until every zone had a body; now there is
    // no card to borrow, and describing the wrong zone would be worse than
    // saying plainly that this one has no surface.
    const copy = ZONE_COPY[slug] || {
      heading: 'Nothing serves this zone yet',
      what: 'The workspace shell names this zone, and no page in this file answers it.',
      why: 'It ships empty rather than borrowing another zone\'s description, which would '
        + 'tell you about a surface you are not looking at.',
    };
    return <NoStoreYet {...copy} accentClass={copy.accentClass || accentClass} />;
  }, [slug, accentClass, role, user, isRoot]);

  // THE GAP SITS ABOVE THE BODY, NOT INSTEAD OF IT. These three zones read a
  // real store AND have a canvas-specified capability with none, so neither
  // half of the page can be dropped: removing the body would hide a live feed,
  // and rendering nothing leaves a reader comparing the design to the page with
  // four missing controls and no reason given. `noStoreCopy.js` says why each
  // one is recorded and what `blocks` is compared against.
  const storeGap = !isRoot && slug ? RESEARCH_STORE_GAPS[slug] : null;

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
      title={isRoot ? bucketTitle(bucket) : undefined}
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
            // WAS "Nobody can send you a document yet", AND THAT STOPPED BEING
            // TRUE. `advisor_client_grants` (migration 218) is the grant it
            // said the product had "for investors and for nobody else", and
            // `advisor_client_document_shares` carries a file inside one; the
            // library lists what has arrived that way. What is still absent is
            // the reach: a shared document stays indexed in the client's
            // namespace, which is never searched for you, so Ask cannot cite it.
            ['Ask over a document a client shared', 'A client can open a file to you and the library lists it, but it stays indexed in their namespace — so Ask, which searches only your own, cannot cite it.'],
            ...(ownAnalysesOnly
              ? [['Client-scoped research', 'An analysis is stored against you, not against a company, so nothing here can be filed under a client or reopened per client.']]
              : []),
            // This rail's whole stance is "which zones have a store behind
            // them", so a zone blocked on one belongs in its own report and not
            // only on the page below it. One object feeds both, so the rail
            // cannot be gentler than the body — the guarantee `noStoreCopy.js`
            // exists to make structural.
            ...(storeGap ? [[`No ${storeGap.blocks}`, storeGap.why]] : []),
          ]}
        />
      )}
      intro={isRoot ? 'Know more than the room — research over your own documents, markets, and companies.' : (INTRO[slug] || INTRO.ask)}
    >
      {storeGap && (
        <div className="mb-4">
          <NoStoreYet
            eyebrow={storeGap.eyebrow}
            heading={storeGap.heading}
            what={storeGap.what}
            why={storeGap.why}
            accentClass={accentClass}
          />
        </div>
      )}
      {body}
    </WorkspaceShell>
  );
}
