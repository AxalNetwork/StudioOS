import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, SkipForward, RotateCcw, Play, ArrowRight, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

/**
 * Task #6 (IF) — Settings → Onboarding tab.
 *
 * Renders the full checklist (10 rows) with manual complete/skip and
 * exposes "Re-run product tour" + "Reset checklist". This is the only
 * surface where the user can re-fire the 5-step tour after first login.
 */
export default function OnboardingSettingsTab() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.getOnboardingChecklist();
      setData(d);
    } catch (e) {
      setMsg(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flip = async (key, action) => {
    setBusy(true);
    try {
      if (action === 'complete') await api.completeOnboardingItem(key);
      else await api.skipOnboardingItem(key);
      await load();
    } finally { setBusy(false); }
  };

  const reset = async () => {
    if (!window.confirm('Reset your onboarding checklist? This clears manual and auto-detected completions; auto-detect will re-fire on next dashboard load.')) return;
    setBusy(true);
    try {
      await api.resetOnboardingChecklist();
      setMsg('Checklist reset.');
      await load();
    } finally { setBusy(false); }
  };

  const rerunTour = async () => {
    setBusy(true);
    try {
      await api.patchOnboardingMeta({ rerun_tour: true });
      setMsg('Tour will re-run on your next dashboard load.');
      // Take the user there so the tour fires immediately.
      setTimeout(() => navigate('/dashboard'), 600);
    } finally { setBusy(false); }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="animate-spin" size={14} /> Loading…</div>;
  }
  if (!data) {
    return <div className="text-sm text-red-600">{msg || 'Checklist unavailable.'}</div>;
  }

  const pct = Math.round((data.completed / data.total) * 100);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Onboarding</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {data.completed} of {data.total} complete · {pct}%
        </p>
        <div className="mt-2 h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-violet-500 to-indigo-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {msg && (
        <div className="text-xs px-3 py-2 rounded bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-200">{msg}</div>
      )}

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
        {data.items.map((row) => (
          <div key={row.key} className="flex items-start gap-3 px-3 py-3">
            {row.status === 'completed' ? (
              <CheckCircle2 size={18} className="text-emerald-500 mt-0.5 flex-shrink-0" />
            ) : row.status === 'skipped' ? (
              <SkipForward size={18} className="text-gray-400 mt-0.5 flex-shrink-0" />
            ) : (
              <Circle size={18} className="text-gray-400 mt-0.5 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-medium ${row.status === 'completed' ? 'text-gray-500 line-through' : 'text-gray-900 dark:text-gray-100'}`}>
                {row.label}
              </div>
              {row.source === 'auto' && (
                <div className="text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mt-0.5">Auto-detected</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {row.route && (
                <button
                  type="button"
                  onClick={() => navigate(row.route)}
                  className="text-xs flex items-center gap-1 px-2 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
                ><ArrowRight size={11} /> Go</button>
              )}
              {row.status !== 'completed' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => flip(row.key, 'complete')}
                  className="text-xs px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white"
                >Mark done</button>
              )}
              {row.status === 'pending' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => flip(row.key, 'skip')}
                  className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 text-gray-600 dark:text-gray-300"
                >Skip</button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <button
          type="button"
          disabled={busy}
          onClick={rerunTour}
          className="text-sm flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
        ><Play size={13} /> Re-run product tour</button>
        <button
          type="button"
          disabled={busy}
          onClick={reset}
          className="text-sm flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 disabled:opacity-50"
        ><RotateCcw size={13} /> Reset checklist</button>
      </div>
    </div>
  );
}
