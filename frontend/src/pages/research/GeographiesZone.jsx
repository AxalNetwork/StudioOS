import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Card } from '../../ui';
import { Unreadable } from '../../ui/Honesty';
import { researchMarketsApi } from '../../lib/api/researchMarkets.js';
import { useRead } from './MarketDirectoryZone';

/**
 * Research · Geographies (`/research/geographies`), to the Geography canvas
 * (`design/incoming/Research · Geography.dc.html`, D546). Issue #1080, D533.
 *
 * The countries the directories place a company or a fund in, with both
 * counts, from `GET /api/research/geographies`. A country is placed by the
 * crosswalk (`services/researchTaxonomy.ts`), by rule or by hand, never
 * guessed; what it cannot place is counted and said, not dropped.
 */

export const GEO_SORTS = [
  { value: 'company_count', label: 'Companies, most first' },
  { value: 'fund_count', label: 'Funds, most first' },
  { value: 'name', label: 'Name, A to Z' },
];

const fmt = (n) => Number(n).toLocaleString('en-US');

/** The country table for each state of its read. */
export function GeographiesList({ geos, query = '', reload }) {
  const q = query.trim().toLowerCase();
  const visible = (geos.data?.items || []).filter((k) => !q || k.name.toLowerCase().includes(q) || k.code.toLowerCase() === q);
  if (geos.status === 'loading' && !geos.data) return <p className="text-[12px] text-axal-muted" role="status">Loading the countries…</p>;
  if (geos.status === 'unreadable') return <Unreadable what="The countries" claim="This is not a sign the directories hold none." onRetry={reload} />;
  if (!geos.data?.total) return <p data-testid="geographies-empty" className="text-[12.5px] text-axal-muted">No directory company or fund has a country that maps yet.</p>;
  return (
      <>
        <p className="text-[12.5px] text-axal-muted">
          {fmt(geos.data.total)} countries hold a directory company or fund.
          {' '}{fmt(geos.data.companies_unmapped)} companies and {fmt(geos.data.funds_unmapped)} funds name no country the crosswalk can place, so they are counted here and in no country.
        </p>
        {visible.length === 0 ? (
          <p className="mt-3 text-[12.5px] text-axal-muted">No country matches “{query.trim()}”.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-axal-hairline text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-faint dark:border-gray-800">
                  <th className="py-2 pr-3">Country</th><th className="py-2 pr-3">Region</th>
                  <th className="py-2 pr-3 text-right">Directory companies</th><th className="py-2 text-right">Funds headquartered</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((k) => (
                  <tr key={k.code} className="border-b border-axal-hairline/60 dark:border-gray-800">
                    <td className="py-2 pr-3"><Link to={`/research/geographies/${k.code}`} className="font-semibold text-axal-ink hover:text-axal-violet dark:text-gray-100">{k.name}</Link></td>
                    <td className="py-2 pr-3 text-axal-muted">{k.region}</td>
                    <td className="py-2 pr-3 text-right font-mono">{fmt(k.company_count)}</td>
                    <td className="py-2 text-right font-mono">{fmt(k.fund_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-axal-faint">research_company_directory · research_fund_directory · HQ as the fund lists wrote it</p>
      </>
    );
}

export default function GeographiesZone() {
  const [sort, setSort] = useState('company_count');
  const [query, setQuery] = useState('');
  const [geos, reload] = useRead(() => researchMarketsApi.geographies({ sort, limit: 100 }), sort);

  return (
    <div data-testid="geographies" className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Geographies</h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-axal-muted">
          Where the directory’s companies are based and where its funds are headquartered. Market intelligence is worldwide only, so no country carries a demand reading.
        </p>
      </div>
      <Card>
        <div className="grid gap-3 sm:grid-cols-[1fr_240px] sm:items-end">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-semibold text-axal-ink dark:text-gray-200">Search countries</span>
            <span className="relative block">
              <Search size={14} className="pointer-events-none absolute left-3 top-3 text-axal-faint" />
              <input aria-label="Search countries" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Germany, BR…"
                className="min-h-[40px] w-full rounded-lg border border-axal-hairline bg-white py-2 pl-9 pr-3 text-[13px] text-axal-ink focus:border-violet-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
            </span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-semibold text-axal-ink dark:text-gray-200">Sort countries by</span>
            <select aria-label="Sort countries by" value={sort} onChange={(e) => setSort(e.target.value)}
              className="min-h-[40px] w-full rounded-lg border border-axal-hairline bg-white px-3 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100">
              {GEO_SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-4"><GeographiesList geos={geos} query={query} reload={reload} /></div>
      </Card>
    </div>
  );
}
