import React, { useEffect } from 'react';
import useAiBudget from '../hooks/useAiBudget';
import { Unreadable } from './Honesty';
import { ADD_TOKENS_PATH, TOPUP_UNAVAILABLE, aiTokenState, microMoney, usageMoney } from '../lib/aiTokens';

// D755 (#1916): the formatters, the top-up state and its sentence live in
// lib/aiTokens.js; re-exported here so no importer changes.
export { microMoney, usageMoney, TOPUP_UNAVAILABLE } from '../lib/aiTokens';
const money=microMoney;
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const BUDGET_KEYS=['daily_microusd','monthly_microusd','day_spend_microusd','month_spend_microusd','balance_microusd','day_reserved_microusd','month_reserved_microusd','topup_reserved_microusd'];
const budgetKnown=(b,budgetError)=>!!b && !budgetError && typeof b.licence==='string' && BUDGET_KEYS.every(key=>integer(b[key]));
/** The month's allowance, spent and cap in micro-USD, or null when unread (the Worker AI rail's Usage card). */
export function allowanceMonth(b,budgetError){
  return budgetKnown(b,budgetError) ? {spent:b.month_spend_microusd,cap:b.monthly_microusd} : null;
}
export function AiBudgetUsage({reading}) {
  const {budget:b,product:p,loading,budgetError,productError,reload}=reading;
  const known=budgetKnown(b,budgetError);
  if (loading) return <div aria-busy="true" className="text-xs text-gray-500 dark:text-gray-400">Loading AI allowance…</div>;
  if (!known) return <Unreadable what="Unreadable: your AI allowance and top-up balance" claim="Retry to read the recorded figures." onRetry={reload} />;
  const topUp=aiTokenState({error:productError,data:p});
  const held=b.day_reserved_microusd+b.month_reserved_microusd+b.topup_reserved_microusd>0;
  return <div className="space-y-2 text-xs text-gray-700 dark:text-gray-300" data-testid="ai-budget-usage">
    <p className="font-semibold">Included allowance · {b.licence.replace(':',' / ')}</p>
    {/* D642 (#1435) — the compact card opens the full Usage page. */}
    <a href="/account/usage" className="inline-block underline text-violet-700 dark:text-violet-300" data-testid="ai-budget-usage-link">See usage</a>
    <p>Today · <span title={money(b.day_spend_microusd)}>{usageMoney(b.day_spend_microusd)}</span> of {money(b.daily_microusd)}</p>
    <p>This month · <span title={money(b.month_spend_microusd)}>{usageMoney(b.month_spend_microusd)}</span> of {money(b.monthly_microusd)}</p>
    {b.monthly_microusd>0 && <div className="h-1 rounded-full bg-gray-200 dark:bg-gray-700" role="presentation">
      <div className="h-1 rounded-full bg-violet-600 dark:bg-violet-400" style={{width:`${Math.min(100,b.month_spend_microusd/b.monthly_microusd*100)}%`}} />
    </div>}
    <p className="font-semibold">Top-up balance · {money(b.balance_microusd)}</p>
    {held && <p>Runs in progress reserve <span title={money(b.month_reserved_microusd)}>{usageMoney(b.month_reserved_microusd)}</span> of allowance and <span title={money(b.topup_reserved_microusd)}>{usageMoney(b.topup_reserved_microusd)}</span> of top-up.</p>}
    {topUp==='unreadable'
      ? <Unreadable what="Unreadable: the AI top-up" claim="Retry to read the purchase option." onRetry={reload} />
      : topUp==='ready'
        ? <a href={ADD_TOKENS_PATH} className="inline-block underline font-semibold text-violet-700 dark:text-violet-300">Add tokens</a>
        : <p data-testid="ai-budget-topup-unavailable">{TOPUP_UNAVAILABLE}</p>}
  </div>;
}
export function LiveAiBudgetUsage({refreshKey}) {
  const reading=useAiBudget();
  useEffect(()=>{if(refreshKey)reading.reload();},[refreshKey,reading.reload]);
  return <AiBudgetUsage reading={reading} />;
}
