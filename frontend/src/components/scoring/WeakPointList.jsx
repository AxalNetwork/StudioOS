// Weak-point analysis — card body only (the page supplies the card shell and
// section label).
//
// The design's per-item "effort" estimate (~6 hours / Week 4) and risk flag
// ("Team composition risk") have no backing: there is no effort model, and
// /venture-risk/* is 403 for a lab member. They are absent from the view
// model entirely, so nothing here can render a placeholder for them. The
// impact figure IS real — it is the engine's own `max − total` arithmetic.

import { Link } from 'react-router-dom';
import { Lock, TrendingUp } from 'lucide-react';

export default function WeakPointList({ weakPoints, investorView, clear, overflowNote }) {
  if (clear) {
    return (
      <p className="text-[12.5px] text-gray-500 dark:text-gray-400 py-4 text-center" data-testid="weakpoints-clear">
        Every dimension is at High level — no weak points at the current thresholds.
      </p>
    );
  }
  if (!weakPoints || !weakPoints.length) return null;

  return (
    <div className="space-y-2.5">
      {weakPoints.map((w) => (
        <div
          key={w.key}
          className="grid grid-cols-[26px_1fr_auto] gap-3 items-start rounded-xl border border-gray-100 dark:border-gray-800 p-3"
          data-testid={`weakpoint-${w.key}`}
        >
          <span className={`w-6 h-6 flex-none rounded-lg text-[11.5px] font-extrabold flex items-center justify-center tabular-nums ${w.rankStyle}`}>{w.rank}</span>
          <div className="min-w-0">
            <div className="text-[12.5px] font-bold text-gray-900 dark:text-gray-50">{w.dim}</div>
            <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-1 leading-snug">{w.gap}</p>
            <span className="inline-flex items-center gap-1 mt-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
              <TrendingUp size={11} /> {w.impact}
            </span>
          </div>
          {/* Investor view hides the fix-it link but keeps the lock note —
              hiding true metadata from an investor would itself be
              dishonest (preserve item E13). */}
          {w.actionLocked ? (
            <span className="flex-none self-center inline-flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500" data-testid={`lock-weakpoint-${w.key}`}>
              <Lock size={11} /> {w.lockLabel}
            </span>
          ) : (
            !investorView && w.actionTo && (
              <Link
                to={w.actionTo}
                className="flex-none self-center whitespace-nowrap text-[11.5px] font-semibold text-violet-600 dark:text-violet-300 border border-violet-200 dark:border-violet-800 rounded-lg px-2.5 py-1.5 hover:bg-violet-50 dark:hover:bg-violet-900/30"
                data-testid={`link-weakpoint-${w.key}`}
              >
                {w.actionLabel} →
              </Link>
            )
          )}
        </div>
      ))}
      {/* The list is capped at 4 (design); all six dimensions can be below the
          Tier-2 pace, so say so rather than truncating silently. */}
      {overflowNote && (
        <p className="text-[10.5px] text-gray-400 dark:text-gray-500 pt-1" data-testid="weakpoints-overflow">{overflowNote}</p>
      )}
    </div>
  );
}
