import React, { useEffect, useState } from 'react';
import { Inbox, Plus, RefreshCw, X, Send } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { api } from '../lib/api';

const KPI_KEYS = [
  ['arr', 'ARR'], ['mrr', 'MRR'], ['burn', 'Burn'],
  ['runway_months', 'Runway (mo)'], ['headcount', 'Headcount'], ['cash', 'Cash'],
];

export default function PortfolioUpdatesPage() {
  const { role } = useAuth();
  const isFounder = role === 'founder';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null); // detail drawer
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ project_id: '', period: '', title: '', body: '', kpis: {} });

  const load = () => {
    setLoading(true);
    api.portfolioUpdatesList()
      .then((res) => setItems(Array.isArray(res?.items) ? res.items : []))
      .catch((e) => setErr(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const onCreate = async (e, submit) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const kpis = {};
      for (const [k] of KPI_KEYS) if (form.kpis[k] !== undefined && form.kpis[k] !== '') kpis[k] = Number(form.kpis[k]);
      await api.portfolioUpdateCreate({
        project_id: Number(form.project_id), title: form.title,
        period: form.period || undefined, body: form.body || undefined,
        kpis, status: submit ? 'submitted' : 'draft',
      });
      setCreating(false);
      setForm({ project_id: '', period: '', title: '', body: '', kpis: {} });
      load();
    } catch (e2) { setErr(e2.message || 'Failed to submit'); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Inbox size={22} /> Company Updates
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {isFounder ? 'Submit periodic KPI + narrative updates for your companies.' : 'Founder-submitted KPIs and updates from across the portfolio.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 text-gray-500 hover:text-gray-800" title="Refresh"><RefreshCw size={16} /></button>
          {isFounder && (
            <button onClick={() => setCreating((v) => !v)} className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm">
              {creating ? <X size={14} /> : <Plus size={14} />} {creating ? 'Cancel' : 'Submit Update'}
            </button>
          )}
        </div>
      </div>

      {err && <div className="mb-4 px-4 py-2 bg-rose-50 text-rose-700 rounded-lg text-sm">{err}</div>}

      {isFounder && creating && (
        <form className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            <input value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} placeholder="Startup ID" inputMode="numeric" required
              className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm" />
            <input value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="Period (e.g. 2026-06)"
              className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm" />
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title" required
              className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm" />
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-3">
            {KPI_KEYS.map(([k, label]) => (
              <input key={k} value={form.kpis[k] ?? ''} onChange={(e) => setForm({ ...form, kpis: { ...form.kpis, [k]: e.target.value } })}
                placeholder={label} inputMode="decimal"
                className="px-2 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm" />
            ))}
          </div>
          <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Narrative / highlights / asks" rows={4}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm mb-3" />
          <div className="flex gap-2">
            <button onClick={(e) => onCreate(e, false)} disabled={busy} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 disabled:opacity-50 rounded-lg text-sm">Save draft</button>
            <button onClick={(e) => onCreate(e, true)} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm">
              <Send size={14} /> Submit
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-gray-500 text-center py-16">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-gray-500 text-center py-16">No updates yet.</div>
      ) : (
        <div className="space-y-2">
          {items.map((u) => (
            <button key={u.uid} onClick={() => setOpen(u)}
              className="w-full text-left bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:border-violet-400 transition">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{u.title}</div>
                  <div className="text-xs text-gray-500 truncate">{u.project?.name || `Startup ${u.project_id}`}{u.period ? ` · ${u.period}` : ''}</div>
                </div>
                <div className="hidden md:flex gap-3 text-xs text-gray-500 shrink-0">
                  {KPI_KEYS.slice(0, 4).map(([k, label]) => (u.kpis?.[k] != null ? <span key={k}>{label}: {u.kpis[k]}</span> : null))}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={() => setOpen(null)}>
          <div className="w-full max-w-md bg-white dark:bg-gray-900 h-full p-6 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{open.title}</h2>
              <button onClick={() => setOpen(null)} className="text-gray-500 hover:text-gray-800"><X size={18} /></button>
            </div>
            <div className="text-sm text-gray-500 mb-4">{open.project?.name || `Startup ${open.project_id}`}{open.period ? ` · ${open.period}` : ''}</div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {KPI_KEYS.map(([k, label]) => (
                <div key={k}>
                  <div className="text-xs text-gray-500">{label}</div>
                  <div className="font-semibold text-gray-900 dark:text-gray-100">{open.kpis?.[k] ?? '—'}</div>
                </div>
              ))}
            </div>
            {open.body && <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{open.body}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
