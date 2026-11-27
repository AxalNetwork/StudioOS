import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, ChevronDown, ChevronUp, X, ArrowRight, SkipForward } from 'lucide-react';
import { api } from '../lib/api';
import Confetti from './Confetti';

/**
 * Task #6 (IF) — Persistent onboarding checklist panel.
 *
 * Rendered top-right of the Dashboard for every signed-in user. Pulls
 * `/api/onboarding/checklist` on mount + after each user action and shows:
 *   - progress bar `N / 10`
 *   - next 3 pending rows with click-through routing
 *   - manual complete / skip controls in expanded mode
 *   - one-time confetti when the user crosses the 8/10 threshold
 *
 * Collapsed state is persisted server-side (`onboarding_meta.panel_collapsed`).
 */
export default function OnboardingChecklistPanel() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.getOnboardingChecklist();
      setData(d);
      setCollapsed(!!d?.meta?.panel_collapsed);
      if (d?.meta?.should_celebrate) {
        setCelebrate(true);
        // Persist server-side so it doesn't re-fire on next mount.
        api.patchOnboardingMeta({ celebration_shown: true }).catch(() => {});
      }
    } catch (e) {
      // Silent — panel just won't appear.
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleCollapsed = useCallback(async () => {
    const next = !collapsed;
    setCollapsed(next);
    api.patchOnboardingMeta({ panel_collapsed: next }).catch(() => {});
  }, [collapsed]);

  const onRowClick = useCallback((row) => {
    if (row.route) navigate(row.route);
  }, [navigate]);

  const onComplete = useCallback(async (e, row) => {
    e.stopPropagation();
    try { await api.completeOnboardingItem(row.key); } catch {}
    load();
  }, [load]);

  const onSkip = useCallback(async (e, row) => {
    e.stopPropagation();
    try { await api.skipOnboardingItem(row.key); } catch {}
    load();
  }, [load]);

  if (loading || !data || hidden) return null;

  const pct = Math.round((data.completed / data.total) * 100);
  const done = data.completed >= data.total;

  return (
    <>
      {celebrate && <Confetti onDone={() => setCelebrate(false)} />}
      <div
        className="w-full lg:w-80 lg:max-w-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm overflow-hidden"
        data-tour="onboarding-checklist"
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          className="w-full flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-900/30 dark:to-indigo-900/30 border-b border-gray-200 dark:border-gray-700"
          aria-expanded={!collapsed}
        >
          <div className="flex-1 text-left">
            <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">
              {done ? "You're all set!" : `Onboarding · ${data.completed} / ${data.total}`}
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          {collapsed ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronUp size={14} className="text-gray-500" />}
          {done && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Dismiss onboarding panel"
              onClick={(e) => { e.stopPropagation(); setHidden(true); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setHidden(true); } }}
              className="ml-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer"
            >
              <X size={14} />
            </span>
          )}
        </button>

        {!collapsed && (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {(data.next.length === 0 ? data.items.filter((it) => it.status === 'completed').slice(-3) : data.next).map((row) => (
              <div
                key={row.key}
                onClick={() => onRowClick(row)}
                className="flex items-start gap-2 px-3 py-2.5 hover:bg-violet-50/40 dark:hover:bg-violet-900/10 cursor-pointer group"
              >
                {row.status === 'completed' ? (
                  <CheckCircle2 size={16} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                ) : (
                  <Circle size={16} className="text-gray-400 mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-medium ${row.status === 'completed' ? 'text-gray-500 line-through' : 'text-gray-900 dark:text-gray-100'}`}>
                    {row.label}
                  </div>
                </div>
                {row.status === 'pending' && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => onComplete(e, row)}
                      className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded"
                      title="Mark complete"
                    ><CheckCircle2 size={13} /></button>
                    <button
                      type="button"
                      onClick={(e) => onSkip(e, row)}
                      className="p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                      title="Skip"
                    ><SkipForward size={13} /></button>
                  </div>
                )}
                {row.status === 'pending' && (
                  <ArrowRight size={13} className="text-gray-400 group-hover:text-violet-600 mt-0.5 flex-shrink-0" />
                )}
              </div>
            ))}
            <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900/50">
              <a
                href="/account/onboarding"
                onClick={(e) => { e.preventDefault(); navigate('/account/onboarding'); }}
                className="text-[11px] text-violet-700 dark:text-violet-300 hover:underline"
              >
                See full checklist →
              </a>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
