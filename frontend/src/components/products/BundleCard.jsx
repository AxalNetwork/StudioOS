// Profile-bundle card (Products redesign, from the design handoff):
// role badge, live catalog price, feature checklist, "See what's included"
// expander (persona), license qty stepper, Preview features + Subscribe.
//
// Prices come from the live catalog only. Subscriptions never enter the
// one-time cart — Subscribe opens the product modal with the embedded
// Stripe checkout started (quantity carries through as license seats).
import React, { useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  formatMoney, pricesByCycle, profileForProduct, BUNDLE_CONTENT, MOST_POPULAR_BUNDLE,
  productDescription,
} from './productsShared';

export default function BundleCard({ product, globalCycle, onPreview, onSubscribe }) {
  const [qty, setQty] = useState(1);
  const [expanded, setExpanded] = useState(false);

  const by = useMemo(() => pricesByCycle(product), [product]);
  // Bundles are subscriptions: the One-time tab falls back to monthly, and a
  // bundle without a yearly price keeps showing its monthly price.
  const wantYearly = globalCycle === 'yearly' && Boolean(by.yearly);
  const price = wantYearly ? by.yearly : (by.monthly || by.yearly || null);
  const isYearly = wantYearly;

  const profile = profileForProduct(product);
  const content = BUNDLE_CONTENT[product.name];
  const features = content?.features || [];
  const description = productDescription(product);
  const popular = product.name === MOST_POPULAR_BUNDLE;

  return (
    <div
      className={`relative flex flex-col bg-white dark:bg-gray-900 rounded-[18px] p-[22px] shadow-sm transition-shadow hover:shadow-md ${
        popular
          ? 'border-[1.5px] border-violet-600 shadow-[0_8px_30px_rgba(107,70,193,.14)]'
          : 'border border-gray-200 dark:border-gray-800'
      }`}
      data-testid={`bundle-card-${product.id}`}
    >
      {popular && (
        <span className="absolute top-3.5 right-3.5 bg-violet-600 text-white text-[10.5px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-[7px]">
          Most popular
        </span>
      )}

      {profile && (
        <span className={`self-start inline-block ${profile.bg} ${profile.text} text-[11.5px] font-bold tracking-[.02em] px-[11px] py-[5px] rounded-lg`}>
          {profile.label}
        </span>
      )}
      <h3 className="mt-3 text-lg font-bold text-gray-900 dark:text-gray-100">{product.name}</h3>

      <div className="mt-2.5 flex items-baseline gap-1.5">
        <span className="tabular-nums text-[30px] font-extrabold tracking-[-.02em] text-gray-900 dark:text-gray-100">
          {price ? formatMoney(price.unit_amount, price.currency) : '—'}
        </span>
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{isYearly ? '/yr' : '/mo'}</span>
      </div>
      <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
        {isYearly ? 'Billed annually · Cancel anytime' : 'Billed monthly · Cancel anytime'}
      </p>

      <div className="h-px bg-gray-900/[.07] dark:bg-white/10 my-4" />

      {features.length > 0 ? (
        <ul className="m-0 p-0 list-none flex flex-col gap-[9px]">
          {features.map((f) => (
            <li key={f} className="flex gap-[9px] items-start text-[13px] leading-[1.4] text-gray-700 dark:text-gray-300">
              <span className={`flex-shrink-0 mt-px inline-flex w-[17px] h-[17px] rounded-md items-center justify-center ${profile?.bg || 'bg-violet-600/10'} ${profile?.text || 'text-violet-600'}`}>
                <Check size={11} strokeWidth={3} />
              </span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      ) : (
        description && <p className="text-[13px] leading-relaxed text-gray-600 dark:text-gray-400">{description}</p>
      )}

      {content?.persona && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-3.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-violet-600 dark:text-violet-400"
          >
            {expanded ? 'Hide details' : "See what's included"}
            <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
          {expanded && (
            <div className="mt-3" style={{ animation: 'mrdFade .2s ease' }}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Who this is for
              </p>
              <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl px-4 py-3.5 text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">
                {content.persona}
              </div>
            </div>
          )}
        </>
      )}

      <div className="mt-4 flex items-center justify-between gap-2.5">
        <div className="inline-flex items-center border border-gray-900/[.14] dark:border-gray-700 rounded-[9px] overflow-hidden">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="w-[30px] h-8 bg-white dark:bg-gray-900 text-base text-gray-500 flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-800"
            aria-label="Fewer licenses"
          >
            −
          </button>
          <span className="tabular-nums min-w-[22px] text-center text-sm font-semibold text-gray-900 dark:text-gray-100">{qty}</span>
          <button
            type="button"
            onClick={() => setQty((q) => q + 1)}
            className="w-[30px] h-8 bg-white dark:bg-gray-900 text-base text-gray-500 flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-800"
            aria-label="More licenses"
          >
            +
          </button>
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-500">licenses</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-[9px]">
        <button
          type="button"
          onClick={() => onPreview(product, { qty })}
          className="h-10 border border-gray-900/[.14] dark:border-gray-700 rounded-[10px] bg-white dark:bg-gray-900 text-[13px] font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          Preview features
        </button>
        <button
          type="button"
          onClick={() => onSubscribe(product, { qty })}
          disabled={!price?.id}
          className="h-10 rounded-[10px] bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-semibold disabled:opacity-50"
          data-testid={`bundle-subscribe-${product.id}`}
        >
          Subscribe
        </button>
      </div>
    </div>
  );
}
