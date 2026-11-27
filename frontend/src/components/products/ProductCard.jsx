// Compact "Add-ons & services" card (Products redesign): icon square, name
// (opens the product modal), description, live catalog price + cadence, and
// one action. Catalog-driven behavior is preserved:
//   - one-time products → Add to Order (cart)
//   - recurring add-ons → Subscribe (opens the modal's embedded checkout)
// Prices ALWAYS come from the catalog response, never hardcoded.
import React, { useMemo } from 'react';
import { Package, Home, PieChart, Flag } from 'lucide-react';
import {
  formatMoney, pickPriceForCycle, cycleUnitLabel, productDescription, priceCycle,
} from './productsShared';

function iconFor(product) {
  const kind = product?.kind || product?.metadata?.kind;
  if (kind === 'incorporation') return Home;
  const name = product?.name || '';
  if (/market intelligence/i.test(name)) return PieChart;
  if (/registered agent/i.test(name)) return Flag;
  return Package;
}

export default function ProductCard({ product, globalCycle, onOpen, onAddToCart, onBuySubscription }) {
  const { price, cycle } = useMemo(() => pickPriceForCycle(product, globalCycle), [product, globalCycle]);
  const description = productDescription(product);
  const Icon = iconFor(product);
  const isOneTime = price && priceCycle(price) === 'onetime';

  const handleAction = () => {
    if (!price?.id) return;
    if (isOneTime) onAddToCart(product, price);
    else onBuySubscription(product, price, cycle);
  };

  return (
    <div
      className="flex flex-col bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[14px] p-[18px] shadow-sm transition-shadow hover:shadow-md"
      data-testid={`addon-card-${product.id}`}
    >
      <div className="flex items-start gap-[11px]">
        <span className="flex-shrink-0 inline-flex w-9 h-9 rounded-[10px] bg-violet-600/[.09] text-violet-600 dark:text-violet-400 items-center justify-center">
          <Icon size={17} />
        </span>
        <div className="flex-1 min-w-0">
          <button
            onClick={() => onOpen(product)}
            className="text-left text-[14.5px] font-bold text-gray-900 dark:text-gray-100 hover:text-violet-600 dark:hover:text-violet-400"
          >
            {product.name}
          </button>
          {description && (
            <p className="mt-1 text-[12.5px] leading-[1.4] text-gray-500 dark:text-gray-400 line-clamp-3">{description}</p>
          )}
        </div>
      </div>

      <div className="mt-auto pt-4 flex items-center justify-between gap-2.5">
        <div className="flex items-baseline gap-1">
          <span className="tabular-nums text-xl font-extrabold tracking-[-.02em] text-gray-900 dark:text-gray-100">
            {price ? formatMoney(price.unit_amount, price.currency) : '—'}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {price ? cycleUnitLabel(cycle) : ''}
          </span>
        </div>
        <button
          onClick={handleAction}
          disabled={!price?.id}
          className="h-9 px-[15px] border border-violet-600/25 rounded-[9px] bg-violet-600/[.06] hover:bg-violet-600/[.12] text-violet-600 dark:text-violet-400 text-[12.5px] font-semibold disabled:opacity-50"
          data-testid={`addon-action-${product.id}`}
        >
          {isOneTime ? 'Add to Order' : 'Subscribe'}
        </button>
      </div>
    </div>
  );
}
