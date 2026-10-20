// D755 CR7: the public pack read is the only source of purchase links.
import React, { useCallback, useEffect, useState } from 'react';
import { publicPricingApi } from '../../lib/api/publicPricing';
import { TOPUP_UNAVAILABLE, TOKENS_LINE, TOKEN_PACKS_PATH, packLabel, packOfferLines, sellableLine } from '../../lib/aiTokens';
import { useAuth } from '../../hooks/useAuthSync';

/** Keep pack products, including the environment fallback, out of the shared cart. */
export function isPackProduct(product, packs = []) {
  return product?.kind === 'token_pack' || product?.metadata?.kind === 'token_pack'
    || (product?.prices || []).some(price => packs.some(pack => pack.price_id === price.id));
}

export default function TokenPacksSection({ onPacksRead }) {
  const { user } = useAuth();
  const [reading, setReading] = useState({ status: 'loading', packs: [] });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(n => n + 1), []);
  useEffect(() => {
    let stopped = false;
    setReading({ status: 'loading', packs: [] });
    publicPricingApi.plansAndPacks().then(data => {
      if (stopped) return;
      if (!Array.isArray(data?.packs) || data.packs.some(pack => !sellableLine(pack))) {
        setReading({ status: 'unreadable', packs: [] }); return;
      }
      setReading({ status: 'ready', packs: data.packs });
      onPacksRead?.(data.packs);
    }).catch(() => { if (!stopped) setReading({ status: 'unreadable', packs: [] }); });
    return () => { stopped = true; };
  }, [attempt, onPacksRead]);
  return <section id="token-packs" className="scroll-mt-6 space-y-3">
    <h2 className="text-[19px] font-bold text-gray-900 dark:text-gray-100">Token packs</h2>
    {reading.status === 'loading' ? <p role="status">Loading token packs…</p>
      : reading.status === 'unreadable' ? <div role="alert">Unreadable · The token packs could not be read. <button type="button" onClick={retry}>Retry</button></div>
      : reading.packs.length === 0 ? <p>{TOPUP_UNAVAILABLE}</p>
      : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{reading.packs.map(pack =>
        <article key={pack.uid || pack.price_id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-3">
          <h3 className="font-semibold">{packLabel(pack.unit_amount)}</h3>
          <p className="text-sm">{TOKENS_LINE}</p>
          {packOfferLines(pack).map(line => <p key={line} className="text-sm">{line}</p>)}
          <a className="inline-flex rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white"
            href={user ? '/checkout?token_pack=' + encodeURIComponent(pack.uid || pack.price_id)
              : '/login?next=' + encodeURIComponent(TOKEN_PACKS_PATH)}>{user ? 'Buy' : 'Sign in to buy'}</a>
        </article>)}</div>}
    <p className="text-xs text-gray-500 dark:text-gray-400">Sold by Axal VC Management LLC. Paid by card through Stripe; Axal never stores your card details. VAT, where it applies, is added at checkout and is not part of the tokens.</p>
  </section>;
}
