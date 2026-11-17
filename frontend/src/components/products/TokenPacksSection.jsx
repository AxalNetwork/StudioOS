// D755 CR7: the public pack read is the only source of purchase links.
import React, { useCallback, useEffect, useState } from 'react';
import { publicPricingApi } from '../../lib/api/publicPricing';
import { CUSTOM_PACK, TOKENS_LINE, TOKEN_PACKS_PATH, addTokensHref, customRangeLine, packLabel, packOfferLines, sellableLine } from '../../lib/aiTokens';
import { useAuth } from '../../hooks/useAuthSync';

/** Keep pack products, including the environment fallback, out of the shared cart. */
export function isPackProduct(product, packs = []) {
  return product?.kind === 'token_pack' || product?.metadata?.kind === 'token_pack'
    || (product?.prices || []).some(price => packs.some(pack => pack.price_id === price.id));
}

/** #7000: the words for the two settled states that sell nothing. A failed read never reads as zero packs. */
export const PACKS_UNAVAILABLE = 'Prices unavailable.';
export const PACKS_EMPTY = 'No token packs are offered yet.';

/**
 * #7000: one settled read as the section's state. Anything that is not a list of sellable packs is
 * `unavailable`, never an empty list; an empty list with no custom amount is `empty`.
 */
export function packsReading(data) {
  if (!Array.isArray(data?.packs) || data.packs.some(pack => !sellableLine(pack))) return { status: 'unavailable', packs: [], custom: null };
  const custom = customRangeLine(data.custom);
  if (data.packs.length === 0 && !custom) return { status: 'empty', packs: [], custom: null };
  return { status: 'ready', packs: data.packs, custom };
}

function PackSkeleton() {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading token packs" data-testid="token-packs-skeleton">
    {[0, 1, 2].map(k => <div key={k} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-3">
      <div className="h-4 w-2/5 rounded bg-gray-200 dark:bg-gray-800" />
      <div className="h-3 w-3/4 rounded bg-gray-100 dark:bg-gray-800" />
      <div className="h-8 w-1/3 rounded bg-gray-100 dark:bg-gray-800" />
    </div>)}
  </div>;
}

/** The section's body for one state: skeleton, unavailable with Try again, empty, or the packs. */
export function PacksBody({ reading, user, onRetry }) {
  if (reading.status === 'loading') return <PackSkeleton />;
  if (reading.status === 'unavailable') return <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-800 dark:text-red-200" data-testid="token-packs-unavailable">
    <span><b>{PACKS_UNAVAILABLE}</b> The token packs could not be read just now.</span>
    <button type="button" className="rounded-lg border border-red-300 dark:border-red-800 px-3 py-1.5 font-semibold" onClick={onRetry}>Try again</button>
  </div>;
  if (reading.status === 'empty') return <p className="text-sm text-gray-600 dark:text-gray-400" data-testid="token-packs-empty">{PACKS_EMPTY}</p>;
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{reading.packs.map(pack =>
    <article key={pack.uid || pack.price_id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-3">
      <h3 className="font-semibold">{packLabel(pack.unit_amount)}</h3>
      <p className="text-sm">{TOKENS_LINE}</p>
      {packOfferLines(pack).map(line => <p key={line} className="text-sm">{line}</p>)}
      <a className="inline-flex rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white"
        href={user ? addTokensHref(pack.uid || pack.price_id)
          : '/login?next=' + encodeURIComponent(TOKEN_PACKS_PATH)}>{user ? 'Buy' : 'Sign in to buy'}</a>
    </article>)}{reading.custom &&
    <article key="custom" className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-3" data-testid="token-pack-custom">
      <h3 className="font-semibold">AI tokens, any amount</h3>
      <p className="text-sm">{TOKENS_LINE}</p>
      <p className="text-sm">{reading.custom}</p>
      <a className="inline-flex rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white"
        href={user ? addTokensHref(CUSTOM_PACK) : '/login?next=' + encodeURIComponent(TOKEN_PACKS_PATH)}>{user ? 'Choose an amount' : 'Sign in to buy'}</a>
    </article>}</div>;
}

/**
 * #7000: the read always settles. `request()` gives `/public/plans-and-packs` the 30 s default deadline
 * (api.js DEFAULT_TIMEOUT_MS), so a read that never answers rejects and the section shows Prices unavailable.
 */
export default function TokenPacksSection({ onPacksRead }) {
  const { user } = useAuth();
  const [reading, setReading] = useState({ status: 'loading', packs: [], custom: null });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(n => n + 1), []);
  useEffect(() => {
    let stopped = false;
    setReading({ status: 'loading', packs: [], custom: null });
    publicPricingApi.plansAndPacks().then(data => {
      if (stopped) return;
      const next = packsReading(data);
      setReading(next);
      if (next.status !== 'unavailable') onPacksRead?.(next.packs);
    }).catch(() => { if (!stopped) setReading({ status: 'unavailable', packs: [], custom: null }); });
    return () => { stopped = true; };
  }, [attempt, onPacksRead]);
  return <section id="token-packs" className="scroll-mt-6 space-y-3" data-testid="token-packs">
    <h2 className="text-[19px] font-bold text-gray-900 dark:text-gray-100">Token packs</h2>
    <PacksBody reading={reading} user={user} onRetry={retry} />
    <p className="text-xs text-gray-500 dark:text-gray-400">Sold by Axal VC Management LLC. Paid by card through Stripe; Axal never stores your card details. VAT, where it applies, is added at checkout and is not part of the tokens.</p>
  </section>;
}
