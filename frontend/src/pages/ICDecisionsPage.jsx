import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gavel, Plus, RefreshCw, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { api } from '../lib/api';

const STATUS_BADGE = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  voting: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  decided: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
};
const DECISION_BADGE = {
  invest: 'text-emerald-700 dark:text-emerald-400',
  pass: 'text-rose-700 dark:text-rose-400',
  defer: 'text-amber-700 dark:text-amber-400',
};

export default function ICDecisionsPage() {
  const { role } = useAuth();
  const canWrite = ['admin', 'partner', 'investor'].includes(role);
  const [items, setItems] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', project_id: '', memo: '' });
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api.icList({ status: statusFilter || undefined })
      .then((res) => setItems(Array.isArray(res?.items) ? res.items : []))
      .catch((e) => setErr(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [statusFilter]);

  const onCreate = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const payload = { title: form.title, memo: form.memo || undefined };
      if (form.project_id) payload.project_id = Number(form.project_id);
      await api.icCreate(payload);
      setCreating(false);
      setForm({ title: '', project_id: '', memo: '' });
      load();
    } catch (e2) { setErr(e2.message || 'Failed to create'); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Gavel size={22} /> IC Decisions
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            One record per deal: memo, proposed terms, committee vote, decision, and outcome.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200" title="Refresh">
            <RefreshCw size={16} />
          </button>
          {canWrite && (
            <button onClick={() => setCreating((v) => !v)} className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm">
              {creating ? <X size={14} /> : <Plus size={14} />} {creating ? 'Cancel' : 'New Decision'}
            </button>
          )}
        </div>
      </div>

      {err && <div className="mb-4 px-4 py-2 bg-rose-50 text-rose-700 rounded-lg text-sm">{err}</div>}

      {creating && (
        <form onSubmit={onCreate} className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
          <input
            value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Decision title (e.g. 'Acme — Seed $500k')" required
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm"
          />
          <input
            value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}
            placeholder="Startup ID (optional)" inputMode="numeric"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm"
          />
          <textarea
            value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })}
            placeholder="IC memo / thesis (optional — can be filled in later)" rows={4}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm"
          />
          <button disabled={busy} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm">
            {busy ? 'Creating…' : 'Create'}
          </button>
        </form>
      )}

      <div className="flex gap-2 mb-4">
        {['', 'draft', 'voting', 'decided'].map((s) => (
          <button key={s || 'all'} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 rounded-full text-xs ${statusFilter === s ? 'bg-violet-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}>
            {s ? s[0].toUpperCase() + s.slice(1) : 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-gray-500 text-center py-16">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-gray-500 text-center py-16">No IC decisions yet.</div>
      ) : (
        <div className="space-y-2">
          {items.map((d) => (
            <Link key={d.uid} to={`/ic/${d.uid}`}
              className="block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:border-violet-400 transition">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{d.title}</div>
                  <div className="text-xs text-gray-500 truncate">
                    {d.project?.name ? `${d.project.name} · ` : ''}
                    {d.tally ? `👍 ${d.tally.yes} · 👎 ${d.tally.no} · ➖ ${d.tally.abstain}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {d.decision && <span className={`text-xs font-semibold uppercase ${DECISION_BADGE[d.decision] || ''}`}>{d.decision}</span>}
                  <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_BADGE[d.status] || ''}`}>{d.status}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
