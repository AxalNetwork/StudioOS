// D534 (#1079) — `/research/companies/company/:uid`, built to
// `design/incoming/Research · Company.dc.html`, and since D7180 (#7180, D7046)
// to boards RS-18 A to RS-18 F of `design/incoming/Research Companies Profiles
// Peers and Evidence Page.dc.html`: sourced metric cards with Observed apart
// from Updated, Sector peers by the Worker's printed rule, and the four
// evidence collections as disclosures with a record drawer (a sheet on a
// phone). A collection's Retry re-reads that collection only (`?part=`). The
// directory record's competitor and diligence status are not shown (D7046
// option A: they name no analysis).
//
// Five reads, each with its own state, so one failure never blanks the page:
//   the company      GET /research/company-directory/:uid  (metrics, evidence,
//                    tracked sector, peers); a failure here is the page's
//   market context   GET /research/markets/:slug for the tracked sector
//   funds            GET /research/fund-directory?focus=  and  ?hq_country=
//   signals          the market's signals plus GET /research/geographies/:code
//
// The bundled `data/companyDirectory.json` read is retired. Description, logo
// and investors read Not recorded: no source holds them, and they are grouped
// into one Not recorded line. "Set up competitor analysis →" opens the Saved
// analyses tab on `/research/companies` with this company as the subject and
// its sector label and country filled in; nothing runs until Analyze.
//
// Departures from the canvas: no public top bar; the app's type; a signal shows
// its why-now and thesis, because the signals store has no "what a founder
// could build" or confidence column for this page to read.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Card, DataState } from '../../ui';
import { researchCompaniesApi } from '../../lib/api/researchCompanies.js';
import { researchMarketsApi } from '../../lib/api/researchMarkets.js';
import { researchFundsApi } from '../../lib/api/researchFunds.js';
import {
  NOT_RECORDED, UNREADABLE, analysisHref, indexRows, latestOnly, relatedSignals,
} from '../../lib/companyDirectoryView.js';
import { backToResults, sessionStore } from './companyDirectoryState.js';
import { useResearchLinks } from './researchLinks.js';
import { directoryHref } from './fundDirectoryRead';
import { formatMinorOrCount } from '../../lib/money';
import ResearchActions from './ResearchActions.jsx';
import { canAddToResearch } from './researchComparisons.js';
import { EVIDENCE_COLLECTIONS, UNSOURCED, collectionState, notRecordedFields, replaceCollection } from './companyProfileRead.js';
import { EvidenceDrawer, EvidenceSection, KeyMetrics, KindBadge, NotRecordedGroup, SectorPeers } from './CompanyEvidence.jsx';

export { KeyMetrics, SectorPeers, UNSOURCED };

const SECTIONS = [
  ['metrics', 'Key metrics'], ['peers', 'Sector peers'], ['market', 'Market context'],
  ['funds', 'Funds'], ['signals', 'Signals'], ['evidence', 'Evidence'],
];

const h2 = 'text-sm font-extrabold tracking-tight text-axal-ink dark:text-gray-100';
const lede = 'mt-1 text-[12px] leading-relaxed text-axal-muted';
const faint = 'text-[11px] text-axal-faint';

/** A read in flight, failed, or answered. */
function useRead(fn, deps) {
  const [r, setR] = useState({ loading: true, error: null, data: null });
  // A peer link reuses this page with a new uid; the old company's read must
  // not land on the new one, so only the newest read commits.
  const [reads] = useState(latestOnly);
  const run = useCallback(async () => {
    const id = reads.next();
    if (!fn) { setR({ loading: false, error: null, data: null }); return; }
    setR((x) => ({ ...x, loading: true, error: null }));
    try {
      const data = await fn();
      if (reads.isCurrent(id)) setR({ loading: false, error: null, data });
    } catch (error) {
      if (reads.isCurrent(id)) setR({ loading: false, error, data: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...r, retry: run };
}

/** D5129 (#5129): the shared Unavailable block, with this page's claim. */
function Unreadable({ what, onRetry }) {
  return <DataState state="unavailable" size="block" what={what} claim="This is not zero." onRetry={onRetry} retryLabel="Try again" />;
}

const Loading = ({ what }) => <p className="text-[12px] text-axal-muted">Loading {what}…</p>;

/** The six indexes of the tracked sector, or why there are none. */
export function MarketContext({ tracked, market }) {
  const head = <h2 className={h2}>Market context{tracked?.name ? `: ${tracked.name}` : ''}</h2>;
  if (!tracked || tracked.status === 'unreadable') return <section id="market" className="space-y-2">{head}<Unreadable what="The sector crosswalk" /></section>;
  if (tracked.status !== 'ok') return <section id="market" className="space-y-2">{head}<p className="text-[12px] text-axal-muted"><strong>{NOT_RECORDED}.</strong> {tracked.reason?.replace(/^Not recorded:\s*/, '') || ''}</p></section>;
  return (
    <section id="market" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>{head}<p className={lede}>The six indexes for the tracked sector this company’s label maps to. Each runs 0 to 100, worldwide, by month.</p></div>
        <Link to={`/research/markets/sector/${encodeURIComponent(tracked.slug)}`} className="text-[12px] font-semibold text-axal-violet underline">Open {tracked.name || tracked.slug} →</Link>
      </div>
      {market.loading ? <Loading what="the market indexes" /> : market.error ? <Unreadable what="The market read" onRetry={market.retry} /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {indexRows(market.data?.index).map((r) => (
            <Card key={r.key} padding="sm">
              <div className="flex items-baseline justify-between"><span className="text-[12px] font-bold text-axal-muted">{r.label}</span>{r.state === 'recorded' && r.change ? <span className="text-[11px] text-axal-faint">{r.change}</span> : null}</div>
              {r.state === 'recorded'
                ? <div className="mt-1 text-lg font-extrabold text-axal-ink dark:text-gray-100">{r.value}<span className="ml-1 text-[11px] font-normal text-axal-faint">{r.period}{r.month_to_date ? ' · month to date' : ''}</span></div>
                : <div className="mt-1"><div className="text-[13px] font-bold text-axal-faint">{NOT_RECORDED}</div><p className={faint}>{r.reason}</p></div>}
            </Card>
          ))}
        </div>
      )}
      <p className={faint}>Mapped by sector label to {tracked.name || tracked.slug} ({tracked.method === 'manual' ? 'by hand' : 'by rule'}). market_intel_indexes · global · monthly.</p>
    </section>
  );
}

// D4612: `canOpen` is whether this reader is admitted to Funds; `more` keeps the list's own filter.
function FundList({ title, read, more, canOpen = true }) {
  return (
    <Card className="space-y-2">
      <div className="flex items-baseline justify-between gap-2"><h3 className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{title}</h3>{read.data ? <span className={faint}>{read.data.total} funds</span> : null}</div>
      {read.loading ? <Loading what="funds" /> : read.error ? <Unreadable what="The fund directory" onRetry={read.retry} /> : !read.data ? <p className="text-[12px] text-axal-muted">{NOT_RECORDED}.</p> : (
        <>
          {read.data.items.length ? (
            <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
              {read.data.items.map((f) => (
                <li key={f.uid} className="py-2">
                  {canOpen
                    ? <Link to={`/research/funds/catalog/${encodeURIComponent(f.uid)}`} className="text-[12.5px] font-semibold text-axal-violet underline">{f.name}</Link>
                    : <span className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{f.name}</span>}
                  <div className={faint}>{[f.hq, f.fund_size_cents != null ? formatMinorOrCount(f.fund_size_cents, f.size_currency, { trimWhole: true }) : null, f.fund_year ? String(f.fund_year) : 'vintage not recorded'].filter(Boolean).join(' · ')}</div>
                </li>
              ))}
            </ul>
          ) : <p className="text-[12px] text-axal-muted">No fund in the directory matches.</p>}
          {canOpen && read.data.total > read.data.items.length ? <Link to={more} className="text-[12px] font-semibold text-axal-violet underline">See all {read.data.total} in Funds →</Link> : null}
        </>
      )}
    </Card>
  );
}

export function Funds({ tracked, focusRead, hqRead, country, links = { funds: true } }) {
  return (
    <section id="funds" className="space-y-3">
      <div><h2 className={h2}>Funds</h2><p className={lede}>Funds whose stated focus maps to this company’s tracked sector, and funds headquartered in its country. Focus and HQ are free text, matched through the crosswalk.</p></div>
      <div className="grid gap-3 lg:grid-cols-2">
        {tracked?.slug ? <FundList title={`Focus maps to ${tracked.name || tracked.slug}`} read={focusRead} canOpen={links.funds} more={directoryHref({ focus: tracked.slug })} />
          : <Card><h3 className="text-[13px] font-bold">By focus</h3><p className="mt-1 text-[12px] text-axal-muted"><strong>{NOT_RECORDED}.</strong> No tracked sector to match a focus on.</p></Card>}
        {tracked?.country_code ? <FundList title={`Headquartered in ${country || tracked.country_code}`} read={hqRead} canOpen={links.funds} more={directoryHref({ hq_country: tracked.country_code })} />
          : <Card><h3 className="text-[13px] font-bold">By headquarters</h3><p className="mt-1 text-[12px] text-axal-muted"><strong>{NOT_RECORDED}.</strong> The crosswalk places this company in no country.</p></Card>}
      </div>
      <p className={faint}>research_fund_directory · sizes as the sources report them.</p>
    </section>
  );
}

export function Signals({ market, geography, tracked }) {
  const reads = [market, geography].filter(Boolean);
  const loading = reads.some((r) => r.loading);
  const failed = reads.some((r) => r.error);
  const list = relatedSignals(market?.data?.signals || [], geography?.data?.signals || []);
  return (
    <section id="signals" className="space-y-3">
      <div><h2 className={h2}>Related signals</h2><p className={lede}>Opportunity signals that name this company’s tracked sector or its country.</p></div>
      {!tracked?.slug && !tracked?.country_code ? <p className="text-[12px] text-axal-muted"><strong>{NOT_RECORDED}.</strong> No tracked sector or country to match on.</p>
        : loading ? <Loading what="signals" />
        : <>
          {failed ? <Unreadable what="A signals read" onRetry={() => reads.forEach((r) => r.error && r.retry())} /> : null}
          {list.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {list.map((s) => (
                <Card key={s.id} className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-axal-faint"><span className="rounded-full bg-violet-100 px-1.5 py-0.5 font-bold text-violet-800 dark:bg-violet-950/40 dark:text-violet-200">{s.match}</span>{[s.region, s.country].filter(Boolean).join(' · ')}</div>
                  <h3 className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{s.title}</h3>
                  {s.why_now ? <p className="text-[12px] text-axal-muted"><strong>Why now:</strong> {s.why_now}</p> : null}
                  {s.thesis ? <p className="text-[12px] text-axal-muted">{s.thesis}</p> : null}
                  <p className={faint}>Updated {s.updated_at || NOT_RECORDED}</p>
                </Card>
              ))}
            </div>
          ) : failed ? null : <p className="text-[12px] text-axal-muted">No signal names this sector or country.</p>}
        </>}
    </section>
  );
}

/**
 * D596 — which register a directory record comes from, read off the row:
 * Companies House (the OGL v3.0 attribution line, which the licence requires
 * to be shown) or Wikidata (CC0). A row names its own source; none is assumed.
 */
export function recordSource(item) {
  if (item?.source_name === 'Companies House') {
    return {
      label: 'Companies House · OGL v3.0', short: 'Companies House (OGL v3.0)', link: 'View the Companies House record ↗',
      attribution: item.source_license || 'Contains public sector information licensed under the Open Government Licence v3.0.',
      fields: 'Name, country, founded year (from the incorporation date) and sector label (from the SIC code)',
    };
  }
  return {
    label: 'Wikidata · CC0', short: 'Wikidata (CC0)', link: 'View the Wikidata record ↗', attribution: null,
    fields: 'Name, website, country, founded year and sector label',
  };
}

/** The header: identity, sector label and tracked sector, and the directory record. */
export function CompanyHeader({ item, tracked, research = null }) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <KindBadge kind="directory" />
        <h1 className="mt-1 break-words text-2xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{item.name}</h1>
        {item.website
          ? <a href={item.website} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-[32px] max-w-full items-center gap-1 break-all text-[12px] text-axal-violet underline">{item.website}<ExternalLink size={12} /><span className="sr-only">(opens in a new tab)</span></a>
          : <p className="mt-1 text-[12px] text-axal-muted">Official site: {NOT_RECORDED} <span className="text-axal-faint">· no source lists a website</span></p>}
        <div className="mt-2 flex flex-wrap gap-2 text-[11.5px]">
          <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-axal-muted dark:border-gray-700">Sector label: {item.sector || NOT_RECORDED}</span>
          <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-axal-muted dark:border-gray-700">Tracked sector: {tracked?.status === 'ok' ? (tracked.name || tracked.slug) : tracked?.status === 'unreadable' ? UNREADABLE : NOT_RECORDED}</span>
          <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-axal-muted dark:border-gray-700">{item.country || `Country: ${NOT_RECORDED}`}</span>
          <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-axal-muted dark:border-gray-700">{item.founded_year ? `Founded ${item.founded_year}` : `Founded: ${NOT_RECORDED}`}</span>
        </div>
        <div className="mt-3 max-w-xl"><NotRecordedGroup testId="company-unsourced" fields={notRecordedFields(item)} /></div>
      </div>
      <div className="flex shrink-0 flex-col gap-2 lg:w-72">
        <Link to={analysisHref(item)} className="inline-flex min-h-[48px] items-center justify-center rounded-lg bg-violet-700 px-3 py-2 text-[13px] font-semibold text-white hover:bg-violet-800 lg:min-h-[40px]">Set up competitor analysis →</Link>
        {research}
        <p className={faint}>Opens the analysis setup with this company filled in. Nothing runs until you press Analyze.</p>
        <Card padding="sm" className="space-y-1">
          <div className="text-[11px] font-bold text-axal-muted">Directory record</div>
          <div className="text-[12px] text-axal-ink dark:text-gray-100">{recordSource(item).label}</div>
          <p className={faint}>{recordSource(item).fields}{item.as_of ? ` · as of ${item.as_of}` : ''}</p>
          {recordSource(item).attribution ? <p className={faint}>{recordSource(item).attribution}</p> : null}
          {item.source_url ? <a href={item.source_url} target="_blank" rel="noreferrer" className="text-[12px] text-axal-violet underline">{recordSource(item).link}</a> : null}
        </Card>
      </div>
    </div>
  );
}

export default function CompanyProfile({ role }) {
  const { uid } = useParams();
  const links = useResearchLinks(role);
  const company = useRead(() => researchCompaniesApi.get(uid), [uid]);
  const tracked = company.data?.tracked_sector;
  const slug = tracked?.status === 'ok' ? tracked.slug : null;
  const code = tracked?.country_code || null;
  const market = useRead(slug ? () => researchMarketsApi.get(slug) : null, [slug]);
  const geography = useRead(code ? () => researchMarketsApi.geography(code) : null, [code]);
  const focusRead = useRead(slug ? () => researchFundsApi.list({ focus: slug, limit: 3 }) : null, [slug]);
  const hqRead = useRead(code ? () => researchFundsApi.list({ hq_country: code, limit: 3 }) : null, [code]);
  // D7180: a collection's Retry re-reads that collection only (`?part=`) and
  // replaces it, keyed to the uid it was pressed on; the rest of the page stays.
  const [parts, setParts] = useState({ uid, data: {}, retrying: {} });
  const [inspect, setInspect] = useState(null);
  useEffect(() => { setParts({ uid, data: {}, retrying: {} }); setInspect(null); }, [uid]);
  const retryCollection = useCallback(async (key) => {
    setParts((p) => (p.uid === uid ? { ...p, retrying: { ...p.retrying, [key]: true } } : p));
    let next;
    try {
      const r = await researchCompaniesApi.part(uid, key);
      next = r?.[key] || { status: 'unreadable', rows: [] };
    } catch {
      next = { status: 'unreadable', rows: [] };
    }
    setParts((p) => (p.uid === uid ? { ...p, data: { ...p.data, [key]: next }, retrying: { ...p.retrying, [key]: false } } : p));
  }, [uid]);
  const onInspect = useCallback((target, opener) => {
    setInspect(typeof target === 'string' ? { metric: target, opener } : { ...target, opener });
  }, []);
  const closeInspect = useCallback(() => setInspect(null), []);

  // D7179 (RS-17 B): Back and the breadcrumb return to this tab's last results
  // (page, filters, sort and selection), named on the link; else the directory.
  const results = backToResults(sessionStore());
  const back = (
    <Link to={results.href} data-testid="link-back-to-results" className="inline-flex min-h-[44px] flex-wrap items-center gap-x-1.5 text-[12px] font-semibold text-axal-violet underline lg:min-h-0 dark:text-violet-300">
      <ArrowLeft size={13} aria-hidden="true" /> {results.label}
      {results.summary ? <span className="font-normal text-axal-muted no-underline dark:text-gray-400">{results.summary}</span> : null}
    </Link>
  );
  if (company.loading) return <div data-testid="company-profile" className="space-y-4">{back}<Card><Loading what="the company" /></Card></div>;
  if (company.error?.status === 404) {
    return <div data-testid="company-profile" className="space-y-4">{back}<Card variant="dashed"><h1 className="text-sm font-extrabold">Company not found</h1><p className="mt-1 text-[12px] text-axal-muted">No directory company has this id.</p></Card></div>;
  }
  if (company.error || !company.data) return <div data-testid="company-profile" className="space-y-4">{back}<Unreadable what="The company directory" onRetry={company.retry} /></div>;

  let d = company.data;
  if (parts.uid === uid) for (const [k, v] of Object.entries(parts.data)) d = replaceCollection(d, k, v);
  const evidenceTotal = EVIDENCE_COLLECTIONS.reduce((n, c) => n + (collectionState(d[c.key]) === 'unreadable' ? 0 : (d[c.key]?.rows || []).length), 0);
  const counts = { peers: d.peers?.status === 'ok' ? d.peers.total : null, evidence: evidenceTotal };
  return (
    <div data-testid="company-profile" className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-[12px] text-axal-muted"><Link to={results.href} state={{ via: 'breadcrumb' }} className="underline">Companies</Link> / <span className="text-axal-ink dark:text-gray-100">{d.item.name}</span></nav>
      {back}
      <CompanyHeader item={d.item} tracked={tracked}
        research={canAddToResearch(role) ? <ResearchActions kind="company" item={{ uid: d.item.uid || uid, name: d.item.name }} /> : null} />
      <nav aria-label="Sections" className="flex gap-1 overflow-x-auto border-b border-axal-hairline dark:border-gray-800">
        {SECTIONS.map(([id, name]) => <a key={id} href={`#${id}`} className="inline-flex min-h-[44px] items-center gap-1 whitespace-nowrap px-3 py-2 text-[12.5px] font-semibold text-axal-muted hover:text-axal-ink dark:hover:text-gray-100">{name}{counts[id] != null ? <span className="rounded-full bg-axal-ground px-1.5 text-[10.5px] font-bold dark:bg-gray-800">{counts[id]}</span> : null}</a>)}
      </nav>
      <KeyMetrics d={d} onInspect={onInspect} />
      <SectorPeers item={d.item} peers={d.peers} />
      <MarketContext tracked={tracked} market={market} />
      <Funds tracked={tracked} focusRead={focusRead} hqRead={hqRead} country={d.item.country} links={links} />
      <Signals tracked={tracked} market={slug ? market : null} geography={code ? geography : null} />
      <EvidenceSection d={d} name={d.item.name} onInspect={onInspect} onRetry={retryCollection} retrying={parts.uid === uid ? parts.retrying : {}} />
      <EvidenceDrawer open={inspect} d={d} onClose={closeInspect} />
      <p className={faint}>Company records come from Wikidata (CC0) or, for UK companies, Companies House (Open Government Licence v3.0); website links are references. Funding, revenue, headcount and market share appear only where a named source records them, with that source and its date. What no source holds reads “Not recorded”.</p>
    </div>
  );
}
