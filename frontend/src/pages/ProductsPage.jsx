// Products — in-house storefront on the Stripe-backed catalog.
//
// Three surfaces on one page:
//   1. Promo redemption — the one-time 30-day-license codes the Personal
//      Advisor issues when an exploring user completes their needs bank
//      (worker: /api/products/promo + /api/products/redeem). Redemption is
//      $0 and never touches Stripe; the confirmation renders as a $0.00
//      billing receipt. `?code=` (from the chat CTA) prefills the input.
//   2. Catalog — the mirrored Stripe catalog (/api/catalog/products),
//      purchased in-app through the embedded AxalCheckout component (Stripe
//      Elements, no redirect). AxalCheckout has its own promo field for
//      Stripe-native discount codes.
//   3. Active licenses — the caller's current feature unlocks so a freshly
//      redeemed 30-day license is visible immediately.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Package, Ticket, CheckCircle2, AlertTriangle, Loader2, X, BadgeCheck, Receipt,
} from 'lucide-react';
import { api } from '../lib/api';
import AxalCheckout from '../components/AxalCheckout';

const REDEEM_REASONS = {
  not_found: "That code isn't valid. Check for typos — codes look like AXAL-XXXX-XXXX.",
  already_redeemed: 'This code has already been redeemed.',
  expired: 'This code has expired.',
};

function formatMoney(cents, currency) {
  const amt = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: (currency || 'usd').toUpperCase(),
    }).format(amt);
  } catch {
    return `${amt.toFixed(2)} ${(currency || 'USD').toUpperCase()}`;
  }
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

// Shared billing-confirmation receipt for both the $0 promo path and paid
// checkout. `lines` = [{ label, value }].
function BillingReceipt({ title, lines, total, note, onClose }) {
  return (
    <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-200 font-semibold text-sm">
          <Receipt size={16} /> {title}
        </div>
        {onClose && (
          <button onClick={onClose} className="text-emerald-700/60 hover:text-emerald-700 dark:text-emerald-300/60 dark:hover:text-emerald-300">
            <X size={16} />
          </button>
        )}
      </div>
      <dl className="mt-3 space-y-1.5 text-sm">
        {lines.map((l) => (
          <div key={l.label} className="flex justify-between gap-4">
            <dt className="text-emerald-900/70 dark:text-emerald-100/70">{l.label}</dt>
            <dd className="text-emerald-900 dark:text-emerald-100 font-medium text-right break-all">{l.value}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t border-emerald-200 dark:border-emerald-900 pt-1.5 mt-1.5">
          <dt className="text-emerald-900 dark:text-emerald-100 font-semibold">Total charged</dt>
          <dd className="text-emerald-900 dark:text-emerald-100 font-bold">{total}</dd>
        </div>
      </dl>
      {note && <p className="mt-2 text-xs text-emerald-800/80 dark:text-emerald-200/80">{note}</p>}
    </div>
  );
}

// Promo redemption card. Pre-renders the caller's issued code state so the
// page is useful even without the ?code= deep link from the advisor chat.
function PromoRedeemCard({ initialCode, onRedeemed }) {
  const [code, setCode] = useState(initialCode || '');
  const [myPromo, setMyPromo] = useState(null);       // issued (maybe redeemed) promo
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmation, setConfirmation] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.productsPromo()
      .then((r) => {
        if (cancelled) return;
        setMyPromo(r?.promo || null);
        // Convenience: an issued, unredeemed code prefills the input when
        // the deep link didn't supply one.
        if (!initialCode && r?.promo && !r.promo.redeemed_at) setCode(r.promo.code);
      })
      .catch(() => { /* endpoint missing (dev backend) — hide silently */ });
    return () => { cancelled = true; };
  }, [initialCode]);

  const redeem = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.productsRedeem(trimmed);
      if (r?.ok && r.confirmation) {
        setConfirmation(r.confirmation);
        setMyPromo((p) => (p ? { ...p, redeemed_at: r.confirmation.redeemed_at } : p));
        onRedeemed?.(r.confirmation);
      } else {
        setError(REDEEM_REASONS[r?.reason] || "That code can't be redeemed.");
      }
    } catch (e) {
      const reason = e?.data?.reason;
      setError(REDEEM_REASONS[reason] || e?.message || 'Redemption failed — please try again.');
    } finally {
      setBusy(false);
    }
  }, [code, busy, onRedeemed]);

  if (confirmation) {
    return (
      <BillingReceipt
        title="Billing confirmation — promo redeemed"
        lines={[
          { label: 'Item', value: confirmation.license_label },
          { label: 'Promo code', value: confirmation.code },
          { label: 'Redeemed', value: formatDate(confirmation.redeemed_at) },
          { label: 'License active until', value: formatDate(confirmation.license_expires_at) },
        ]}
        total={formatMoney(0, confirmation.currency)}
        note="Your one-time promo code covered the full amount — nothing was charged."
      />
    );
  }

  const alreadyRedeemed = myPromo?.redeemed_at;
  return (
    <div className="rounded-xl border border-violet-200 dark:border-violet-900 bg-violet-50/60 dark:bg-violet-950/30 p-4">
      <div className="flex items-center gap-2 text-violet-800 dark:text-violet-200 font-semibold text-sm">
        <Ticket size={16} /> Redeem a promo code
      </div>
      {alreadyRedeemed ? (
        <p className="mt-2 text-sm text-violet-900/80 dark:text-violet-100/80">
          <BadgeCheck size={14} className="inline mr-1 -mt-0.5" />
          Your code <span className="font-mono font-medium">{myPromo.code}</span> was redeemed
          on {formatDate(myPromo.redeemed_at)} — the {myPromo.license_label.toLowerCase()} is active.
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-sm text-violet-900/80 dark:text-violet-100/80">
            Completed your Personal Advisor profile? Enter the one-time code from the chat to
            activate your free 30-day license.
          </p>
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <input
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') redeem(); }}
              placeholder="AXAL-XXXX-XXXX"
              spellCheck={false}
              className="flex-1 rounded-lg border border-violet-300 dark:border-violet-800 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-mono tracking-wide text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <button
              onClick={redeem}
              disabled={busy || !code.trim()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Redeem
            </button>
          </div>
          {error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
              <AlertTriangle size={12} /> {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function pickDisplayPrice(product) {
  const prices = Array.isArray(product?.prices) ? product.prices : [];
  return prices.find((p) => p && p.active !== false) || prices[0] || null;
}

function priceLabel(price) {
  if (!price || price.unit_amount == null) return 'Contact us';
  const base = formatMoney(price.unit_amount, price.currency);
  const interval = price.recurring?.interval;
  return interval ? `${base}/${interval}` : base;
}

function ProductCard({ product, onBuy }) {
  const price = pickDisplayPrice(product);
  const description = product.metadata?.description || '';
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="flex items-center gap-2">
        <Package size={16} className="text-violet-600 dark:text-violet-400 flex-shrink-0" />
        <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100">{product.name}</h3>
      </div>
      {description && (
        <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-400 line-clamp-3">{description}</p>
      )}
      <div className="mt-auto pt-3 flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{priceLabel(price)}</span>
        <button
          onClick={() => onBuy(product, price)}
          disabled={!price?.id}
          className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium disabled:opacity-50"
        >
          Buy
        </button>
      </div>
    </div>
  );
}

export default function ProductsPage() {
  const [searchParams] = useSearchParams();
  const deepLinkCode = searchParams.get('code') || '';

  const [products, setProducts] = useState(null);   // null = loading
  const [catalogError, setCatalogError] = useState(null);
  const [unlocks, setUnlocks] = useState([]);
  const [checkout, setCheckout] = useState(null);   // { product, price }
  const [paidReceipt, setPaidReceipt] = useState(null);

  const refreshUnlocks = useCallback(() => {
    api.alacarteUnlocks()
      .then((r) => setUnlocks(r?.unlocks || []))
      .catch(() => { /* dev backend without the route — hide */ });
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.catalogProducts()
      .then((r) => {
        if (cancelled) return;
        setProducts((r?.products || []).filter((p) => p.active !== false));
      })
      .catch((e) => {
        if (cancelled) return;
        setProducts([]);
        setCatalogError(e?.message || 'Could not load the catalog.');
      });
    refreshUnlocks();
    return () => { cancelled = true; };
  }, [refreshUnlocks]);

  const onPaidSuccess = useCallback((result) => {
    const { product, price } = checkout || {};
    setPaidReceipt({
      product_name: product?.name || 'Purchase',
      amount_cents: result?.free ? 0 : (price?.unit_amount ?? null),
      currency: price?.currency || 'usd',
      when: new Date().toISOString(),
      free: !!result?.free,
    });
    setCheckout(null);
    refreshUnlocks();
  }, [checkout, refreshUnlocks]);

  const grid = useMemo(() => {
    if (products === null) {
      return (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-8 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading catalog…
        </div>
      );
    }
    if (products.length === 0) {
      return (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
          {catalogError || 'No products are available right now — check back soon.'}
        </p>
      );
    }
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} onBuy={(product, price) => { setPaidReceipt(null); setCheckout({ product, price }); }} />
        ))}
      </div>
    );
  }, [products, catalogError]);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Package size={22} className="text-violet-600 dark:text-violet-400" /> Products
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Licenses, sessions and add-ons — purchased in-app, or unlocked with a promo code.
        </p>
      </div>

      <PromoRedeemCard initialCode={deepLinkCode} onRedeemed={refreshUnlocks} />

      {unlocks.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <BadgeCheck size={15} className="text-emerald-600 dark:text-emerald-400" /> Active licenses
          </h2>
          <ul className="mt-2 space-y-1">
            {unlocks.map((u) => (
              <li key={u.feature_key} className="text-xs text-gray-700 dark:text-gray-300 flex justify-between gap-4">
                <span className="font-mono">{u.feature_key}</span>
                <span className="text-gray-500 dark:text-gray-400">
                  {u.expires_at ? `until ${formatDate(u.expires_at)}` : 'permanent'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {paidReceipt && (
        <BillingReceipt
          title="Billing confirmation"
          lines={[
            { label: 'Item', value: paidReceipt.product_name },
            { label: 'Date', value: formatDate(paidReceipt.when) },
          ]}
          total={paidReceipt.amount_cents != null
            ? formatMoney(paidReceipt.amount_cents, paidReceipt.currency)
            : '—'}
          note={paidReceipt.free
            ? 'A promo code covered the full amount — nothing was charged.'
            : 'Payment confirmed. Your access is active; a card receipt follows from Stripe.'}
          onClose={() => setPaidReceipt(null)}
        />
      )}

      {checkout && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Checkout — {checkout.product.name}
            </h2>
            <button
              onClick={() => setCheckout(null)}
              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              title="Cancel checkout"
            >
              <X size={16} />
            </button>
          </div>
          <AxalCheckout
            priceId={checkout.price?.id}
            description={checkout.product.name}
            submitLabel="Pay now"
            onSuccess={onPaidSuccess}
            onError={() => { /* AxalCheckout renders its own inline error state */ }}
          />
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Catalog</h2>
        {grid}
      </div>
    </div>
  );
}
