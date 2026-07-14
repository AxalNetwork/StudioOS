import React, { useMemo, useState } from 'react';
import {
  COMPANY_DATASETS, STARTUPS, ENTERPRISE_COMPANIES, COMPETITORS, COMPETITOR_TIERS,
  CUSTOMERS, PARTNERS, UNICORNS, PUBLIC_COMPANIES, EXITS, EXIT_TYPES,
  FUNDING_ROUNDS, ROUND_STAGES, money, formatDay, formatRelativeDay,
} from '../../../data/advisor/research';
import {
  SubTabs, SearchInput, FilterChips, SlideOver, Section, Field, Badge,
  TrendValue, BulletList, EmptyState, Chip,
} from './kit';

// Companies — filterable/searchable company databases across five datasets:
// Startup Database, Enterprise Database, Competitors, Customers, and Partners.
// Each row opens a detail panel.

export default function CompaniesPage() {
  const [dataset, setDataset] = useState('startups');
  return (
    <div className="space-y-5">
      <SubTabs tabs={COMPANY_DATASETS} value={dataset} onChange={setDataset} />
      {dataset === 'startups' && <StartupsView />}
      {dataset === 'enterprise' && <EnterpriseView />}
      {dataset === 'competitors' && <CompetitorsView />}
      {dataset === 'customers' && <CustomersView />}
      {dataset === 'partners' && <PartnersView />}
      {dataset === 'unicorns' && <UnicornsView />}
      {dataset === 'public' && <PublicCompaniesView />}
      {dataset === 'exits' && <ExitsView />}
      {dataset === 'rounds' && <FundingRoundsView />}
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

function EnterpriseView() {
  const [q, setQ, rows] = useSearch(ENTERPRISE_COMPANIES, ['name', 'sector', 'hq', 'segment']);
  const [id, setId] = useState(null);
  const sel = ENTERPRISE_COMPANIES.find((x) => x.id === id) || null;
  return (
    <div className="space-y-3">
      <SearchInput value={q} onChange={setQ} placeholder="Search enterprises, sectors…" />
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400">
              <th className="text-left px-4 py-2.5 font-medium">Company</th>
              <th className="hidden sm:table-cell text-left px-4 py-2.5 font-medium">Segment</th>
              <th className="text-right px-4 py-2.5 font-medium">AUM</th>
              <th className="hidden md:table-cell text-right px-4 py-2.5 font-medium">Employees</th>
              <th className="hidden md:table-cell text-left px-4 py-2.5 font-medium">HQ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id} onClick={() => setId(x.id)} className="border-b border-gray-100 dark:border-gray-800 last:border-0 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/50">
                <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">{x.name}</td>
                <td className="hidden sm:table-cell px-4 py-2.5 text-gray-600 dark:text-gray-300">{x.segment}</td>
                <td className="px-4 py-2.5 text-right font-medium text-violet-600 dark:text-violet-300 tabular-nums">{money(x.aum)}</td>
                <td className="hidden md:table-cell px-4 py-2.5 text-right text-gray-600 dark:text-gray-300 tabular-nums">{x.employees.toLocaleString()}</td>
                <td className="hidden md:table-cell px-4 py-2.5 text-gray-500 dark:text-gray-400">{x.hq}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <EmptyState>No enterprises match your search.</EmptyState>}
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={sel.name} subtitle={`${sel.sector} · Founded ${sel.founded}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{sel.segment}</Badge>
            <Chip tone="violet">{money(sel.aum)} AUM</Chip>
            {sel.ticker && <Chip>{sel.ticker}</Chip>}
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300">{sel.note}</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="HQ">{sel.hq}</Field>
            <Field label="Employees">{sel.employees.toLocaleString()}</Field>
            <Field label="Sector">{sel.sector}</Field>
            <Field label="Ticker">{sel.ticker || 'Private'}</Field>
          </div>
        </SlideOver>
      )}
    </div>
  );
}

function CompetitorsView() {
  const [tier, setTier] = useState('all');
  const [id, setId] = useState(null);
  const filters = [{ id: 'all', label: 'All' }, ...COMPETITOR_TIERS.map((t) => ({ id: t, label: t }))];
  const rows = useMemo(() => COMPETITORS.filter((e) => tier === 'all' || e.tier === tier), [tier]);
  const sel = COMPETITORS.find((x) => x.id === id) || null;
  return (
    <div className="space-y-3">
      <FilterChips options={filters} value={tier} onChange={setTier} />
      {rows.length === 0 ? <EmptyState>No competitors in this tier.</EmptyState> : (
        <div className="space-y-2">
          {rows.map((x) => (
            <button key={x.id} onClick={() => setId(x.id)} className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{x.company}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {x.segment} · {x.region} · {x.clients.toLocaleString()} clients
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-semibold text-violet-600 dark:text-violet-300 tabular-nums">{money(x.aum)}</div>
                  <Badge>{x.tier}</Badge>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={sel.company} subtitle={`${sel.segment} · ${sel.region}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{sel.tier}</Badge>
            <Chip tone="violet">{money(sel.aum)} AUM</Chip>
            <Chip>{sel.clients.toLocaleString()} clients</Chip>
          </div>
          <Section title="Strengths"><BulletList items={sel.strengths} tone="emerald" /></Section>
          <Section title="What to watch"><p className="text-sm text-gray-700 dark:text-gray-300">{sel.watch}</p></Section>
          <div className="text-[11px] text-gray-400">Last reviewed {formatDay(sel.date)}</div>
        </SlideOver>
      )}
    </div>
  );
}

function CustomersView() {
  const [q, setQ, rows] = useSearch(CUSTOMERS, ['name', 'segment', 'hq', 'advisor', 'relationship']);
  const [id, setId] = useState(null);
  const sel = CUSTOMERS.find((x) => x.id === id) || null;
  return (
    <div className="space-y-3">
      <SearchInput value={q} onChange={setQ} placeholder="Search clients, segments, advisors…" />
      {rows.length === 0 ? <EmptyState>No clients match your search.</EmptyState> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {rows.map((x) => (
            <button key={x.id} onClick={() => setId(x.id)} className="text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{x.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{x.segment} · {x.hq}</div>
                </div>
                <Badge>{x.relationship}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Chip tone="violet">{money(x.aum)} AUM</Chip>
                <Chip>{x.since ? `Since ${x.since}` : 'Prospect'}</Chip>
              </div>
            </button>
          ))}
        </div>
      )}
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={sel.name} subtitle={`${sel.segment} · ${sel.hq}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{sel.relationship}</Badge>
            <Chip tone="violet">{money(sel.aum)} AUM</Chip>
            {sel.since && <Chip>Since {sel.since}</Chip>}
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300">{sel.note}</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Advisor">{sel.advisor}</Field>
            <Field label="HQ">{sel.hq}</Field>
          </div>
          <Section title="Products & services">
            <div className="flex flex-wrap gap-1.5">{sel.products.map((p) => <Chip key={p}>{p}</Chip>)}</div>
          </Section>
        </SlideOver>
      )}
    </div>
  );
}

function PartnersView() {
  const [q, setQ, rows] = useSearch(PARTNERS, ['name', 'type', 'focus', 'tier']);
  const [id, setId] = useState(null);
  const sel = PARTNERS.find((x) => x.id === id) || null;
  return (
    <div className="space-y-3">
      <SearchInput value={q} onChange={setQ} placeholder="Search partners, types, focus…" />
      {rows.length === 0 ? <EmptyState>No partners match your search.</EmptyState> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {rows.map((x) => (
            <button key={x.id} onClick={() => setId(x.id)} className="text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{x.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{x.type} · {x.focus}</div>
                </div>
                <Badge>{x.tier}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Chip>Since {x.since}</Chip>
                <Chip>{x.hq}</Chip>
              </div>
            </button>
          ))}
        </div>
      )}
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={sel.name} subtitle={`${sel.type} · ${sel.focus}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{sel.tier}</Badge>
            <Chip>Since {sel.since}</Chip>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300">{sel.note}</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Type">{sel.type}</Field>
            <Field label="Focus">{sel.focus}</Field>
            <Field label="HQ">{sel.hq}</Field>
            <Field label="Partner since">{sel.since}</Field>
          </div>
        </SlideOver>
      )}
    </div>
  );
}

function UnicornsView() {
  const [q, setQ, rows] = useSearch(UNICORNS, ['name', 'sector', 'hq', 'lastRound']);
  const [id, setId] = useState(null);
  const sel = UNICORNS.find((x) => x.id === id) || null;
  return (
    <div className="space-y-3">
      <SearchInput value={q} onChange={setQ} placeholder="Search unicorns, sectors, cities…" />
      {rows.length === 0 ? <EmptyState>No unicorns match your search.</EmptyState> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {rows.map((x) => (
            <button key={x.id} onClick={() => setId(x.id)} className="text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{x.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{x.sector} · {x.hq}</div>
                </div>
                <Badge>{x.lastRound}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Chip tone="violet">{money(x.valuation)} val</Chip>
                <Chip>{money(x.totalFunding)} raised</Chip>
                <Chip>{x.employees.toLocaleString()} people</Chip>
              </div>
            </button>
          ))}
        </div>
      )}
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={sel.name} subtitle={`${sel.sector} · Founded ${sel.founded}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{sel.lastRound}</Badge>
            <Chip tone="violet">{money(sel.valuation)} valuation</Chip>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300">{sel.description}</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="HQ">{sel.hq}</Field>
            <Field label="Employees">{sel.employees.toLocaleString()}</Field>
            <Field label="Total funding">{money(sel.totalFunding)}</Field>
            <Field label="Last round">{sel.lastRound}</Field>
          </div>
          <Section title="Investors">
            <div className="flex flex-wrap gap-1.5">{sel.investors.map((i) => <Chip key={i}>{i}</Chip>)}</div>
          </Section>
        </SlideOver>
      )}
    </div>
  );
}

function PublicCompaniesView() {
  const [q, setQ, rows] = useSearch(PUBLIC_COMPANIES, ['name', 'ticker', 'sector', 'hq']);
  const [id, setId] = useState(null);
  const sel = PUBLIC_COMPANIES.find((x) => x.id === id) || null;
  return (
    <div className="space-y-3">
      <SearchInput value={q} onChange={setQ} placeholder="Search public companies, tickers…" />
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400">
              <th className="text-left px-4 py-2.5 font-medium">Company</th>
              <th className="hidden sm:table-cell text-left px-4 py-2.5 font-medium">Sector</th>
              <th className="text-right px-4 py-2.5 font-medium">Market cap</th>
              <th className="hidden md:table-cell text-right px-4 py-2.5 font-medium">Revenue</th>
              <th className="text-right px-4 py-2.5 font-medium">1D</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id} onClick={() => setId(x.id)} className="border-b border-gray-100 dark:border-gray-800 last:border-0 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/50">
                <td className="px-4 py-2.5">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{x.name}</span>
                  <span className="ml-1.5 text-xs text-gray-400">{x.ticker}</span>
                </td>
                <td className="hidden sm:table-cell px-4 py-2.5 text-gray-600 dark:text-gray-300">{x.sector}</td>
                <td className="px-4 py-2.5 text-right font-medium text-violet-600 dark:text-violet-300 tabular-nums">{money(x.marketCap)}</td>
                <td className="hidden md:table-cell px-4 py-2.5 text-right text-gray-600 dark:text-gray-300 tabular-nums">{money(x.revenue)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  <TrendValue trend={x.change >= 0 ? 'up' : 'down'}>{x.change > 0 ? '+' : ''}{x.change}%</TrendValue>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <EmptyState>No public companies match your search.</EmptyState>}
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={sel.name} subtitle={`${sel.ticker} · ${sel.sector}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="violet">{money(sel.marketCap)} market cap</Chip>
            <Chip>P/E {sel.pe}</Chip>
            <TrendValue trend={sel.change >= 0 ? 'up' : 'down'}>{sel.change > 0 ? '+' : ''}{sel.change}%</TrendValue>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300">{sel.note}</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Revenue">{money(sel.revenue)}</Field>
            <Field label="HQ">{sel.hq}</Field>
            <Field label="Ticker">{sel.ticker}</Field>
            <Field label="P/E">{sel.pe}</Field>
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
  const rows = useMemo(() => EXITS.filter((e) => type === 'all' || e.type === type).slice().sort((a, b) => (a.date < b.date ? 1 : -1)), [type]);
  const sel = EXITS.find((x) => x.id === id) || null;
  return (
    <div className="space-y-3">
      <FilterChips options={filters} value={type} onChange={setType} />
      {rows.length === 0 ? <EmptyState>No exits in this category.</EmptyState> : (
        <div className="space-y-2">
          {rows.map((x) => (
            <button key={x.id} onClick={() => setId(x.id)} className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{x.company}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{x.type} · {x.counterparty} · {x.sector}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-semibold text-violet-600 dark:text-violet-300 tabular-nums">{money(x.value)}</div>
                  <div className="text-[11px] text-gray-400">{x.multiple}x</div>
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
          <p className="text-sm text-gray-700 dark:text-gray-300">{sel.note}</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Counterparty">{sel.counterparty}</Field>
            <Field label="Sector">{sel.sector}</Field>
          </div>
          <Section title="Investors">
            <div className="flex flex-wrap gap-1.5">{sel.investors.map((i) => <Chip key={i}>{i}</Chip>)}</div>
          </Section>
        </SlideOver>
      )}
    </div>
  );
}

function FundingRoundsView() {
  const [stage, setStage] = useState('all');
  const [q, setQ] = useState('');
  const [id, setId] = useState(null);
  const filters = [{ id: 'all', label: 'All' }, ...ROUND_STAGES.map((s) => ({ id: s, label: s }))];
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return FUNDING_ROUNDS
      .filter((r) => (stage === 'all' || r.stage === stage))
      .filter((r) => !term || [r.company, r.sector, r.leadInvestor].some((v) => String(v).toLowerCase().includes(term)))
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [stage, q]);
  const sel = FUNDING_ROUNDS.find((x) => x.id === id) || null;
  return (
    <div className="space-y-3">
      <SearchInput value={q} onChange={setQ} placeholder="Search rounds, companies, investors…" />
      <FilterChips options={filters} value={stage} onChange={setStage} />
      {rows.length === 0 ? <EmptyState>No funding rounds match your filters.</EmptyState> : (
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
          <Section title="Investors">
            <div className="flex flex-wrap gap-1.5">{sel.investors.map((i) => <Chip key={i}>{i}</Chip>)}</div>
          </Section>
        </SlideOver>
      )}
    </div>
  );
}
