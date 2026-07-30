// Sticky billing toggle + cart bar. Global page toggle (Monthly / Yearly /
// One-time) highlights the relevant catalog price across the page; the cart
// button carries a count badge and opens the drawer. One-time cart only.
import React from 'react';
import { ShoppingCart, ArrowRight } from 'lucide-react';
import { formatMoney } from './productsShared';

const CYCLES = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
  { id: 'onetime', label: 'One-time' },
];

export default function BillingCartBar({ cycle, onCycleChange, cart, onOpenDrawer }) {
  const hasItems = cart.count > 0;
  return (
    <div className="sticky top-0 z-40 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mb-2 bg-white/80 dark:bg-gray-900/80 backdrop-blur border-y border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Billing</span>
          <div className="inline-flex bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-0.5">
            {CYCLES.map((c) => (
              <button
                key={c.id}
                onClick={() => onCycleChange(c.id)}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${
                  cycle === c.id
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={onOpenDrawer}
          className="inline-flex items-center gap-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl py-1.5 pl-3.5 pr-1.5 shadow-sm hover:border-violet-300 dark:hover:border-violet-700"
        >
          <span className="relative inline-flex text-gray-900 dark:text-gray-100">
            <ShoppingCart size={19} />
            {hasItems && (
              <span className="absolute -top-2 -right-2 min-w-[17px] h-[17px] px-1 rounded-full bg-violet-600 text-white text-[10px] font-bold flex items-center justify-center">
                {cart.count}
              </span>
            )}
          </span>
          <span className="hidden sm:flex flex-col items-start leading-tight">
            <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
              {hasItems ? 'Your order' : 'Cart empty'}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {hasItems ? formatMoney(cart.subtotal, cart.currency) : 'One-time items'}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5 bg-violet-600 text-white rounded-lg px-3 py-2 text-[13px] font-semibold">
            Review &amp; Checkout <ArrowRight size={14} />
          </span>
        </button>
      </div>
    </div>
  );
}
