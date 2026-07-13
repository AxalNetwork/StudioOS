// Fit v2 — stage rail for the staged assessment flow. Renders the ordered
// stages plus the trailing Review step, with per-stage progress; horizontal
// chip row on mobile, vertical rail on desktop.
import React from 'react';
import { Check } from 'lucide-react';

export default function FitStageStepper({ stages, progress, currentKey, onSelect }) {
  const steps = [...stages, { key: 'review', label: 'Review & submit' }];
  return (
    <nav className="flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0" aria-label="Assessment stages">
      {steps.map((s, i) => {
        const p = progress?.[s.key];
        const done = p && p.total > 0 && p.answered >= p.total;
        const active = s.key === currentKey;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onSelect(s.key)}
            className={
              active
                ? 'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap bg-violet-600 text-white dark:bg-violet-500'
                : 'flex items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            }
          >
            <span
              className={
                done && !active
                  ? 'w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center flex-shrink-0'
                  : active
                    ? 'w-5 h-5 rounded-full bg-white/20 text-white text-xs font-semibold flex items-center justify-center flex-shrink-0'
                    : 'w-5 h-5 rounded-full border border-gray-300 dark:border-gray-600 text-xs text-gray-500 dark:text-gray-400 flex items-center justify-center flex-shrink-0'
              }
            >
              {done && !active ? <Check size={12} /> : i + 1}
            </span>
            <span>{s.label}</span>
            {p && p.total > 0 ? (
              <span className={active ? 'text-xs text-white/80' : 'text-xs text-gray-400 dark:text-gray-500'}>
                {p.answered}/{p.total}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
