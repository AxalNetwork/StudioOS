import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { XCircle, CheckCircle2, Search, RefreshCw, Sparkles, Loader2 } from 'lucide-react';
import { useToast } from '../../../components/useToast';
import { ConsoleUnreadable } from './shared';

/**
 * D648 (#1448) — the Directory console. Loads only its own rows.
 */

// Admin-managed Service Provider Directory approval (Task #53).
// Lists every partner with their current listed/featured flags and
// lets the admin flip either one. Featuring without listing is
// auto-corrected server-side because the public /directory route
// hides any row where listed=0.
export function DirectoryPanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  // D648 — a failed read is said, never drawn as an empty list.
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [q, setQ] = useState('');
  const { toast, showToast } = useToast(3000);

  const load = useCallback(async (query = '') => {
    setLoading(true);
    try {
      const r = await api.adminListDirectoryPartners(query);
      setRows(r.partners || []);
      setFailed(false);
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Failed to load partners' });
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (partner, patch) => {
    setBusyId(partner.id);
    try {
      const r = await api.adminSetPartnerDirectory(partner.id, patch);
      setRows((prev) => prev.map((p) => p.id === partner.id ? {
        ...p,
        directory_listed:   r.partner.listed   ? 1 : 0,
        directory_featured: r.partner.featured ? 1 : 0,
      } : p));
      const which = 'listed' in patch ? (r.partner.listed ? 'Approved for directory' : 'Removed from directory')
                                      : (r.partner.featured ? 'Featured' : 'Unfeatured');
      showToast({ kind: 'ok', msg: `${partner.name}: ${which}` });
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Update failed' });
    } finally {
      setBusyId(null);
    }
  };

  const approvedCount = rows.filter(r => r.directory_listed).length;
  const featuredCount = rows.filter(r => r.directory_featured).length;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 flex-wrap dark:border-gray-800">
        <Sparkles size={16} className="text-gray-600" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Service Provider Directory</h3>
        <span className="text-xs text-gray-500">
          {approvedCount} approved · {featuredCount} featured · {rows.length} total
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search" value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') load(q); }}
              placeholder="Search name / company / email"
              className="pl-7 pr-2 py-1 text-xs border border-gray-300 rounded-md w-60 dark:border-gray-700"
            />
          </div>
          <button onClick={() => load(q)}
            className="text-xs px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-700 inline-flex items-center gap-1 dark:text-gray-300">
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </div>
      <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100 bg-gray-50/50">
        <strong>Approved</strong> partners appear on the public <code>/directory</code> page.
        <strong className="ml-2">Featured</strong> partners are promoted above standard rows
        (featured implies approved).
      </div>
      {loading ? (
        <div className="p-8 text-center text-gray-500 text-sm inline-flex items-center justify-center gap-2 w-full">
          <Loader2 size={14} className="animate-spin" /> Loading partners…
        </div>
      ) : failed ? (
        <ConsoleUnreadable what="The directory" onRetry={() => load()} />
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-gray-500 text-sm">No partners found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800">
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Partner</th>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Specialization</th>
                <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Status</th>
                <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Approved</th>
                <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Featured</th>
                <th className="text-right px-4 py-2.5 text-gray-600 font-medium text-xs">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const isListed = !!p.directory_listed;
                const isFeatured = !!p.directory_featured;
                const busy = busyId === p.id;
                return (
                  <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{p.name}</div>
                      <div className="text-xs text-gray-500">{p.company || '—'} · {p.email}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-xs dark:text-gray-300">{p.specialization || <span className="text-gray-400">—</span>}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${p.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isListed
                        ? <CheckCircle2 size={16} className="text-emerald-600 inline" />
                        : <XCircle size={16} className="text-gray-300 inline" />}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isFeatured
                        ? <Sparkles size={14} className="text-amber-500 inline" />
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1.5">
                        <button
                          disabled={busy}
                          onClick={() => toggle(p, { listed: !isListed })}
                          className={`px-2 py-1 text-xs rounded-md font-medium transition-colors disabled:opacity-50 ${
                            isListed
                              ? 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}>
                          {isListed ? 'Remove' : 'Approve'}
                        </button>
                        <button
                          disabled={busy || (!isListed && !isFeatured)}
                          title={!isListed ? 'Approve the partner first' : ''}
                          onClick={() => toggle(p, { featured: !isFeatured })}
                          className={`px-2 py-1 text-xs rounded-md font-medium transition-colors disabled:opacity-40 ${
                            isFeatured
                              ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}>
                          {isFeatured ? 'Unfeature' : 'Feature'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {toast && (
        <div className={`fixed bottom-4 right-4 px-3 py-2 rounded-lg text-sm shadow-lg ${
          toast.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        }`}>{toast.msg}</div>
      )}
    </div>
  );
}

export default DirectoryPanel;
