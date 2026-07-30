import React, { useMemo, useState } from 'react';
import { Loader2, AlertTriangle, RotateCcw, Banknote, PenLine, ListChecks, FileText, Clock } from 'lucide-react';
import {
  StatCard, Section, Chip, SlideOver, EmptyState, SearchInput, FilterChips, Field,
} from './advisor/network/kit';
import {
  usePipelineDeals, isTransactionDeal, prettyStage, fmtDate, avg,
} from './pipeline/livePipeline';

const CLOSE = {
  closing: { tone: 'amber', label: 'Closing' },
  closed: { tone: 'emerald', label: 'Closed' },
};

function closeStatus(d) {
  return String(d.project_status || '').toLowerCase() === 'spinout' ? 'closed' : 'closing';
}

function toTransaction(d) {
  return {
    id: d.id,
    company: d.name || 'Untitled deal',
    sector: d.sector || '—',
    stage: prettyStage(d.pipeline_stage),
    thesisFit: d.score ?? null,
    enteredAt: fmtDate(d.created_at),
    stageStartedAt: fmtDate(d.pipeline_stage_started),
    status: closeStatus(d),
  };
}

export default function PipelineTransactionsPage({ embedded = false }) {
  const { deals, loading, error, reload } = usePipelineDeals();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [openId, setOpenId] = useState(null);

  const txns = useMemo(() => deals.filter(isTransactionDeal).map(toTransaction), [deals]);

  const stats = useMemo(() => ({
    closing: txns.filter((d) => d.status === 'closing').length,
    closed: txns.filter((d) => d.status === 'closed').length,
    total: txns.length,
    avgFit: avg(txns.map((d) => d.thesisFit)),
  }), [txns]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return txns.filter((d) => {
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (!q) return true;
      return d.company.toLowerCase().includes(q) || d.sector.toLowerCase().includes(q);
    });
  }, [txns, query, statusFilter]);

  const filterOptions = [
    { id: 'all', label: 'All', count: txns.length },
    { id: 'closing', label: 'Closing', count: txns.filter((d) => d.status === 'closing').length },
    { id: 'closed', label: 'Closed', count: txns.filter((d) => d.status === 'closed').length },
  ];

  const openDeal = txns.find((d) => d.id === openId) || null;

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
        <StatCard label="Closing" value={stats.closing} hint="Spin-out ready" />
        <StatCard label="Closed" value={stats.closed} hint="Spun out" />
        <StatCard label="Total" value={stats.total} hint="In transactions" />
        <StatCard label="Avg thesis fit" value={stats.avgFit == null ? '—' : `${stats.avgFit}`} hint="Across scored deals" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Search company or sector" />
      </div>
      <div className="mb-4">
        <FilterChips options={filterOptions} value={statusFilter} onChange={setStatusFilter} />
      </div>

      {txns.length === 0 ? (
        <EmptyState>No deals are currently in the transactions stage.</EmptyState>
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
                    <Chip tone={CLOSE[d.status].tone}>{CLOSE[d.status].label}</Chip>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{d.sector} · {d.stage}</div>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-gray-400">
                  <Clock size={11} /> Since {d.enteredAt}
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
              <Field label="Stage">{openDeal.stage}</Field>
              <Field label="Status"><Chip tone={CLOSE[openDeal.status].tone}>{CLOSE[openDeal.status].label}</Chip></Field>
              <Field label="Thesis fit">{openDeal.thesisFit == null ? 'Not scored' : `${openDeal.thesisFit}/100`}</Field>
              <Field label="In pipeline since">{openDeal.enteredAt}</Field>
            </div>

            <Section title="Closing checklist">
              <EmptyState>
                <ListChecks className="mx-auto mb-1 text-gray-300 dark:text-gray-600" size={20} />
                No closing checklist on record for this deal yet.
              </EmptyState>
            </Section>

            <Section title="Wire & signatures">
              <EmptyState>
                <div className="flex items-center justify-center gap-3 mb-1 text-gray-300 dark:text-gray-600">
                  <Banknote size={20} /><PenLine size={20} />
                </div>
                No wire or signature records for this deal yet.
              </EmptyState>
            </Section>

            <Section title="Documents">
              <EmptyState>
                <FileText className="mx-auto mb-1 text-gray-300 dark:text-gray-600" size={20} />
                No executed documents on record for this deal yet.
              </EmptyState>
            </Section>

            <Section title="Transaction history">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full bg-violet-500" />
                  <span className="text-gray-600 dark:text-gray-400">Entered pipeline</span>
                  <span className="ml-auto text-xs text-gray-400 tabular-nums">{openDeal.enteredAt}</span>
                </div>
                {openDeal.stageStartedAt !== '—' && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-2 h-2 rounded-full bg-violet-500" />
                    <span className="text-gray-600 dark:text-gray-400">Entered {openDeal.stage}</span>
                    <span className="ml-auto text-xs text-gray-400 tabular-nums">{openDeal.stageStartedAt}</span>
                  </div>
                )}
              </div>
            </Section>
          </>
        )}
      </SlideOver>
    </div>
  );
}
