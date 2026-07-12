import React, { useState } from 'react';
import { Search, Send, GitCompare, Map, FileBarChart } from 'lucide-react';
import {
  AI_TABS, AI_SEARCH_SAMPLE, AI_ANALYST_SAMPLES, COMPARABLES_SAMPLE,
  MARKET_MAPS, COMPANY_REPORTS, money, formatDay,
} from '../../../data/advisor/research';
import {
  SubTabs, SlideOver, Section, Field, Badge, BulletList, AiSampleBanner,
  SampleTag, Chip,
} from './kit';

// AI Research — clearly-labelled sample AI surfaces. Nothing here is generated
// from live data; every surface carries a "sample output" marker so it can't be
// mistaken for a real model response. Sub-tabs: AI Search, AI Analyst,
// Comparable Companies, Market Maps, Company Reports.

export default function AIResearchPage() {
  const [tab, setTab] = useState('search');
  return (
    <div className="space-y-4">
      <SubTabs tabs={AI_TABS} value={tab} onChange={setTab} />
      {tab === 'search' && <AiSearchView />}
      {tab === 'analyst' && <AiAnalystView />}
      {tab === 'comparables' && <ComparablesView />}
      {tab === 'maps' && <MarketMapsView />}
      {tab === 'reports' && <ReportsView />}
    </div>
  );
}

function FakeInput({ value, icon: Icon = Search, cta = 'Ask', ctaIcon: CtaIcon = Send }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2">
      <Icon size={16} className="text-gray-400 flex-shrink-0" />
      <div className="flex-1 text-sm text-gray-700 dark:text-gray-300 truncate">{value}</div>
      <button disabled className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600/60 text-white cursor-not-allowed" title="Sample only">
        <CtaIcon size={13} /> {cta}
      </button>
    </div>
  );
}

function AiSearchView() {
  const s = AI_SEARCH_SAMPLE;
  return (
    <div className="space-y-4">
      <AiSampleBanner />
      <FakeInput value={s.query} />
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3">
        <div className="flex items-center gap-2"><SampleTag /><span className="text-xs text-gray-500">Answer</span></div>
        <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">{s.answer}</p>
        <Section title="Sources">
          <div className="space-y-1.5">
            {s.sources.map((src) => (
              <div key={src.title} className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-500" /> {src.title}
              </div>
            ))}
          </div>
        </Section>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {s.related.map((r) => <Chip key={r} tone="violet">{r}</Chip>)}
        </div>
      </div>
    </div>
  );
}

function AiAnalystView() {
  return (
    <div className="space-y-4">
      <AiSampleBanner>Sample AI analyst responses — illustrative only, not live analysis.</AiSampleBanner>
      <FakeInput value="Ask the AI analyst about a sector, company, or thesis…" cta="Send" />
      <div className="space-y-3">
        {AI_ANALYST_SAMPLES.map((a) => (
          <div key={a.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-800 text-sm font-medium text-gray-700 dark:text-gray-200">{a.prompt}</div>
            <div className="p-4 space-y-2">
              <SampleTag />
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{a.output}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ComparablesView() {
  const c = COMPARABLES_SAMPLE;
  return (
    <div className="space-y-4">
      <AiSampleBanner>Sample comparable-company set — illustrative only.</AiSampleBanner>
      <FakeInput value={`Comparable companies for: ${c.base}`} icon={GitCompare} cta="Find" ctaIcon={GitCompare} />
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400">
              <th className="text-left px-4 py-2.5 font-medium">Company</th>
              <th className="text-left px-4 py-2.5 font-medium">Stage</th>
              <th className="text-right px-4 py-2.5 font-medium">Valuation</th>
              <th className="hidden sm:table-cell text-right px-4 py-2.5 font-medium">Growth</th>
              <th className="hidden sm:table-cell text-right px-4 py-2.5 font-medium">Rev multiple</th>
            </tr>
          </thead>
          <tbody>
            {c.peers.map((p) => {
              const base = p.name === c.base;
              return (
                <tr key={p.name} className={`border-b border-gray-100 dark:border-gray-800 last:border-0 ${base ? 'bg-violet-50/60 dark:bg-violet-950/30' : ''}`}>
                  <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">
                    {p.name} {base && <Badge tone="violet">Base</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{p.stage}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{money(p.valuation)}</td>
                  <td className="hidden sm:table-cell px-4 py-2.5 text-right tabular-nums text-emerald-600">+{p.growth}%</td>
                  <td className="hidden sm:table-cell px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{p.revenueMultiple}x</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MarketMapsView() {
  return (
    <div className="space-y-4">
      <AiSampleBanner>Sample market maps — illustrative categorization only.</AiSampleBanner>
      <div className="space-y-4">
        {MARKET_MAPS.map((m) => (
          <div key={m.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Map size={16} className="text-violet-500" />
              <span className="font-semibold text-gray-900 dark:text-gray-100">{m.category}</span>
              <SampleTag />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {m.segments.map((seg) => (
                <div key={seg.name} className="rounded-lg border border-gray-100 dark:border-gray-800 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{seg.name}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {seg.companies.map((co) => <Chip key={co}>{co}</Chip>)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportsView() {
  const [id, setId] = useState(null);
  const sel = COMPANY_REPORTS.find((r) => r.id === id) || null;
  return (
    <div className="space-y-4">
      <AiSampleBanner>Sample AI-generated company reports — illustrative only.</AiSampleBanner>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {COMPANY_REPORTS.map((r) => (
          <button key={r.id} onClick={() => setId(r.id)} className="text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                  <FileBarChart size={14} className="text-gray-400" /> {r.company}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{r.sector} · Generated {formatDay(r.generated)}</div>
              </div>
              <SampleTag />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Chip tone="violet">Score {r.score}</Chip>
              <Chip>{r.recommendation}</Chip>
            </div>
          </button>
        ))}
      </div>
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={sel.company} subtitle={`AI company report · ${sel.sector}`}>
          <AiSampleBanner>Sample report — illustrative only, not generated from live data.</AiSampleBanner>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="violet">Score {sel.score}/100</Chip>
            <Badge>{sel.recommendation}</Badge>
            <Chip>Generated {formatDay(sel.generated)}</Chip>
          </div>
          <Section title="Summary"><p className="text-sm text-gray-700 dark:text-gray-300">{sel.summary}</p></Section>
          <Section title="Strengths"><BulletList items={sel.strengths} tone="emerald" /></Section>
          <Section title="Risks"><BulletList items={sel.risks} tone="rose" /></Section>
          <Section title="Report sections">
            <div className="flex flex-wrap gap-1.5">{sel.sections.map((s) => <Chip key={s}>{s}</Chip>)}</div>
          </Section>
        </SlideOver>
      )}
    </div>
  );
}
