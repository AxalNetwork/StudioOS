import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Card } from '../../ui';
import WorkspaceShell from '../../workspaces/WorkspaceShell';
import { researchMarketsApi } from '../../lib/api/researchMarkets';
import { researchSectorsApi } from '../../lib/api/researchSectors';
import { sizeOf, backingOf } from './fundDirectoryRead';

const DIMENSIONS = ['demand', 'supply', 'capital', 'talent', 'research', 'sentiment'];
const READS = { demand: 'Demand for the work', supply: 'What is being built', capital: 'Capital activity', talent: 'Talent activity', research: 'Research activity', sentiment: 'Public discussion' };
const titleCase = (word) => word.charAt(0).toUpperCase() + word.slice(1);
const missing = (value) => value === null || value === undefined || value === '';
const fact = (value) => missing(value) ? 'Not recorded' : value;

/** A missing sector may be an old market link; a failed read never means missing. */
export async function resolveSectorPage(slug, sectors = researchSectorsApi, markets = researchMarketsApi) {
  try { return { kind: 'sector', data: await sectors.get(slug) }; }
  catch (error) { if (error?.status !== 404) throw error; }
  let market;
  try { market = await markets.get(slug); }
  catch (error) { if (error?.status !== 404) throw error; return { kind: 'missing' }; }
  const sector = market?.sector?.mi_sector;
  if (!sector) return { kind: 'legacy', market };
  const sectorSlug = sector.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { kind: 'redirect', to: `/research/markets/sector/${encodeURIComponent(sectorSlug)}?market=${encodeURIComponent(slug)}#submarkets` };
}

export function sectorChartPoints(dimension) {
  return (dimension?.points || []).map((p) => ({ ...p, value: missing(p.value) ? null : p.value }));
}

function Builds({ signals }) {
  const builds = signals.flatMap((s) => {
    let b = s.build_opportunity;
    if (typeof b === 'string') {
      try { b = JSON.parse(b); } catch { b = { headline: b }; }
    }
    return b && typeof b === 'object' && !Array.isArray(b) && Object.values(b).some((v) => typeof v === 'string' && v.trim()) ? [{ signal: s, build: b }] : [];
  });
  return <section id="build" className="space-y-3"><h2 className="text-xl font-bold">What a founder could build here</h2>
    <p className="text-sm text-axal-muted">Taken from the build opportunity recorded on each signal.</p>
    {!builds.length ? <Card variant="dashed">Not recorded · No build opportunity is recorded for this sector.</Card>
      : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{builds.map(({ signal, build }) => <Card key={signal.id}>
        <h3 className="font-semibold">{typeof build.headline === 'string' ? build.headline : signal.title}</h3>
        <dl className="mt-3 space-y-3">{[['First workflow', 'wedge'], ['Who buys', 'icp'], ['Why it might not work', 'risks']].map(([label, key]) => <div key={key}>
          <dt className="text-xs text-axal-muted">{label}</dt><dd className="mt-1 text-sm">{typeof build[key] === 'string' && build[key].trim() ? build[key] : 'Not recorded · This signal has no entry for this field.'}</dd>
        </div>)}</dl><p className="mt-4 text-xs text-axal-muted">From {signal.title} · updated {fact(signal.updated_at)}</p>
      </Card>)}</div>}
  </section>;
}

export function SectorProfileView({ loading = false, error = false, data = null, highlightedMarket = '', onRetry = () => {} }) {
  if (loading) return <Card><p role="status">Loading sector data…</p></Card>;
  if (error) return <Card variant="dashed"><p role="alert">Unreadable · This sector could not be read. Try again.</p><button type="button" onClick={onRetry} className="mt-3 min-h-11 underline">Retry</button></Card>;
  if (!data) return <Card variant="dashed"><p>Sector or market not found.</p><Link to="/research/markets" className="mt-3 inline-block underline">Back to markets</Link></Card>;
  const dimensions = data.dimensions || {};
  const countries = (data.companies_by_country || []).map((c) => ({ ...c, label: c.name || 'Country not recorded' }));
  const signals = data.signals || [];
  const submarkets = data.sub_markets || [];
  const companies = data.companies || [];
  const funds = data.funds || [];
  return <div data-testid="tracked-sector-profile" className="space-y-8 text-axal-ink dark:text-gray-100">
    <div className="space-y-3"><p className="text-xs font-bold uppercase tracking-wider text-axal-muted">Tracked sector · worldwide</p>
      <p className="text-sm text-axal-muted">Monthly indexes from cited live sources. A missing month remains a gap; the current month is month to date.</p>
      <nav aria-label="Sector sections" className="flex flex-wrap gap-2">{[
        ['companies', `${data.company_count} directory companies`], ['funds', `${data.fund_count} funds`],
        ['signals', `${signals.length} signals`], ['submarkets', `${submarkets.length} taxonomy markets`], ['build', 'What to build'],
      ].map(([id, label]) => <a key={id} href={`#${id}`} className="inline-flex min-h-11 items-center rounded-full border border-axal-hairline px-4 text-sm dark:border-gray-700">{label}</a>)}</nav>
    </div>
    <section id="indexes" className="space-y-3"><h2 className="text-xl font-bold">Six dimensions, month by month</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{DIMENSIONS.map((dimension) => {
        const d = dimensions[dimension];
        const points = sectorChartPoints(d);
        return <Card key={dimension}><figure aria-label={`${titleCase(dimension)} monthly index`}>
          <figcaption className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-semibold">{titleCase(dimension)}</h3><p className="text-xs text-axal-muted">{READS[dimension]}</p></div>
            <div className="text-right"><span className="text-2xl font-semibold">{fact(d?.value)}</span>
              <p className="text-xs text-axal-muted">{missing(d?.change) ? 'Change not recorded' : `${d.change > 0 ? '+' : ''}${d.change}% vs previous month`}</p></div></figcaption>
          {missing(d?.value) ? <p className="my-6 text-sm text-axal-muted">Not recorded · {d?.reason || 'No live source yet for this dimension.'}</p>
            : <div className="mt-3 h-36 min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={points}>
              <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="period" tick={{ fontSize: 10 }} /><YAxis domain={[0, 100]} width={28} tick={{ fontSize: 10 }} />
              <Tooltip /><Line type="linear" dataKey="value" stroke="var(--color-axal-violet)" connectNulls={false} isAnimationActive={false} />
            </LineChart></ResponsiveContainer></div>}
          <details className="mt-3 text-xs"><summary className="cursor-pointer">Monthly values and gaps</summary><ul className="mt-2 space-y-1">{points.map((p) => <li key={p.period}>
            {p.period}: {missing(p.value) ? `Not recorded · ${p.reason}` : `${p.value} · ${p.sources} sources`}{p.month_to_date ? ' · month to date' : ''}
          </li>)}</ul></details>
          <p className="mt-3 border-t border-axal-hairline pt-3 text-xs text-axal-muted dark:border-gray-700">Latest live period {fact(d?.period)} · computed {fact(d?.computed_at)}</p>
        </figure></Card>;
      })}</div>
    </section>
    <section id="sources" className="space-y-3"><h2 className="text-xl font-bold">What each index reads</h2><p className="text-sm text-axal-muted">{data.source_mix_basis}</p>
      <Card><div className="divide-y divide-axal-hairline dark:divide-gray-700">{DIMENSIONS.map((dimension) => {
        const d = dimensions[dimension];
        const mix = d?.points?.find((p) => p.period === d.period)?.source_mix || [];
        return <div key={dimension} className="grid gap-3 py-4 sm:grid-cols-2"><h3 className="font-semibold">{titleCase(dimension)} · {fact(d?.period)}</h3>
          {!mix.length ? <p className="text-sm text-axal-muted">Not recorded · No cited source rows for this month.</p> : <ul className="space-y-2">{mix.map((s) => <li key={s.source_key} className="text-sm">
            {s.name} · {s.rows} rows · {missing(s.share) ? 'Share not recorded' : `${Math.round(s.share * 100)}%`} · latest {s.latest}
          </li>)}</ul>}</div>;
      })}</div></Card>
    </section>
    <div className="grid gap-3 lg:grid-cols-3"><section id="signals" className="lg:col-span-2"><Card><h2 className="text-xl font-bold">Signals in {data.name}</h2>
      {!signals.length ? <p className="mt-4 text-sm text-axal-muted">No signals recorded for this sector.</p> : <div className="mt-3 divide-y divide-axal-hairline dark:divide-gray-700">{signals.map((s) => <article key={s.id} className="space-y-2 py-4">
        <p className="text-xs text-axal-muted">{s.type} · {fact(s.region)} · {fact(s.country)}</p><h3 className="font-semibold">{s.title}</h3>
        <p className="text-sm">Why now: {fact(s.why_now)}</p><p className="text-xs text-axal-muted">Confidence {missing(s.confidence_score) ? 'Not recorded' : `${s.confidence_score}%`} · updated {fact(s.updated_at)}</p>
      </article>)}</div>}</Card></section>
      <section id="submarkets"><Card><h2 className="text-xl font-bold">Sub-markets</h2><p className="mt-1 text-xs text-axal-muted">Directory company counts through the taxonomy crosswalk.</p>
        {!submarkets.length ? <p className="mt-4 text-sm text-axal-muted">No taxonomy markets map to this sector.</p> : <ul className="mt-3 space-y-2">{submarkets.map((m) => <li key={m.slug} data-highlighted={m.slug === highlightedMarket ? 'true' : 'false'} className={m.slug === highlightedMarket ? 'rounded-md bg-violet-50 p-2 dark:bg-violet-950' : 'p-2'}>
          <div className="flex justify-between gap-3"><Link to={`/research/markets/sector/${encodeURIComponent(data.slug)}?market=${encodeURIComponent(m.slug)}#submarkets`} className="underline" aria-current={m.slug === highlightedMarket ? 'true' : undefined}>{m.name}</Link><span>{m.company_count}</span></div>
          <p className="mt-1 text-xs text-axal-muted">{m.supplied_count} supplied by the taxonomy source · as of {fact(m.as_of)} · not market size</p>
        </li>)}</ul>}</Card></section></div>
    <section id="companies" className="space-y-3"><h2 className="text-xl font-bold">Companies in this sector</h2>
      {!companies.length ? <Card variant="dashed">No directory companies map to this sector.</Card> : <div className="grid gap-3 lg:grid-cols-3">
        <Card><figure aria-label="Companies by country"><figcaption className="font-semibold">By country</figcaption><div className="mt-3 h-56 min-w-0"><ResponsiveContainer width="100%" height="100%"><BarChart data={countries} layout="vertical">
          <XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="count" fill="var(--color-axal-violet)" isAnimationActive={false} />
        </BarChart></ResponsiveContainer></div><ul className="mt-3 space-y-1 text-sm">{countries.map((c) => <li key={c.code || 'unknown'} className="flex justify-between gap-3">
          {c.code ? <Link to={`/research/geographies/${c.code}`} className="underline">{c.label}</Link> : <span>{c.label}</span>}<span>{c.count}</span>
        </li>)}</ul></figure></Card>
        <Card className="min-w-0 lg:col-span-2"><div className="overflow-x-auto"><table className="w-full min-w-[500px] text-left text-sm"><caption className="mb-3 text-left text-xs text-axal-muted">Showing {companies.length} of {data.company_count} directory companies. Each row names its as-of date.</caption>
          <thead><tr>{['Company', 'Country', 'Founded', 'Employees', 'As of'].map((h) => <th key={h} scope="col" className="p-2 text-xs text-axal-muted">{h}</th>)}</tr></thead><tbody>{companies.map((c) => <tr key={c.uid} className="border-t border-axal-hairline dark:border-gray-700">
            <td className="p-2"><Link to={`/research/companies/company/${encodeURIComponent(c.uid)}`} className="font-semibold underline">{c.name}</Link><p className="text-xs text-axal-muted">{fact(c.sector)}</p></td>
            <td className="p-2">{fact(c.country)}</td><td className="p-2">{fact(c.founded_year)}</td><td className="p-2">{fact(c.employee_count)}</td><td className="p-2">{fact(c.as_of)}</td>
          </tr>)}</tbody></table></div></Card></div>}
    </section>
    <section id="funds" className="space-y-3"><h2 className="text-xl font-bold">Funds focused on {data.name}</h2>
      <p className="text-sm text-axal-muted">Focus goes through the taxonomy crosswalk. A size is shown only where its currency is known.</p>
      {!funds.length ? <Card variant="dashed">No funds map to this sector.</Card> : <Card><div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><caption className="mb-3 text-left text-xs text-axal-muted">Showing {funds.length} of {data.fund_count} funds.</caption>
        <thead><tr>{['Fund', 'HQ', 'Size', 'Vintage', 'EIF / EIFO', 'As of'].map((h) => <th key={h} scope="col" className="p-2 text-xs text-axal-muted">{h}</th>)}</tr></thead><tbody>{funds.map((f) => {
          const size = sizeOf(f); const backing = backingOf(f);
          return <tr key={f.uid} className="border-t border-axal-hairline dark:border-gray-700"><td className="p-2"><Link to={`/research/funds/catalog/${encodeURIComponent(f.uid)}`} className="font-semibold underline">{f.name}</Link><p className="text-xs text-axal-muted">{fact(f.sector_focus)}</p></td>
            <td className="p-2">{fact(f.hq)}</td><td className="p-2">{size.text || `Not recorded · ${size.reason}`}</td><td className="p-2">{fact(f.fund_year)}</td><td className="p-2">{backing.kind === 'named' ? backing.named.join(' / ') : backing.kind === 'neither' ? 'Neither recorded' : 'LPs not recorded'}</td><td className="p-2">{fact(f.as_of)}</td></tr>;
        })}</tbody></table></div></Card>}
    </section>
    <Builds signals={signals} />
  </div>;
}

export default function SectorProfile({ slug, role, LegacyPage }) {
  const location = useLocation();
  const [result, setResult] = useState({ slug, loading: true });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setResult({ slug, loading: true });
    resolveSectorPage(slug).then((value) => { if (alive) setResult({ slug, ...value }); })
      .catch(() => { if (alive) setResult({ slug, error: true }); });
    return () => { alive = false; };
  }, [slug, retry]);
  const state = result.slug === slug ? result : { loading: true };
  if (state.kind === 'redirect') return <Navigate replace to={state.to} />;
  // #1077: the legacy page draws the market the resolver already read.
  if (state.kind === 'legacy') return <LegacyPage role={role} market={state.market} />;
  return <WorkspaceShell role={role} title={state.data?.name || 'Sector'} activeSlug="markets">
    <SectorProfileView loading={state.loading} error={state.error} data={state.data}
      highlightedMarket={new URLSearchParams(location.search).get('market') || ''} onRetry={() => setRetry((n) => n + 1)} />
  </WorkspaceShell>;
}
