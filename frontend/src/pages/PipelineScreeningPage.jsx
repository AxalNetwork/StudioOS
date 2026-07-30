import React, { useMemo, useState } from 'react';
import { Loader2, AlertTriangle, RotateCcw, Calendar, BarChart3, Activity } from 'lucide-react';
import {
  StatCard, Section, Chip, SlideOver, EmptyState, SearchInput, FilterChips, StrengthBar, Field,
} from './advisor/network/kit';
import {
  usePipelineDeals, isScreeningDeal, isCommitDeal, isTransactionDeal, prettyStage, fmtDate, avg,
} from './pipeline/livePipeline';

const STATUS_TONE = { reviewing: 'blue', iterate: 'amber' };
const STATUS_LABEL = { reviewing: 'Reviewing', iterate: 'Iterating' };

// Map a raw /pipeline/active deal into the screening display model. Only fields
// with a real source are populated; the rest fall through to empty states.
function toScreening(d) {
  const status = String(d.pipeline_stage || '').toLowerCase() === 'iterate' ? 'iterate' : 'reviewing';
  return {
    id: d.id,
    company: d.name || 'Untitled deal',
    sector: d.sector || '—',
    stage: prettyStage(d.pipeline_stage),
    dateReceived: fmtDate(d.created_at),
    thesisFitScore: d.score ?? null,
    tractionScore: d.latest_metrics?.traction_score ?? null,
    keyMetrics: d.latest_metrics?.key_metrics || null,
    status,
  };
}

export default function PipelineScreeningPage({ embedded = false }) {
  const { deals, loading, error, reload } = usePipelineDeals();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [openId, setOpenId] = useState(null);

  const screening = useMemo(() => deals.filter(isScreeningDeal).map(toScreening), [deals]);

  const stats = useMemo(() => {
    const scored = screening.filter((d) => d.thesisFitScore != null);
    const advanced = deals.filter((d) => isCommitDeal(d) || isTransactionDeal(d)).length;
    return {
      inScreening: screening.length,
      avgFit: avg(scored.map((d) => d.thesisFitScore)),
      scored: scored.length,
      advanced,
    };
  }, [screening, deals]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return screening.filter((d) => {
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (!q) return true;
      return d.company.toLowerCase().includes(q) || d.sector.toLowerCase().includes(q);
    });
  }, [screening, query, statusFilter]);

  const filterOptions = [
    { id: 'all', label: 'All', count: screening.length },
    { id: 'reviewing', label: 'Reviewing', count: screening.filter((d) => d.status === 'reviewing').length },
    { id: 'iterate', label: 'Iterating', count: screening.filter((d) => d.status === 'iterate').length },
  ];

  const openDeal = screening.find((d) => d.id === openId) || null;

  if (loading) {
    return (
      <div className={embedded ? '' : 'p-6 max-w-7xl mx-auto'}>
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="animate-spin" size={20} /> <span className="ml-2 text-sm">Loading deals…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={embedded ? '' : 'p-6 max-w-7xl mx-auto'}>
        <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-6 text-center">
          <AlertTriangle className="mx-auto text-amber-500 mb-2" size={22} />
          <p className="text-sm text-amber-800 dark:text-amber-300">{error}</p>
          <button onClick={reload} className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40">
            <RotateCcw size={14} /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? '' : 'p-6 max-w-7xl mx-auto'}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="In screening" value={stats.inScreening} hint="Deals under review" />
        <StatCard label="Avg thesis fit" value={stats.avgFit == null ? '—' : `${stats.avgFit}`} hint="Across scored deals" />
        <StatCard label="Scored" value={stats.scored} hint="Have a fit score" />
        <StatCard label="Advanced" value={stats.advanced} hint="Reached IC or beyond" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Search company or sector" />
      </div>
      <div className="mb-4">
        <FilterChips options={filterOptions} value={statusFilter} onChange={setStatusFilter} />
      </div>

      {screening.length === 0 ? (
        <EmptyState>No deals are currently in screening.</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>No deals match your filters.</EmptyState>
      ) : (
        <div className="space-y-2">
          {filtered.map((d) => (
            <button
              key={d.id}
              onClick={() => setOpenId(d.id)}
              className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 dark:hover:border-violet-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 dark:text-white">{d.company}</span>
                    <Chip tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Chip>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {d.sector} · {d.stage}
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-gray-400 mt-1">
                    <Calendar size={11} /> Received {d.dateReceived}
                  </div>
                </div>
                <div className="w-40">
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Thesis fit</div>
                  {d.thesisFitScore == null
                    ? <span className="text-xs text-gray-400 italic">Not scored</span>
                    : <StrengthBar value={d.thesisFitScore} />}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <SlideOver
        open={!!openDeal}
        onClose={() => setOpenId(null)}
        title={openDeal?.company}
        subtitle={openDeal ? `${openDeal.sector} · ${openDeal.stage}` : ''}
      >
        {openDeal && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Received">{openDeal.dateReceived}</Field>
              <Field label="Stage">{openDeal.stage}</Field>
              <Field label="Thesis fit">{openDeal.thesisFitScore == null ? 'Not scored' : `${openDeal.thesisFitScore}/100`}</Field>
              <Field label="Status"><Chip tone={STATUS_TONE[openDeal.status]}>{STATUS_LABEL[openDeal.status]}</Chip></Field>
            </div>

            <Section title="Traction metrics">
              {openDeal.tractionScore == null && !openDeal.keyMetrics ? (
                <EmptyState>No traction metrics recorded for this deal yet.</EmptyState>
              ) : (
                <div className="space-y-2">
                  {openDeal.tractionScore != null && (
                    <div className="flex items-center gap-2 text-sm">
                      <Activity size={15} className="text-violet-500" />
                      <span className="text-gray-600 dark:text-gray-400">Traction score</span>
                      <span className="ml-auto font-medium tabular-nums text-gray-900 dark:text-gray-100">{openDeal.tractionScore}/100</span>
                    </div>
                  )}
                  {openDeal.keyMetrics && Object.entries(openDeal.keyMetrics).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400 capitalize">{k.replace(/_/g, ' ')}</span>
                      <span className="font-medium tabular-nums text-gray-900 dark:text-gray-100">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Scorecard">
              <EmptyState>
                <BarChart3 className="mx-auto mb-1 text-gray-300 dark:text-gray-600" size={20} />
                No screening scorecard on record for this deal yet.
              </EmptyState>
            </Section>

            <Section title="Screening notes">
              <EmptyState>No screening notes have been logged for this deal yet.</EmptyState>
            </Section>
          </>
        )}
      </SlideOver>
    </div>
  );
}
