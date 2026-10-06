// D534 (#1079) — `/research/companies/company/:uid`, built to
// `design/incoming/Research · Company.dc.html`.
//
// Five reads, each with its own state, so one failure never blanks the page:
//   the company      GET /research/company-directory/:uid  (metrics, evidence,
//                    tracked sector, peers); a failure here is the page's
//   market context   GET /research/markets/:slug for the tracked sector
//   funds            GET /research/fund-directory?focus=  and  ?hq_country=
//   signals          the market's signals plus GET /research/geographies/:code
//
// The bundled `data/companyDirectory.json` read is retired. Description, logo
// and investors read Not recorded: no source holds them. The "Run competitor
// analysis" button opens the Saved analyses tab on `/research/companies` with
// the company prefilled — `/build/competitors` redirected founders to the
// directory and dropped the prefill.
//
// Departures from the canvas: no public top bar; the app's type; a signal shows
// its why-now and thesis, because the signals store has no "what a founder
// could build" or confidence column for this page to read.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Card } from '../../ui';
import { researchCompaniesApi } from '../../lib/api/researchCompanies.js';
import { researchMarketsApi } from '../../lib/api/researchMarkets.js';
import { researchFundsApi } from '../../lib/api/researchFunds.js';
import {
  NOT_RECORDED, UNREADABLE, analysisHref, employees, indexRows, lastRound, latestOnly, money, relatedSignals,
  sectorLabelHref, signedPct,
} from '../../lib/companyDirectoryView.js';
import { companyHref } from '../../lib/companyDirectoryView.js';

const SECTIONS = [
  ['metrics', 'Key metrics'], ['market', 'Market context'], ['competitors', 'Competitors'],
  ['funds', 'Funds'], ['signals', 'Signals'], ['sources', 'Sources and evidence'],
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

function Unreadable({ what, onRetry }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/60 p-3 text-[12px] text-red-900 dark:border-red-900 dark:bg-red-950/20 dark:text-red-100">
      <strong>{UNREADABLE}.</strong> {what} did not answer. This is not zero.
      {onRetry ? <button type="button" onClick={onRetry} className="ml-2 font-semibold underline">Try again</button> : null}
    </div>
  );
}

const Loading = ({ what }) => <p className="text-[12px] text-axal-muted">Loading {what}…</p>;

function SourceLine({ m }) {
  const parts = [m.source_name, m.as_of ? `as of ${m.as_of}` : null].filter(Boolean).join(' · ');
  return parts ? <p className={faint}>{m.source_url ? <a href={m.source_url} target="_blank" rel="noreferrer" className="underline">{parts}</a> : parts}</p> : null;
}

/** One Key metrics card: the value with its source and date, or Not recorded with why. */
export function MetricCard({ title, m, value, detail, confidence, notRecordedReason }) {
  const recorded = m?.status === 'recorded';
  return (
    <Card data-testid={`metric-${title}`} className="space-y-1">
      <div className="text-[11px] font-bold text-axal-muted">{title}</div>
      {recorded ? (
        <>
          <div className="text-lg font-extrabold text-axal-ink dark:text-gray-100">{value}</div>
          {detail ? <p className="text-[12px] text-axal-muted">{detail}</p> : null}
          <SourceLine m={m} />
          {confidence ? <p className={faint}>Confidence: {confidence}</p> : null}
        </>
      ) : (
        <>
          <div className="text-lg font-extrabold text-axal-faint">{NOT_RECORDED}</div>
          <p className="text-[12px] text-axal-muted">{notRecordedReason}</p>
        </>
      )}
    </Card>
  );
}

export function KeyMetrics({ metrics }) {
  const m = metrics || {};
  const conf = m.confidence;
  const growth = signedPct(m.headcount?.growth_pct);
  const round = m.last_funding;
  return (
    <section id="metrics" className="space-y-3">
      <div><h2 className={h2}>Key metrics</h2><p className={lede}>Each figure shows its own source and date. Not recorded means no source holds it; Unreadable means the read failed.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard title="Funding total" m={m.funding_total} value={money(m.funding_total?.value, m.funding_total?.currency)}
          detail={m.funding_total?.currency ? `All rounds the source lists, in ${m.funding_total.currency}` : null} confidence={conf}
          notRecordedReason="No source lists funding for this company yet." />
        <MetricCard title="Last round" m={round} value={money(round?.value, round?.currency)}
          detail={[round?.type, round?.date ? `announced ${round.date}` : null].filter(Boolean).join(' · ') || null} confidence={conf}
          notRecordedReason="No source lists a round for this company yet." />
        <MetricCard title="Valuation" m={m.valuation} value={money(m.valuation?.value, m.valuation?.currency)} confidence={conf}
          notRecordedReason="No source lists a valuation for this company yet." />
        <MetricCard title="Revenue" m={m.revenue} value={money(m.revenue?.value, m.revenue?.currency)} confidence={conf}
          notRecordedReason="No source lists revenue for this company yet." />
        <MetricCard title="Employees" m={m.headcount} value={m.headcount?.value != null ? Number(m.headcount.value).toLocaleString('en-US') : null}
          detail={m.headcount?.as_of ? `Headcount on ${m.headcount.as_of}` : null} confidence={conf}
          notRecordedReason="No source lists a headcount for this company yet." />
        <MetricCard title="Employee growth" m={growth ? m.headcount : null} value={growth} confidence={conf}
          notRecordedReason="No source lists headcount growth for this company yet." />
        <MetricCard title="Market share" m={m.market_share_pct} value={m.market_share_pct?.value != null ? `${m.market_share_pct.value}%` : null} confidence={conf}
          notRecordedReason="No source lists a market share for this company yet." />
      </div>
    </section>
  );
}

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

/** Same-label companies, nearest first, with the API's total. */
export function Competitors({ item, peers }) {
  const head = <div><h2 className={h2}>Competitors</h2><p className={lede}>Other directory companies with the same sector label, nearest first: same country, then the rest by name.</p></div>;
  if (!peers || peers.status === 'unreadable') return <section id="competitors" className="space-y-3">{head}<Unreadable what="The peers read" /></section>;
  if (peers.status === 'not_recorded') return <section id="competitors" className="space-y-3">{head}<p className="text-[12px] text-axal-muted"><strong>{NOT_RECORDED}.</strong> This company has no sector label, so it has no peers to match.</p></section>;
  return (
    <section id="competitors" className="space-y-3">
      {head}
      <p className="text-[12.5px] text-axal-muted"><strong className="text-axal-ink dark:text-gray-100">{peers.total}</strong> {peers.total === 1 ? 'company shares' : 'companies share'} this label</p>
      {peers.rows.length ? (
        <Card padding="none" className="overflow-hidden"><div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[12px]">
            <thead className="bg-axal-ground text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint dark:bg-gray-950">
              <tr><th className="px-4 py-2.5">Company</th><th className="px-4 py-2.5">Country</th><th className="px-4 py-2.5">Founded</th><th className="px-4 py-2.5">Last round</th><th className="px-4 py-2.5">Employees</th></tr>
            </thead>
            <tbody className="divide-y divide-axal-hairline dark:divide-gray-800">
              {peers.rows.map((p) => {
                const round = lastRound(p);
                const staff = employees(p);
                return (
                  <tr key={p.uid}>
                    <td className="px-4 py-3"><Link to={companyHref(p.uid)} className="font-semibold text-axal-violet underline dark:text-violet-300">{p.name}</Link>{p.website ? <div className="mt-0.5 max-w-[280px] truncate text-[11px] text-axal-faint">{p.website}</div> : null}</td>
                    <td className="px-4 py-3 text-axal-muted">{p.country || NOT_RECORDED}{p.same_country ? <span className="ml-2 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-800 dark:bg-violet-950/40 dark:text-violet-200">Same country</span> : null}</td>
                    <td className="px-4 py-3 font-mono text-axal-muted">{p.founded_year ?? NOT_RECORDED}</td>
                    <td className="px-4 py-3">{round ? <>{round.amount}{round.detail ? <div className={faint}>{round.detail}</div> : null}</> : <span className="text-axal-faint">{NOT_RECORDED}</span>}</td>
                    <td className="px-4 py-3">{staff ? staff.count : <span className="text-axal-faint">{NOT_RECORDED}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div></Card>
      ) : null}
      {peers.total > peers.rows.length ? <Link to={sectorLabelHref(item.sector)} className="text-[12px] font-semibold text-axal-violet underline">See all {peers.total} with this label in Companies →</Link> : null}
    </section>
  );
}

function FundList({ title, read, more }) {
  return (
    <Card className="space-y-2">
      <div className="flex items-baseline justify-between gap-2"><h3 className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{title}</h3>{read.data ? <span className={faint}>{read.data.total} funds</span> : null}</div>
      {read.loading ? <Loading what="funds" /> : read.error ? <Unreadable what="The fund directory" onRetry={read.retry} /> : !read.data ? <p className="text-[12px] text-axal-muted">{NOT_RECORDED}.</p> : (
        <>
          {read.data.items.length ? (
            <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
              {read.data.items.map((f) => (
                <li key={f.uid} className="py-2">
                  <Link to={`/research/funds/catalog/${encodeURIComponent(f.uid)}`} className="text-[12.5px] font-semibold text-axal-violet underline">{f.name}</Link>
                  <div className={faint}>{[f.hq, f.fund_size_cents != null ? money(f.fund_size_cents / 100, f.size_currency) : null, f.fund_year ? String(f.fund_year) : 'vintage not recorded'].filter(Boolean).join(' · ')}</div>
                </li>
              ))}
            </ul>
          ) : <p className="text-[12px] text-axal-muted">No fund in the directory matches.</p>}
          {read.data.total > read.data.items.length ? <Link to={more} className="text-[12px] font-semibold text-axal-violet underline">See all {read.data.total} in Funds →</Link> : null}
        </>
      )}
    </Card>
  );
}

export function Funds({ tracked, focusRead, hqRead, country }) {
  return (
    <section id="funds" className="space-y-3">
      <div><h2 className={h2}>Funds</h2><p className={lede}>Funds whose stated focus maps to this company’s tracked sector, and funds headquartered in its country. Focus and HQ are free text, matched through the crosswalk.</p></div>
      <div className="grid gap-3 lg:grid-cols-2">
        {tracked?.slug ? <FundList title={`Focus maps to ${tracked.name || tracked.slug}`} read={focusRead} more="/research/funds" />
          : <Card><h3 className="text-[13px] font-bold">By focus</h3><p className="mt-1 text-[12px] text-axal-muted"><strong>{NOT_RECORDED}.</strong> No tracked sector to match a focus on.</p></Card>}
        {tracked?.country_code ? <FundList title={`Headquartered in ${country || tracked.country_code}`} read={hqRead} more="/research/funds" />
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
                  <p className={faint}>Updated {s.updated_at || NOT_RECORDED} · <Link to="/signals" className="underline">Read the signal →</Link></p>
                </Card>
              ))}
            </div>
          ) : failed ? null : <p className="text-[12px] text-axal-muted">No signal names this sector or country.</p>}
        </>}
    </section>
  );
}

/** Where each fact comes from. A failed evidence table says so on its own row. */
export function SourcesTable({ item, metrics, financials, employment, sources, fundingRounds }) {
  const m = metrics || {};
  const rec = (x) => x?.status === 'recorded';
  const metricRow = (label, x) => rec(x)
    ? [label, x.source_name || NOT_RECORDED, x.as_of || NOT_RECORDED, m.confidence || 'Not rated', x.source_url]
    : [label, NOT_RECORDED, '', '', null];
  const rows = [
    ['Name, website, country, founded', 'Wikidata (CC0)', item.as_of, 'Not rated', item.source_url],
    ['Sector label', item.sector ? 'Wikidata (CC0)' : NOT_RECORDED, item.sector ? item.as_of : '', item.sector ? 'Not rated' : '', item.sector ? item.source_url : null],
    metricRow('Funding total', m.funding_total),
    metricRow('Last round', m.last_funding),
    metricRow('Employees and growth', m.headcount),
    metricRow('Revenue', m.revenue),
    metricRow('Valuation', m.valuation),
    metricRow('Market share', m.market_share_pct),
  ];
  const evidence = [['Financial statements', financials], ['Headcount history', employment], ['Funding rounds', fundingRounds], ['Field sources', sources]];
  return (
    <section id="sources" className="space-y-3">
      <div><h2 className={h2}>Sources and evidence</h2><p className={lede}>Where each fact on this page comes from, and how sure the source is.</p></div>
      <Card padding="none" className="overflow-hidden"><div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[12px]">
          <thead className="bg-axal-ground text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint dark:bg-gray-950">
            <tr><th className="px-4 py-2.5">Field</th><th className="px-4 py-2.5">Source</th><th className="px-4 py-2.5">As of</th><th className="px-4 py-2.5">Confidence</th><th className="px-4 py-2.5">Record</th></tr>
          </thead>
          <tbody className="divide-y divide-axal-hairline dark:divide-gray-800">
            {rows.map(([f, src, asOf, conf, url]) => (
              <tr key={f}><td className="px-4 py-2.5 font-semibold text-axal-ink dark:text-gray-100">{f}</td><td className="px-4 py-2.5 text-axal-muted">{src}</td><td className="px-4 py-2.5 text-axal-muted">{asOf}</td><td className="px-4 py-2.5 text-axal-muted">{conf}</td>
                <td className="px-4 py-2.5">{url ? <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-axal-violet underline">Open source <ExternalLink size={11} /></a> : null}</td></tr>
            ))}
            {evidence.map(([f, e]) => (
              <tr key={f}><td className="px-4 py-2.5 font-semibold text-axal-ink dark:text-gray-100">{f}</td>
                <td className="px-4 py-2.5 text-axal-muted" colSpan={4}>{!e || e.status === 'unreadable' ? <span className="font-semibold text-red-700 dark:text-red-300">{UNREADABLE}: read failed</span> : e.rows.length ? `${e.rows.length} ${e.rows.length === 1 ? 'row' : 'rows'}` : NOT_RECORDED}</td></tr>
            ))}
            <tr><td className="px-4 py-2.5 font-semibold text-axal-ink dark:text-gray-100">Competitor status</td><td className="px-4 py-2.5 text-axal-muted" colSpan={4}>{item.competitor_status || NOT_RECORDED} <span className={faint}>· as stored on the directory record</span></td></tr>
            <tr><td className="px-4 py-2.5 font-semibold text-axal-ink dark:text-gray-100">Diligence status</td><td className="px-4 py-2.5 text-axal-muted" colSpan={4}>{item.diligence_status || NOT_RECORDED} <span className={faint}>· as stored on the directory record</span></td></tr>
          </tbody>
        </table>
      </div></Card>
      <p className={faint}>Discovery metadata from Wikidata, plus figures only where a named source records them. Nothing on this page is estimated.</p>
    </section>
  );
}

/** Fields the canvas draws that no source holds: shown as Not recorded, never invented. */
export const UNSOURCED = [
  ['Description', 'no source holds one'],
  ['Logo', 'no source holds one'],
  ['Investors', 'no source lists them'],
];

/** The header: identity, sector label and tracked sector, and the directory record. */
export function CompanyHeader({ item, tracked }) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{item.name}</h1>
        {item.website ? <a href={item.website} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] text-axal-violet underline">{item.website}<ExternalLink size={12} /><span className="sr-only">(opens in a new tab)</span></a> : null}
        <dl data-testid="company-unsourced" className="mt-2 grid max-w-xl grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
          {UNSOURCED.map(([name, why]) => (
            <React.Fragment key={name}><dt className="text-axal-muted">{name}</dt><dd className="text-axal-faint">{NOT_RECORDED} · {why}</dd></React.Fragment>
          ))}
        </dl>
        <div className="mt-2 flex flex-wrap gap-2 text-[11.5px]">
          <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-axal-muted dark:border-gray-700">Sector label: {item.sector || NOT_RECORDED}</span>
          <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-axal-muted dark:border-gray-700">Tracked sector: {tracked?.status === 'ok' ? (tracked.name || tracked.slug) : tracked?.status === 'unreadable' ? UNREADABLE : NOT_RECORDED}</span>
          <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-axal-muted dark:border-gray-700">{item.country || `Country: ${NOT_RECORDED}`}</span>
          <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-axal-muted dark:border-gray-700">{item.founded_year ? `Founded ${item.founded_year}` : `Founded: ${NOT_RECORDED}`}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2 lg:w-72">
        <Link to={analysisHref(item)} className="inline-flex items-center justify-center rounded-lg bg-violet-700 px-3 py-2 text-[12px] font-semibold text-white hover:bg-violet-800">Run competitor analysis →</Link>
        <Card padding="sm" className="space-y-1">
          <div className="text-[11px] font-bold text-axal-muted">Directory record</div>
          <div className="text-[12px] text-axal-ink dark:text-gray-100">Wikidata · CC0</div>
          <p className={faint}>Name, website, country, founded year and sector label{item.as_of ? ` · as of ${item.as_of}` : ''}</p>
          {item.source_url ? <a href={item.source_url} target="_blank" rel="noreferrer" className="text-[12px] text-axal-violet underline">View the Wikidata record ↗</a> : null}
        </Card>
      </div>
    </div>
  );
}

export default function CompanyProfile() {
  const { uid } = useParams();
  const company = useRead(() => researchCompaniesApi.get(uid), [uid]);
  const tracked = company.data?.tracked_sector;
  const slug = tracked?.status === 'ok' ? tracked.slug : null;
  const code = tracked?.country_code || null;
  const market = useRead(slug ? () => researchMarketsApi.get(slug) : null, [slug]);
  const geography = useRead(code ? () => researchMarketsApi.geography(code) : null, [code]);
  const focusRead = useRead(slug ? () => researchFundsApi.list({ focus: slug, limit: 3 }) : null, [slug]);
  const hqRead = useRead(code ? () => researchFundsApi.list({ hq_country: code, limit: 3 }) : null, [code]);

  const back = <Link to="/research/companies" className="inline-flex items-center gap-1 text-[12px] font-semibold text-axal-violet underline dark:text-violet-300"><ArrowLeft size={13} /> Companies</Link>;
  if (company.loading) return <div data-testid="company-profile" className="space-y-4">{back}<Card><Loading what="the company" /></Card></div>;
  if (company.error?.status === 404) {
    return <div data-testid="company-profile" className="space-y-4">{back}<Card variant="dashed"><h1 className="text-sm font-extrabold">Company not found</h1><p className="mt-1 text-[12px] text-axal-muted">No directory company has this id.</p></Card></div>;
  }
  if (company.error || !company.data) return <div data-testid="company-profile" className="space-y-4">{back}<Unreadable what="The company directory" onRetry={company.retry} /></div>;

  const d = company.data;
  return (
    <div data-testid="company-profile" className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-[12px] text-axal-muted"><Link to="/research/companies" className="underline">Companies</Link> / <span className="text-axal-ink dark:text-gray-100">{d.item.name}</span></nav>
      <CompanyHeader item={d.item} tracked={tracked} />
      <nav aria-label="Sections" className="flex gap-1 overflow-x-auto border-b border-axal-hairline dark:border-gray-800">
        {SECTIONS.map(([id, name]) => <a key={id} href={`#${id}`} className="whitespace-nowrap px-3 py-2 text-[12.5px] font-semibold text-axal-muted hover:text-axal-ink dark:hover:text-gray-100">{name}</a>)}
      </nav>
      <KeyMetrics metrics={d.metrics} />
      <MarketContext tracked={tracked} market={market} />
      <Competitors item={d.item} peers={d.peers} />
      <Funds tracked={tracked} focusRead={focusRead} hqRead={hqRead} country={d.item.country} />
      <Signals tracked={tracked} market={slug ? market : null} geography={code ? geography : null} />
      <SourcesTable item={d.item} metrics={d.metrics} financials={d.financials} employment={d.employment} sources={d.sources} fundingRounds={d.funding_rounds} />
      <p className={faint}>Company records come from Wikidata (CC0); website links are references. Funding, revenue, headcount and market share appear only where a named source records them, with that source and its date. What no source holds reads “Not recorded”.</p>
    </div>
  );
}
