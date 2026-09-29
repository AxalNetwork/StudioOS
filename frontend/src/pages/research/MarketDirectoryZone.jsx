import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Database, ArrowUpRight } from 'lucide-react';
import { Card } from '../../ui';
import data from '../../data/marketDirectory.json';

export default function MarketDirectoryZone() {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => { const q = query.trim().toLowerCase(); return (data.items || []).filter((x) => !q || x.name.toLowerCase().includes(q)); }, [query]);
  return <div data-testid="market-directory" className="space-y-4">
    <div><h1 className="text-xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Markets</h1><p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-axal-muted">Sector-by-sector market research. Open a sector for its company universe, public evidence, growth direction, risk notes, and signal quality.</p></div>
    <Card className="border-violet-200 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/20"><div className="flex items-start gap-2 text-[12px] leading-relaxed text-violet-950 dark:text-violet-100"><Database size={15} className="mt-0.5 shrink-0" /><span><strong>Count provenance:</strong> the company counts below are the supplied Axal sector-taxonomy counts. They are discovery counts, not TAM, valuation, revenue, or independently verified market-size figures. Individual pages add live public signals when available.</span></div></Card>
    <label className="relative block"><Search size={14} className="pointer-events-none absolute left-3 top-2.5 text-axal-faint" /><input aria-label="Search sectors" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sectors" className="w-full rounded-lg border border-axal-hairline bg-axal-ground py-2 pl-9 pr-3 text-[12.5px] text-axal-ink focus:border-violet-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" /></label>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visible.map((x) => <Link key={x.slug} to={`/research/markets/sector/${x.slug}`}><Card className="h-full transition hover:border-violet-300 hover:shadow-sm dark:hover:border-violet-700"><div className="flex items-start justify-between gap-2"><div><h2 className="text-[14px] font-extrabold text-axal-ink dark:text-gray-100">{x.name}</h2><p className="mt-1 font-mono text-[12px] text-axal-muted">{x.company_count.toLocaleString()} companies</p></div><ArrowUpRight size={15} className="text-axal-faint" /></div><p className="mt-3 text-[11px] text-axal-faint">Open sector profile →</p></Card></Link>)}</div>
  </div>;
}
