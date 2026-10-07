import React, { useEffect } from 'react';
import useAiBudget from '../hooks/useAiBudget';
import { Unreadable } from './Honesty';

const money=n=>{
  const micro=BigInt(n);
  const fraction=(micro%1000000n).toString().padStart(6,'0').replace(/0+$/,'').padEnd(2,'0');
  return `$${(micro/1000000n).toLocaleString('en-US')}.${fraction}`;
};
const integer=n=>Number.isSafeInteger(n)&&n>=0;
export function AiBudgetUsage({reading}) {
  const {budget:b,product:p,loading,budgetError,productError,reload}=reading;
  const known=b && !budgetError && typeof b.licence==='string' &&
    ['daily_microusd','monthly_microusd','day_spend_microusd','month_spend_microusd','balance_microusd','day_reserved_microusd','month_reserved_microusd','topup_reserved_microusd'].every(key=>integer(b[key]));
  if (loading) return <div aria-busy="true" className="text-xs text-gray-500 dark:text-gray-400">Loading AI allowance…</div>;
  if (!known) return <Unreadable what="Unreadable: your AI allowance and top-up balance" claim="Retry to read the recorded figures." onRetry={reload} />;
  const held=b.day_reserved_microusd+b.month_reserved_microusd+b.topup_reserved_microusd>0;
  return <div className="space-y-2 text-xs text-gray-700 dark:text-gray-300" data-testid="ai-budget-usage">
    <p className="font-semibold">Included allowance · {b.licence.replace(':',' / ')}</p>
    <p>Today · {money(b.day_spend_microusd)} of {money(b.daily_microusd)}</p>
    <p>This month · {money(b.month_spend_microusd)} of {money(b.monthly_microusd)}</p>
    {b.monthly_microusd>0 && <div className="h-1 rounded-full bg-gray-200 dark:bg-gray-700" role="presentation">
      <div className="h-1 rounded-full bg-violet-600 dark:bg-violet-400" style={{width:`${Math.min(100,b.month_spend_microusd/b.monthly_microusd*100)}%`}} />
    </div>}
    <p className="font-semibold">Top-up balance · {money(b.balance_microusd)}</p>
    {held && <p>Runs in progress reserve {money(b.month_reserved_microusd)} of allowance and {money(b.topup_reserved_microusd)} of top-up.</p>}
    {productError || !p || typeof p.configured!=='boolean' || (p.configured && (!p.product || !/^price_[A-Za-z0-9]+$/.test(p.product.price_id) || p.product.currency!=='usd' || !integer(p.product.unit_amount) || p.product.unit_amount===0))
      ? <Unreadable what="Unreadable: the AI top-up" claim="Retry to read the purchase option." onRetry={reload} />
      : p.configured
        ? <a href="/checkout?ai_topup=1" className="inline-block underline font-semibold text-violet-700 dark:text-violet-300">Add tokens</a>
        : <p>Top-up not configured</p>}
  </div>;
}
export function LiveAiBudgetUsage({refreshKey}) {
  const reading=useAiBudget();
  useEffect(()=>{if(refreshKey)reading.reload();},[refreshKey,reading.reload]);
  return <AiBudgetUsage reading={reading} />;
}
