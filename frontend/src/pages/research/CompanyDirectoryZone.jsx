import React, { useMemo, useState } from 'react';
import { ExternalLink, Search, Database } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Card } from '../../ui';
import data from '../../data/companyDirectory.json';

const items = data.items || [];

export default function CompanyDirectoryZone() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('all');
  const countries = useMemo(() => [...new Set(items.map((x) => x.country).filter(Boolean))].sort(), []);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((x) => (!needle || `${x.name} ${x.country || ''} ${x.website}`.toLowerCase().includes(needle))
      && (country === 'all' || x.country === country));
  }, [query, country]);

  return (
    <div data-testid="company-directory" className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Company directory</h1>
        <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-axal-muted">
          A public discovery baseline for competitor research. Open a company to review sourced identity facts, then launch an analysis with the company name prefilled.
        </p>
      </div>
      <Card className="border-violet-200 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/20">
        <div className="flex items-start gap-2 text-[12px] leading-relaxed text-violet-950 dark:text-violet-100">
          <Database size={15} className="mt-0.5 shrink-0" />
          <span><strong>Source boundary:</strong> {items.length} records from Wikidata, retrieved 30 September 2026. This baseline contains discovery metadata and official website links; it does not claim funding, revenue, valuation, market share, or diligence status.</span>
        </div>
      </Card>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-2.5 text-axal-faint" />
          <input aria-label="Search companies" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search company, country, or website" className="w-full rounded-lg border border-axal-hairline bg-axal-ground py-2 pl-9 pr-3 text-[12.5px] text-axal-ink focus:border-violet-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
        </label>
        <select aria-label="Filter by country" value={country} onChange={(e) => setCountry(e.target.value)} className="rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[12.5px] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100">
          <option value="all">All countries</option>
          {countries.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>
      <Card padding="none" className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-axal-hairline px-4 py-3 text-[11px] text-axal-muted dark:border-gray-800">
          <span>{visible.length} companies</span><span>Source: Wikidata · metadata only</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[12px]">
            <thead className="bg-axal-ground text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint dark:bg-gray-950">
              <tr><th className="px-4 py-2.5">Company</th><th className="px-4 py-2.5">Country</th><th className="px-4 py-2.5">Founded</th><th className="px-4 py-2.5">Source</th><th className="px-4 py-2.5" /></tr>
            </thead>
            <tbody className="divide-y divide-axal-hairline dark:divide-gray-800">
              {visible.map((x) => <tr key={x.uid} role="link" tabIndex={0} onClick={() => navigate(`/research/companies/company/${x.uid}`)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(`/research/companies/company/${x.uid}`); } }} className="cursor-pointer hover:bg-violet-50/40 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-violet-500 dark:hover:bg-violet-950/10">
                <td className="px-4 py-3"><Link to={`/research/companies/company/${x.uid}`} className="font-semibold text-axal-violet underline dark:text-violet-300">{x.name}</Link><div className="mt-0.5 max-w-[360px] truncate text-[11px] text-axal-faint">{x.website}</div></td>
                <td className="px-4 py-3 text-axal-muted">{x.country || 'Not recorded'}</td>
                <td className="px-4 py-3 font-mono text-axal-muted">{x.founded_year || 'Not recorded'}</td>
                <td className="px-4 py-3 text-axal-muted">Wikidata</td>
                <td className="px-4 py-3 text-right"><a href={x.website} target="_blank" rel="noreferrer" aria-label={`Open ${x.name} website`} onClick={(event) => event.stopPropagation()} className="text-axal-faint hover:text-axal-violet"><ExternalLink size={14} /></a></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        {!visible.length && <p className="px-4 py-8 text-center text-[12px] text-axal-muted">No companies match this search.</p>}
      </Card>
    </div>
  );
}
