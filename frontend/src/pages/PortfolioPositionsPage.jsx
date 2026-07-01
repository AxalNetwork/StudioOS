import React, { useEffect, useState } from 'react';
import { PieChart, Plus, RefreshCw, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { api } from '../lib/api';

const fmtMoney = (v) => (v == null ? '—' : `$${Number(v).toLocaleString()}`);
const fmtPct = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);

export default function PortfolioPositionsPage() {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [detail, setDetail] = useState(null); // { project, rounds, cap_table_snapshot }
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ project_id: '', round_name: '', invested_amount: '', shares: '', price_per_share: '', ownership_pct: '', position_date: '' });

  const load = () => {
    setLoading(true);
    api.positionsList()
      .then((res) => setItems(Array.isArray(res?.items) ? res.items : []))
      .catch((e) => setErr(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openDetail = async (projectUid) => {
    if (!projectUid) return;
    setErr(null);
    try { setDetail(await api.positionsByProject(projectUid)); }
    catch (e) { setErr(e.message || 'Failed to load company'); }
  };

  const onCreate = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.positionCreate({
        project_id: Number(form.project_id), round_name: form.round_name,
        invested_amount: form.invested_amount || undefined, shares: form.shares || undefined,
        price_per_share: form.price_per_share || undefined, ownership_pct: form.ownership_pct || undefined,
        position_date: form.position_date || undefined,
      });
      setCreating(false);
      setForm({ project_id: '', round_name: '', invested_amount: '', shares: '', price_per_share: '', ownership_pct: '', position_date: '' });
      load();
    } catch (e2) { setErr(e2.message || 'Failed to record'); }
    finally { setBusy(false); }
  };

  const field = (key, placeholder, extra = {}) => (
    <input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder={placeholder} {...extra}
      className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm" />
  );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <PieChart size={22} /> Cap Table &amp; Ownership
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Ownership and dilution across rounds for each portfolio company.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 text-gray-500 hover:text-gray-800" title="Refresh"><RefreshCw size={16} /></button>
          {isAdmin && (
            <button onClick={() => setCreating((v) => !v)} className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm">
              {creating ? <X size={14} /> : <Plus size={14} />} {creating ? 'Cancel' : 'Record Round'}
            </button>
          )}
        </div>
      </div>

      {err && <div className="mb-4 px-4 py-2 bg-rose-50 text-rose-700 rounded-lg text-sm">{err}</div>}

      {isAdmin && creating && (
        <form onSubmit={onCreate} className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {field('project_id', 'Project ID', { required: true, inputMode: 'numeric' })}
            {field('round_name', 'Round (e.g. Seed)', { required: true })}
            {field('invested_amount', 'Invested $', { inputMode: 'decimal' })}
            {field('ownership_pct', 'Ownership %', { inputMode: 'decimal' })}
            {field('shares', 'Shares', { inputMode: 'decimal' })}
            {field('price_per_share', 'Price / share', { inputMode: 'decimal' })}
            {field('position_date', 'Date (YYYY-MM-DD)')}
          </div>
          <button disabled={busy} className="mt-3 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm">
            {busy ? 'Saving…' : 'Record'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="text-gray-500 text-center py-16">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-gray-500 text-center py-16">No positions recorded yet.</div>
      ) : (
        <div className="overflow-x-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100 dark:border-gray-800">
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Total invested</th>
                <th className="px-4 py-3">Rounds</th>
                <th className="px-4 py-3">Latest ownership</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.project_id} className="border-b border-gray-50 dark:border-gray-800/50">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{it.project?.name || `Project ${it.project_id}`}</td>
                  <td className="px-4 py-3">{fmtMoney(it.total_invested)}</td>
                  <td className="px-4 py-3">{it.rounds}</td>
                  <td className="px-4 py-3">{fmtPct(it.latest_ownership_pct)} {it.latest_round ? <span className="text-gray-400">({it.latest_round})</span> : null}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openDetail(it.project?.uid)} className="text-violet-600 hover:underline text-xs">View dilution</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={() => setDetail(null)}>
          <div className="w-full max-w-lg bg-white dark:bg-gray-900 h-full p-6 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{detail.project?.name}</h2>
              <button onClick={() => setDetail(null)} className="text-gray-500 hover:text-gray-800"><X size={18} /></button>
            </div>

            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Dilution by round</h3>
            {(detail.rounds || []).length === 0 ? (
              <div className="text-sm text-gray-500 mb-4">No rounds recorded.</div>
            ) : (
              <table className="w-full text-sm mb-6">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100 dark:border-gray-800">
                    <th className="py-2">Round</th><th className="py-2">Invested</th><th className="py-2">Ownership</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.rounds.map((r) => (
                    <tr key={r.uid} className="border-b border-gray-50 dark:border-gray-800/50">
                      <td className="py-2">{r.round_name}</td>
                      <td className="py-2">{fmtMoney(r.invested_amount)}</td>
                      <td className="py-2">{fmtPct(r.ownership_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Current cap table</h3>
            {(detail.cap_table_snapshot || []).length === 0 ? (
              <div className="text-sm text-gray-500">No cap-table snapshot (connect Carta or add holders).</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100 dark:border-gray-800">
                    <th className="py-2">Holder</th><th className="py-2">Type</th><th className="py-2">Ownership</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.cap_table_snapshot.map((h, i) => (
                    <tr key={i} className="border-b border-gray-50 dark:border-gray-800/50">
                      <td className="py-2">{h.name}</td>
                      <td className="py-2">{h.security_type || '—'}</td>
                      <td className="py-2">{fmtPct(h.ownership_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
