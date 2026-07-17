// A single catalog product card. Catalog-driven billing:
//   - Shows a per-product Monthly/Yearly/One-time toggle ONLY for the cycles
//     that have a real Stripe price. Hides the toggle if only one type exists.
//   - The global page toggle sets the initial highlighted cycle.
//   - Products lacking a yearly price show monthly + muted "Monthly billing only".
//   - One-time products always show their one-time price.
// Subscription products bypass the cart (Buy → one-click Stripe). One-time
// products add to the cart.
import React, { useMemo, useState } from 'react';
import { Package } from 'lucide-react';
import {
  formatMoney, availableCycles, pricesByCycle, cycleUnitLabel, productDescription,
  isSubscriptionProduct, priceCycle,
} from './productsShared';

const CYCLE_LABELS = { monthly: 'Monthly', yearly: 'Yearly', onetime: 'One-time' };

export default function ProductCard({ product, globalCycle, onOpen, onAddToCart, onBuySubscription }) {
  const cycles = useMemo(() => availableCycles(product), [product]);
  const by = useMemo(() => pricesByCycle(product), [product]);

  // Initial selected cycle: prefer the global toggle if the product sells it,
  // else the first cycle it does sell.
  const initialCycle = cycles.includes(globalCycle) ? globalCycle : cycles[0];
  const [selected, setSelected] = useState(initialCycle);

  // Keep in sync when the global toggle changes to a cycle this product sells.
  const effectiveCycle = cycles.includes(globalCycle) ? globalCycle : (cycles.includes(selected) ? selected : cycles[0]);
  const price = by[effectiveCycle] || null;
  const description = productDescription(product);

  const isSub = isSubscriptionProduct(product);
  const showToggle = cycles.length > 1;
  // A subscription product that only offers monthly (no yearly) → muted note.
  const monthlyOnly = isSub && cycles.includes('monthly') && !cycles.includes('yearly') && cycles.length === 1;

  const handleBuy = () => {
    if (!price?.id) return;
    if (priceCycle(price) === 'onetime') {
      onAddToCart(product, price);
    } else {
      onBuySubscription(product, price, effectiveCycle);
    }
  };

  const buyLabel = priceCycle(price) === 'onetime' ? 'Add to Order' : 'Buy';

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-2.5">
        <span className="flex-shrink-0 inline-flex w-9 h-9 rounded-lg bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400 items-center justify-center">
          <Package size={17} />
        </span>
        <div className="flex-1 min-w-0">
          <button
            onClick={() => onOpen(product)}
            className="text-left font-semibold text-sm text-gray-900 dark:text-gray-100 hover:text-violet-600 dark:hover:text-violet-400"
          >
            {product.name}
          </button>
          {description && (
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 line-clamp-3">{description}</p>
          )}
        </div>
      </div>

      {showToggle && (
        <div className="mt-3 inline-flex self-start bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
          {cycles.map((c) => (
            <button
              key={c}
              onClick={() => setSelected(c)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                effectiveCycle === c
                  ? 'bg-violet-600 text-white'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {CYCLE_LABELS[c]}
            </button>
          ))}
        </div>
      )}

      <div className="mt-auto pt-3 flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-extrabold text-gray-900 dark:text-gray-100">
              {price ? formatMoney(price.unit_amount, price.currency) : 'Contact us'}
            </span>
            {price && <span className="text-xs text-gray-500 dark:text-gray-400">{cycleUnitLabel(effectiveCycle)}</span>}
          </div>
          {monthlyOnly && (
            <span className="text-[11px] text-gray-400 dark:text-gray-500">Monthly billing only</span>
          )}
        </div>
        <button
          onClick={handleBuy}
          disabled={!price?.id}
          className="px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold disabled:opacity-50"
        >
          {buyLabel}
        </button>
      </div>
    </div>
  );
}
