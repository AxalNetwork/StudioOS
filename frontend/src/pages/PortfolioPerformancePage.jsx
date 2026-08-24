// Investor Portfolio Performance surface — build queue #125.
//
// Live data only. Fund ratios come from GET /api/positions/analytics
// (XIRR + TVPI/DPI/RVPI/MOIC computed in services/portfolioMetrics.ts
// from positions, marks, and realisations); the company table and the
// per-company mark history come from /api/positions.
//
// Honesty rules this page enforces, because the numbers are LP-facing:
//   - every ratio is GROSS of fees and carry, and says so;
//   - a position with no valuation mark carries at COST and is badged
//     "at cost" — cost is never presented as a valuation;
//   - mark coverage is shown whenever any position is unmarked, since
//     low coverage drags TVPI toward 1.0 for reasons unrelated to
//     performance;
//   - a null ratio renders "—". Nothing is defaulted to zero.
import React, { useEffect, useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, ArrowUpRight, ChevronDown, Info, RefreshCw } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { StatCard, Section, Chip, SlideOver, FilterChips, EmptyState, Field } from './advisor/network/kit';
import { api } from '../lib/api';
import { reportError } from '../lib/log';

const fmtMoney = (v) => {
  if (v == null) return '—';
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${Math.round(v)}`;
};
const fmtMoneyFull = (v) => (v == null ? '—' : `$${Number(v).toLocaleString()}`);
const fmtX = (v) => (v == null ? '—' : `${Number(v).toFixed(2)}x`);
const fmtIrr = (v) => (v == null ? '—' : `${(Number(v) * 100).toFixed(1)}%`);
const fmtPct = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);

const AXIS = { fontSize: 11, fill: '#94a3b8' };
const GRID = '#e2e8f0';

const MARK_BASIS_LABEL = {
  round_price: 'Round price',
  secondary: 'Secondary',
  gp_estimate: 'GP estimate',
  write_down: 'Write-down',
  cost: 'Held at cost',
};

function SortHeader({ label, field, sort, setSort, align = 'left' }) {
  const active = sort.field === field;
  return (
    <button
      type="button"
      onClick={() => setSort({ field, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
      className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide ${
        align === 'right' ? 'justify-end w-full' : ''
      } ${active ? 'text-violet-600 dark:text-violet-300' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
    >
      {label}
      {active && <ChevronDown className={`w-3 h-3 ${sort.dir === 'asc' ? 'rotate-180' : ''}`} />}
    </button>
  );
}

export default function PortfolioPerformancePage({ embedded = false }) {
  const [analytics, setAnalytics] = useState(null);
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [markFilter, setMarkFilter] = useState('all');
  const [sort, setSort] = useState({ field: 'fmv', dir: 'desc' });
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const [a, p] = await Promise.all([
        api.positionsAnalytics().catch(() => null),
        api.positionsList(),
      ]);
      setAnalytics(a);
      setPositions(Array.isArray(p?.items) ? p.items : []);
    } catch (e) {
      reportError('PortfolioPerformancePage:load', e);
      setErr(e.message || 'Failed to load portfolio performance');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // Mark history for the slide-over comes from the per-project endpoint,
  // so the timeline below is a real audit trail, not a reconstruction.
  useEffect(() => {
    const row = positions.find(p => p.project_id === selectedId);
    if (!row?.project?.uid) { setDetail(null); return; }
    let alive = true;
    setDetailLoading(true);
    api.positionsByProject(row.project.uid)
      .then(d => { if (alive) setDetail(d); })
      .catch(() => { if (alive) setDetail(null); })
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [selectedId, positions]);

  const filtered = useMemo(() => {
    if (markFilter === 'marked') return positions.filter(p => !p.unmarked);
    if (markFilter === 'unmarked') return positions.filter(p => p.unmarked);
    if (markFilter === 'down') return positions.filter(p => p.marked_down);
    return positions;
  }, [positions, markFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const get = (x) => {
      switch (sort.field) {
        case 'name': return (x.project?.name || '').toLowerCase();
        case 'total_invested': return x.total_invested ?? 0;
        case 'fmv': return x.fmv ?? 0;
        case 'multiple': return x.multiple ?? 0;
        case 'latest_ownership_pct': return x.latest_ownership_pct ?? 0;
        default: return x.fmv ?? 0;
      }
    };
    arr.sort((a, b) => {
      const A = get(a), B = get(b);
      if (A < B) return sort.dir === 'asc' ? -1 : 1;
      if (A > B) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, sort]);

  // Vintage cohorts, derived from the year of each company's first
  // cheque (positions.vintage) — real cohorts, not a curated list.
  const cohorts = useMemo(() => {
    const by = new Map();
    for (const p of positions) {
      if (!p.vintage) continue;
      const cur = by.get(p.vintage) || { vintage: p.vintage, invested: 0, value: 0 };
      cur.invested += p.total_invested || 0;
      cur.value += p.fmv || 0;
      by.set(p.vintage, cur);
    }
    return [...by.values()]
      .map(c => ({ ...c, moic: c.invested > 0 ? Math.round((c.value / c.invested) * 100) / 100 : null }))
      .sort((a, b) => a.vintage - b.vintage);
  }, [positions]);

  const selected = positions.find(p => p.project_id === selectedId) || null;
  const coverage = analytics?.mark_coverage;
  const hasUnmarked = (analytics?.unmarked_position_count ?? 0) > 0;

  const filterOptions = [
    { id: 'all', label: 'All', count: positions.length },
    { id: 'marked', label: 'Marked', count: positions.filter(p => !p.unmarked).length },
    { id: 'unmarked', label: 'At cost', count: positions.filter(p => p.unmarked).length },
    { id: 'down', label: 'Marked down', count: positions.filter(p => p.marked_down).length },
  ];

  if (loading) return <div className="p-10 text-center text-gray-500 text-sm">Loading portfolio…</div>;

  const content = (
    <div className="space-y-6">
      {err && <div className="px-4 py-2 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 rounded-lg text-sm">{err}</div>}

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Performance</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Gross of fees and carry, from recorded positions, marks, and realisations
            {analytics?.as_of ? ` · as of ${analytics.as_of}` : ''}.
          </p>
        </div>
        <button onClick={load} className="p-2 text-gray-500 hover:text-violet-600" title="Refresh"><RefreshCw size={16} /></button>
      </div>

      {positions.length === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-10">
          <EmptyState>
            No positions recorded yet. Once rounds are recorded on the Cap Table page, performance
            appears here — TVPI and IRR need at least one dated position.
          </EmptyState>
        </div>
      ) : (
        <>
          {/* Fund ratios */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard label="Total value" value={fmtMoney(analytics?.total_value)} hint={`Paid-in ${fmtMoney(analytics?.paid_in)}`} />
            <StatCard label="TVPI" value={fmtX(analytics?.tvpi)} hint="Total value / paid-in, gross" />
            <StatCard label="DPI" value={fmtX(analytics?.dpi)} hint={`${fmtMoney(analytics?.distributed)} realised`} />
            <StatCard label="RVPI" value={fmtX(analytics?.rvpi)} hint={`NAV ${fmtMoney(analytics?.nav)}`} />
            <StatCard label="IRR" value={fmtIrr(analytics?.irr)} hint="Money-weighted, dated flows" />
          </div>

          {/* Methodology + coverage honesty banner */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60 px-4 py-3 text-xs text-gray-600 dark:text-gray-400 flex items-start gap-2">
            <Info size={14} className="mt-0.5 flex-shrink-0 text-gray-400" />
            <div>
              <span className="font-semibold text-gray-700 dark:text-gray-300">Methodology.</span>{' '}
              TVPI is (realisations + carrying value) over capital deployed into companies; IRR is a
              money-weighted return over dated position and realisation flows with carrying value as
              the terminal inflow. All figures are <strong>gross</strong> — management fees, carry,
              and fund expenses are not deducted, so these are not net-to-LP returns.
              {hasUnmarked && (
                <>
                  {' '}
                  <span className="text-amber-700 dark:text-amber-400">
                    {analytics.unmarked_position_count} of {analytics.position_count} positions have
                    no valuation mark and are carried at cost
                    {coverage != null ? ` (${Math.round(coverage * 100)}% mark coverage)` : ''} —
                    which pulls TVPI toward 1.0 for reasons unrelated to performance.
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Company table */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Companies</h3>
              <FilterChips options={filterOptions} value={markFilter} onChange={setMarkFilter} />
            </div>
            {sorted.length === 0 ? (
              <div className="p-6"><EmptyState>No companies match this filter.</EmptyState></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-800">
                    <tr>
                      <th className="px-4 py-2.5 text-left"><SortHeader label="Company" field="name" sort={sort} setSort={setSort} /></th>
                      <th className="px-4 py-2.5 text-right"><SortHeader label="Invested" field="total_invested" sort={sort} setSort={setSort} align="right" /></th>
                      <th className="px-4 py-2.5 text-right"><SortHeader label="Carrying value" field="fmv" sort={sort} setSort={setSort} align="right" /></th>
                      <th className="px-4 py-2.5 text-right"><SortHeader label="Multiple" field="multiple" sort={sort} setSort={setSort} align="right" /></th>
                      <th className="px-4 py-2.5 text-right"><SortHeader label="Ownership" field="latest_ownership_pct" sort={sort} setSort={setSort} align="right" /></th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Mark</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
                    {sorted.map((c) => (
                      <tr key={c.project_id} onClick={() => setSelectedId(c.project_id)}
                        className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900 dark:text-gray-100">{c.project?.name || `Startup ${c.project_id}`}</span>
                            {c.marked_down && <Chip tone="rose">Marked down</Chip>}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {[c.project?.sector, c.project?.stage, c.vintage ? `Vintage ${c.vintage}` : null].filter(Boolean).join(' · ')}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{fmtMoney(c.total_invested)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-900 dark:text-gray-100 font-medium">{fmtMoney(c.fmv)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className={c.multiple == null ? 'text-gray-400' : c.multiple >= 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                            {c.multiple != null && c.multiple !== 1 && (c.multiple >= 1
                              ? <TrendingUp size={12} className="inline mr-0.5" />
                              : <TrendingDown size={12} className="inline mr-0.5" />)}
                            {fmtX(c.multiple)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{fmtPct(c.latest_ownership_pct)}</td>
                        <td className="px-4 py-3">
                          {c.unmarked ? (
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">at cost</span>
                          ) : (
                            <span className="text-xs text-gray-600 dark:text-gray-400">
                              {MARK_BASIS_LABEL[c.mark_basis] || c.mark_basis}
                              {c.mark_as_of && <span className="text-gray-400"> · {c.mark_as_of}</span>}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right"><ArrowUpRight size={14} className="text-gray-400 inline" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Vintage cohorts — derived from first-cheque year */}
          {cohorts.length > 1 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
              <Section title="Vintage cohorts">
                <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1 mb-2">
                  Grouped by the year of the first cheque into each company. Gross multiple on
                  carrying value; cohorts with unmarked positions sit closer to 1.0x.
                </p>
                <div style={{ width: '100%', height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cohorts} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} opacity={0.4} vertical={false} />
                      <XAxis dataKey="vintage" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
                      <YAxis yAxisId="left" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={fmtMoney} width={54} />
                      <YAxis yAxisId="right" orientation="right" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}x`} width={40} />
                      <Tooltip
                        formatter={(v, n) => (n === 'Multiple' ? [`${Number(v).toFixed(2)}x`, n] : [fmtMoneyFull(v), n])}
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="left" dataKey="invested" name="Invested" fill="#c4b5fd" radius={[4, 4, 0, 0]} />
                      <Bar yAxisId="left" dataKey="value" name="Carrying value" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                      <Bar yAxisId="right" dataKey="moic" name="Multiple" fill="#34d399" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Section>
            </div>
          )}
        </>
      )}

      {/* Per-company slide-over — real mark history */}
      <SlideOver
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected?.project?.name}
        subtitle={selected ? [selected.project?.sector, selected.project?.stage, selected.vintage ? `Vintage ${selected.vintage}` : null].filter(Boolean).join(' · ') : ''}
      >
        {selected && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Invested" value={fmtMoney(selected.total_invested)} hint={`${selected.rounds} round${selected.rounds === 1 ? '' : 's'}`} />
              <StatCard label="Carrying value" value={fmtMoney(selected.fmv)} hint={selected.unmarked ? 'Held at cost — no mark' : MARK_BASIS_LABEL[selected.mark_basis] || ''} />
              <StatCard label="Multiple" value={fmtX(selected.multiple)} />
              <StatCard label="Ownership" value={fmtPct(selected.latest_ownership_pct)} hint={selected.latest_round || ''} />
            </div>

            <Section title="Valuation mark history">
              {detailLoading && <div className="text-xs text-gray-500">Loading…</div>}
              {!detailLoading && (detail?.marks || []).length === 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  No marks recorded. This position is carried at cost — an admin can record a mark
                  to give it a valuation.
                </p>
              )}
              {(detail?.marks || []).length > 0 && (
                <ol className="relative border-l border-gray-200 dark:border-gray-700 ml-1 space-y-4">
                  {detail.marks.map((m) => (
                    <li key={m.uid} className="ml-4">
                      <span className="absolute -left-1.5 mt-1 w-3 h-3 rounded-full bg-violet-500 border-2 border-white dark:border-gray-950" />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400">{m.as_of_date}</span>
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 tabular-nums">{fmtMoneyFull(m.fmv)}</span>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {m.event && <span className="text-gray-700 dark:text-gray-300">{m.event} · </span>}
                        {MARK_BASIS_LABEL[m.basis] || m.basis}
                        {m.post_money ? ` · post-money ${fmtMoneyFull(m.post_money)}` : ''}
                      </div>
                      {m.source && <div className="text-[11px] text-gray-400 mt-0.5">Source: {m.source}</div>}
                    </li>
                  ))}
                </ol>
              )}
            </Section>

            {(detail?.distributions || []).length > 0 && (
              <Section title="Realisations">
                <ul className="space-y-2">
                  {detail.distributions.map(d => (
                    <li key={d.uid} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">{d.distribution_date} · {d.kind}</span>
                      <span className="tabular-nums font-medium text-emerald-600 dark:text-emerald-400">{fmtMoneyFull(d.amount)}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title="Rounds">
              <ul className="space-y-2">
                {(detail?.rounds || []).map(r => (
                  <li key={r.uid} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">{r.round_name}{r.position_date ? ` · ${r.position_date}` : ''}</span>
                    <span className="tabular-nums text-gray-900 dark:text-gray-100">{fmtMoneyFull(r.invested_amount)}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Latest mark">{selected.mark_as_of || 'None'}</Field>
              <Field label="Status">{selected.project?.status || '—'}</Field>
            </div>
          </>
        )}
      </SlideOver>
    </div>
  );

  if (embedded) return content;
  return <div className="p-6 max-w-7xl mx-auto">{content}</div>;
}
