// Right slide-over product detail panel. Opened by a card click and by direct
// navigation to /products/:productId (deep link → pre-open). The page stays
// behind. For subscription products the Buy action runs the embedded one-click
// Stripe checkout (AxalCheckout with the selected price_id); one-time products
// add to the cart.
import React, { useEffect, useMemo, useState } from 'react';
import { X, Package, CheckCircle2, Loader2 } from 'lucide-react';
import AxalCheckout from '../AxalCheckout';
import {
  formatMoney, availableCycles, pricesByCycle, cycleUnitLabel, productDescription,
  isSubscriptionProduct, priceCycle,
} from './productsShared';

const CYCLE_LABELS = { monthly: 'Monthly', yearly: 'Yearly', onetime: 'One-time' };

export default function ProductSlideOver({ product, globalCycle, onClose, onAddToCart, onSubscribed }) {
  const cycles = useMemo(() => (product ? availableCycles(product) : []), [product]);
  const by = useMemo(() => (product ? pricesByCycle(product) : {}), [product]);

  const initial = cycles.includes(globalCycle) ? globalCycle : cycles[0];
  const [selected, setSelected] = useState(initial);
  const [checkingOut, setCheckingOut] = useState(false);

  useEffect(() => { setSelected(cycles.includes(globalCycle) ? globalCycle : cycles[0]); setCheckingOut(false); }, [product, cycles, globalCycle]);

  useEffect(() => {
    if (!product) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [product, onClose]);

  if (!product) return null;

  const effectiveCycle = cycles.includes(selected) ? selected : cycles[0];
  const price = by[effectiveCycle] || null;
  const description = productDescription(product);
  const isSub = isSubscriptionProduct(product);
  const showToggle = cycles.length > 1;
  const isOneTime = price && priceCycle(price) === 'onetime';

  const features = Array.isArray(product.metadata?.features)
    ? product.metadata.features
    : (typeof product.metadata?.features === 'string'
      ? product.metadata.features.split('\n').map((s) => s.trim()).filter(Boolean)
      : []);

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[70] bg-gray-900/40 backdrop-blur-sm" style={{ animation: 'mrdFade .18s ease' }} />
      <div
        className="fixed top-0 right-0 bottom-0 z-[71] w-[560px] max-w-[95vw] bg-white dark:bg-gray-900 shadow-2xl flex flex-col"
        style={{ animation: 'mrdSlide .24s cubic-bezier(.2,.8,.2,1)' }}
        role="dialog"
        aria-label={product.name}
      >
        <div className="px-6 py-5 border-b border-gray-200 dark:border-gray-800 relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-9 h-9 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <X size={16} />
          </button>
          <span className="inline-flex w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400 items-center justify-center">
            <Package size={20} />
          </span>
          <h2 className="mt-3 text-2xl font-extrabold text-gray-900 dark:text-gray-100 pr-10">{product.name}</h2>
          {description && (
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 max-w-lg leading-relaxed">{description}</p>
          )}
          <div className="mt-4 flex items-center gap-4 flex-wrap">
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-extrabold text-gray-900 dark:text-gray-100">
                {price ? formatMoney(price.unit_amount, price.currency) : 'Contact us'}
              </span>
              {price && <span className="text-sm text-gray-500 dark:text-gray-400">{cycleUnitLabel(effectiveCycle)}</span>}
            </div>
            {showToggle && !checkingOut && (
              <div className="inline-flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                {cycles.map((c) => (
                  <button
                    key={c}
                    onClick={() => setSelected(c)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      effectiveCycle === c ? 'bg-violet-600 text-white' : 'text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {CYCLE_LABELS[c]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {features.length > 0 && (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-3">
                What's included
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {features.map((f, i) => (
                  <div key={i} className="flex gap-2.5 items-start">
                    <span className="flex-shrink-0 mt-0.5 inline-flex w-5 h-5 rounded-md bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400 items-center justify-center">
                      <CheckCircle2 size={13} />
                    </span>
                    <span className="text-sm text-gray-700 dark:text-gray-300 leading-snug">{f}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {checkingOut && price && (
            <div className="mt-6 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Checkout — {product.name}
              </h3>
              <AxalCheckout
                priceId={price.id}
                description={product.name}
                submitLabel="Confirm & Pay"
                onSuccess={(result) => {
                  onSubscribed?.({ product, price, cycle: effectiveCycle, result });
                }}
                onError={() => { /* AxalCheckout renders its own inline error */ }}
              />
            </div>
          )}
        </div>

        {!checkingOut && (
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 flex items-center justify-end gap-3">
            {isOneTime ? (
              <button
                onClick={() => { onAddToCart(product, price); onClose(); }}
                disabled={!price?.id}
                className="h-11 px-6 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold disabled:opacity-50"
              >
                Add to Order
              </button>
            ) : (
              <button
                onClick={() => setCheckingOut(true)}
                disabled={!price?.id}
                className="h-11 px-6 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold disabled:opacity-50"
              >
                Buy {price ? formatMoney(price.unit_amount, price.currency) + cycleUnitLabel(effectiveCycle) : ''}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
