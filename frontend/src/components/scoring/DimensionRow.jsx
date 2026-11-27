// One weakest-first dimension row (design grid 34px / 1fr / auto).
//
// Stays a role="button" div rather than a <button> so the nested fix-it
// <Link> remains a real link; the keyboard handler is guarded on
// e.target === e.currentTarget so Enter on the link doesn't also open the
// drawer.
//
// The pill after the weight is the SCORE BAND ("High band"), not a
// confidence measure — the engine stores no per-dimension confidence.

import { Link } from 'react-router-dom';
import { ArrowRight, ChevronRight, Lock } from 'lucide-react';
import { DIM_ICONS } from './dimIcons';

export default function DimensionRow({ dim, investorView, onOpen }) {
  if (!dim) return null;
  const Icon = DIM_ICONS[dim.iconKey] || null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(dim.key)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen(dim.key);
        }
      }}
      className="grid grid-cols-[34px_1fr_auto] gap-3 items-start rounded-xl border border-gray-100 dark:border-gray-800 p-3.5 cursor-pointer hover:bg-violet-50/40 dark:hover:bg-gray-800/50 hover:border-violet-200 dark:hover:border-violet-800 transition-colors"
      data-testid={`dimension-row-${dim.key}`}
    >
      {/* Per-dimension tint (design L371 tint map), carried on the view model. */}
      <span className={`w-[34px] h-[34px] flex-none rounded-[9px] flex items-center justify-center ${dim.tintClass || 'bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400'}`}>
        {Icon && <Icon size={16} />}
      </span>

      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-bold tracking-tight text-gray-900 dark:text-gray-50">{dim.name}</span>
          <span className="text-[10.5px] font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5">{dim.weightLabel}</span>
          <span className={`text-[10.5px] font-semibold rounded-full px-2 py-0.5 ${dim.confStyle}`} data-testid={`band-${dim.key}`}>{dim.confidence}</span>
        </div>
        <div className="flex items-center gap-2.5 mt-2">
          <div className="flex-1 max-w-[280px] h-[7px] rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div className={`h-full rounded-full ${dim.scoreBarClass}`} style={{ width: dim.scorePct }} />
          </div>
          <span className={`text-[13px] font-extrabold tabular-nums min-w-[26px] ${dim.scoreTextClass}`} data-testid={`score-${dim.key}`}>{dim.score}</span>
        </div>
        <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-2 leading-snug">{dim.weakLine}</div>
      </div>

      <div className="flex flex-col items-end gap-2">
        <ChevronRight size={16} aria-hidden="true" className="flex-none text-gray-300 dark:text-gray-600" />
        {dim.fixUnlocked ? (
          !investorView && dim.fixTo && (
            <Link
              to={dim.fixTo}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 whitespace-nowrap text-[11.5px] font-semibold text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 rounded-md px-2.5 py-1.5"
              data-testid={`link-fix-${dim.key}`}
            >
              Fix it <ArrowRight size={12} />
            </Link>
          )
        ) : (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-gray-400 dark:text-gray-500" data-testid={`lock-fix-${dim.key}`}>
            <Lock size={11} /> {dim.fixLabel ? `${dim.fixLabel} locked` : 'Locked'}
          </span>
        )}
      </div>
    </div>
  );
}
