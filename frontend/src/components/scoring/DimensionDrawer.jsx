// Per-dimension drill-down drawer.
//
// "Contributing evidence" is the snapshot's real sub-factor points. The
// design's per-evidence source attribution ("from Market Intel") is omitted —
// no attribution table exists and inputs_json is stripped for non-admins — so
// one run-level caption stands in for it.
//
// The design's Team-only panels are restored in ./TeamCoveragePanel from the
// connection-free self-scoped endpoints (GET /radar/me, GET
// /assessment/results/me). The two halves that genuinely require a connected
// co-founder — the second founder column and the pair values-alignment bars —
// are replaced there by a stated reason, never by placeholder numbers.

import { Link } from 'react-router-dom';
import { AlertCircle, Check, Lock, X } from 'lucide-react';
import { DIM_ICONS } from './dimIcons';
import TeamCoveragePanel from './TeamCoveragePanel';

const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';

export default function DimensionDrawer({ dim, investorView, onClose, skillState, archetypeState }) {
  if (!dim) return null;
  const Icon = DIM_ICONS[dim.iconKey] || null;

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-gray-900/30 backdrop-blur-[2px]" onClick={onClose} data-testid="scoring-drawer-scrim" />
      <aside
        className="fixed inset-y-0 right-0 z-[61] w-full lg:w-[460px] bg-white dark:bg-gray-900 shadow-2xl overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-label={`${dim.name} drill-down`}
        data-testid="scoring-drawer"
      >
        <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className={`w-9 h-9 flex-none rounded-[9px] flex items-center justify-center ${dim.tintClass || 'bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400'}`}>
              {Icon && <Icon size={16} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-extrabold tracking-tight text-gray-900 dark:text-gray-50">{dim.name}</div>
              <div className="text-[11.5px] text-gray-400 dark:text-gray-500" data-testid="text-drawer-meta">
                Weight {dim.weightLabel} · {dim.confidence} · {dim.total}/{dim.max} pts
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              data-testid="button-close-drawer"
              className="w-8 h-8 flex-none rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <X size={14} />
            </button>
          </div>
          <div className="mt-3.5 flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <div className={`h-full rounded-full ${dim.scoreBarClass}`} style={{ width: dim.scorePct }} />
            </div>
            <span className={`text-[22px] font-extrabold tabular-nums ${dim.scoreTextClass}`} data-testid="text-drawer-score">{dim.score}</span>
          </div>
        </div>

        <div className="px-5 py-5">
          <div className={`${LBL} mb-1`}>Contributing evidence</div>
          <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-2.5">{dim.evidenceCaption}</p>
          <div className="space-y-2 mb-6">
            {dim.evidence.map((e) => (
              <div
                key={e.id}
                className="flex items-start gap-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 px-3 py-2.5"
                data-testid={`drawer-evidence-${e.id}`}
              >
                {e.good
                  ? <Check size={14} className="flex-none mt-0.5 text-emerald-600 dark:text-emerald-400" />
                  : <AlertCircle size={14} className="flex-none mt-0.5 text-amber-600 dark:text-amber-500" />}
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-gray-700 dark:text-gray-200">{e.text}</div>
                  <div className="text-[10.5px] text-gray-400 dark:text-gray-500 tabular-nums">{e.points}/{e.max} points</div>
                </div>
              </div>
            ))}
          </div>

          {dim.isTeam && (
            <TeamCoveragePanel
              skillState={skillState}
              archetypeState={archetypeState}
              profilingTo={dim.fixTo}
              profilingUnlocked={dim.fixUnlocked}
              investorView={investorView}
            />
          )}

          <div className={`${LBL} mb-1.5`}>What&apos;s missing</div>
          <p className="text-[12px] text-gray-600 dark:text-gray-300 leading-relaxed mb-4" data-testid="text-drawer-missing">{dim.missing}</p>

          {!dim.fixUnlocked ? (
            <div className="w-full rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 text-[12.5px] font-semibold py-3 flex items-center justify-center gap-1.5" data-testid="lock-drawer-fix">
              <Lock size={13} /> {dim.fixLabel ? `${dim.fixLabel} locked` : 'Locked'}
            </div>
          ) : (
            !investorView && dim.fixTo && (
              <Link
                to={dim.fixTo}
                data-testid="link-drawer-fix"
                className="block w-full text-center rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-semibold py-3"
              >
                {dim.fixLabel} →
              </Link>
            )
          )}
        </div>
      </aside>
    </>
  );
}
