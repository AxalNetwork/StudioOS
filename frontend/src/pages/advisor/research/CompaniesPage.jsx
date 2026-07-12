import React, { useMemo, useState } from 'react';
import {
  COMPANY_DATASETS, STARTUPS, UNICORNS, PUBLIC_COMPANIES, EXITS, EXIT_TYPES,
  FUNDING_ROUNDS, money, formatDay, formatRelativeDay,
} from '../../../data/advisor/research';
import {
  SubTabs, SearchInput, FilterChips, SlideOver, Section, Field, Badge,
  GrowthPct, BulletList, EmptyState, Chip,
} from './kit';

// Companies — filterable/searchable company databases across five datasets:
// Startups, Unicorns, Public companies, Exits, and Funding Rounds. Each row
// opens a detail panel.

export default function CompaniesPage() {
  const [dataset, setDataset] = useState('startups');
  return (
    <div className="space-y-5">
      <SubTabs tabs={COMPANY_DATASETS} value={dataset} onChange={setDataset} />
      {dataset === 'startups' && <StartupsView />}
      {dataset === 'unicorns' && <UnicornsView />}
      {dataset === 'public' && <PublicView />}
      {dataset === 'exits' && <ExitsView />}
      {dataset === 'rounds' && <RoundsView />}
    </div>
  );
}

function useSearch(rows, keys) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => keys.some((k) => String(r[k] ?? '').toLowerCase().includes(term)));
  }, [rows, keys, q]);
  return [q, setQ, filtered];
}

function StartupsView() {
  const [q, setQ, rows] = useSearch(STARTUPS, ['name', 'sector', 'hq', 'stage']);
  const [id, setId] = useState(null);
  const sel = STARTUPS.find((x) => x.id === id) || null;
  return (
    <div className="space-y-3">
      <SearchInput value={q} onChange={setQ} placeholder="Search startups, sectors, cities…" />
      {rows.length === 0 ? <EmptyState>No startups match your search.</EmptyState> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {rows.map((x) => (
            <button key={x.id} onClick={() => setId(x.id)} className="text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{x.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{x.sector} · {x.hq}</div>
                </div>
                <Badge>{x.stage}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Chip tone="violet">{money(x.valuation)} val</Chip>
                <Chip>{money(x.totalFunding)} raised</Chip>
                <Chip>{x.employees} people</Chip>
              </div>
            </button>
          ))}
        </div>
      )}
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={sel.name} subtitle={`${sel.sector} · Founded ${sel.founded}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{sel.stage}</Badge>
            <Chip tone="violet">{money(sel.valuation)} valuation</Chip>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300">{sel.description}</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="HQ">{sel.hq}</Field>
            <Field label="Employees">{sel.employees}</Field>
            <Field label="Total funding">{money(sel.totalFunding)}</Field>
            <Field label="Last round">{sel.lastRound}</Field>
          </div>
          <Section title="Founders">
            <div className="flex flex-wrap gap-1.5">{sel.founders.map((f) => <Chip key={f}>{f}</Chip>)}</div>
          </Section>
          <Section title="Investors">
            <div className="flex flex-wrap gap-1.5">{sel.investors.map((i) => <Chip key={i}>{i}</Chip>)}</div>
          </Section>
        </SlideOver>
      )}
    </div>
  );
}

function UnicornsView() {
  const [q, setQ, rows] = useSearch(UNICORNS, ['name', 'sector', 'hq']);
  const [id, setId] = useState(null);
  const sel = UNICORNS.find((x) => x.id === id) || null;
  return (
    <div className="space-y-3">
      <SearchInput value={q} onChange={setQ} placeholder="Search unicorns…" />
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400">
              <th className="text-left px-4 py-2.5 font-medium">Company</th>
              <th className="hidden sm:table-cell text-left px-4 py-2.5 font-medium">Sector</th>
              <th className="text-right px-4 py-2.5 font-medium">Valuation</th>
              <th className="hidden md:table-cell text-right px-4 py-2.5 font-medium">Raised</th>
              <th className="hidden md:table-cell text-left px-4 py-2.5 font-medium">HQ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id} onClick={() => setId(x.id)} className="border-b border-gray-100 dark:border-gray-800 last:border-0 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/50">
                <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">{x.name}</td>
                <td className="hidden sm:table-cell px-4 py-2.5 text-gray-600 dark:text-gray-300">{x.sector}</td>
                <td className="px-4 py-2.5 text-right font-medium text-violet-600 dark:text-violet-300 tabular-nums">{money(x.valuation)}</td>
                <td className="hidden md:table-cell px-4 py-2.5 text-right text-gray-600 dark:text-gray-300 tabular-nums">{money(x.totalFunding)}</td>
                <td className="hidden md:table-cell px-4 py-2.5 text-gray-500 dark:text-gray-400">{x.hq}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <EmptyState>No unicorns match your search.</EmptyState>}
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={sel.name} subtitle={`${sel.sector} · Founded ${sel.founded}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="violet">{money(sel.valuation)} valuation</Chip>
            <Badge>{sel.status}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="HQ">{sel.hq}</Field>
            <Field label="Total funding">{money(sel.totalFunding)}</Field>
          </div>
          <Section title="Investors">
            <div className="flex flex-wrap gap-1.5">{sel.investors.map((i) => <Chip key={i}>{i}</Chip>)}</div>
          </Section>
        </SlideOver>
      )}
    </div>
  );
}

function PublicView() {
  const [q, setQ, rows] = useSearch(PUBLIC_COMPANIES, ['name', 'ticker', 'sector']);
  const [id, setId] = useState(null);
  const sel = PUBLIC_COMPANIES.find((x) => x.id === id) || null;
  return (
    <div className="space-y-3">
      <SearchInput value={q} onChange={setQ} placeholder="Search by name or ticker…" />
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400">
              <th className="text-left px-4 py-2.5 font-medium">Company</th>
              <th className="text-left px-4 py-2.5 font-medium">Ticker</th>
              <th className="text-right px-4 py-2.5 font-medium">Price</th>
              <th className="text-right px-4 py-2.5 font-medium">Change</th>
              <th className="hidden sm:table-cell text-right px-4 py-2.5 font-medium">Market cap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id} onClick={() => setId(x.id)} className="border-b border-gray-100 dark:border-gray-800 last:border-0 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/50">
                <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">{x.name}</td>
                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300 font-mono text-xs">{x.ticker}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">${x.price.toFixed(2)}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${x.change >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{x.change >= 0 ? '+' : ''}{x.change}%</td>
                <td className="hidden sm:table-cell px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{money(x.marketCap)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <EmptyState>No companies match your search.</EmptyState>}
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={`${sel.name} (${sel.ticker})`} subtitle={sel.sector}>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Price">${sel.price.toFixed(2)}</Field>
            <Field label="Day change"><span className={sel.change >= 0 ? 'text-emerald-600' : 'text-rose-500'}>{sel.change >= 0 ? '+' : ''}{sel.change}%</span></Field>
            <Field label="Market cap">{money(sel.marketCap)}</Field>
            <Field label="Revenue (TTM)">{money(sel.revenue)}</Field>
            <Field label="P/E">{sel.pe ?? '—'}</Field>
            <Field label="IPO date">{formatDay(sel.ipoDate)}</Field>
          </div>
        </SlideOver>
      )}
    </div>
  );
}

function ExitsView() {
  const [type, setType] = useState('all');
  const [id, setId] = useState(null);
  const filters = [{ id: 'all', label: 'All' }, ...EXIT_TYPES.map((t) => ({ id: t, label: t }))];
  const rows = useMemo(() => EXITS.filter((e) => type === 'all' || e.type === type), [type]);
  const sel = EXITS.find((x) => x.id === id) || null;
  return (
    <div className="space-y-3">
      <FilterChips options={filters} value={type} onChange={setType} />
      {rows.length === 0 ? <EmptyState>No exits of this type.</EmptyState> : (
        <div className="space-y-2">
          {rows.map((x) => (
            <button key={x.id} onClick={() => setId(x.id)} className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{x.company}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {x.sector} · {x.type === 'M&A' && x.acquirer ? `Acquired by ${x.acquirer}` : x.type} · {formatDay(x.date)}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-semibold text-violet-600 dark:text-violet-300 tabular-nums">{money(x.value)}</div>
                  <Badge>{x.type}</Badge>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={sel.company} subtitle={`${sel.type} · ${formatDay(sel.date)}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{sel.type}</Badge>
            <Chip tone="violet">{money(sel.value)}</Chip>
            <Chip>{sel.multiple}x return</Chip>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Sector">{sel.sector}</Field>
            <Field label="Acquirer">{sel.acquirer || 'Public listing'}</Field>
          </div>
          <Section title="Investors">
            <div className="flex flex-wrap gap-1.5">{sel.investors.map((i) => <Chip key={i}>{i}</Chip>)}</div>
          </Section>
        </SlideOver>
      )}
    </div>
  );
}

function RoundsView() {
  const [q, setQ, rows] = useSearch(FUNDING_ROUNDS, ['company', 'sector', 'stage', 'leadInvestor']);
  const [id, setId] = useState(null);
  const sel = FUNDING_ROUNDS.find((x) => x.id === id) || null;
  return (
    <div className="space-y-3">
      <SearchInput value={q} onChange={setQ} placeholder="Search rounds, companies, investors…" />
      {rows.length === 0 ? <EmptyState>No rounds match your search.</EmptyState> : (
        <div className="space-y-2">
          {rows.map((x) => (
            <button key={x.id} onClick={() => setId(x.id)} className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{x.company}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{x.sector} · Led by {x.leadInvestor} · {formatRelativeDay(x.date)}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-semibold text-violet-600 dark:text-violet-300 tabular-nums">{money(x.amount)}</div>
                  <Badge>{x.stage}</Badge>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={sel.company} subtitle={`${sel.stage} · ${formatDay(sel.date)}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{sel.stage}</Badge>
            <Chip tone="violet">{money(sel.amount)} raised</Chip>
            <Chip>{money(sel.valuation)} valuation</Chip>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Sector">{sel.sector}</Field>
            <Field label="Lead investor">{sel.leadInvestor}</Field>
          </div>
          <Section title="Participating investors">
            <div className="flex flex-wrap gap-1.5">{sel.investors.map((i) => <Chip key={i}>{i}</Chip>)}</div>
          </Section>
        </SlideOver>
      )}
    </div>
  );
}
