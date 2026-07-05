import React from 'react';
import { Rocket, Compass } from 'lucide-react';

/**
 * SignalModeToggle — switch between Founder and Advisor/Mentor modes.
 *
 * Both modes read the SAME signals; the mode only changes default ordering
 * (founder → tie-break to buildability, advisor → tie-break to confidence) and
 * the framing copy shown on each card. This is a segmented control, not two
 * separate products.
 */
const MODES = [
  { value: 'founder', label: 'Founder', icon: Rocket, hint: 'What should I build next?' },
  { value: 'advisor', label: 'Advisor', icon: Compass, hint: 'What should I point founders toward?' },
];

export default function SignalModeToggle({ mode, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Signals mode"
      className="inline-flex items-center gap-1 p-1 rounded-xl bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
    >
      {MODES.map((m) => {
        const active = mode === m.value;
        const Icon = m.icon;
        return (
          <button
            key={m.value}
            role="tab"
            aria-selected={active}
            title={m.hint}
            onClick={() => onChange(m.value)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              active
                ? 'bg-white dark:bg-gray-900 text-violet-700 dark:text-violet-300 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <Icon size={15} aria-hidden="true" />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
