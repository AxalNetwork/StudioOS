// Single source of truth for the co-founder agreement status styling.
// The six statuses are defined in lib/cofounderAgreementViewModel.js (STATUS).
import React from 'react';
import { STATUS } from '../../lib/cofounderAgreementViewModel';

/** Tone → Tailwind pill classes. Every literal carries its dark: counterpart. */
export const TONE = {
  emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  gray: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300',
};

/** Tone → tinted card surface (snapshot tiles). */
export const TONE_CARD = {
  emerald: 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-900/15',
  violet: 'border-violet-200 bg-violet-50/50 dark:border-violet-900/50 dark:bg-violet-900/15',
  gray: 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900',
  amber: 'border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-900/15',
  rose: 'border-rose-200 bg-rose-50/50 dark:border-rose-900/50 dark:bg-rose-900/15',
};

export function toneClass(tone) {
  return TONE[tone] || TONE.gray;
}

export default function StatusPill({ status, tone, label, size = 'sm', title, icon = null }) {
  const meta = STATUS[status] || null;
  const cls = meta ? meta.cls : toneClass(tone);
  const text = label || (meta ? meta.label : '—');
  const dims = size === 'xs' ? 'text-[9.5px] px-2 py-0.5' : 'text-[10.5px] px-2.5 py-0.5';
  return (
    <span
      title={title || (meta ? meta.meaning : undefined)}
      className={`${dims} font-bold rounded-full whitespace-nowrap inline-flex items-center gap-1 ${cls}`}
    >
      {icon}
      {text}
    </span>
  );
}
