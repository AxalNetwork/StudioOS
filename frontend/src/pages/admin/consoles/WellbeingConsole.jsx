import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { XCircle, Search, RefreshCw, Loader2, Heart, Eye, EyeOff, BadgeCheck } from 'lucide-react';
import { useToast } from '../../../components/useToast';
import { ConsoleUnreadable } from './shared';

/**
 * D648 (#1448) — the Wellbeing experts roster.
 */

/**
 * The roster's name cell. D643 — a sample from the development seed is marked
 * "Sample": it is not a person, and no member list shows or counts it.
 */
export function WellbeingExpertName({ expert: e }) {
  return (
    <>
      <div className="font-medium text-gray-900 dark:text-gray-100">
        {e.name}
        {e.is_sample && (
          <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" data-testid={`admin-wellbeing-sample-${e.uid}`}>Sample</span>
        )}
      </div>
      <div className="text-xs text-gray-500">{e.headline || <span className="text-gray-400">—</span>}</div>
    </>
  );
}

export function WellbeingExpertsPanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  // D648 — a failed read is said, never drawn as an empty list.
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all'); // all | hidden | unverified | verified
  const { toast, showToast } = useToast(3000);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Admins receive every active expert (verified + unverified + hidden)
      // from this endpoint — see routes/wellbeing.ts.
      const r = await api.wellbeingExperts({ limit: 50 });
      setRows(r.matches || []);
      setFailed(false);
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Failed to load experts' });
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const toggleHide = async (expert) => {
    setBusyId(expert.uid);
    try {
      const next = !expert.hidden;
      const r = await api.wellbeingAdminHide(expert.uid, next);
      setRows((prev) => prev.map((e) => e.uid === expert.uid ? { ...e, hidden: !!r.hidden } : e));
      showToast({ kind: 'ok', msg: `${expert.name}: ${r.hidden ? 'Hidden from directory' : 'Restored to directory'}` });
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Update failed' });
    } finally {
      setBusyId(null);
    }
  };

  const toggleVerify = async (expert) => {
    setBusyId(expert.uid);
    try {
      const next = !expert.verified;
      const r = await api.wellbeingAdminVerify(expert.uid, next);
      setRows((prev) => prev.map((e) => e.uid === expert.uid ? { ...e, verified: !!r.verified } : e));
      showToast({ kind: 'ok', msg: `${expert.name}: ${r.verified ? 'Verified' : 'Verification removed'}` });
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Update failed' });
    } finally {
      setBusyId(null);
    }
  };

  const verifiedCount = rows.filter((r) => r.verified).length;
  const hiddenCount = rows.filter((r) => r.hidden).length;
  const sampleCount = rows.filter((r) => r.is_sample).length;

  const needle = q.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (filter === 'hidden' && !r.hidden) return false;
    if (filter === 'unverified' && r.verified) return false;
    if (filter === 'verified' && !r.verified) return false;
    if (!needle) return true;
    return (r.name || '').toLowerCase().includes(needle)
      || (r.headline || '').toLowerCase().includes(needle)
      || (r.uid || '').toLowerCase().includes(needle);
  });

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 flex-wrap dark:border-gray-800">
        <Heart size={16} className="text-rose-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Wellbeing Experts</h3>
        <span className="text-xs text-gray-500">
          {verifiedCount} verified · {hiddenCount} hidden · {rows.length} total{sampleCount ? ` · ${sampleCount} sample` : ''}
        </span>
        {/* D570 — the resource library members read under Wellbeing. */}
        <Link to="/admin/wellbeing/resources" className="text-xs font-semibold text-violet-700 hover:underline dark:text-violet-300" data-testid="link-admin-wellbeing-library">
          Resource library →
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white dark:border-gray-700 dark:bg-gray-900"
            data-testid="admin-wellbeing-filter"
          >
            <option value="all">All</option>
            <option value="unverified">Unverified</option>
            <option value="verified">Verified</option>
            <option value="hidden">Hidden</option>
          </select>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search" value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name / headline"
              className="pl-7 pr-2 py-1 text-xs border border-gray-300 rounded-md w-56 dark:border-gray-700"
            />
          </div>
          <button onClick={load}
            className="text-xs px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-700 inline-flex items-center gap-1 dark:text-gray-300">
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </div>
      <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100 bg-gray-50/50">
        Hidden experts are removed from the public directory. Only <strong>verified</strong> experts with profile
        completion ≥ 70% appear to founders.
      </div>
      {loading ? (
        <div className="p-8 text-center text-gray-500 text-sm inline-flex items-center justify-center gap-2 w-full">
          <Loader2 size={14} className="animate-spin" /> Loading experts…
        </div>
      ) : failed ? (
        <ConsoleUnreadable what="The experts" onRetry={() => load()} />
      ) : visible.length === 0 ? (
        <div className="p-8 text-center text-gray-500 text-sm">No experts match the current filter.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800">
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Expert</th>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Categories</th>
                <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Completion</th>
                <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Rating</th>
                <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Verified</th>
                <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Hidden</th>
                <th className="text-right px-4 py-2.5 text-gray-600 font-medium text-xs">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => {
                const busy = busyId === e.uid;
                const cats = Array.isArray(e.categories) ? e.categories : [];
                return (
                  <tr key={e.uid} className="border-b border-gray-100 hover:bg-gray-50/50" data-testid={`admin-wellbeing-row-${e.uid}`}>
                    <td className="px-4 py-3">
                      <WellbeingExpertName expert={e} />
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-xs dark:text-gray-300">
                      {cats.length ? cats.slice(0, 3).join(', ') : <span className="text-gray-400">—</span>}
                      {cats.length > 3 && <span className="text-gray-400"> +{cats.length - 3}</span>}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-gray-700 dark:text-gray-300">
                      {Math.round(e.profile_completion_pct || 0)}%
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-gray-700 dark:text-gray-300">
                      {e.rating_count
                        ? <>{(e.rating_avg || 0).toFixed(1)} <span className="text-gray-400">({e.rating_count})</span></>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {e.verified
                        ? <BadgeCheck size={16} className="text-emerald-600 inline" />
                        : <XCircle size={16} className="text-gray-300 inline" />}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {e.hidden
                        ? <EyeOff size={16} className="text-rose-600 inline" />
                        : <Eye size={16} className="text-gray-300 inline" />}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1.5">
                        <button
                          disabled={busy}
                          onClick={() => toggleVerify(e)}
                          data-testid={`admin-wellbeing-verify-${e.uid}`}
                          className={`px-2 py-1 text-xs rounded-md font-medium transition-colors disabled:opacity-50 ${
                            e.verified
                              ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}>
                          {e.verified ? 'Unverify' : 'Verify'}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => toggleHide(e)}
                          data-testid={`admin-wellbeing-hide-${e.uid}`}
                          className={`px-2 py-1 text-xs rounded-md font-medium transition-colors disabled:opacity-50 ${
                            e.hidden
                              ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                              : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                          }`}>
                          {e.hidden ? 'Unhide' : 'Hide'}
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

export default WellbeingExpertsPanel;
