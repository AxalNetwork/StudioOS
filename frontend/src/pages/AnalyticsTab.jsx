import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  BarChart3, Users as UsersIcon, DollarSign, Cpu, ClipboardList,
  Download, FileText, RefreshCw, EyeOff, Eye, AlertTriangle, ChevronRight,
  ArrowUp, ArrowDown,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { api } from '../lib/api';

const SUB_TABS = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'users', label: 'Users', icon: UsersIcon },
  { id: 'financial', label: 'Financial', icon: DollarSign },
  { id: 'technical', label: 'Technical', icon: Cpu },
  { id: 'management', label: 'Management', icon: ClipboardList },
];

function isoDate(d) { return d.toISOString().slice(0, 10); }
function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86400 * 1000);
  return { from: isoDate(from), to: isoDate(to) };
}
function maskEmail(e, id) { return `user#${id || '?'}`; }
function maskName(_n, id) { return `User ${id || '?'}`; }

function useSort(initial = { key: null, dir: 'asc' }) {
  const [sort, setSort] = useState(initial);
  const toggle = (key) => setSort(s => s.key === key
    ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: 'asc' });
  const apply = (rows) => {
    if (!sort.key) return rows;
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sort.key]; const bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
      return String(av).localeCompare(String(bv)) * sign;
    });
  };
  return { sort, toggle, apply };
}

function SortHeader({ sort, toggle, k, children, align = 'left' }) {
  const active = sort.key === k;
  return (
    <th className={`px-3 py-2 font-medium select-none cursor-pointer hover:text-violet-700 ${align === 'right' ? 'text-right' : 'text-left'}`}
        onClick={() => toggle(k)}>
      <span className="inline-flex items-center gap-0.5">
        {children}
        {active ? (sort.dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : null}
      </span>
    </th>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500 font-medium">{label}</div>
      <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function ExportButtons({ onExport, busy }) {
  return (
    <div className="flex gap-2">
      <button
        onClick={() => onExport('csv')}
        disabled={busy}
        className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 inline-flex items-center gap-1.5 disabled:opacity-50"
      >
        <Download size={13} /> Export CSV
      </button>
      <button
        onClick={() => onExport('pdf')}
        disabled={busy}
        className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 inline-flex items-center gap-1.5 disabled:opacity-50"
      >
        <FileText size={13} /> Export PDF
      </button>
    </div>
  );
}

function RecentExports({ refreshKey }) {
  const [items, setItems] = useState([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    api.analyticsAudit(10)
      .then(r => { if (alive) setItems(r.items || []); })
      .catch(e => { if (alive) setErr(e?.message || 'Failed to load'); });
    return () => { alive = false; };
  }, [refreshKey]);
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mt-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-gray-900">Recent Exports</div>
        <span className="text-xs text-gray-500">{items.length} item(s)</span>
      </div>
      {err && <div className="text-xs text-red-600">{err}</div>}
      {items.length === 0 ? (
        <div className="text-xs text-gray-400 text-center py-3">No exports yet.</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {items.map(it => (
            <div key={it.id} className="flex items-center justify-between gap-3 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-900">
                  {it.report_type} · <span className="uppercase text-gray-500">{it.format}</span>
                </div>
                <div className="text-gray-500 truncate">
                  by {it.admin_email || `user#${it.admin_user_id}`} · {new Date((it.exported_at || '').replace(' ', 'T') + 'Z').toLocaleString()}
                </div>
              </div>
              {it.download_url && (
                <a
                  href={it.download_url}
                  target="_blank" rel="noreferrer"
                  className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 text-gray-700 inline-flex items-center gap-1"
                >
                  <Download size={11} /> Open
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OverviewSub({ range, anonymized, onExport, busy }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setData(null); setErr('');
    api.analyticsOverview(range.from, range.to)
      .then(setData)
      .catch(e => setErr(e?.message || 'Failed to load'));
  }, [range.from, range.to]);
  if (err) return <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2"><AlertTriangle size={14} className="inline mr-1" /> {err}</div>;
  if (!data) return <div className="text-sm text-gray-500 py-8 text-center"><RefreshCw size={14} className="inline animate-spin mr-2" /> Loading…</div>;
  const fmt$ = (n) => `$${Number(n || 0).toLocaleString()}`;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end"><ExportButtons onExport={onExport} busy={busy} /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Active users" value={data.active_users.toLocaleString()} sub={`Last ${data.range.days}d`} />
        <Stat label="New signups" value={data.new_signups.toLocaleString()} />
        <Stat label="Conversion" value={`${data.conversion_to_paid_pct}%`} sub={`${data.paid_users}/${data.total_users}`} />
        <Stat label="MRR" value={fmt$(data.mrr_usd)} sub={`ARR ${fmt$(data.arr_usd)}`} />
        <Stat label="Churn" value={`${data.churn_rate_pct}%`} sub={`${data.churned_subscriptions} sub(s)`} />
        <Stat label="Avg session" value={`${data.avg_session_minutes}m`} />
        <Stat label="P50 / P95 latency" value={`${data.p50_latency_ms} / ${data.p95_latency_ms}ms`} sub={`${data.total_requests.toLocaleString()} req`} />
        <Stat label="Error rate" value={`${data.error_rate_pct}%`} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-gray-900 mb-2">Daily active users</div>
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <LineChart data={data.daily_active}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Line type="monotone" dataKey="active" stroke="#7c3aed" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-gray-900 mb-2">Top pages</div>
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
            {(data.top_pages || []).map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs border-b border-gray-100 last:border-0 py-1">
                <span className="font-mono text-gray-700 truncate">{p.endpoint}</span>
                <span className="text-gray-500">{Number(p.hits).toLocaleString()} hits</span>
              </div>
            ))}
            {!data.top_pages?.length && <div className="text-xs text-gray-400 text-center py-4">No data.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function UsersSub({ anonymized, onExport, busy, onFiltersChange }) {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [tier, setTier] = useState('');
  const [offset, setOffset] = useState(0);
  const [err, setErr] = useState('');
  const [drillId, setDrillId] = useState(null);
  const sorter = useSort();
  const limit = 25;
  useEffect(() => {
    if (onFiltersChange) onFiltersChange({ search, role, tier, limit, offset });
  }, [search, role, tier, offset, onFiltersChange]);
  const load = useCallback(() => {
    setErr('');
    api.analyticsUsers({ search, role, tier, limit, offset })
      .then(setData)
      .catch(e => setErr(e?.message || 'Failed to load'));
  }, [search, role, tier, offset]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={search} onChange={e => { setOffset(0); setSearch(e.target.value); }}
            placeholder="Search email/name…"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white text-gray-900 w-64"
          />
          <select value={role} onChange={e => { setOffset(0); setRole(e.target.value); }}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white text-gray-900">
            <option value="">All roles</option>
            <option value="admin">admin</option>
            <option value="founder">founder</option>
            <option value="partner">partner</option>
            <option value="investor">investor</option>
          </select>
          <select value={tier} onChange={e => { setOffset(0); setTier(e.target.value); }}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white text-gray-900">
            <option value="">All tiers</option>
            <option value="mi_pro_monthly">MI Pro · Monthly</option>
            <option value="mi_pro_annual">MI Pro · Annual</option>
          </select>
        </div>
        <ExportButtons onExport={onExport} busy={busy} />
      </div>
      {err && <div className="text-xs text-red-600">{err}</div>}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <SortHeader sort={sorter.sort} toggle={sorter.toggle} k="email">User</SortHeader>
              <SortHeader sort={sorter.sort} toggle={sorter.toggle} k="role">Role</SortHeader>
              <SortHeader sort={sorter.sort} toggle={sorter.toggle} k="sub_plan">Tier</SortHeader>
              <SortHeader sort={sorter.sort} toggle={sorter.toggle} k="sessions_30d" align="right">Sessions 30d</SortHeader>
              <SortHeader sort={sorter.sort} toggle={sorter.toggle} k="project_count" align="right">Projects</SortHeader>
              <SortHeader sort={sorter.sort} toggle={sorter.toggle} k="lifetime_value_usd" align="right">LTV</SortHeader>
              <SortHeader sort={sorter.sort} toggle={sorter.toggle} k="last_seen_at">Last seen</SortHeader>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorter.apply(data?.users || []).map(u => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-900">{anonymized ? maskName(u.name, u.id) : (u.name || '—')}</div>
                  <div className="text-gray-500">{anonymized ? maskEmail(u.email, u.id) : u.email}</div>
                </td>
                <td className="px-3 py-2">{u.role}</td>
                <td className="px-3 py-2">{u.sub_plan || <span className="text-gray-400">free</span>}</td>
                <td className="px-3 py-2 text-right">{u.sessions_30d}</td>
                <td className="px-3 py-2 text-right">{u.project_count}</td>
                <td className="px-3 py-2 text-right">${u.lifetime_value_usd}</td>
                <td className="px-3 py-2 text-gray-500">{u.last_seen_at ? new Date(u.last_seen_at.replace(' ', 'T') + 'Z').toLocaleDateString() : '—'}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => setDrillId(u.id)} className="text-violet-700 hover:underline inline-flex items-center gap-0.5">
                    Drill <ChevronRight size={12} />
                  </button>
                </td>
              </tr>
            ))}
            {(!data || data.users.length === 0) && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">No users.</td></tr>
            )}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-3 py-2 text-xs text-gray-600 border-t border-gray-100">
          <div>{data ? `${offset + 1}–${Math.min(offset + limit, data.total)} of ${data.total}` : '—'}</div>
          <div className="flex gap-1">
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}
                    className="px-2 py-1 border border-gray-300 rounded disabled:opacity-50">Prev</button>
            <button disabled={!data || offset + limit >= data.total} onClick={() => setOffset(offset + limit)}
                    className="px-2 py-1 border border-gray-300 rounded disabled:opacity-50">Next</button>
          </div>
        </div>
      </div>
      {drillId && <UserDrillDown id={drillId} anonymized={anonymized} onClose={() => setDrillId(null)} />}
    </div>
  );
}

function UserDrillDown({ id, anonymized, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.analyticsUser(id).then(setData).catch(e => setErr(e?.message || 'Failed'));
  }, [id]);
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="font-semibold text-gray-900 text-sm">User drill-down · #{id}</div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-sm">Close</button>
        </div>
        <div className="p-4 space-y-3 text-xs">
          {err && <div className="text-red-600">{err}</div>}
          {!data && !err && <div className="text-gray-500">Loading…</div>}
          {data && (
            <>
              <div className="text-sm">
                <div className="font-semibold">{anonymized ? maskName(data.user.name, data.user.id) : (data.user.name || '—')}</div>
                <div className="text-gray-500">{anonymized ? maskEmail(data.user.email, data.user.id) : data.user.email} · {data.user.role}</div>
                <div className="text-gray-500 mt-1">
                  Plan: {data.user.sub_plan || 'free'} · Status: {data.user.sub_status || '—'} · LTV: ${data.lifetime_value_usd}
                </div>
              </div>
              <div>
                <div className="font-semibold text-gray-700 mb-1">Feature usage (last 90d)</div>
                <div className="border border-gray-200 rounded divide-y divide-gray-100 max-h-40 overflow-y-auto">
                  {data.feature_usage.map((f, i) => (
                    <div key={i} className="flex justify-between px-2 py-1">
                      <span className="font-mono text-gray-700">{f.action}</span>
                      <span className="text-gray-500">{f.c}</span>
                    </div>
                  ))}
                  {data.feature_usage.length === 0 && <div className="text-gray-400 px-2 py-2">No activity.</div>}
                </div>
              </div>
              <div>
                <div className="font-semibold text-gray-700 mb-1">Support tickets ({data.support_tickets.length})</div>
                <div className="border border-gray-200 rounded divide-y divide-gray-100 max-h-32 overflow-y-auto">
                  {data.support_tickets.map(t => (
                    <div key={t.id} className="flex justify-between px-2 py-1">
                      <span className="text-gray-700 truncate">{t.subject}</span>
                      <span className="text-gray-500">{t.status}</span>
                    </div>
                  ))}
                  {data.support_tickets.length === 0 && <div className="text-gray-400 px-2 py-2">No tickets.</div>}
                </div>
              </div>
              <div>
                <div className="font-semibold text-gray-700 mb-1">Billing history ({data.billing_history?.length || 0})</div>
                <div className="border border-gray-200 rounded divide-y divide-gray-100 max-h-32 overflow-y-auto">
                  {(data.billing_history || []).map((b, i) => (
                    <div key={i} className="flex items-center justify-between px-2 py-1">
                      <span className="text-gray-700">{b.event_type} · {b.plan}</span>
                      <span className="text-gray-500">${b.amount_usd} · {b.status}</span>
                    </div>
                  ))}
                  {(!data.billing_history || data.billing_history.length === 0) && (
                    <div className="text-gray-400 px-2 py-2">No billing events.</div>
                  )}
                </div>
              </div>
              <div className="text-gray-600">Errors logged (90d): <strong>{data.error_count_90d}</strong></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FinancialSub({ range, onExport, busy }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setData(null); setErr('');
    api.analyticsFinancial(range.from, range.to).then(setData).catch(e => setErr(e?.message || 'Failed'));
  }, [range.from, range.to]);
  if (err) return <div className="text-sm text-red-600">{err}</div>;
  if (!data) return <div className="text-sm text-gray-500 py-8 text-center"><RefreshCw size={14} className="inline animate-spin mr-2" /> Loading…</div>;
  const fmt$ = (n) => `$${Number(n || 0).toLocaleString()}`;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end"><ExportButtons onExport={onExport} busy={busy} /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total MRR" value={fmt$(data.total_mrr_usd)} />
        <Stat label="ARR" value={fmt$(data.arr_usd)} />
        <Stat label="New MRR (window)" value={fmt$(data.new_mrr_usd)} />
        <Stat label="Churn MRR (window)" value={fmt$(data.churn_mrr_usd)} />
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="text-sm font-semibold text-gray-900 mb-2">MRR by tier</div>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={data.mrr_breakdown_by_tier}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="plan" tick={{ fontSize: 10, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="mrr_usd" fill="#7c3aed" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <table className="w-full text-xs mt-3">
          <thead className="text-gray-500">
            <tr><th className="text-left py-1">Plan</th><th className="text-right">Subscribers</th><th className="text-right">Price</th><th className="text-right">MRR</th></tr>
          </thead>
          <tbody>
            {data.mrr_breakdown_by_tier.map((r, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="py-1">{r.plan}</td>
                <td className="text-right">{r.subscribers}</td>
                <td className="text-right">{fmt$(r.monthly_price_usd)}</td>
                <td className="text-right font-semibold">{fmt$(r.mrr_usd)}</td>
              </tr>
            ))}
            {data.mrr_breakdown_by_tier.length === 0 && (
              <tr><td colSpan={4} className="text-center py-3 text-gray-400">No paying subscribers in this period.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="text-sm font-semibold text-gray-900 mb-2">LTV by signup cohort</div>
        <table className="w-full text-xs">
          <thead className="text-gray-500">
            <tr><th className="text-left py-1">Cohort</th><th className="text-right">Signups</th><th className="text-right">Paying</th><th className="text-right">Est. LTV</th></tr>
          </thead>
          <tbody>
            {(data.ltv_by_cohort || []).map((r, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="py-1 font-mono">{r.cohort}</td>
                <td className="text-right">{r.signups}</td>
                <td className="text-right">{r.paying}</td>
                <td className="text-right">{fmt$(r.estimated_ltv_usd)}</td>
              </tr>
            ))}
            {(data.ltv_by_cohort || []).length === 0 && (
              <tr><td colSpan={4} className="text-center py-3 text-gray-400">No cohort data.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TechnicalSub({ range, onExport, busy }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setData(null); setErr('');
    api.analyticsTechnical(range.from, range.to).then(setData).catch(e => setErr(e?.message || 'Failed'));
  }, [range.from, range.to]);
  if (err) return <div className="text-sm text-red-600">{err}</div>;
  if (!data) return <div className="text-sm text-gray-500 py-8 text-center"><RefreshCw size={14} className="inline animate-spin mr-2" /> Loading…</div>;
  return <TechnicalView data={data} onExport={onExport} busy={busy} />;
}

function TechnicalView({ data, onExport, busy }) {
  const routeSorter = useSort({ key: 'hits', dir: 'desc' });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end"><ExportButtons onExport={onExport} busy={busy} /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Queue depth" value={data.queue_depth} />
        <Stat label="DLQ" value={data.dlq_count} />
        <Stat label="Routes tracked" value={data.by_route.length} />
        <Stat label="Top errors" value={data.top_errors.length} />
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="text-sm font-semibold text-gray-900 mb-2">Per-route latency (p50 / p95 / p99)</div>
        <table className="w-full text-xs">
          <thead className="text-gray-500">
            <tr>
              <SortHeader sort={routeSorter.sort} toggle={routeSorter.toggle} k="endpoint">Endpoint</SortHeader>
              <SortHeader sort={routeSorter.sort} toggle={routeSorter.toggle} k="hits" align="right">Hits</SortHeader>
              <SortHeader sort={routeSorter.sort} toggle={routeSorter.toggle} k="p50_ms" align="right">P50</SortHeader>
              <SortHeader sort={routeSorter.sort} toggle={routeSorter.toggle} k="p95_ms" align="right">P95</SortHeader>
              <SortHeader sort={routeSorter.sort} toggle={routeSorter.toggle} k="p99_ms" align="right">P99</SortHeader>
              <SortHeader sort={routeSorter.sort} toggle={routeSorter.toggle} k="errors_5xx" align="right">5xx</SortHeader>
              <SortHeader sort={routeSorter.sort} toggle={routeSorter.toggle} k="error_rate_pct" align="right">Err %</SortHeader>
            </tr>
          </thead>
          <tbody>
            {routeSorter.apply(data.by_route).map((r, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="py-1 font-mono truncate max-w-xs">{r.endpoint}</td>
                <td className="text-right">{Number(r.hits).toLocaleString()}</td>
                <td className="text-right">{r.p50_ms}ms</td>
                <td className="text-right">{r.p95_ms}ms</td>
                <td className="text-right">{r.p99_ms}ms</td>
                <td className="text-right">{r.errors_5xx}</td>
                <td className="text-right">{r.error_rate_pct}%</td>
              </tr>
            ))}
            {data.by_route.length === 0 && <tr><td colSpan={7} className="text-center py-3 text-gray-400">No traffic.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="text-sm font-semibold text-gray-900 mb-2">Slow queries (highest P95)</div>
        <table className="w-full text-xs">
          <thead className="text-gray-500">
            <tr><th className="text-left py-1">Endpoint</th><th className="text-right">P95</th><th className="text-right">Hits</th></tr>
          </thead>
          <tbody>
            {(data.slow_queries || []).map((s, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="py-1 font-mono truncate max-w-md">{s.endpoint}</td>
                <td className="text-right">{s.p95_ms}ms</td>
                <td className="text-right">{Number(s.hits).toLocaleString()}</td>
              </tr>
            ))}
            {(data.slow_queries || []).length === 0 && (
              <tr><td colSpan={3} className="text-center py-3 text-gray-400">No data.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="text-sm font-semibold text-gray-900 mb-2">Top errors</div>
        <table className="w-full text-xs">
          <thead className="text-gray-500">
            <tr><th className="text-left py-1">Endpoint</th><th>Status</th><th className="text-left">Message</th><th className="text-right">Count</th></tr>
          </thead>
          <tbody>
            {data.top_errors.map((e, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="py-1 font-mono">{e.endpoint}</td>
                <td>{e.status_code}</td>
                <td className="truncate max-w-md">{e.message}</td>
                <td className="text-right">{e.c}</td>
              </tr>
            ))}
            {data.top_errors.length === 0 && <tr><td colSpan={4} className="text-center py-3 text-gray-400">No errors.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ManagementSub({ range, onExport, busy }) {
  const [overview, setOverview] = useState(null);
  const [financial, setFinancial] = useState(null);
  useEffect(() => {
    Promise.all([
      api.analyticsOverview(range.from, range.to),
      api.analyticsFinancial(range.from, range.to),
    ]).then(([o, f]) => { setOverview(o); setFinancial(f); }).catch(() => {});
  }, [range.from, range.to]);
  const fmt$ = (n) => `$${Number(n || 0).toLocaleString()}`;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end"><ExportButtons onExport={onExport} busy={busy} /></div>
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="text-sm font-semibold text-gray-900 mb-2">Executive summary · {range.from} → {range.to}</div>
        {overview && financial ? (
          <ul className="text-sm text-gray-700 space-y-1">
            <li><strong>{overview.active_users.toLocaleString()}</strong> active users · <strong>{overview.new_signups.toLocaleString()}</strong> new signups · <strong>{overview.conversion_to_paid_pct}%</strong> paid conversion</li>
            <li><strong>{fmt$(financial.total_mrr_usd)}</strong> total MRR · <strong>{fmt$(financial.arr_usd)}</strong> ARR · new {fmt$(financial.new_mrr_usd)} / churn {fmt$(financial.churn_mrr_usd)}</li>
            <li>Reliability: P50 <strong>{overview.p50_latency_ms}ms</strong> · P95 <strong>{overview.p95_latency_ms}ms</strong> · error rate <strong>{overview.error_rate_pct}%</strong></li>
            <li>Engagement: avg session <strong>{overview.avg_session_minutes} min</strong> · churn rate <strong>{overview.churn_rate_pct}%</strong></li>
          </ul>
        ) : <div className="text-sm text-gray-500">Loading…</div>}
      </div>
    </div>
  );
}

export default function AnalyticsTab() {
  const [sub, setSub] = useState('overview');
  const [range, setRange] = useState(defaultRange());
  const [anonymized, setAnonymized] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [auditKey, setAuditKey] = useState(0);
  const [exportNote, setExportNote] = useState('');
  const [usersFilters, setUsersFilters] = useState({});

  const onExport = useCallback(async (format) => {
    setExporting(true); setExportNote('');
    try {
      const filters = sub === 'users' ? usersFilters : {};
      const res = await api.analyticsExport({
        report: sub, format, from: range.from, to: range.to, filters,
      });
      setAuditKey(k => k + 1);
      if (res.download_url) {
        window.open(res.download_url, '_blank', 'noopener,noreferrer');
        setExportNote(`Export ready · ${res.format?.toUpperCase()} · expires in 24h`);
      }
    } catch (e) {
      setAuditKey(k => k + 1);
      const msg = e?.message || 'Export failed';
      setExportNote(format === 'pdf' && /503|not configured|rendering/i.test(msg)
        ? 'PDF rendering is not configured on this environment. Try CSV.'
        : msg);
    } finally {
      setExporting(false);
    }
  }, [sub, range, usersFilters]);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 text-xs text-gray-600">
          From
          <input type="date" value={range.from}
                 onChange={e => setRange(r => ({ ...r, from: e.target.value }))}
                 className="border border-gray-300 rounded px-2 py-1" />
          To
          <input type="date" value={range.to}
                 onChange={e => setRange(r => ({ ...r, to: e.target.value }))}
                 className="border border-gray-300 rounded px-2 py-1" />
        </div>
        <button
          onClick={() => setAnonymized(a => !a)}
          className={`text-xs px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5 ${
            anonymized
              ? 'bg-violet-50 border-violet-300 text-violet-800'
              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
          title="Hide emails/names; keep IDs"
        >
          {anonymized ? <EyeOff size={12} /> : <Eye size={12} />}
          {anonymized ? 'Anonymized view ON' : 'View as anonymized'}
        </button>
        {exportNote && <span className="text-xs text-gray-600">{exportNote}</span>}
      </div>

      <div className="border-b border-gray-200 flex gap-1 overflow-x-auto">
        {SUB_TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setSub(t.id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px inline-flex items-center gap-1.5 ${
                sub === t.id
                  ? 'border-violet-600 text-violet-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {sub === 'overview'  && <OverviewSub  range={range} anonymized={anonymized} onExport={onExport} busy={exporting} />}
      {sub === 'users'     && <UsersSub                  anonymized={anonymized} onExport={onExport} busy={exporting} onFiltersChange={setUsersFilters} />}
      {sub === 'financial' && <FinancialSub range={range}                          onExport={onExport} busy={exporting} />}
      {sub === 'technical' && <TechnicalSub range={range}                          onExport={onExport} busy={exporting} />}
      {sub === 'management'&& <ManagementSub range={range}                         onExport={onExport} busy={exporting} />}

      <RecentExports refreshKey={auditKey} />
    </div>
  );
}
