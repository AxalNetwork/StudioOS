// D4822 (#4822) — an engagement's health in word AND shape, never colour alone: On track (solid), At risk and
// Blocked (solid, with a mark), Not rated (dashed, never green). Shared by Board v2 and the engagement Sheet.
import React from 'react';
import { HEALTH_WORD, NOT_RATED } from './boardAttention';

const TONE = {
  on_track: 'border-[#047857]/30 bg-[#ecfdf5] text-[#047857] dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  at_risk: 'border-[#fcd34d] bg-[#fffbeb] text-[#92400e] dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  blocked: 'border-[#b91c1c]/30 bg-[#fef2f2] text-[#b91c1c] dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
};
const MARK = { on_track: '✓', at_risk: '!', blocked: '✕' };

export default function HealthPill({ health }) {
  if (!health || !HEALTH_WORD[health]) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-[#6b6577]/60 px-2 py-0.5 text-[13px] font-semibold text-[#6b6577] dark:border-gray-500 dark:text-gray-400" data-health="not_rated">
        {NOT_RATED}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[13px] font-semibold ${TONE[health]}`} data-health={health}>
      <span aria-hidden="true">{MARK[health]}</span>{HEALTH_WORD[health]}
    </span>
  );
}
