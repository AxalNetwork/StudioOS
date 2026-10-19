// D755 §11 (#1915) — a plan with no Stripe product: Founder Free, Investor
// Free, and Exploring and other accounts. $0, nothing to subscribe to; the
// card exists to show the AI allowance the plan comes with.
import React from 'react';
import PlanAi, { YourPlanBadge } from './PlanAi';
import { FAMILY_LABELS } from '../../lib/plansPricing';

export default function FreePlanCard({ plan, ai }) {
  return (
    <div className="relative flex flex-col bg-white dark:bg-gray-900 rounded-[18px] p-[22px] shadow-sm border border-gray-200 dark:border-gray-800" data-testid={`free-plan-${plan.family}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="self-start inline-block bg-gray-900/[.06] dark:bg-white/10 text-gray-700 dark:text-gray-300 text-[11.5px] font-bold tracking-[.02em] px-[11px] py-[5px] rounded-lg">
          {FAMILY_LABELS[plan.family]}
        </span>
        {ai?.current && <YourPlanBadge />}
      </div>
      <h3 className="mt-3 text-lg font-bold text-gray-900 dark:text-gray-100">{plan.title}</h3>
      <div className="mt-2.5 tabular-nums text-[30px] font-extrabold tracking-[-.02em] text-gray-900 dark:text-gray-100">$0</div>
      <PlanAi ai={ai} testid={`free-plan-ai-${plan.family}`} />
    </div>
  );
}
