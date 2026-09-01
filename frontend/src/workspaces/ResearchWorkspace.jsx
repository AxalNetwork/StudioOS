import React, { Suspense, lazy, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card, Skeleton } from '../ui';
import WorkspaceShell from './WorkspaceShell';
import { bucketForPath, zoneForPath } from './shellConfig';

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

const ASK = {
  heading: 'Ask has no library to read',
  what: 'Ask answers questions over a cache of documents and cites the specific sources each answer drew on. The cache, the index, and the retrieval step do not exist in the product yet.',
  why: 'An Ask box wired to nothing would still answer — from general knowledge, in the same voice a cited answer uses. That is worse than no page, so this one waits for the library rather than faking the citation.',
  link: { to: '/research/library', label: 'What the library would hold →' },
};

const LIBRARY = {
  heading: 'The document library is not built yet',
  what: 'The library is the cache Ask reads from, plus your own reusable material. Its most important column is the last one: whether a document is indexed, because that is precisely Ask’s reach.',
  why: 'Nothing in the product stores documents for retrieval today. Adding a document and making it answerable are two acts, and neither has a store behind it yet.',
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
    why: 'It would draw on the engagement record and — where the client is a founder on the platform — on their own record, read-only. Neither join exists yet, and a brief assembled from one side only would be half a brief presented as a whole one.',
  },
};

export default function ResearchWorkspace({ role = 'founder' }) {
  const location = useLocation();
  const bucket = bucketForPath(role, location.pathname);
  const zone = zoneForPath(bucket, location.pathname);
  const slug = zone?.slug;

  const accentClass = {
    founder: 'text-axal-violet', investor: 'text-indigo-700',
    advisor: 'text-emerald-700', partner: 'text-amber-700',
  }[role] || 'text-axal-violet';

  const body = useMemo(() => {
    if (slug === 'markets') {
      return (
        <Suspense fallback={<Loading />}>
          <SignalsPage embedded />
        </Suspense>
      );
    }
    if (slug === 'companies') {
      return (
        <Suspense fallback={<Loading />}>
          <CompetitorAnalysisPage embedded />
        </Suspense>
      );
    }
    const copy = ZONE_COPY[slug] || ZONE_COPY.ask;
    return <NoStoreYet {...copy} accentClass={copy.accentClass || accentClass} />;
  }, [slug, accentClass]);

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
      surface="research"
      intro={INTRO[slug] || INTRO.ask}
    >
      {body}
    </WorkspaceShell>
  );
}
