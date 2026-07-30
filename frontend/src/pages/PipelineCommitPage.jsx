import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle, RotateCcw, Gavel, FileText, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { api } from '../lib/api';
import {
  StatCard, Section, Chip, SlideOver, EmptyState, SearchInput, FilterChips, Field,
} from './advisor/network/kit';
import {
  usePipelineDeals, isCommitDeal, prettyStage, fmtDate,
} from './pipeline/livePipeline';

const DECISION = {
  approved: { tone: 'emerald', label: 'Approved', icon: CheckCircle2 },
  declined: { tone: 'rose', label: 'Declined', icon: XCircle },
  pending: { tone: 'amber', label: 'Pending', icon: Clock },
};

const VOTE_ORDER = [
  ['Strong_Buy', 'Strong Buy', 'emerald'],
  ['Buy', 'Buy', 'blue'],
  ['Hold', 'Hold', 'amber'],
  ['Pass', 'Pass', 'rose'],
];

function decisionFromGate(gate) {
  const fd = String(gate?.final_decision || '').toLowerCase();
  if (fd === 'passed' || fd === 'approved') return 'approved';
  if (fd === 'failed' || fd === 'rejected' || fd === 'declined') return 'declined';
  return 'pending';
}

function memoFromGate(gate) {
  if (!gate) return 'none';
  if (gate.final_decision) return 'final';
  if (gate.status) return 'in_review';
  return 'none';
}

function toCommit(d) {
  return {
    id: d.id,
    company: d.name || 'Untitled deal',
    sector: d.sector || '—',
    round: prettyStage(d.pipeline_stage),
    thesisFit: d.score ?? null,
    decision: decisionFromGate(d.latest_gate),
    memoStatus: memoFromGate(d.latest_gate),
    icDate: fmtDate(d.latest_gate?.created_at),
    recommendation: d.latest_gate?.ai_recommendation || null,
  };
}

export default function PipelineCommitPage({ embedded = false }) {
  const { deals, loading, error, reload } = usePipelineDeals();
  const [query, setQuery] = useState('');
  const [decisionFilter, setDecisionFilter] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [tallies, setTallies] = useState({});

  const commit = useMemo(() => deals.filter(isCommitDeal).map(toCommit), [deals]);

  // Vote tallies are a real source (`GET /api/pipeline/votes/:id`). We key off
  // the same `id` that `/pipeline/active` returns — the app-wide contract the
  // Board also uses to cast and read votes, so tallies written against a deal
  // render back here. Deals with no votes (a 404 or empty tally) fall through
  // to the empty voting state, which is the honest result.
  useEffect(() => {
    let cancelled = false;
    const ids = commit.map((d) => d.id);
    if (!ids.length) { setTallies({}); return; }
    (async () => {
      const results = await Promise.allSettled(ids.map((id) => api.getVotes(id)));
      if (cancelled) return;
      const next = {};
      results.forEach((r, i) => { if (r.status === 'fulfilled' && r.value) next[ids[i]] = r.value; });
      setTallies(next);
    })();
    return () => { cancelled = true; };
  }, [commit]);

  const stats = useMemo(() => ({
    inIC: commit.length,
    approved: commit.filter((d) => d.decision === 'approved').length,
    declined: commit.filter((d) => d.decision === 'declined').length,
    votes: Object.values(tallies).reduce((s, t) => s + (t.total_voters || 0), 0),
  }), [commit, tallies]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return commit.filter((d) => {
      if (decisionFilter !== 'all' && d.decision !== decisionFilter) return false;
      if (!q) return true;
      return d.company.toLowerCase().includes(q) || d.sector.toLowerCase().includes(q);
    });
  }, [commit, query, decisionFilter]);

  const filterOptions = [
    { id: 'all', label: 'All', count: commit.length },
    { id: 'pending', label: 'Pending', count: commit.filter((d) => d.decision === 'pending').length },
    { id: 'approved', label: 'Approved', count: commit.filter((d) => d.decision === 'approved').length },
    { id: 'declined', label: 'Declined', count: commit.filter((d) => d.decision === 'declined').length },
  ];

  const openDeal = commit.find((d) => d.id === openId) || null;
  const openTally = openDeal ? tallies[openDeal.id] : null;

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
        <StatCard label="In committee" value={stats.inIC} hint="At decision gate" />
        <StatCard label="Approved" value={stats.approved} hint="Gate passed" />
        <StatCard label="Declined" value={stats.declined} hint="Gate not passed" />
        <StatCard label="Votes cast" value={stats.votes} hint="Across IC deals" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Search company or sector" />
      </div>
      <div className="mb-4">
        <FilterChips options={filterOptions} value={decisionFilter} onChange={setDecisionFilter} />
      </div>

      {commit.length === 0 ? (
        <EmptyState>No deals are currently at the investment committee.</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>No deals match your filters.</EmptyState>
      ) : (
        <div className="space-y-2">
          {filtered.map((d) => {
            const dec = DECISION[d.decision];
            const t = tallies[d.id];
            return (
              <button
                key={d.id}
                onClick={() => setOpenId(d.id)}
                className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 dark:hover:border-violet-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 dark:text-white">{d.company}</span>
                      <Chip tone={dec.tone}>{dec.label}</Chip>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{d.sector} · {d.round}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Votes</div>
                    <div className="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                      {t ? t.total_voters : 0}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <SlideOver
        open={!!openDeal}
        onClose={() => setOpenId(null)}
        title={openDeal?.company}
        subtitle={openDeal ? `${openDeal.sector} · ${openDeal.round}` : ''}
      >
        {openDeal && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Stage">{openDeal.round}</Field>
              <Field label="IC date">{openDeal.icDate}</Field>
              <Field label="Decision"><Chip tone={DECISION[openDeal.decision].tone}>{DECISION[openDeal.decision].label}</Chip></Field>
              <Field label="Thesis fit">{openDeal.thesisFit == null ? 'Not scored' : `${openDeal.thesisFit}/100`}</Field>
            </div>

            <Section title="Committee recommendation">
              {openDeal.recommendation
                ? <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{openDeal.recommendation}</p>
                : <EmptyState>No committee recommendation on record for this deal yet.</EmptyState>}
            </Section>

            <Section title="Voting record">
              {!openTally || openTally.total_voters === 0 ? (
                <EmptyState>
                  <Gavel className="mx-auto mb-1 text-gray-300 dark:text-gray-600" size={20} />
                  No committee votes have been cast for this deal yet.
                </EmptyState>
              ) : (
                <div className="space-y-2">
                  {VOTE_ORDER.map(([key, label, tone]) => {
                    const cell = openTally.by_type?.[key] || { count: 0 };
                    return (
                      <div key={key} className="flex items-center justify-between text-sm">
                        <Chip tone={tone}>{label}</Chip>
                        <span className="font-medium tabular-nums text-gray-900 dark:text-gray-100">{cell.count}</span>
                      </div>
                    );
                  })}
                  <div className="pt-2 mt-1 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>{openTally.total_voters} {openTally.total_voters === 1 ? 'voter' : 'voters'} · {openTally.strong_buy_pct}% buy conviction</span>
                    {openTally.threshold_reached && <Chip tone="green">Threshold reached</Chip>}
                  </div>
                </div>
              )}
            </Section>

            <Section title="IC memo & term sheet">
              <EmptyState>
                <FileText className="mx-auto mb-1 text-gray-300 dark:text-gray-600" size={20} />
                No IC memo or term sheet on record for this deal yet.
              </EmptyState>
            </Section>

            <Section title="Conditions to close">
              <EmptyState>No closing conditions have been logged for this deal yet.</EmptyState>
            </Section>
          </>
        )}
      </SlideOver>
    </div>
  );
}
