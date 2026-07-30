// Centered product detail modal (Products redesign — replaces the old right
// slide-over; the file keeps its name so routes/imports stay stable). Opened
// by a card click and by direct navigation to /products/:productId (deep
// link → pre-open). The page stays behind.
//
// Behavior is unchanged and catalog-driven:
//   - subscription products → embedded one-click Stripe checkout
//     (AxalCheckout with the selected price_id + license quantity)
//   - one-time products → add to the cart
// `initialCheckout` (from a bundle card's Subscribe button) opens the modal
// with the embedded checkout already revealed; `initialQty` carries the
// card's license count through.
import React, { useEffect, useMemo, useState } from 'react';
import { X, Package, CheckCircle2 } from 'lucide-react';
import AxalCheckout from '../AxalCheckout';
import {
  formatMoney, availableCycles, pricesByCycle, cycleUnitLabel, productDescription,
  priceCycle, profileForProduct, BUNDLE_CONTENT,
} from './productsShared';

const CYCLE_LABELS = { monthly: 'Monthly', yearly: 'Yearly', onetime: 'One-time' };

export default function ProductSlideOver({
  product, globalCycle, onClose, onAddToCart, onSubscribed,
  initialQty = 1, initialCheckout = false,
}) {
  const cycles = useMemo(() => (product ? availableCycles(product) : []), [product]);
  const by = useMemo(() => (product ? pricesByCycle(product) : {}), [product]);

  const initial = cycles.includes(globalCycle) ? globalCycle : cycles[0];
  const [selected, setSelected] = useState(initial);
  const [qty, setQty] = useState(initialQty);
  const [checkingOut, setCheckingOut] = useState(false);

  useEffect(() => {
    setSelected(cycles.includes(globalCycle) ? globalCycle : cycles[0]);
    setQty(Math.max(1, initialQty || 1));
    setCheckingOut(Boolean(initialCheckout));
  }, [product, cycles, globalCycle, initialQty, initialCheckout]);

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
  const showToggle = cycles.length > 1;
  const isOneTime = price && priceCycle(price) === 'onetime';

  const profile = profileForProduct(product);
  const content = BUNDLE_CONTENT[product.name];
  const metaFeatures = Array.isArray(product.metadata?.features)
    ? product.metadata.features
    : (typeof product.metadata?.features === 'string'
      ? product.metadata.features.split('\n').map((s) => s.trim()).filter(Boolean)
      : []);
  const features = metaFeatures.length ? metaFeatures : (content?.features || []);

  const totalLabel = price ? formatMoney(price.unit_amount * qty, price.currency) : '';

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[70] bg-[#14142B]/45 backdrop-blur-sm" style={{ animation: 'mrdFade .18s ease' }} />
      <div className="fixed inset-0 z-[71] flex items-center justify-center p-4 sm:p-6 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-[760px] max-h-[88vh] bg-white dark:bg-gray-900 rounded-[20px] shadow-2xl flex flex-col overflow-hidden"
          style={{ animation: 'mrdPop .22s cubic-bezier(.2,.8,.2,1)' }}
          role="dialog"
          aria-label={product.name}
        >
          <div className="px-6 sm:px-7 pt-6 pb-5 border-b border-gray-900/[.07] dark:border-gray-800 relative">
            <button
              onClick={onClose}
              className="absolute top-4 right-4 w-9 h-9 rounded-lg border border-gray-900/10 dark:border-gray-700 flex items-center justify-center text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
              aria-label="Close"
            >
              <X size={16} />
            </button>
            {profile ? (
              <span className={`inline-block ${profile.bg} ${profile.text} text-[11.5px] font-bold tracking-[.02em] px-[11px] py-[5px] rounded-lg`}>
                {profile.label}
              </span>
            ) : (
              <span className="inline-flex w-10 h-10 rounded-xl bg-violet-600/[.09] text-violet-600 dark:text-violet-400 items-center justify-center">
                <Package size={20} />
              </span>
            )}
            <h2 className="mt-3 text-[26px] leading-tight font-extrabold tracking-[-.01em] text-gray-900 dark:text-gray-100 pr-10">{product.name}</h2>
            {(content?.persona || description) && (
              <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400 max-w-xl leading-relaxed">
                {description || content?.persona}
              </p>
            )}
            <div className="mt-4 flex items-center gap-4 flex-wrap">
              <div className="flex items-baseline gap-1.5">
                <span className="tabular-nums text-[30px] font-extrabold tracking-[-.02em] text-gray-900 dark:text-gray-100">
                  {price ? formatMoney(price.unit_amount, price.currency) : 'Contact us'}
                </span>
                {price && <span className="text-sm text-gray-500 dark:text-gray-400">{cycleUnitLabel(effectiveCycle)}</span>}
              </div>
              {showToggle && (
                <div className="inline-flex bg-[#eeecf4] dark:bg-gray-800 rounded-[10px] p-[3px]">
                  {cycles.map((c) => (
                    <button
                      key={c}
                      onClick={() => { setSelected(c); setCheckingOut(false); }}
                      className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-all ${
                        effectiveCycle === c
                          ? 'bg-violet-600 text-white shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                      }`}
                    >
                      {CYCLE_LABELS[c]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 sm:px-7 py-5">
            {features.length > 0 && (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
                  What's included
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
                  {features.map((f, i) => (
                    <div key={i} className="flex gap-2.5 items-start">
                      <span className="flex-shrink-0 mt-0.5 inline-flex w-5 h-5 rounded-md bg-violet-600/[.09] text-violet-600 dark:text-violet-400 items-center justify-center">
                        <CheckCircle2 size={13} />
                      </span>
                      <span className="text-[13px] text-gray-700 dark:text-gray-300 leading-snug">{f}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {content?.persona && (
              <div className="mt-6">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2.5">
                  Who this is for
                </p>
                <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl px-4 py-3.5 text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">
                  {content.persona}
                </div>
              </div>
            )}

            {checkingOut && price && (
              <div className="mt-6 rounded-xl border border-gray-900/[.08] dark:border-gray-800 p-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                  Checkout — {product.name}{qty > 1 ? ` × ${qty}` : ''}
                </h3>
                <AxalCheckout
                  priceId={price.id}
                  quantity={qty > 1 ? qty : undefined}
                  description={product.name}
                  submitLabel="Confirm & Pay"
                  onSuccess={(result) => {
                    onSubscribed?.({ product, price, cycle: effectiveCycle, quantity: qty, result });
                  }}
                  onError={() => { /* AxalCheckout renders its own inline error */ }}
                />
              </div>
            )}
          </div>

          {!checkingOut && (
            <div className="px-6 sm:px-7 py-4 border-t border-gray-900/[.07] dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5">
                <div className="inline-flex items-center border border-gray-900/[.14] dark:border-gray-700 rounded-[9px] overflow-hidden bg-white dark:bg-gray-900">
                  <button
                    type="button"
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    className="w-[30px] h-8 text-base text-gray-500 flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-800"
                    aria-label="Decrease quantity"
                  >
                    −
                  </button>
                  <span className="tabular-nums min-w-[22px] text-center text-sm font-semibold text-gray-900 dark:text-gray-100">{qty}</span>
                  <button
                    type="button"
                    onClick={() => setQty((q) => q + 1)}
                    className="w-[30px] h-8 text-base text-gray-500 flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-800"
                    aria-label="Increase quantity"
                  >
                    +
                  </button>
                </div>
                <span className="text-xs text-gray-400 dark:text-gray-500">{isOneTime ? 'quantity' : 'licenses'}</span>
              </div>
              {isOneTime ? (
                <button
                  onClick={() => { onAddToCart(product, price, qty); onClose(); }}
                  disabled={!price?.id}
                  className="h-11 px-6 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold disabled:opacity-50"
                  data-testid="modal-add-to-order"
                >
                  Add to Order
                </button>
              ) : (
                <button
                  onClick={() => setCheckingOut(true)}
                  disabled={!price?.id}
                  className="h-11 px-6 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold disabled:opacity-50"
                  data-testid="modal-confirm-purchase"
                >
                  Confirm Purchase{price ? ` — ${totalLabel}${qty > 1 ? '' : cycleUnitLabel(effectiveCycle)}` : ''}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
