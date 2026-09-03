import React, { Suspense, lazy, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card, WorkerRail, Skeleton } from '../ui';
import WorkspaceShell from './WorkspaceShell';
import { bucketForPath, zoneForPath, zonePath } from './shellConfig';

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
 * sitting unindexed is invisible to every question asked upstairs. Neither has
 * a backend — there is no document cache, no index state, and no retrieval
 * endpoint in the product today. They therefore ship saying so. An Ask box
 * wired to nothing would answer from the model's general knowledge and present
 * it with the confidence of a citation, which is the single worst failure
 * available on a research surface.
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
 */

const SignalsPage = lazy(() => import('../pages/SignalsPage'));
const CompetitorAnalysisPage = lazy(() => import('../pages/CompetitorAnalysisPage'));

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

// The two zones with a live source behind them. Everything else in ZONE_COPY
// renders NoStoreYet, and the rail says so rather than implying a source.
const LIVE_ZONES = new Set(['markets', 'companies']);

const ASK = {
  heading: 'Ask has no library to read',
  what: 'Ask answers questions over a cache of documents and cites the specific sources each answer drew on. The cache, the index, and the retrieval step do not exist in the product yet.',
  why: 'An Ask box wired to nothing would still answer — from general knowledge, in the same voice a cited answer uses. That is worse than no page, so this one waits for the library rather than faking the citation. A previous Ask tab was withdrawn for exactly that (decision D12): it rendered analyses from a fixture. What is missing here is a store, not a licence — the questions this zone is for are about your own clients’ documents.',
  link: { to: '/research/library', label: 'What the library would hold →' },
};

const LIBRARY = {
  heading: 'The document library is not built yet',
  what: 'The library is the cache Ask reads from, plus your own reusable material. Its most important column is the last one: whether a document is indexed, because that is precisely Ask’s reach.',
  why: 'Nothing in the product stores documents for retrieval today — the one document endpoint is a signed download, not a listable store. Adding a document and making it answerable are two acts, and neither has a store behind it yet. The earlier Documents tab was withdrawn on the same finding (decision D12).',
  link: { to: '/research/ask', label: 'Why Ask is empty too →' },
};

const ZONE_COPY = {
  ask: ASK,
  library: LIBRARY,
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
    why: 'Half of it exists: a booking already carries the topic and the questions the client wrote when they booked, and that half is on Practice · Sessions. What is missing is the other side — nothing joins a booking to the client’s own record, and the project read that would reach it excludes advisors. A brief assembled from one side only would be half a brief presented as a whole one.',
  },
};

function ResearchOverview({ role }) {
  const bucket = bucketForPath(role, '/research');
  if (!bucket) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {bucket.zones.map((zone) => (
        <Link
          key={zone.slug}
          to={zonePath(bucket, zone)}
          className="group rounded-xl border border-axal-border bg-white p-4 transition-colors hover:border-emerald-300 hover:bg-emerald-50/40"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold text-axal-ink group-hover:text-emerald-800">{zone.label}</span>
            <span
              className="rounded-[3px] border px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[.07em]"
              style={{ background: zone.archetype.colors[0], color: zone.archetype.colors[1], borderColor: zone.archetype.colors[2] }}
            >
              {zone.archetype.label}
            </span>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-axal-ink-2">
            {zone.slug === 'ask' && 'Cited answers over your own documents. Every answer names the sources it drew on.'}
            {zone.slug === 'client-prep' && 'One client, everything you need before the session.'}
            {zone.slug === 'markets' && 'Signals from the sectors you work in, with the date each one was gathered.'}
            {zone.slug === 'companies' && 'Companies you have looked into — and whether you have a relationship or only a file.'}
            {zone.slug === 'library' && 'The documents Ask reads from. What is indexed here is exactly what Ask can reach.'}
            {zone.slug === 'funds' && 'Who invests at your stage, and on what terms.'}
            {zone.slug === 'diligence' && 'The evidence behind a decision, and the questions still open against it.'}
            {zone.slug === 'benchmarking' && 'Comparables, with the sample size on every figure.'}
          </p>
        </Link>
      ))}
    </div>
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
          <SignalsPage user={user} mode={role === 'advisor' ? 'advisor' : 'founder'} embedded />
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
          <CompetitorAnalysisPage chromeless />
        </Suspense>
      );
    }
    const copy = ZONE_COPY[slug] || ZONE_COPY.ask;
    return <NoStoreYet {...copy} accentClass={copy.accentClass || accentClass} />;
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

  const INTRO = {
    ask: 'Cited answers over your own documents. Every answer names the sources it drew on.',
    markets: 'Signals from the sectors you work in, with the date each one was gathered.',
    companies: 'Companies you have looked into — and whether you have a relationship or only a file.',
    funds: 'Who invests at your stage, and on what terms.',
    library: 'The documents Ask reads from. What is indexed here is exactly what Ask can reach.',
    diligence: 'The evidence behind a decision, and the questions still open against it.',
    benchmarking: 'Comparables, with the sample size on every figure.',
    'client-prep': 'One client, everything you need before the session.',
  };

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
            ['Cited answers', 'No document cache, index or retrieval step exists in the product, so nothing here can cite.'],
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
