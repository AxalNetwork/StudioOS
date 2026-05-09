import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  BarChart3, Users as UsersIcon, DollarSign, Cpu, ClipboardList,
  Download, FileText, RefreshCw, EyeOff, Eye, AlertTriangle, ChevronRight,
  ArrowUp, ArrowDown, Check, X as XIcon, Pencil, Plus, Trash2,
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

function fmtMoney(amount, code) {
  const ccy = (code || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: ccy, maximumFractionDigits: ccy === 'JPY' ? 0 : 0,
    }).format(Number(amount || 0));
  } catch {
    return `${ccy} ${Number(amount || 0).toLocaleString()}`;
  }
}

function FxBadge({ code, asOf }) {
  if (!code) return null;
  return (
    <span className="text-[11px] text-gray-500 ml-2">
      Display: <span className="font-medium text-gray-700">{code}</span>
      {asOf && <> · FX as of {String(asOf).slice(0, 10)}</>}
    </span>
  );
}

function OverviewSub({ range, anonymized, currency, onExport, busy }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setData(null); setErr('');
    api.analyticsOverview(range.from, range.to, currency)
      .then(setData)
      .catch(e => setErr(e?.message || 'Failed to load'));
  }, [range.from, range.to, currency]);
  if (err) return <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2"><AlertTriangle size={14} className="inline mr-1" /> {err}</div>;
  if (!data) return <div className="text-sm text-gray-500 py-8 text-center"><RefreshCw size={14} className="inline animate-spin mr-2" /> Loading…</div>;
  const ccy = data.display_currency || 'USD';
  const mrr = data.mrr ?? data.mrr_usd;
  const arr = data.arr ?? data.arr_usd;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <FxBadge code={ccy} asOf={data.fx_as_of} />
        <ExportButtons onExport={onExport} busy={busy} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Active users" value={data.active_users.toLocaleString()} sub={`Last ${data.range.days}d`} />
        <Stat label="New signups" value={data.new_signups.toLocaleString()} />
        <Stat label="Conversion" value={`${data.conversion_to_paid_pct}%`} sub={`${data.paid_users}/${data.total_users}`} />
        <Stat label={`MRR (${ccy})`} value={fmtMoney(mrr, ccy)} sub={`ARR ${fmtMoney(arr, ccy)}`} />
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

function PlanCatalog({ onChanged }) {
  const [plans, setPlans] = useState(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null); // {plan_id, monthly_price_usd, display_name}
  const [saving, setSaving] = useState(false);
  const [savingFlag, setSavingFlag] = useState(null); // plan_id of in-flight is_active toggle
  const [deletingFlag, setDeletingFlag] = useState(null); // plan_id of in-flight delete
  const [confirmDelete, setConfirmDelete] = useState(null); // plan_id awaiting confirm
  const [creating, setCreating] = useState(null); // {plan_id, monthly_price_usd, display_name, stripe_price_id, currency, native_amount}
  const [createBusy, setCreateBusy] = useState(false);
  // Task #18 — currency dropdown options for the "Add plan" form, sourced
  // from the same endpoint as the dashboard-level selector.
  // Task #23 — also retain the full {currency, usd_rate, updated_at} rows
  // so the form can render a live USD preview using the same rate the
  // backend will FX-convert with on submit.
  const [planCurrencies, setPlanCurrencies] = useState([
    'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'SGD', 'CHF', 'SEK',
  ]);
  const [fxRates, setFxRates] = useState({}); // { CCY: { usd_rate, updated_at } }
  const refreshCurrencies = useCallback(() => {
    api.analyticsCurrencies()
      .then(r => {
        const arr = Array.isArray(r.currencies) ? r.currencies : [];
        const list = arr.map(c => c.currency).filter(Boolean);
        if (list.length) setPlanCurrencies(list);
        const map = {};
        for (const row of arr) {
          if (row && row.currency) {
            map[String(row.currency).toUpperCase()] = {
              usd_rate: Number(row.usd_rate),
              updated_at: row.updated_at || null,
            };
          }
        }
        setFxRates(map);
      })
      .catch(() => {});
  }, []);
  useEffect(() => { refreshCurrencies(); }, [refreshCurrencies]);

  const load = useCallback(() => {
    setErr('');
    api.analyticsListPlans()
      .then(r => setPlans(r.plans || []))
      .catch(e => setErr(e?.message || 'Failed to load plans'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const startEdit = (p) => {
    // Task #25 — re-fetch FX rates on edit open so the live USD preview
    // for non-USD plans always reflects today's rate (matches startCreate).
    refreshCurrencies();
    const currency = String(p.currency || 'USD').toUpperCase();
    setEditing({
      plan_id: p.plan_id,
      currency,
      monthly_price_usd: String(p.monthly_price_usd ?? 0),
      native_amount: String(p.native_amount ?? p.monthly_price_usd ?? 0),
      display_name: p.display_name || '',
    });
  };
  const cancelEdit = () => setEditing(null);
  const saveEdit = async () => {
    if (!editing) return;
    const isUsd = (editing.currency || 'USD') === 'USD';
    const payload = { display_name: editing.display_name.trim() || null };
    if (isUsd) {
      const priceNum = Number(editing.monthly_price_usd);
      if (!Number.isFinite(priceNum) || priceNum < 0) {
        setErr('Price must be a non-negative number'); return;
      }
      payload.monthly_price_usd = priceNum;
    } else {
      const nativeNum = Number(editing.native_amount);
      if (!Number.isFinite(nativeNum) || nativeNum < 0) {
        setErr('Native amount must be a non-negative number'); return;
      }
      payload.native_amount = nativeNum;
    }
    setSaving(true); setErr('');
    try {
      await api.analyticsUpdatePlan(editing.plan_id, payload);
      setEditing(null);
      load();
      onChanged && onChanged();
    } catch (e) {
      setErr(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };
  const startCreate = () => {
    setErr('');
    // Task #23 — re-fetch FX rates whenever the form opens so admins always
    // see today's rate (in case the form sat closed across a daily fx_rates
    // refresh on the worker).
    refreshCurrencies();
    setCreating({
      plan_id: '', monthly_price_usd: '', display_name: '', stripe_price_id: '',
      currency: 'USD', native_amount: '',
    });
  };
  const cancelCreate = () => setCreating(null);
  const submitCreate = async () => {
    if (!creating) return;
    const planId = (creating.plan_id || '').trim();
    if (!planId) { setErr('Plan ID is required'); return; }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.\-]{0,63}$/.test(planId)) {
      setErr('Plan ID must be 1-64 chars: letters, digits, _ . -'); return;
    }
    const currency = (creating.currency || 'USD').toUpperCase();
    const isUsd = currency === 'USD';
    const payload = {
      plan_id: planId,
      display_name: creating.display_name.trim() || null,
      stripe_price_id: creating.stripe_price_id.trim() || null,
      currency,
    };
    if (isUsd) {
      const priceNum = Number(creating.monthly_price_usd);
      if (!Number.isFinite(priceNum) || priceNum < 0) {
        setErr('Price must be a non-negative number'); return;
      }
      payload.monthly_price_usd = priceNum;
    } else {
      const nativeNum = Number(creating.native_amount);
      if (!Number.isFinite(nativeNum) || nativeNum < 0) {
        setErr('Native amount must be a non-negative number'); return;
      }
      payload.native_amount = nativeNum;
    }
    setCreateBusy(true); setErr('');
    try {
      await api.analyticsCreatePlan(payload);
      setCreating(null);
      load();
      onChanged && onChanged();
    } catch (e) {
      setErr(e?.message || 'Create failed');
    } finally {
      setCreateBusy(false);
    }
  };

  const askDelete = (p) => { setErr(''); setConfirmDelete(p.plan_id); };
  const cancelDelete = () => setConfirmDelete(null);
  const confirmDeletePlan = async (p) => {
    setDeletingFlag(p.plan_id); setErr('');
    try {
      await api.analyticsDeletePlan(p.plan_id);
      setConfirmDelete(null);
      load();
      onChanged && onChanged();
    } catch (e) {
      setErr(e?.message || 'Delete failed');
    } finally {
      setDeletingFlag(null);
    }
  };

  const toggleActive = async (p) => {
    setSavingFlag(p.plan_id); setErr('');
    try {
      await api.analyticsUpdatePlan(p.plan_id, { is_active: !p.is_active });
      load();
      onChanged && onChanged();
    } catch (e) {
      setErr(e?.message || 'Update failed');
    } finally {
      setSavingFlag(null);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-semibold text-gray-900">Subscription plan catalog</div>
          <div className="text-xs text-gray-500">Edits update MRR / ARR immediately. Plan IDs are stable join keys and can't be renamed once created.</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={startCreate}
            disabled={!!creating}
            className="text-xs px-2 py-1 rounded bg-violet-600 text-white inline-flex items-center gap-1 disabled:opacity-50"
          >
            <Plus size={11} /> Add plan
          </button>
          <button onClick={load} className="text-xs text-gray-600 hover:text-gray-900 inline-flex items-center gap-1">
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </div>
      {creating && (
        <div className="mb-3 p-3 rounded-lg border border-violet-200 bg-violet-50/50">
          <div className="text-xs font-semibold text-gray-900 mb-2">New plan</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <label className="text-xs">
              <span className="block text-gray-600 mb-0.5">Plan ID <span className="text-red-500">*</span></span>
              <input
                value={creating.plan_id}
                onChange={e => setCreating(s => ({ ...s, plan_id: e.target.value }))}
                placeholder="e.g. mi_team_monthly"
                className="border border-gray-300 rounded px-2 py-1 text-xs w-full font-mono"
                autoFocus
              />
            </label>
            <label className="text-xs">
              <span className="block text-gray-600 mb-0.5">Currency</span>
              <select
                value={creating.currency}
                onChange={e => setCreating(s => ({ ...s, currency: e.target.value }))}
                className="border border-gray-300 rounded px-2 py-1 text-xs w-full bg-white"
              >
                {planCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            {creating.currency === 'USD' ? (
              <label className="text-xs">
                <span className="block text-gray-600 mb-0.5">Monthly price (USD) <span className="text-red-500">*</span></span>
                <input
                  type="number" min="0" step="0.01"
                  value={creating.monthly_price_usd}
                  onChange={e => setCreating(s => ({ ...s, monthly_price_usd: e.target.value }))}
                  placeholder="e.g. 99"
                  className="border border-gray-300 rounded px-2 py-1 text-xs w-full text-right"
                />
              </label>
            ) : (
              <label className="text-xs">
                <span className="block text-gray-600 mb-0.5">Monthly price ({creating.currency}) <span className="text-red-500">*</span></span>
                <input
                  type="number" min="0" step="0.01"
                  value={creating.native_amount}
                  onChange={e => setCreating(s => ({ ...s, native_amount: e.target.value }))}
                  placeholder={`Native amount in ${creating.currency}`}
                  className="border border-gray-300 rounded px-2 py-1 text-xs w-full text-right"
                  title="USD price will be FX-derived from this amount."
                />
                {(() => {
                  // Task #23 — live USD preview using the same fx_rates row
                  // the backend will divide by on submit (monthly_price_usd
                  // = native_amount / usd_rate).
                  const fx = fxRates[creating.currency];
                  const nativeNum = Number(creating.native_amount);
                  if (!fx || !Number.isFinite(fx.usd_rate) || fx.usd_rate <= 0) {
                    return (
                      <span className="block mt-0.5 text-amber-600">
                        No FX rate on file for {creating.currency} — submit will fail.
                      </span>
                    );
                  }
                  if (!Number.isFinite(nativeNum) || nativeNum <= 0) {
                    return (
                      <span className="block mt-0.5 text-gray-500">
                        1 USD ≈ {fx.usd_rate.toLocaleString(undefined, { maximumFractionDigits: 4 })} {creating.currency}
                        {fx.updated_at ? ` · rate as of ${new Date(fx.updated_at).toLocaleDateString()}` : ''}
                      </span>
                    );
                  }
                  const usd = nativeNum / fx.usd_rate;
                  return (
                    <span className="block mt-0.5 text-gray-600">
                      ≈ ${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                      {fx.updated_at ? ` · rate as of ${new Date(fx.updated_at).toLocaleDateString()}` : ''}
                    </span>
                  );
                })()}
              </label>
            )}
            <label className="text-xs">
              <span className="block text-gray-600 mb-0.5">Display name</span>
              <input
                value={creating.display_name}
                onChange={e => setCreating(s => ({ ...s, display_name: e.target.value }))}
                placeholder="e.g. Team · Monthly"
                className="border border-gray-300 rounded px-2 py-1 text-xs w-full"
              />
            </label>
            <label className="text-xs">
              <span className="block text-gray-600 mb-0.5">Stripe price ID (optional)</span>
              <input
                value={creating.stripe_price_id}
                onChange={e => setCreating(s => ({ ...s, stripe_price_id: e.target.value }))}
                placeholder="price_…"
                className="border border-gray-300 rounded px-2 py-1 text-xs w-full font-mono"
              />
            </label>
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button onClick={cancelCreate} disabled={createBusy}
                    className="px-2 py-1 rounded border border-gray-300 text-gray-600 text-xs inline-flex items-center gap-1">
              <XIcon size={11} /> Cancel
            </button>
            <button onClick={submitCreate} disabled={createBusy}
                    className="px-2 py-1 rounded bg-violet-600 text-white text-xs inline-flex items-center gap-1 disabled:opacity-50">
              <Check size={11} /> {createBusy ? 'Creating…' : 'Create plan'}
            </button>
          </div>
        </div>
      )}
      {err && <div className="text-xs text-red-600 mb-2"><AlertTriangle size={11} className="inline mr-1" />{err}</div>}
      <table className="w-full text-xs">
        <thead className="text-gray-500">
          <tr>
            <th className="text-left py-1">Plan ID</th>
            <th className="text-left">Display name</th>
            <th className="text-right">Monthly price (USD)</th>
            <th className="text-left">Stripe price ID</th>
            <th className="text-center">Active</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {plans === null && (
            <tr><td colSpan={6} className="text-center py-3 text-gray-400">Loading…</td></tr>
          )}
          {plans && plans.length === 0 && (
            <tr><td colSpan={6} className="text-center py-3 text-gray-400">No plans registered yet.</td></tr>
          )}
          {plans && plans.map(p => {
            const isEdit = editing && editing.plan_id === p.plan_id;
            const subs = Number(p.subscriber_count || 0);
            const canDelete = subs === 0;
            const isConfirming = confirmDelete === p.plan_id;
            const isDeleting = deletingFlag === p.plan_id;
            return (
              <tr key={p.plan_id} className="border-t border-gray-100 align-middle">
                <td className="py-1.5 font-mono text-gray-700">{p.plan_id}</td>
                <td className="py-1.5">
                  {isEdit ? (
                    <input
                      value={editing.display_name}
                      onChange={e => setEditing(s => ({ ...s, display_name: e.target.value }))}
                      placeholder="(none)"
                      className="border border-gray-300 rounded px-2 py-1 text-xs w-full"
                    />
                  ) : (p.display_name || <span className="text-gray-400">—</span>)}
                </td>
                <td className="py-1.5 text-right">
                  {isEdit ? (
                    (editing.currency || 'USD') === 'USD' ? (
                      <input
                        type="number" min="0" step="0.01"
                        value={editing.monthly_price_usd}
                        onChange={e => setEditing(s => ({ ...s, monthly_price_usd: e.target.value }))}
                        className="border border-gray-300 rounded px-2 py-1 text-xs w-24 text-right"
                      />
                    ) : (
                      <div className="inline-flex flex-col items-end gap-0.5">
                        <div className="inline-flex items-center gap-1">
                          <input
                            type="number" min="0" step="0.01"
                            value={editing.native_amount}
                            onChange={e => setEditing(s => ({ ...s, native_amount: e.target.value }))}
                            className="border border-gray-300 rounded px-2 py-1 text-xs w-24 text-right"
                            title="USD price will be FX-derived from this amount."
                          />
                          <span className="text-[11px] text-gray-500">{editing.currency}</span>
                        </div>
                        {(() => {
                          // Task #25 — same live USD preview as the Add plan form (Task #23).
                          const fx = fxRates[editing.currency];
                          const nativeNum = Number(editing.native_amount);
                          if (!fx || !Number.isFinite(fx.usd_rate) || fx.usd_rate <= 0) {
                            return (
                              <span className="text-[11px] text-amber-600">
                                No FX rate on file for {editing.currency} — save will fail.
                              </span>
                            );
                          }
                          if (!Number.isFinite(nativeNum) || nativeNum <= 0) {
                            return (
                              <span className="text-[11px] text-gray-500">
                                1 USD ≈ {fx.usd_rate.toLocaleString(undefined, { maximumFractionDigits: 4 })} {editing.currency}
                                {fx.updated_at ? ` · rate as of ${new Date(fx.updated_at).toLocaleDateString()}` : ''}
                              </span>
                            );
                          }
                          const usd = nativeNum / fx.usd_rate;
                          return (
                            <span className="text-[11px] text-gray-600">
                              ≈ ${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                              {fx.updated_at ? ` · rate as of ${new Date(fx.updated_at).toLocaleDateString()}` : ''}
                            </span>
                          );
                        })()}
                      </div>
                    )
                  ) : `$${Number(p.monthly_price_usd).toLocaleString(undefined, { minimumFractionDigits: p.monthly_price_usd % 1 ? 2 : 0 })}`}
                </td>
                <td className="py-1.5 font-mono text-gray-500 truncate max-w-[180px]">
                  {p.stripe_price_id || <span className="text-gray-300">—</span>}
                </td>
                <td className="py-1.5 text-center">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!p.is_active}
                    onClick={() => toggleActive(p)}
                    disabled={savingFlag === p.plan_id || isEdit}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                      p.is_active ? 'bg-violet-600' : 'bg-gray-300'
                    } ${savingFlag === p.plan_id ? 'opacity-60' : ''}`}
                    title={p.is_active ? 'Active — click to deactivate' : 'Inactive — click to activate'}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
                      p.is_active ? 'translate-x-5' : 'translate-x-1'
                    }`} />
                  </button>
                </td>
                <td className="py-1.5 text-right">
                  {isEdit ? (
                    <span className="inline-flex gap-1">
                      <button onClick={saveEdit} disabled={saving}
                              className="px-2 py-1 rounded bg-violet-600 text-white inline-flex items-center gap-1 disabled:opacity-50">
                        <Check size={11} /> Save
                      </button>
                      <button onClick={cancelEdit} disabled={saving}
                              className="px-2 py-1 rounded border border-gray-300 text-gray-600 inline-flex items-center gap-1">
                        <XIcon size={11} /> Cancel
                      </button>
                    </span>
                  ) : isConfirming ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="text-[11px] text-gray-600 mr-1">Delete plan?</span>
                      <button onClick={() => confirmDeletePlan(p)} disabled={isDeleting}
                              className="px-2 py-1 rounded bg-red-600 text-white inline-flex items-center gap-1 disabled:opacity-50">
                        <Check size={11} /> {isDeleting ? 'Deleting…' : 'Confirm'}
                      </button>
                      <button onClick={cancelDelete} disabled={isDeleting}
                              className="px-2 py-1 rounded border border-gray-300 text-gray-600 inline-flex items-center gap-1">
                        <XIcon size={11} /> Cancel
                      </button>
                    </span>
                  ) : (
                    <span className="inline-flex gap-1">
                      <button onClick={() => startEdit(p)}
                              className="px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1">
                        <Pencil size={11} /> Edit
                      </button>
                      <button
                        onClick={() => askDelete(p)}
                        disabled={!canDelete}
                        title={canDelete
                          ? 'Permanently delete this plan'
                          : `Can't delete — ${subs} user(s) still reference this plan. Deactivate it instead.`}
                        className={`px-2 py-1 rounded border inline-flex items-center gap-1 ${
                          canDelete
                            ? 'border-red-200 text-red-600 hover:bg-red-50'
                            : 'border-gray-200 text-gray-300 cursor-not-allowed'
                        }`}
                      >
                        <Trash2 size={11} /> Delete
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PlanAuditHistory({ refreshKey }) {
  const PAGE_SIZE = 25;
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState('');
  const [planOptions, setPlanOptions] = useState([]);
  const [planFilter, setPlanFilter] = useState('');
  const [adminFilter, setAdminFilter] = useState('');
  const [adminFilterDraft, setAdminFilterDraft] = useState('');

  useEffect(() => {
    let alive = true;
    api.analyticsListPlans()
      .then(r => { if (alive) setPlanOptions(Array.isArray(r?.plans) ? r.plans : []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [refreshKey]);

  useEffect(() => {
    let alive = true;
    setItems(null); setErr(''); setHasMore(false); setTotal(0);
    const opts = {};
    if (planFilter) opts.plan_id = planFilter;
    if (adminFilter) {
      if (/^\d+$/.test(adminFilter.trim())) opts.admin_user_id = adminFilter.trim();
      else opts.admin_q = adminFilter.trim();
    }
    api.analyticsAudit(PAGE_SIZE, 'subscription_plan_update', opts)
      .then(r => {
        if (!alive) return;
        setItems(r.items || []);
        setTotal(Number(r.total || 0));
        setHasMore(!!r.has_more);
      })
      .catch(e => { if (alive) setErr(e?.message || 'Failed to load'); });
    return () => { alive = false; };
  }, [refreshKey, planFilter, adminFilter]);

  const loadMore = async () => {
    if (loadingMore || !items) return;
    setLoadingMore(true);
    try {
      const opts = { offset: items.length };
      if (planFilter) opts.plan_id = planFilter;
      if (adminFilter) {
        if (/^\d+$/.test(adminFilter.trim())) opts.admin_user_id = adminFilter.trim();
        else opts.admin_q = adminFilter.trim();
      }
      const r = await api.analyticsAudit(PAGE_SIZE, 'subscription_plan_update', opts);
      setItems(prev => [...(prev || []), ...(r.items || [])]);
      setTotal(Number(r.total || 0));
      setHasMore(!!r.has_more);
    } catch (e) {
      setErr(e?.message || 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  };

  const applyAdminFilter = (e) => {
    e?.preventDefault?.();
    setAdminFilter(adminFilterDraft.trim());
  };
  const clearFilters = () => {
    setPlanFilter('');
    setAdminFilter('');
    setAdminFilterDraft('');
  };
  const hasFilters = !!(planFilter || adminFilter);

  const describePatch = (raw) => {
    if (!raw) return null;
    let parsed;
    try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return String(raw); }
    if (!parsed || typeof parsed !== 'object') return String(raw);
    const parts = [];
    if (parsed.deleted) {
      const label = parsed.display_name ? `“${parsed.display_name}”` : null;
      parts.push(label ? `deleted (${label})` : 'deleted');
      return parts.join(' · ');
    }
    if (parsed.created) {
      parts.push('created');
      if (parsed.stripe_price_id) parts.push(`stripe → ${parsed.stripe_price_id}`);
    }
    if (parsed.monthly_price_usd !== undefined) {
      parts.push(`price → $${Number(parsed.monthly_price_usd).toLocaleString(undefined, { minimumFractionDigits: parsed.monthly_price_usd % 1 ? 2 : 0 })}`);
    }
    if (parsed.display_name !== undefined) {
      parts.push(`name → ${parsed.display_name == null || parsed.display_name === '' ? '(none)' : `“${parsed.display_name}”`}`);
    }
    if (parsed.is_active !== undefined) {
      parts.push(parsed.is_active ? 'activated' : 'deactivated');
    }
    return parts.length ? parts.join(' · ') : null;
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-semibold text-gray-900">Plan change history</div>
          <div className="text-xs text-gray-500">Most recent edits to subscription plans, including who made them.</div>
        </div>
        <span className="text-xs text-gray-500">
          {items ? `${items.length} of ${total}` : '—'} item(s)
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">Plan</label>
          <select
            value={planFilter}
            onChange={e => setPlanFilter(e.target.value)}
            className="text-xs border border-gray-300 rounded px-2 py-1 bg-white min-w-[140px]"
          >
            <option value="">All plans</option>
            {planOptions.map(p => (
              <option key={p.plan_id} value={p.plan_id}>
                {p.display_name ? `${p.display_name} (${p.plan_id})` : p.plan_id}
              </option>
            ))}
          </select>
        </div>
        <form onSubmit={applyAdminFilter} className="flex items-end gap-1">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">Admin (email or user id)</label>
            <input
              type="text"
              value={adminFilterDraft}
              onChange={e => setAdminFilterDraft(e.target.value)}
              placeholder="e.g. alice@ or 42"
              className="text-xs border border-gray-300 rounded px-2 py-1 bg-white min-w-[180px]"
            />
          </div>
          <button
            type="submit"
            className="text-xs px-2 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50"
          >
            Apply
          </button>
        </form>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs px-2 py-1 text-gray-600 hover:text-gray-900 underline"
          >
            Clear filters
          </button>
        )}
      </div>
      {err && <div className="text-xs text-red-600 mb-2"><AlertTriangle size={11} className="inline mr-1" />{err}</div>}
      {items === null ? (
        <div className="text-xs text-gray-400 text-center py-3"><RefreshCw size={11} className="inline animate-spin mr-1" /> Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-gray-400 text-center py-3">{hasFilters ? 'No edits match these filters.' : 'No edits yet.'}</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {items.map(it => {
            const summary = describePatch(it.filters_json);
            return (
              <div key={it.id} className="py-2 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-gray-900 font-mono">{it.report_type || '—'}</div>
                  <div className="text-gray-500 whitespace-nowrap">{new Date((it.exported_at || '').replace(' ', 'T') + 'Z').toLocaleString()}</div>
                </div>
                <div className="text-gray-600 mt-0.5">
                  {summary ? <span className="text-gray-800">{summary}</span> : <span className="text-gray-400">No diff recorded</span>}
                  <span className="text-gray-500"> · by {it.admin_email || it.admin_name || `user#${it.admin_user_id}`}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {items && items.length > 0 && hasMore && (
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="text-xs px-3 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            {loadingMore ? <><RefreshCw size={11} className="inline animate-spin mr-1" /> Loading…</> : `Load more (${total - items.length} remaining)`}
          </button>
        </div>
      )}
    </div>
  );
}

function FinancialSub({ range, currency, onExport, busy }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    setData(null); setErr('');
    api.analyticsFinancial(range.from, range.to, currency).then(setData).catch(e => setErr(e?.message || 'Failed'));
  }, [range.from, range.to, currency, reloadKey]);
  const onPlanChanged = () => setReloadKey(k => k + 1);
  if (err) return <div className="space-y-4"><div className="text-sm text-red-600">{err}</div><PlanCatalog onChanged={onPlanChanged} /><PlanAuditHistory refreshKey={reloadKey} /></div>;
  if (!data) return <div className="space-y-4"><div className="text-sm text-gray-500 py-8 text-center"><RefreshCw size={14} className="inline animate-spin mr-2" /> Loading…</div><PlanCatalog onChanged={onPlanChanged} /><PlanAuditHistory refreshKey={reloadKey} /></div>;
  const ccy = data.display_currency || 'USD';
  const totalMrr = data.total_mrr ?? data.total_mrr_usd;
  const arr = data.arr ?? data.arr_usd;
  const newMrr = data.new_mrr ?? data.new_mrr_usd;
  const churnMrr = data.churn_mrr ?? data.churn_mrr_usd;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <FxBadge code={ccy} asOf={data.fx_as_of} />
        <ExportButtons onExport={onExport} busy={busy} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={`Total MRR (${ccy})`} value={fmtMoney(totalMrr, ccy)} />
        <Stat label={`ARR (${ccy})`} value={fmtMoney(arr, ccy)} />
        <Stat label={`New MRR (${ccy})`} value={fmtMoney(newMrr, ccy)} />
        <Stat label={`Churn MRR (${ccy})`} value={fmtMoney(churnMrr, ccy)} />
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="text-sm font-semibold text-gray-900 mb-2">MRR by tier ({ccy})</div>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={data.mrr_breakdown_by_tier}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="plan" tick={{ fontSize: 10, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="mrr" fill="#7c3aed" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <table className="w-full text-xs mt-3">
          <thead className="text-gray-500">
            <tr>
              <th className="text-left py-1">Plan</th>
              <th className="text-right">Subscribers</th>
              <th className="text-right">Native price</th>
              <th className="text-right">Price ({ccy})</th>
              <th className="text-right">MRR ({ccy})</th>
            </tr>
          </thead>
          <tbody>
            {data.mrr_breakdown_by_tier.map((r, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="py-1">{r.plan}</td>
                <td className="text-right">{r.subscribers}</td>
                <td className="text-right text-gray-500">{fmtMoney(r.native_monthly_price ?? r.monthly_price_usd, r.native_currency || 'USD')}</td>
                <td className="text-right">{fmtMoney(r.monthly_price ?? r.monthly_price_usd, ccy)}</td>
                <td className="text-right font-semibold">{fmtMoney(r.mrr ?? r.mrr_usd, ccy)}</td>
              </tr>
            ))}
            {data.mrr_breakdown_by_tier.length === 0 && (
              <tr><td colSpan={5} className="text-center py-3 text-gray-400">No paying subscribers in this period.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="text-sm font-semibold text-gray-900 mb-2">LTV by signup cohort ({ccy})</div>
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
                <td className="text-right">{fmtMoney(r.estimated_ltv ?? r.estimated_ltv_usd, ccy)}</td>
              </tr>
            ))}
            {(data.ltv_by_cohort || []).length === 0 && (
              <tr><td colSpan={4} className="text-center py-3 text-gray-400">No cohort data.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <PlanCatalog onChanged={onPlanChanged} />
      <PlanAuditHistory refreshKey={reloadKey} />
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

function ManagementSub({ range, currency, onExport, busy }) {
  const [overview, setOverview] = useState(null);
  const [financial, setFinancial] = useState(null);
  useEffect(() => {
    Promise.all([
      api.analyticsOverview(range.from, range.to, currency),
      api.analyticsFinancial(range.from, range.to, currency),
    ]).then(([o, f]) => { setOverview(o); setFinancial(f); }).catch(() => {});
  }, [range.from, range.to, currency]);
  const ccy = financial?.display_currency || overview?.display_currency || 'USD';
  const m$ = (n) => fmtMoney(n, ccy);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end"><ExportButtons onExport={onExport} busy={busy} /></div>
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="text-sm font-semibold text-gray-900 mb-2">Executive summary · {range.from} → {range.to}</div>
        {overview && financial ? (
          <ul className="text-sm text-gray-700 space-y-1">
            <li><strong>{overview.active_users.toLocaleString()}</strong> active users · <strong>{overview.new_signups.toLocaleString()}</strong> new signups · <strong>{overview.conversion_to_paid_pct}%</strong> paid conversion</li>
            <li><strong>{m$(financial.total_mrr ?? financial.total_mrr_usd)}</strong> total MRR · <strong>{m$(financial.arr ?? financial.arr_usd)}</strong> ARR · new {m$(financial.new_mrr ?? financial.new_mrr_usd)} / churn {m$(financial.churn_mrr ?? financial.churn_mrr_usd)} <span className="text-xs text-gray-500">({ccy}{financial.fx_as_of ? ` · FX ${String(financial.fx_as_of).slice(0,10)}` : ''})</span></li>
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
  // Task #14 — currency selector. Persisted per-browser so admins don't have
  // to re-select on every visit.
  const [currency, setCurrency] = useState(() => {
    try { return localStorage.getItem('analytics:currency') || 'USD'; } catch { return 'USD'; }
  });
  const [currencies, setCurrencies] = useState([
    'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'SGD', 'CHF', 'SEK',
  ]);
  useEffect(() => {
    try { localStorage.setItem('analytics:currency', currency); } catch {}
  }, [currency]);
  useEffect(() => {
    api.analyticsCurrencies()
      .then(r => {
        const list = (r.currencies || []).map(c => c.currency).filter(Boolean);
        if (list.length) setCurrencies(list);
      })
      .catch(() => {});
  }, []);

  const onExport = useCallback(async (format) => {
    setExporting(true); setExportNote('');
    try {
      const filters = sub === 'users' ? usersFilters : {};
      const res = await api.analyticsExport({
        report: sub, format, from: range.from, to: range.to, filters, currency,
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
  }, [sub, range, usersFilters, currency]);

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
        <div className="flex items-center gap-1 text-xs text-gray-600">
          Currency
          <select
            value={currency}
            onChange={e => setCurrency(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 bg-white"
            title="Display MRR/ARR in this currency (FX-converted from USD)"
          >
            {currencies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
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

      {sub === 'overview'  && <OverviewSub  range={range} anonymized={anonymized} currency={currency} onExport={onExport} busy={exporting} />}
      {sub === 'users'     && <UsersSub                  anonymized={anonymized}                     onExport={onExport} busy={exporting} onFiltersChange={setUsersFilters} />}
      {sub === 'financial' && <FinancialSub range={range}                          currency={currency} onExport={onExport} busy={exporting} />}
      {sub === 'technical' && <TechnicalSub range={range}                                              onExport={onExport} busy={exporting} />}
      {sub === 'management'&& <ManagementSub range={range}                         currency={currency} onExport={onExport} busy={exporting} />}

      <RecentExports refreshKey={auditKey} />
    </div>
  );
}
