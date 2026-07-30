import React, { useMemo, useState } from 'react';
import { Building2, Layers, Activity, Globe, MapPin } from 'lucide-react';
import {
  MARKET_TABS, INDUSTRIES, SECTORS, TRENDS, TREND_STAGES, MACRO, GEOGRAPHIES,
  money, formatDay,
} from '../../../data/advisor/research';
import {
  SubTabs, SlideOver, Section, Badge, TrendValue, GrowthPct,
  BulletList, RowCard, EmptyState, Chip,
} from './kit';

// Market — the market-intelligence surface. Sub-tabs: Industries, Sectors,
// Trends, Macro, Geography. Most rows open a detail panel.

export default function MarketPage() {
  const [tab, setTab] = useState('industries');
  const tabs = MARKET_TABS.map((t) => ({ id: t.id, label: t.label }));
  return (
    <div className="space-y-5">
      <SubTabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'industries' && <IndustriesView />}
      {tab === 'sectors' && <SectorsView />}
      {tab === 'trends' && <TrendsView />}
      {tab === 'macro' && <MacroView />}
      {tab === 'geography' && <GeographyView />}
    </div>
  );
}

function IndustriesView() {
  const [id, setId] = useState(null);
  const sel = INDUSTRIES.find((x) => x.id === id) || null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {INDUSTRIES.map((x) => (
          <RowCard key={x.id} onClick={() => setId(x.id)}>
            <div className="flex items-start justify-between gap-3">
              <div className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                <Building2 size={14} className="text-gray-400" /> {x.name}
              </div>
              <Badge>{x.momentum}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Chip tone="violet">{money(x.marketSize)} market</Chip>
              <Chip>Growth <GrowthPct value={x.growth} /></Chip>
              <Chip>{x.companies.toLocaleString()} cos</Chip>
            </div>
          </RowCard>
        ))}
      </div>
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={sel.name} subtitle={`${money(sel.marketSize)} market · ${sel.companies.toLocaleString()} companies`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{sel.momentum}</Badge>
            <Chip>Growth <GrowthPct value={sel.growth} /></Chip>
            <Chip>{sel.multiple}x avg multiple</Chip>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300">{sel.description}</p>
          <Section title="Key trends"><BulletList items={sel.keyTrends} tone="violet" /></Section>
          <Section title="Top players">
            <div className="flex flex-wrap gap-1.5">{sel.topPlayers.map((p) => <Chip key={p}>{p}</Chip>)}</div>
          </Section>
          <Section title="Outlook"><p className="text-sm text-gray-700 dark:text-gray-300">{sel.outlook}</p></Section>
        </SlideOver>
      )}
    </div>
  );
}

function SectorsView() {
  const [id, setId] = useState(null);
  const sel = SECTORS.find((x) => x.id === id) || null;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
        {SECTORS.map((x) => (
          <button key={x.id} onClick={() => setId(x.id)} className="w-full text-left flex items-center gap-3 p-3.5 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors">
            <Layers size={16} className="text-gray-400 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{x.name}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{x.industry}</div>
            </div>
            <span className="hidden sm:block text-sm text-gray-600 dark:text-gray-300 tabular-nums">{money(x.marketSize)}</span>
            <span className="hidden md:block w-16 text-right text-sm"><GrowthPct value={x.growth} /></span>
            <Badge>{x.momentum}</Badge>
          </button>
        ))}
      </div>
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={sel.name} subtitle={sel.industry}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{sel.momentum}</Badge>
            <Chip tone="violet">{money(sel.marketSize)}</Chip>
            <Chip>Growth <GrowthPct value={sel.growth} /></Chip>
            <Chip>{sel.multiple}x multiple</Chip>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300">{sel.summary}</p>
          <Section title="Notable deals"><BulletList items={sel.notableDeals} tone="emerald" /></Section>
        </SlideOver>
      )}
    </div>
  );
}

function TrendsView() {
  const [stage, setStage] = useState('all');
  const [id, setId] = useState(null);
  const filters = [{ id: 'all', label: 'All' }, ...TREND_STAGES];
  const visible = useMemo(() => TRENDS.filter((t) => stage === 'all' || t.stage === stage), [stage]);
  const sel = TRENDS.find((x) => x.id === id) || null;
  return (
    <div className="space-y-3">
      <SubTabs tabs={filters} value={stage} onChange={setStage} />
      {visible.length === 0 ? <EmptyState>No trends in this stage.</EmptyState> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {visible.map((x) => (
            <RowCard key={x.id} onClick={() => setId(x.id)}>
              <div className="flex items-start justify-between gap-3">
                <div className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                  <Activity size={14} className="text-gray-400" /> {x.title}
                </div>
                <Badge>{TREND_STAGES.find((s) => s.id === x.stage)?.label}</Badge>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{x.category}</div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Chip>Impact <Badge>{x.impact}</Badge></Chip>
                <Chip>{x.timeHorizon}</Chip>
              </div>
            </RowCard>
          ))}
        </div>
      )}
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={sel.title} subtitle={sel.category}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{TREND_STAGES.find((s) => s.id === sel.stage)?.label}</Badge>
            <Chip>Impact <Badge>{sel.impact}</Badge></Chip>
            <Chip>{sel.timeHorizon}</Chip>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300">{sel.description}</p>
          <Section title="Signals"><BulletList items={sel.signals} tone="blue" /></Section>
          <Section title="Related sectors">
            <div className="flex flex-wrap gap-1.5">{sel.relatedSectors.map((s) => <Chip key={s}>{s}</Chip>)}</div>
          </Section>
        </SlideOver>
      )}
    </div>
  );
}

function MacroView() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {MACRO.indicators.map((ind) => (
          <div key={ind.label} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
            <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{ind.label}</div>
            <div className="mt-0.5"><TrendValue trend={ind.trend} className="text-xl font-bold">{ind.value}</TrendValue></div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{ind.note}</div>
          </div>
        ))}
      </div>
      <Section title="Commentary">
        <p className="text-sm text-gray-700 dark:text-gray-300">{MACRO.commentary}</p>
      </Section>
      <Section title="Regional funding">
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400">
                <th className="text-left px-4 py-2.5 font-medium">Region</th>
                <th className="text-right px-4 py-2.5 font-medium">VC funding</th>
                <th className="text-right px-4 py-2.5 font-medium">Growth</th>
                <th className="text-center px-4 py-2.5 font-medium">IPO window</th>
                <th className="hidden md:table-cell text-left px-4 py-2.5 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {MACRO.regions.map((r) => (
                <tr key={r.region} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">{r.region}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300 tabular-nums">{money(r.vcFunding)}</td>
                  <td className="px-4 py-2.5 text-right"><GrowthPct value={r.growth} /></td>
                  <td className="px-4 py-2.5 text-center"><Badge>{r.ipoWindow}</Badge></td>
                  <td className="hidden md:table-cell px-4 py-2.5 text-gray-500 dark:text-gray-400">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <div className="text-[11px] text-gray-400">As of {formatDay(MACRO.asOf)}</div>
    </div>
  );
}

function GeographyView() {
  const [id, setId] = useState(null);
  const sel = GEOGRAPHIES.find((x) => x.id === id) || null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {GEOGRAPHIES.map((x) => (
          <RowCard key={x.id} onClick={() => setId(x.id)}>
            <div className="flex items-start justify-between gap-3">
              <div className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                <Globe size={14} className="text-gray-400" /> {x.region}
              </div>
              <Chip>Growth <GrowthPct value={x.growth} /></Chip>
            </div>
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
              <MapPin size={11} /> {x.hubs.slice(0, 3).join(' · ')}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Chip tone="violet">{money(x.totalFunding)}</Chip>
              <Chip>{x.dealVolume.toLocaleString()} deals</Chip>
            </div>
          </RowCard>
        ))}
      </div>
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={sel.region} subtitle={`${money(sel.totalFunding)} · ${sel.dealVolume.toLocaleString()} deals`}>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="violet">{money(sel.totalFunding)}</Chip>
            <Chip>Growth <GrowthPct value={sel.growth} /></Chip>
          </div>
          <Section title="Hubs">
            <div className="flex flex-wrap gap-1.5">{sel.hubs.map((h) => <Chip key={h}>{h}</Chip>)}</div>
          </Section>
          <Section title="Top sectors"><BulletList items={sel.topSectors} tone="violet" /></Section>
          <Section title="Notable companies">
            <div className="flex flex-wrap gap-1.5">{sel.notableCompanies.map((c) => <Chip key={c}>{c}</Chip>)}</div>
          </Section>
        </SlideOver>
      )}
    </div>
  );
}
