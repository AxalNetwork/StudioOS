import React, { useEffect, useState } from 'react';
import { Trash2, RotateCcw, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../components/useToast';

// Task #7 (AM) — Admin > Trash. Lists soft-deleted projects with Restore +
// Hard-delete actions. Soft-deleted rows are auto-purged 30 days after
// `deleted_at` by the cron sweep in services/projectTrash.ts.
export default function AdminTrashPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const { toast, showToast } = useToast();

  const load = () => {
    setLoading(true);
    setError('');
    api.adminListProjectTrash()
      .then((r) => setRows(Array.isArray(r?.projects) ? r.projects : []))
      .catch((e) => setError(e?.message || 'Failed to load trash'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const handleRestore = async (p) => {
    setBusy(p.id);
    try {
      await api.adminRestoreProject(p.id);
      setRows(prev => prev.filter(r => r.id !== p.id));
      showToast({ kind: 'success', msg: `Restored "${p.name}"` });
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Restore failed' });
    } finally { setBusy(null); }
  };

  const handleHardDelete = async (p) => {
    if (!window.confirm(`Permanently delete "${p.name}"? This wipes all child records (scores, deals, docs) and CANNOT be undone.`)) return;
    setBusy(p.id);
    try {
      await api.adminHardDeleteProject(p.id);
      setRows(prev => prev.filter(r => r.id !== p.id));
      showToast({ kind: 'success', msg: `"${p.name}" permanently deleted` });
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Hard delete failed' });
    } finally { setBusy(null); }
  };

  const daysLeft = (deletedAt) => {
    if (!deletedAt) return null;
    const ms = (new Date(deletedAt).getTime() + 30 * 86400000) - Date.now();
    return Math.max(0, Math.ceil(ms / 86400000));
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1 dark:text-gray-100">Trash · Startups</h1>
        <p className="text-sm text-gray-600">Soft-deleted startups. Restored within 30 days, otherwise auto-purged.</p>
      </div>

      {loading ? (
        <div className="text-gray-600 text-center py-10 text-sm">Loading…</div>
      ) : error ? (
        <div className="bg-white border border-red-200 rounded-xl px-5 py-8 text-center text-sm dark:bg-gray-900">
          <div className="text-red-600 mb-2">Couldn't load trash</div>
          <div className="text-gray-600 mb-4">{error}</div>
          <button onClick={load} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg text-white text-sm">Retry</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl px-5 py-12 text-center text-sm text-gray-500 dark:bg-gray-900 dark:border-gray-800">
          Trash is empty.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-600 text-xs uppercase dark:border-gray-800">
                <th className="text-left px-5 py-3">Startup</th>
                <th className="text-left px-5 py-3 hidden md:table-cell">Founder</th>
                <th className="text-left px-5 py-3 hidden md:table-cell">Sector</th>
                <th className="text-left px-5 py-3">Deleted</th>
                <th className="text-left px-5 py-3">Auto-purge in</th>
                <th className="px-3 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(p => {
                const dl = daysLeft(p.deleted_at);
                const urgent = dl !== null && dl <= 3;
                return (
                  <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3 text-gray-900 font-medium dark:text-gray-100">{p.name}</td>
                    <td className="px-5 py-3 hidden md:table-cell text-gray-600">{p.founder_name || '—'}</td>
                    <td className="px-5 py-3 hidden md:table-cell text-gray-600">{p.sector || '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{p.deleted_at ? new Date(p.deleted_at).toLocaleDateString() : '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1 ${urgent ? 'text-amber-700' : 'text-gray-600'}`}>
                        {urgent && <AlertTriangle size={12} />}
                        {dl === null ? '—' : `${dl} day${dl === 1 ? '' : 's'}`}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleRestore(p)}
                        disabled={busy === p.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                        title="Restore startup"
                      >
                        <RotateCcw size={12} /> Restore
                      </button>
                      <button
                        onClick={() => handleHardDelete(p)}
                        disabled={busy === p.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 ml-1 text-xs rounded text-red-700 hover:bg-red-50 disabled:opacity-50"
                        title="Permanently delete"
                      >
                        <Trash2 size={12} /> Delete forever
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-2 rounded-lg shadow-lg text-sm text-white ${
          toast.kind === 'error' ? 'bg-red-600' : 'bg-violet-600'
        }`} role="status">
          {toast.msg || (typeof toast === 'string' ? toast : '')}
        </div>
      )}
    </div>
  );
}
