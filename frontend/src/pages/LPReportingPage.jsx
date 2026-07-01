import React, { useEffect, useState } from 'react';
import { FileBarChart, Plus, RefreshCw, X, Send } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { api } from '../lib/api';

const fmtMoney = (v) => (v == null ? '—' : `$${Number(v).toLocaleString()}`);
const fmtNum = (v) => (v == null ? '—' : Number(v).toFixed(2));
const fmtPct = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);

export default function LPReportingPage() {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ fund_id: '', period: '', nav: '', called: '', distributed: '', dpi: '', tvpi: '', irr: '', narrative: '' });

  const load = () => {
    setLoading(true);
    api.lpReportsList()
      .then((res) => setItems(Array.isArray(res?.items) ? res.items : []))
      .catch((e) => setErr(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const onCreate = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.lpReportCreate({
        fund_id: Number(form.fund_id), period: form.period,
        nav: form.nav || undefined, called: form.called || undefined, distributed: form.distributed || undefined,
        dpi: form.dpi || undefined, tvpi: form.tvpi || undefined, irr: form.irr || undefined,
        narrative: form.narrative || undefined,
      });
      setCreating(false);
      setForm({ fund_id: '', period: '', nav: '', called: '', distributed: '', dpi: '', tvpi: '', irr: '', narrative: '' });
      load();
    } catch (e2) { setErr(e2.message || 'Failed to create'); }
    finally { setBusy(false); }
  };

  const publish = async (uid) => {
    setBusy(true); setErr(null);
    try { await api.lpReportPublish(uid); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const field = (key, placeholder, extra = {}) => (
    <input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      placeholder={placeholder} {...extra}
      className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm" />
  );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <FileBarChart size={22} /> LP Reporting
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Quarterly fund statements — NAV, called &amp; distributed capital, DPI / TVPI / IRR, and narrative.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 text-gray-500 hover:text-gray-800" title="Refresh"><RefreshCw size={16} /></button>
          {isAdmin && (
            <button onClick={() => setCreating((v) => !v)} className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm">
              {creating ? <X size={14} /> : <Plus size={14} />} {creating ? 'Cancel' : 'New Report'}
            </button>
          )}
        </div>
      </div>

      {err && <div className="mb-4 px-4 py-2 bg-rose-50 text-rose-700 rounded-lg text-sm">{err}</div>}

      {isAdmin && creating && (
        <form onSubmit={onCreate} className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            {field('fund_id', 'Fund ID', { required: true, inputMode: 'numeric' })}
            {field('period', 'Period (e.g. 2026-Q2)', { required: true })}
            {field('nav', 'NAV', { inputMode: 'decimal' })}
            {field('called', 'Called', { inputMode: 'decimal' })}
            {field('distributed', 'Distributed', { inputMode: 'decimal' })}
            {field('dpi', 'DPI', { inputMode: 'decimal' })}
            {field('tvpi', 'TVPI', { inputMode: 'decimal' })}
            {field('irr', 'IRR %', { inputMode: 'decimal' })}
          </div>
          <textarea value={form.narrative} onChange={(e) => setForm({ ...form, narrative: e.target.value })}
            placeholder="Narrative / quarterly commentary" rows={4}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm mb-3" />
          <button disabled={busy} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm">
            {busy ? 'Creating…' : 'Create draft'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="text-gray-500 text-center py-16">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-gray-500 text-center py-16">No reports available.</div>
      ) : (
        <div className="space-y-3">
          {items.map((x) => (
            <div key={x.uid} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {x.fund?.name || `Fund ${x.fund_id}`} · {x.period}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${x.status === 'published' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
                    {x.status}
                  </span>
                  {isAdmin && x.status !== 'published' && (
                    <button onClick={() => publish(x.uid)} disabled={busy}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs">
                      <Send size={12} /> Publish
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3 text-sm">
                <Metric label="NAV" value={fmtMoney(x.nav)} />
                <Metric label="Called" value={fmtMoney(x.called)} />
                <Metric label="Distributed" value={fmtMoney(x.distributed)} />
                <Metric label="DPI" value={fmtNum(x.dpi)} />
                <Metric label="TVPI" value={fmtNum(x.tvpi)} />
                <Metric label="IRR" value={fmtPct(x.irr)} />
              </div>
              {x.narrative && <p className="mt-3 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{x.narrative}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-semibold text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}
