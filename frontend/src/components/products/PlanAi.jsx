// D755 §11 (#1915) — the AI part of a plan card, on the desktop BundleCard and
// the free plans' cards: the allowance from the allowance store, what it
// covers, when it resets, and the way to top up. The words are
// lib/plansPricing.js's; `ai` is `planAi(...)`'s answer.
import React from 'react';
import { YOUR_PLAN } from '../../lib/plansPricing';

/** "Your plan", on the member's current plan. */
export function YourPlanBadge() {
  return (
    <span className="self-start inline-block bg-emerald-600/10 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold px-2.5 py-1 rounded-lg" data-testid="plan-current">
      {YOUR_PLAN}
    </span>
  );
}

export default function PlanAi({ ai, testid }) {
  if (!ai) return null;
  return (
    <div className="mt-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 px-3.5 py-3 text-[12.5px] leading-relaxed" data-testid={testid}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">AI allowance</p>
      <p className={`mt-0.5 font-semibold ${ai.unreadable ? 'text-amber-700 dark:text-amber-300' : 'text-gray-900 dark:text-gray-100'}`}>{ai.allowance}</p>
      {ai.covers && <p className="mt-1 text-gray-600 dark:text-gray-400">{ai.covers}</p>}
      {ai.resets && <p className="mt-1 text-gray-500 dark:text-gray-400">{ai.resets}</p>}
      {ai.topUp && (
        <a href={ai.topUp.href} className="mt-1.5 inline-block font-semibold text-violet-600 dark:text-violet-400 hover:underline">
          {ai.topUp.label}
        </a>
      )}
    </div>
  );
}
