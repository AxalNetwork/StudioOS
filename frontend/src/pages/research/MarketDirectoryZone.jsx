import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Card } from '../../ui';
import { Unreadable, Unrecorded } from '../../ui/Honesty';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { api } from '../../lib/api';
import { researchMarketsApi } from '../../lib/api/researchMarkets.js';

/**
 * Research · Markets (`/research/markets`), to the Markets canvas
 * (`design/incoming/Research · Markets.dc.html`, D546). Issue #1080, D533.
 *
 * EVERY NUMBER HERE IS READ FROM THE WORKER. The page used to print the
 * bundled `marketDirectory.json` and an ETF snapshot whose 1D/1Y line was red
 * whatever its sign. It now reads `/api/research/markets`,
 * `/api/research/listed-companies`, `/api/research/geographies` and the
 * signals feed, and prints the totals those answer with.
 *
 * FOUR STATES, PER SECTION. Each card loads on its own, so one failed read
 * says "could not be read" on that card and leaves the others standing:
 * loading, unreadable (the read failed; nothing is known either way), empty
 * (the read worked and holds nothing), and the rows.
 *
 * WHAT NO SOURCE HOLDS reads "Not recorded" with the reason: government-owned
 * companies (no source names an owner; #1083 Q3 settles only the wording) and
 * the top movers, which come from the Research overview (#1092) once it lands.
 */

export const MARKET_TABS = [
  { key: 'private', label: 'Private' },
  { key: 'public', label: 'Public' },
  { key: 'government', label: 'Government' },
];

export const MARKET_SORTS = [
  { value: 'supplied_count:desc', label: 'Company count, highest first' },
  { value: 'supplied_count:asc', label: 'Company count, lowest first' },
  { value: 'name:asc', label: 'Name, A to Z' },
];

const fmt = (n) => (n == null ? null : Number(n).toLocaleString('en-US'));

/** The slug the sector page (#1139, D546) is keyed by: the tracked sector's own name, slugged. */
export const sectorSlug = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Markets → groups by tracked sector, largest group first. A market with no
 * tracked sector is in its own group at the end, marked as such: no index
 * applies to it, and it is not folded into a sector it does not belong to.
 */
export function groupMarkets(items) {
  const groups = new Map();
  const unmapped = [];
  for (const m of items) {
    if (!m.mi_sector) { unmapped.push(m); continue; }
    if (!groups.has(m.mi_sector)) groups.set(m.mi_sector, []);
    groups.get(m.mi_sector).push(m);
  }
  const sum = (ms) => ms.reduce((s, m) => s + (Number(m.supplied_count) || 0), 0);
  const out = [...groups.entries()]
    .map(([name, markets]) => ({ name, slug: sectorSlug(name), markets, companies: sum(markets), mapped: true }))
    .sort((a, b) => b.companies - a.companies || a.name.localeCompare(b.name));
  if (unmapped.length) out.push({ name: 'Not mapped to a tracked sector', slug: null, markets: unmapped, companies: sum(unmapped), mapped: false });
  return out;
}

/**
 * One section's read: `{ status: 'loading' | 'unreadable' | 'not_found' | 'ready', data }`.
 * `key` re-runs it when what it reads changes; `fn` is read through a ref so
 * an inline arrow does not re-fire it on every render.
 */
export function useRead(fn, key = '') {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [state, setState] = useState({ status: 'loading', data: null });
  const load = useCallback(() => {
    let live = true;
    setState((s) => ({ status: 'loading', data: s.data }));
    fnRef.current().then((data) => { if (live) setState({ status: 'ready', data }); })
      // A 404 is an answer (there is no such thing), not a failed read.
      .catch((e) => { if (live) setState({ status: e?.status === 404 ? 'not_found' : 'unreadable', data: null }); });
    return () => { live = false; };
  }, [key]);
  useEffect(() => load(), [load]);
  return [state, load];
}

function Loading({ what }) {
  return <p className="text-[12px] text-axal-muted" role="status">Loading {what}…</p>;
}

function Caption({ children }) {
  return <p className="mt-3 text-[11px] leading-relaxed text-axal-faint">{children}</p>;
}

function Bar({ value, max }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return <span className="block h-1.5 rounded-full bg-violet-100 dark:bg-violet-950"><span className="block h-1.5 rounded-full bg-violet-500" style={{ width: `${w}%` }} /></span>;
}

export function PrivatePanel({ markets }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(MARKET_SORTS[0].value);
  const [grouped, setGrouped] = useState(true);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const [key, dir] = sort.split(':');
    const sign = dir === 'asc' ? 1 : -1;
    return (markets.data?.items || [])
      .filter((m) => !q || m.name.toLowerCase().includes(q))
      .sort((a, b) => sign * (key === 'name' ? a.name.localeCompare(b.name) : (a[key] - b[key])) || a.name.localeCompare(b.name));
  }, [markets.data, query, sort]);
  const max = Math.max(0, ...visible.map((m) => Number(m.supplied_count) || 0));
  const total = markets.data?.total;
  const held = (markets.data?.items || []).reduce((s, m) => s + (Number(m.supplied_count) || 0), 0);
  const asOf = markets.data?.items?.[0]?.as_of;

  if (markets.status === 'loading' && !markets.data) return <Loading what="the markets" />;
  if (markets.status === 'unreadable') {
    return <Unreadable what="The markets" claim="This is not a sign there are none." onRetry={markets.reload} />;
  }
  if (!total) return <p data-testid="markets-empty" className="text-[12.5px] text-axal-muted">No markets are in the directory yet.</p>;

  const row = (m) => (
    <li key={m.slug} className="grid grid-cols-[1fr_120px_72px] items-center gap-3 py-1.5">
      <Link to={`/research/markets/sector/${encodeURIComponent(m.slug)}`} className="truncate text-[13px] font-semibold text-axal-ink hover:text-axal-violet dark:text-gray-100">{m.name}</Link>
      <Bar value={Number(m.supplied_count) || 0} max={max} />
      <span className="text-right font-mono text-[12px] text-axal-muted">{fmt(m.supplied_count)}</span>
    </li>
  );

  return (
    <div data-testid="markets-private">
      <div className="grid gap-3 sm:grid-cols-[1fr_260px_auto] sm:items-end">
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-semibold text-axal-ink dark:text-gray-200">Search markets</span>
          <span className="relative block">
            <Search size={14} className="pointer-events-none absolute left-3 top-3 text-axal-faint" />
            <input aria-label="Search markets" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="FinTech, robotics, health…"
              className="min-h-[40px] w-full rounded-lg border border-axal-hairline bg-white py-2 pl-9 pr-3 text-[13px] text-axal-ink focus:border-violet-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
          </span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-semibold text-axal-ink dark:text-gray-200">Sort markets by</span>
          <select aria-label="Sort markets by" value={sort} onChange={(e) => setSort(e.target.value)}
            className="min-h-[40px] w-full rounded-lg border border-axal-hairline bg-white px-3 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100">
            {MARKET_SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-axal-hairline px-3 text-[12.5px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} className="accent-violet-600" /> Group by tracked sector
        </label>
      </div>
      <p className="mt-4 text-[13px] font-semibold text-axal-ink dark:text-gray-100">
        {fmt(total)} markets holding {fmt(held)} companies, as the taxonomy source counts them
      </p>
      <p className="text-[11px] text-axal-faint">
        research_market_directory · Axal sector taxonomy{asOf ? ` · as of ${asOf}` : ''} · counts are not market size and are not independently verified
      </p>
      {visible.length === 0 ? (
        <p className="mt-4 text-[12.5px] text-axal-muted">No market matches “{query.trim()}”.</p>
      ) : grouped ? (
        <div className="mt-4 space-y-2">
          {groupMarkets(visible).map((g, i) => (
            <details key={g.name} open={i < 2} className="rounded-xl border border-axal-hairline px-4 py-2 dark:border-gray-800">
              <summary className="flex cursor-pointer items-center justify-between gap-3 py-1">
                <span>
                  <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{g.name}</span>
                  <span className="ml-2 text-[12px] text-axal-muted">
                    {g.markets.length} markets · {g.mapped ? `${fmt(g.companies)} companies` : 'no index applies'}
                  </span>
                </span>
                {g.mapped ? <Link to={`/research/markets/sector/${g.slug}`} className="text-[12.5px] font-semibold text-axal-violet">Open sector →</Link> : null}
              </summary>
              <ul className="mt-1">{g.markets.map(row)}</ul>
            </details>
          ))}
        </div>
      ) : (
        <ul className="mt-4">{visible.map(row)}</ul>
      )}
    </div>
  );
}

export function PublicPanel({ listed }) {
  if (listed.status === 'loading' && !listed.data) return <Loading what="the listed companies" />;
  if (listed.status === 'unreadable') {
    return <Unreadable what="The listed companies" claim="This is not a sign there are none." onRetry={listed.reload} />;
  }
  const items = listed.data?.items || [];
  if (!listed.data?.total) return <p data-testid="listed-empty" className="text-[12.5px] text-axal-muted">No listed companies are recorded yet.</p>;
  return (
    <div data-testid="markets-public">
      <h3 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Listed companies</h3>
      <p className="mt-1 text-[12.5px] text-axal-muted">
        Only these {fmt(listed.data.total)} are known to be listed. The company directory does not record listing status.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-axal-hairline text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-faint dark:border-gray-800">
              <th className="py-2 pr-3">Symbol</th><th className="py-2 pr-3">Company</th><th className="py-2 pr-3">Exchange</th>
              <th className="py-2 pr-3">Country</th><th className="py-2 pr-3">Market cap</th><th className="py-2">Employees</th>
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.symbol} className="border-b border-axal-hairline/60 dark:border-gray-800">
                <td className="py-2 pr-3 font-mono font-semibold">{x.symbol}</td>
                <td className="py-2 pr-3 text-axal-ink dark:text-gray-100">{x.name}</td>
                <td className="py-2 pr-3">{x.exchange || <Unrecorded />}</td>
                <td className="py-2 pr-3">{x.country || <Unrecorded />}</td>
                <td className="py-2 pr-3">{x.market_cap_band || <Unrecorded />}</td>
                <td className="py-2">{x.employee_band || <Unrecorded />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Caption>signal_companies · {fmt(listed.data.total)} listed companies · bands as the source sets them{listed.data.as_of ? ` · as of ${listed.data.as_of.slice(0, 10)}` : ''}</Caption>
    </div>
  );
}

export function GovernmentPanel() {
  return (
    <div data-testid="markets-government" className="rounded-xl border border-dashed border-axal-hairline p-4 dark:border-gray-700">
      <Unrecorded />
      <h3 className="mt-2 text-[15px] font-bold text-axal-ink dark:text-gray-100">Government-owned companies</h3>
      <p className="mt-1 text-[12.5px] text-axal-muted">
        No source lists government-owned companies yet, so StudioOS cannot count or name them. The directory and the listed companies do not record who owns a company.
      </p>
    </div>
  );
}

export function WhereBased({ geos }) {
  const SHOWN = 12;
  let body;
  if (geos.status === 'loading' && !geos.data) body = <Loading what="the countries" />;
  else if (geos.status === 'unreadable') body = <Unreadable what="The countries" claim="This is not a sign the companies have no location." onRetry={geos.reload} />;
  else if (!geos.data?.total) body = <p className="text-[12.5px] text-axal-muted">No directory company has a country that maps yet.</p>;
  else {
    const items = geos.data.items.slice(0, SHOWN);
    const placed = geos.data.items.reduce((s, k) => s + k.company_count, 0);
    const max = Math.max(...items.map((k) => k.company_count));
    body = (
      <>
        <p className="text-[12.5px] text-axal-muted">
          {fmt(placed + (geos.data.companies_unmapped || 0))} companies in {fmt(geos.data.total)} countries
          {geos.data.companies_unmapped ? `, and ${fmt(geos.data.companies_unmapped)} whose country does not map` : ''}.
          The taxonomy’s companies carry no location, so this reads the company directory.
        </p>
        <ul className="mt-3">
          {items.map((k) => (
            <li key={k.code} className="grid grid-cols-[140px_1fr_48px] items-center gap-3 py-1">
              <Link to={`/research/geographies/${k.code}`} className="truncate text-[12.5px] font-semibold text-axal-ink hover:text-axal-violet dark:text-gray-100">{k.name}</Link>
              <Bar value={k.company_count} max={max} />
              <span className="text-right font-mono text-[12px] text-axal-muted">{fmt(k.company_count)}</span>
            </li>
          ))}
        </ul>
        {geos.data.total > SHOWN ? <Link to="/research/geographies" className="mt-2 inline-block text-[12.5px] font-semibold text-axal-violet">{fmt(geos.data.total - SHOWN)} more countries →</Link> : null}
        <Caption>research_company_directory</Caption>
      </>
    );
  }
  return <Card data-testid="markets-where"><h2 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Where the directory’s companies are based</h2><div className="mt-2">{body}</div></Card>;
}

export function TopMovers() {
  return (
    <Card data-testid="markets-movers">
      <h2 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Top movers this month</h2>
      <p className="mt-2"><Unrecorded reason="The month-on-month movers come from the Research overview (#1092), which has not landed." /></p>
      <p className="mt-1 text-[12px] text-axal-muted">The largest changes across the tracked sectors arrive with the Research overview. Until then nothing is ranked here.</p>
    </Card>
  );
}

export function LatestSignals({ sigs }) {
  let body;
  if (sigs.status === 'loading' && !sigs.data) body = <Loading what="the signals" />;
  else if (sigs.status === 'unreadable') body = <Unreadable what="The signals" claim="This is not a sign there are none." onRetry={sigs.reload} />;
  else if (!(sigs.data?.signals || []).length) body = <p className="text-[12.5px] text-axal-muted">No signals are recorded yet.</p>;
  else {
    const list = sigs.data.signals.slice(0, 3);
    body = (
      <>
        {sigs.data.data_state === 'illustrative' ? (
          <p className="mb-2 text-[11.5px] font-semibold text-amber-800 dark:text-amber-300">Illustrative: no live signal is stored, so these are the seed examples.</p>
        ) : null}
        <ul className="space-y-2">
          {list.map((s) => (
            <li key={s.id} className="rounded-lg border border-axal-hairline p-3 dark:border-gray-800">
              <p className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{s.title}</p>
              <p className="mt-0.5 text-[11.5px] text-axal-muted">
                {[s.sector, s.region].filter(Boolean).join(' · ')}
                {s.confidence_score != null ? ` · confidence ${Math.round(Number(s.confidence_score) * 100)}%` : ''}
                {s.updated_at ? ` · updated ${String(s.updated_at).slice(0, 10)}` : ''}
              </p>
            </li>
          ))}
        </ul>
      </>
    );
  }
  const total = sigs.data?.total;
  const shown = Math.min(3, (sigs.data?.signals || []).length);
  return (
    <Card data-testid="markets-signals">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Latest signals</h2>
        {total && shown ? <span className="text-[12px] text-axal-muted">{fmt(shown)} of {fmt(total)}</span> : null}
      </div>
      <div className="mt-2">{body}</div>
    </Card>
  );
}

export function Readings({ readings }) {
  let body;
  if (readings.status === 'loading' && !readings.data) body = <Loading what="your readings" />;
  else if (readings.status === 'unreadable') body = <Unreadable what="Your market readings" claim="This is not a sign you have none." onRetry={readings.reload} />;
  else {
    const run = (readings.data?.items || []).filter((r) => r.uid);
    body = run.length === 0
      ? <p className="text-[12.5px] text-axal-muted">You have not run a market reading yet. A reading records the comparable range for one of your service lines, with its date.</p>
      : (
        <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
          {run.map((r) => (
            <li key={r.uid} className="flex items-center justify-between gap-3 py-2">
              <Link to={`/research/markets/${encodeURIComponent(r.uid)}`} className="text-[13px] font-semibold text-axal-ink hover:text-axal-violet dark:text-gray-100">{r.metric}</Link>
              <span className="text-[11.5px] text-axal-muted">{r.ran_at ? `run ${String(r.ran_at).slice(0, 10)}` : <Unrecorded />}</span>
            </li>
          ))}
        </ul>
      );
  }
  return <Card data-testid="markets-readings"><h2 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Your market readings</h2><div className="mt-2">{body}</div></Card>;
}

export default function MarketDirectoryZone({ role = 'founder', zoneActions = null }) {
  const [tab, setTab] = useState('private');
  const [markets, reloadMarkets] = useRead(() => researchMarketsApi.list({ limit: 100 }));
  const [listed, reloadListed] = useRead(() => researchMarketsApi.listedCompanies({ limit: 100 }));
  const [geos, reloadGeos] = useRead(() => researchMarketsApi.geographies({ sort: 'company_count', limit: 100 }));
  const [sigs, reloadSigs] = useRead(() => api.signals.list({ limit: 3, mode: role === 'advisor' ? 'advisor' : 'founder' }), role);
  const [readings, reloadReadings] = useRead(() => api.research.marketReadings());

  const tabCount = {
    private: markets.status === 'ready' ? `${fmt(markets.data?.total ?? 0)} markets` : null,
    public: listed.status === 'ready' ? `${fmt(listed.data?.total ?? 0)} listed` : null,
    government: 'Not recorded',
  };

  return (
    <div data-testid="market-directory" className="space-y-4">
      {zoneActions ? <ZoneToolbar role={role} className="mb-3" actions={zoneActions(markets.data?.items || [])} /> : null}
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Markets</h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-axal-muted">
          The markets of the Axal sector taxonomy, the listed companies StudioOS knows, and six indexes for each tracked sector.
        </p>
      </div>
      <Card>
        <div role="tablist" aria-label="Market type" className="flex flex-wrap gap-1">
          {MARKET_TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg px-3 text-[13px] font-semibold ${tab === t.key ? 'bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-800' : 'text-axal-ink dark:text-gray-200'}`}>
              {t.label} {tabCount[t.key] ? <span className="text-[11.5px] font-medium text-axal-muted">{tabCount[t.key]}</span> : null}
            </button>
          ))}
        </div>
        <div className="mt-4">
          {tab === 'private' ? <PrivatePanel markets={{ ...markets, reload: reloadMarkets }} /> : null}
          {tab === 'public' ? <PublicPanel listed={{ ...listed, reload: reloadListed }} /> : null}
          {tab === 'government' ? <GovernmentPanel /> : null}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <WhereBased geos={{ ...geos, reload: reloadGeos }} />
        <TopMovers />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <LatestSignals sigs={{ ...sigs, reload: reloadSigs }} />
        <Readings readings={{ ...readings, reload: reloadReadings }} />
      </div>
      <p className="text-[11px] leading-relaxed text-axal-faint">
        Markets come from the Axal sector taxonomy; their company counts are the taxonomy source’s own and are not market size. Indexes are worldwide only. What no source holds reads “Not recorded”.
      </p>
    </div>
  );
}
