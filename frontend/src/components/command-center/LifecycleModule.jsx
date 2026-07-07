/**
 * LifecycleModule — the founder-facing heart of the Command Center Overview.
 *
 * Renders a 6-stage lifecycle rail (idea → validate → build → launch → grow →
 * raise), a "next best action", any advance-stage suggestions, and the current
 * stage's checklist. The stage + manual check-offs are founder-editable and
 * persist via the parent's `onSetStage` / `onToggleCheck` (PUT
 * /progress/lifecycle/:id). Auto-derived checklist items (manual: false) are
 * read-only mirrors of observable signals and deep-link to the surface that
 * moves them.
 *
 * All state lives in the `lifecycle` prop (the GET response); this component is
 * presentational + optimistic-free (it awaits the parent's refetch).
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRight, Sparkles } from 'lucide-react';

export default function LifecycleModule({ lifecycle, canEdit = false, onSetStage, onToggleCheck }) {
  const [pending, setPending] = useState({});
  const [stagePending, setStagePending] = useState(false);

  if (!lifecycle) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 text-sm text-gray-500 dark:text-gray-400">
        Lifecycle data is unavailable right now.
      </div>
    );
  }

  const { stage, stored, stages = [], checklist = [], suggestions = [] } = lifecycle;
  const currentIdx = stages.findIndex((s) => s.id === stage);
  const currentMeta = currentIdx >= 0 ? stages[currentIdx] : null;
  const nextAction = checklist.find((i) => !i.done);

  const handleStage = async (id) => {
    if (!canEdit || id === stage || stagePending || typeof onSetStage !== 'function') return;
    setStagePending(true);
    try {
      await onSetStage(id);
    } finally {
      setStagePending(false);
    }
  };

  const handleToggle = async (item) => {
    if (!canEdit || !item.manual || typeof onToggleCheck !== 'function') return;
    setPending((p) => ({ ...p, [item.key]: true }));
    try {
      await onToggleCheck(item.key, !item.done);
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[item.key];
        return next;
      });
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-5" data-testid="lifecycle-module">
      {/* Header + auto-detected hint */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Startup lifecycle</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {currentMeta ? currentMeta.goal : 'Track where your venture is and what to do next.'}
          </p>
        </div>
        {!stored && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-900/30 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            <Sparkles size={12} /> Auto-detected — confirm your stage
          </span>
        )}
      </div>

      {/* Stage rail */}
      <ol className="flex flex-wrap gap-1.5">
        {stages.map((s, idx) => {
          const state = idx < currentIdx ? 'done' : idx === currentIdx ? 'current' : 'upcoming';
          const tone =
            state === 'done'
              ? 'bg-violet-600 text-white'
              : state === 'current'
                ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-200 ring-2 ring-violet-500'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400';
          return (
            <li key={s.id} className="flex-1 min-w-[92px]">
              <button
                type="button"
                disabled={!canEdit || stagePending}
                onClick={() => handleStage(s.id)}
                aria-current={state === 'current' ? 'step' : undefined}
                title={canEdit ? `Set stage to ${s.label}` : s.label}
                className={`w-full rounded-lg px-3 py-2 text-left transition-opacity ${tone} ${
                  canEdit ? 'hover:opacity-90' : ''
                } disabled:cursor-default disabled:opacity-70`}
              >
                <span className="flex items-center gap-1 text-[11px] uppercase tracking-wide opacity-80">
                  {state === 'done' && <Check size={11} />} Step {idx + 1}
                </span>
                <span className="block text-sm font-semibold">{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Advance suggestions */}
      {suggestions.map((sg) => {
        const target = stages.find((s) => s.id === sg.to);
        return (
          <div
            key={sg.to}
            className="flex items-center justify-between gap-3 rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/20 px-4 py-3"
          >
            <p className="text-sm text-violet-800 dark:text-violet-200">{sg.reason}</p>
            {canEdit && target && (
              <button
                type="button"
                onClick={() => handleStage(sg.to)}
                disabled={stagePending}
                className="shrink-0 inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
              >
                Move to {target.label} <ArrowRight size={14} />
              </button>
            )}
          </div>
        );
      })}

      {/* Next best action */}
      {nextAction && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Next best action</p>
          <div className="mt-1 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{nextAction.label}</p>
            {nextAction.manual ? (
              canEdit && (
                <button
                  type="button"
                  onClick={() => handleToggle(nextAction)}
                  disabled={!!pending[nextAction.key]}
                  className="shrink-0 inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
                >
                  <Check size={14} /> Mark done
                </button>
              )
            ) : (
              nextAction.href && (
                <Link
                  to={nextAction.href}
                  className="shrink-0 inline-flex items-center gap-1 rounded-md border border-violet-300 dark:border-violet-700 px-3 py-1.5 text-sm font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20"
                >
                  Go <ArrowRight size={14} />
                </Link>
              )
            )}
          </div>
        </div>
      )}

      {/* Checklist */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {currentMeta ? `${currentMeta.label} checklist` : 'Checklist'}
        </p>
        <ul className="space-y-1.5">
          {checklist.map((item) => {
            const busy = !!pending[item.key];
            const interactive = item.manual && canEdit;
            return (
              <li
                key={item.key}
                className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/50"
              >
                <button
                  type="button"
                  disabled={!interactive || busy}
                  onClick={() => handleToggle(item)}
                  aria-pressed={!!item.done}
                  title={
                    item.manual
                      ? item.done
                        ? 'Mark not done'
                        : 'Mark done'
                      : 'Updates automatically from your activity'
                  }
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded border transition-colors ${
                    item.done
                      ? 'border-violet-600 bg-violet-600 text-white'
                      : 'border-gray-300 text-transparent dark:border-gray-600'
                  } ${interactive ? 'cursor-pointer' : 'cursor-default'} disabled:opacity-60`}
                >
                  <Check size={13} />
                </button>
                <span
                  className={`flex-1 text-sm ${
                    item.done
                      ? 'text-gray-500 line-through dark:text-gray-400'
                      : 'text-gray-800 dark:text-gray-200'
                  }`}
                >
                  {item.label}
                </span>
                {!item.manual && (
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">auto</span>
                )}
                {item.href && (
                  <Link
                    to={item.href}
                    title="Open"
                    className="shrink-0 text-gray-400 hover:text-violet-600 dark:hover:text-violet-300"
                  >
                    <ArrowRight size={14} />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
