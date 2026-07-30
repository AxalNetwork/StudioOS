// Products — in-house storefront on the Stripe-backed catalog (redesigned).
//
// Surfaces on one page:
//   1. Header + promo-redemption box (PRESERVED — the one-time 30-day-license
//      codes the Personal Advisor issues; $0, never touches Stripe).
//   2. Sticky billing toggle + cart bar (count badge, Review & Checkout).
//   3. Catalog grid with audience tabs. Catalog-driven billing: each product
//      shows only the cycles that have a real Stripe price.
//   4. One-time cart drawer (right slide-over) with promo validation + VAT.
//   5. Product slide-over (details, deep-linkable via /products/:productId).
//   6. Active-licenses surface (PRESERVED).
//   7. Admin-only "Add Product" button + modal (reuses adminCatalog create).
//
// Prices ALWAYS come from GET /catalog/products — never hardcoded, never
// client-computed. Subscriptions bypass the cart (one-click Stripe via the
// slide-over); one-time items go through the cart → /checkout.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate, useParams } from 'react-router-dom';
import {
  Package, Ticket, CheckCircle2, AlertTriangle, Loader2, X, BadgeCheck, Receipt,
  Sparkles, Plus,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import AxalCheckout from '../components/AxalCheckout';
import { useCart } from '../components/products/useCart';
import BillingCartBar from '../components/products/BillingCartBar';
import CartDrawer from '../components/products/CartDrawer';
import ProductCard from '../components/products/ProductCard';
import BundleCard from '../components/products/BundleCard';
import ProductSlideOver from '../components/products/ProductSlideOver';
import {
  formatMoney, formatDate, AUDIENCE_FILTERS, priceCycle, isBundleProduct,
} from '../components/products/productsShared';

const REDEEM_REASONS = {
  not_found: "That code isn't valid. Check for typos — codes look like AXAL-XXXX-XXXX.",
  already_redeemed: 'This code has already been redeemed.',
  expired: 'This code has expired.',
};

// ------- Shared billing-confirmation receipt (PRESERVED) -------
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

// ------- Promo redemption card (PRESERVED) -------
function PromoRedeemCard({ initialCode, onRedeemed }) {
  const [code, setCode] = useState(initialCode || '');
  const [myPromo, setMyPromo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmation, setConfirmation] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.productsPromo()
      .then((r) => {
        if (cancelled) return;
        setMyPromo(r?.promo || null);
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
  if (alreadyRedeemed) {
    return (
      <p className="mt-3 text-[13px] text-gray-500 dark:text-gray-400">
        <BadgeCheck size={14} className="inline mr-1 -mt-0.5 text-emerald-600 dark:text-emerald-400" />
        Your code <span className="font-mono font-medium text-gray-700 dark:text-gray-300">{myPromo.code}</span> was
        redeemed on {formatDate(myPromo.redeemed_at)} — the {myPromo.license_label.toLowerCase()} is active.
      </p>
    );
  }
  return (
    <div className="mt-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative">
          <Ticket size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') redeem(); }}
            placeholder="AXAL-XXXX-XXXX"
            spellCheck={false}
            className="w-full sm:w-[250px] h-10 rounded-[10px] border border-gray-900/[.14] dark:border-gray-700 bg-white dark:bg-gray-900 pl-9 pr-3 text-[13px] font-mono tracking-wide text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
            data-testid="promo-input"
          />
        </div>
        <button
          onClick={redeem}
          disabled={busy || !code.trim()}
          className="inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-[10px] border border-violet-600/25 bg-violet-600/[.06] hover:bg-violet-600/[.12] text-violet-600 dark:text-violet-400 text-[13px] font-semibold disabled:opacity-50"
          data-testid="promo-redeem"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          Redeem code
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
          <AlertTriangle size={12} /> {error}
        </p>
      ) : (
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
          Completed your Personal Advisor profile? Enter the one-time code from the chat to
          activate your free 30-day license.
        </p>
      )}
    </div>
  );
}

// ------- Introduction packs (PRESERVED) -------
// Prices come exclusively from GET /network/intro-packs — no client-side
// fallback amounts. If the endpoint is unavailable the section says so
// instead of showing stale numbers.
function IntroPacksSection({ onReceipt }) {
  const [packs, setPacks] = useState(null); // null = loading, [] = unavailable
  const [buying, setBuying] = useState(null);
  const [pendingKey, setPendingKey] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.introPacks()
      .then((r) => setPacks(Array.isArray(r?.packs) ? r.packs : []))
      .catch(() => setPacks([]));
  }, []);

  const buy = useCallback(async (pack) => {
    setError(null);
    setPendingKey(pack.key);
    try {
      const r = await api.introCreditsIntent(pack.key);
      if (!r?.client_secret) throw new Error('Checkout is unavailable right now.');
      setBuying({ pack, clientSecret: r.client_secret });
    } catch (e) {
      setError(e?.message || 'Could not start checkout.');
    } finally {
      setPendingKey(null);
    }
  }, []);

  return (
    <section>
      <div className="mb-3.5">
        <h2 className="text-[19px] font-bold tracking-[-.01em] text-gray-900 dark:text-gray-100">Introduction packs</h2>
        <p className="mt-0.5 text-[13px] text-gray-500 dark:text-gray-400">
          Top up your Network › Introductions balance. Purchased credits never expire and stack on
          your monthly allowance.
        </p>
      </div>
      {packs === null && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-6">
          <Loader2 size={15} className="animate-spin" /> Loading packs…
        </div>
      )}
      {packs !== null && packs.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-6">
          Introduction packs are unavailable right now — check back soon.
        </p>
      )}
      <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {(packs || []).map((p) => (
          <div key={p.key} className="flex flex-col bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[14px] p-[18px] shadow-sm transition-shadow hover:shadow-md">
            <div className="flex items-start gap-[11px]">
              <span className="flex-shrink-0 inline-flex w-9 h-9 rounded-[10px] bg-violet-600/[.09] text-violet-600 dark:text-violet-400 items-center justify-center">
                <Sparkles size={17} />
              </span>
              <div>
                <div className="text-[14.5px] font-bold text-gray-900 dark:text-gray-100">{p.label}</div>
                <p className="mt-1 text-[12.5px] leading-[1.4] text-gray-500 dark:text-gray-400">{p.blurb}</p>
              </div>
            </div>
            <div className="mt-auto pt-4 flex items-center justify-between gap-2.5">
              <div className="flex items-baseline gap-1">
                <span className="tabular-nums text-xl font-extrabold tracking-[-.02em] text-gray-900 dark:text-gray-100">
                  {formatMoney(p.amount_cents, p.currency)}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">one-time</span>
              </div>
              <button
                onClick={() => buy(p)}
                disabled={pendingKey === p.key}
                className="h-9 px-[15px] rounded-[9px] bg-violet-600 hover:bg-violet-700 text-white text-[12.5px] font-semibold disabled:opacity-50"
                data-testid={`intro-pack-buy-${p.key}`}
              >
                {pendingKey === p.key ? <Loader2 size={12} className="inline animate-spin" /> : 'Buy'}
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
          <AlertTriangle size={12} /> {error}
        </p>
      )}
      {buying && (
        <div className="mt-4 rounded-[14px] border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Checkout — {buying.pack.label}
            </h3>
            <button onClick={() => setBuying(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="Cancel checkout">
              <X size={16} />
            </button>
          </div>
          <AxalCheckout
            clientSecret={buying.clientSecret}
            description={`Introduction credits: ${buying.pack.label}`}
            submitLabel="Pay now"
            onSuccess={() => {
              onReceipt({
                product_name: `Introduction credits — ${buying.pack.label}`,
                amount_cents: buying.pack.amount_cents,
                currency: buying.pack.currency,
                when: new Date().toISOString(),
                free: false,
                note: 'Payment confirmed. Your credits are being added to Network › Introductions now.',
              });
              setBuying(null);
            }}
            onError={() => { /* AxalCheckout renders its own inline error state */ }}
          />
        </div>
      )}
    </section>
  );
}

// ------- Admin "Add Product" modal (reuses adminCatalog create) -------
function AddProductModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', kind: 'subscription', description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !form.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const meta = {};
      if (form.kind === 'incorporation') meta.kind = 'incorporation';
      else if (form.kind === 'session') meta.kind = 'session';
      else if (form.kind === 'alacarte') { meta.kind = 'alacarte'; meta.feature_key = ''; meta.unlock_days = ''; }
      if (form.description.trim()) meta.description = form.description.trim();
      await api.adminCatalogCreateProduct({ name: form.name.trim(), kind: form.kind, metadata: meta });
      onCreated?.();
      onClose();
    } catch (e2) {
      const details = e2?.data?.details;
      setError(details ? details.join('; ') : (e2?.message || 'Create failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-[85] bg-gray-900/50 flex items-start justify-center p-6 overflow-y-auto" style={{ animation: 'mrdFade .18s ease' }}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 mt-16">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Add product</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              autoFocus
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="e.g. Founder — Growth"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Kind</label>
            <select
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="subscription">Subscription</option>
              <option value="incorporation">Incorporation</option>
              <option value="session">Session</option>
              <option value="alacarte">À la carte</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="Short summary shown on the card."
            />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Add prices, edit or archive this product from the Admin › Catalog panel.
          </p>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">Cancel</button>
            <button type="submit" disabled={busy || !form.name.trim()} className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5">
              {busy && <Loader2 size={14} className="animate-spin" />} Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ProductsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { productId } = useParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const deepLinkCode = searchParams.get('code') || '';

  const cart = useCart();
  const [products, setProducts] = useState(null);   // null = loading
  const [catalogError, setCatalogError] = useState(null);
  const [unlocks, setUnlocks] = useState([]);
  const [paidReceipt, setPaidReceipt] = useState(null);
  const [audienceFilter, setAudienceFilter] = useState('all');
  const [globalCycle, setGlobalCycle] = useState('monthly');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [toast, setToast] = useState('');

  const refreshUnlocks = useCallback(() => {
    api.alacarteUnlocks()
      .then((r) => setUnlocks(r?.unlocks || []))
      .catch(() => { /* dev backend without the route — hide */ });
  }, []);

  const loadCatalog = useCallback(() => {
    api.catalogProducts()
      .then((r) => setProducts((r?.products || []).filter((p) => p.active !== false)))
      .catch((e) => { setProducts([]); setCatalogError(e?.message || 'Could not load the catalog.'); });
  }, []);

  useEffect(() => {
    loadCatalog();
    refreshUnlocks();
  }, [loadCatalog, refreshUnlocks]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(''), 2000);
  }, []);

  // Deep-linked product for the slide-over. When /products/:productId is hit
  // directly, open the panel pre-open once the catalog resolves.
  const openProduct = useMemo(
    () => (productId && products ? products.find((p) => p.id === productId) || null : null),
    [productId, products],
  );

  // How the product modal was opened: carries the bundle card's license
  // quantity and whether to reveal the embedded checkout immediately
  // (Subscribe button). Cleared on close and on plain deep links.
  const [modalIntent, setModalIntent] = useState(null);

  const handleOpenProduct = useCallback((product) => {
    setModalIntent(null);
    navigate(`/products/${encodeURIComponent(product.id)}`);
  }, [navigate]);

  const handlePreviewBundle = useCallback((product, { qty } = {}) => {
    setModalIntent({ qty: qty || 1, checkout: false });
    navigate(`/products/${encodeURIComponent(product.id)}`);
  }, [navigate]);

  const handleSubscribeBundle = useCallback((product, { qty } = {}) => {
    setModalIntent({ qty: qty || 1, checkout: true });
    navigate(`/products/${encodeURIComponent(product.id)}`);
  }, [navigate]);

  const handleCloseProduct = useCallback(() => {
    setModalIntent(null);
    navigate('/products');
  }, [navigate]);

  // Add a one-time item to the cart.
  const addToCart = useCallback((product, price, qty = 1) => {
    cart.add({
      price_id: price.id,
      product_id: product.id,
      name: product.name,
      currency: price.currency,
      unit_amount: price.unit_amount,
      cycle: priceCycle(price),
    }, qty);
    showToast(`${product.name} added to your order`);
  }, [cart, showToast]);

  // Subscription one-click success (from the modal's embedded checkout).
  // Clear the modal intent so back/deep-link reopens never resume checkout.
  const onSubscribed = useCallback(({ product, price, result }) => {
    setModalIntent(null);
    setPaidReceipt({
      product_name: product?.name || 'Subscription',
      amount_cents: result?.free ? 0 : (price?.unit_amount ?? null),
      currency: price?.currency || 'usd',
      when: new Date().toISOString(),
      free: !!result?.free,
    });
    navigate('/products');
    refreshUnlocks();
  }, [navigate, refreshUnlocks]);

  const goCheckout = useCallback(() => {
    setDrawerOpen(false);
    navigate('/checkout');
  }, [navigate]);

  // Split the live catalog into the prototype's two sections: role
  // subscriptions ("Profile bundles") and everything else ("Add-ons &
  // services"). The audience filter applies to the add-ons grid only.
  const bundles = useMemo(
    () => (products || []).filter(isBundleProduct),
    [products],
  );
  const addons = useMemo(
    () => (products || []).filter((p) => !isBundleProduct(p)),
    [products],
  );
  const visibleAddons = useMemo(() => {
    if (audienceFilter === 'all') return addons;
    return addons.filter((p) => Array.isArray(p.categories) && p.categories.includes(audienceFilter));
  }, [addons, audienceFilter]);

  const filterBar = useMemo(() => {
    if (products === null || addons.length === 0) return null;
    const pill = (active) => `px-3.5 py-[7px] rounded-full text-[12.5px] font-semibold border transition-colors ${
      active
        ? 'bg-[#14142B] dark:bg-gray-100 border-transparent text-white dark:text-gray-900'
        : 'bg-white dark:bg-gray-900 border-gray-900/10 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
    }`;
    return (
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setAudienceFilter('all')} className={pill(audienceFilter === 'all')}>
          All
        </button>
        {AUDIENCE_FILTERS.map((f) => (
          <button key={f.value} onClick={() => setAudienceFilter(f.value)} className={pill(audienceFilter === f.value)}>
            {f.label}
          </button>
        ))}
      </div>
    );
  }, [products, addons, audienceFilter]);

  const loadingState = products === null && (
    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-10 justify-center">
      <Loader2 size={16} className="animate-spin" /> Loading catalog…
    </div>
  );
  const emptyState = products !== null && products.length === 0 && (
    <p className="text-sm text-gray-500 dark:text-gray-400 py-10 text-center">
      {catalogError || 'No products are available right now — check back soon.'}
    </p>
  );

  return (
    <div className="max-w-[1240px] space-y-7">
      {/* Slide-over / drawer animations (scoped inline — global CSS untouched). */}
      <style>{`
        @keyframes mrdFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes mrdSlide { from { transform: translateX(100%) } to { transform: translateX(0) } }
        @keyframes mrdPop { 0% { transform: scale(.96); opacity: 0 } 100% { transform: scale(1); opacity: 1 } }
      `}</style>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-[32px] leading-tight font-extrabold tracking-[-.02em] text-gray-900 dark:text-gray-100 flex items-center gap-2.5">
            <Package size={26} className="text-violet-600 dark:text-violet-400" /> Products
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1.5 max-w-2xl">
            One clear catalog — profile bundles, introduction packs, and add-ons. Purchased
            in-app, or unlocked with a promo code.
          </p>
          <PromoRedeemCard initialCode={deepLinkCode} onRedeemed={refreshUnlocks} />
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowAddProduct(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium"
          >
            <Plus size={15} /> Add Product
          </button>
        )}
      </div>

      <BillingCartBar
        cycle={globalCycle}
        onCycleChange={setGlobalCycle}
        cart={cart}
        onOpenDrawer={() => setDrawerOpen(true)}
      />

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
          note={paidReceipt.note || (paidReceipt.free
            ? 'A promo code covered the full amount — nothing was charged.'
            : 'Payment confirmed. Your access is active; a card receipt follows from Stripe.')}
          onClose={() => setPaidReceipt(null)}
        />
      )}

      {loadingState}
      {emptyState}

      {bundles.length > 0 && (
        <section>
          <div className="mb-3.5">
            <h2 className="text-[19px] font-bold tracking-[-.01em] text-gray-900 dark:text-gray-100">Profile bundles</h2>
            <p className="mt-0.5 text-[13px] text-gray-500 dark:text-gray-400">
              Role-based subscriptions — pick the profile that matches how you use Axal.
            </p>
          </div>
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {bundles.map((p) => (
              <BundleCard
                key={p.id}
                product={p}
                globalCycle={globalCycle}
                onPreview={handlePreviewBundle}
                onSubscribe={handleSubscribeBundle}
              />
            ))}
          </div>
        </section>
      )}

      <IntroPacksSection onReceipt={(r) => setPaidReceipt(r)} />

      {(addons.length > 0 || (products !== null && products.length > 0)) && (
        <section>
          <div className="flex items-end justify-between gap-3 mb-3.5 flex-wrap">
            <div>
              <h2 className="text-[19px] font-bold tracking-[-.01em] text-gray-900 dark:text-gray-100">Add-ons &amp; services</h2>
              <p className="mt-0.5 text-[13px] text-gray-500 dark:text-gray-400">
                Incorporations, intelligence and standalone services — one-time or recurring.
              </p>
            </div>
            {filterBar}
          </div>
          {visibleAddons.length > 0 ? (
            <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {visibleAddons.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  globalCycle={globalCycle}
                  onOpen={handleOpenProduct}
                  onAddToCart={addToCart}
                  onBuySubscription={(product) => handleOpenProduct(product)}
                />
              ))}
            </div>
          ) : (
            products !== null && products.length > 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
                No products match this filter yet.
              </p>
            )
          )}
        </section>
      )}

      {unlocks.length > 0 && (
        <div className="rounded-[14px] border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
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

      <CartDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        cart={cart}
        appliedPromo={cart.promo}
        onPromoChange={cart.setPromo}
        onCheckout={goCheckout}
      />

      <ProductSlideOver
        product={openProduct}
        globalCycle={globalCycle}
        onClose={handleCloseProduct}
        onAddToCart={addToCart}
        onSubscribed={onSubscribed}
        initialQty={modalIntent?.qty || 1}
        initialCheckout={Boolean(modalIntent?.checkout)}
      />

      {showAddProduct && (
        <AddProductModal onClose={() => setShowAddProduct(false)} onCreated={loadCatalog} />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-gray-900 text-white px-5 py-3 rounded-xl text-sm font-medium shadow-2xl flex items-center gap-2" style={{ animation: 'mrdPop .2s ease' }}>
          <CheckCircle2 size={16} className="text-violet-400" /> {toast}
        </div>
      )}
    </div>
  );
}
