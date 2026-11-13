// Sticky billing toggle + cart bar (Products redesign). Global page toggle
// (Monthly / Yearly — Save 20% / One-time) highlights the relevant catalog
// price across the page; the cart button carries a count badge and opens the
// drawer. One-time cart only — subscriptions bypass it.
import React from 'react';
import { ShoppingCart, ArrowRight } from 'lucide-react';
import { formatMoney } from './productsShared';

const CYCLES = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly — Save 20%' },
  { id: 'onetime', label: 'One-time' },
];

export default function BillingCartBar({ cycle, onCycleChange, cart, onOpenDrawer }) {
  const hasItems = cart.count > 0;
  return (
    <div className="sticky top-0 z-40 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-[#F8F8FA]/80 dark:bg-gray-950/80 backdrop-blur-md border-y border-gray-900/[.07] dark:border-gray-800">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-[.04em] text-gray-400 dark:text-gray-500">Billing</span>
          <div className="inline-flex bg-[#eeecf4] dark:bg-gray-800 border border-gray-900/[.06] dark:border-gray-700 rounded-[11px] p-[3px]">
            {CYCLES.map((c) => (
              <button
                key={c.id}
                onClick={() => onCycleChange(c.id)}
                className={`px-3.5 py-[7px] rounded-[9px] text-[13px] font-semibold whitespace-nowrap transition-all ${
                  cycle === c.id
                    ? 'bg-violet-600 text-white shadow-[0_1px_4px_rgba(107,70,193,.35)]'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
                data-testid={`billing-${c.id}`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={onOpenDrawer}
          className="inline-flex items-center gap-3 bg-white dark:bg-gray-900 border border-gray-900/10 dark:border-gray-700 rounded-xl py-[7px] pl-3.5 pr-2 shadow-sm hover:border-violet-300 dark:hover:border-violet-700"
          data-testid="cart-bar-button"
        >
          <span className="relative inline-flex text-gray-900 dark:text-gray-100">
            <ShoppingCart size={19} />
            {hasItems && (
              <span className="absolute -top-[7px] -right-2 min-w-[17px] h-[17px] px-1 rounded-full bg-violet-600 text-white text-[10.5px] font-bold flex items-center justify-center tabular-nums">
                {cart.count}
              </span>
            )}
          </span>
          <span className="hidden sm:flex flex-col items-start leading-[1.15]">
            <span className="text-[13.5px] font-semibold text-gray-900 dark:text-gray-100">
              {hasItems ? `Cart (${cart.count} ${cart.count > 1 ? 'items' : 'item'})` : 'Cart'}
            </span>
            <span className="tabular-nums text-xs text-gray-500 dark:text-gray-400">
              {hasItems ? formatMoney(cart.subtotal, cart.currency) : 'No items yet'}
            </span>
          </span>
          <span className="inline-flex items-center gap-[5px] bg-violet-600 text-white rounded-[9px] px-[13px] py-2 text-[13px] font-semibold">
            Review &amp; Checkout <ArrowRight size={14} />
          </span>
        </button>
      </div>
    </div>
  );
}
