// /checkout — auth-protected cart checkout, or one isolated D755 token pack.
//   Left  = editable order summary + promo (subtotal / discount / VAT / total).
//   Right = Stripe Elements (Payment Intents) with #6B46C1 accent, prefilled
//           email, card, name, billing address (country drives VAT), optional
//           company / VAT number, save-payment-method toggle.
//
// Flow: createOrderIntent → get client_secret → confirm with Stripe →
// confirmOrder → redirect to /checkout/confirmation?order=MRD-YYYY-XXXXX.
// Prices/discount/VAT are recomputed server-side by /orders/intent — the client
// summary is a live preview only.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { TOKEN_PACKS_PATH, TOPUP_UNAVAILABLE, aiTokenState, packLabel, packOfferLines, sellableLine } from '../lib/aiTokens';
import { aiBudgetApi } from '../lib/api/aiBudget';
import { Elements, PaymentElement, AddressElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { Loader2, Lock, AlertTriangle, ArrowLeft, ShoppingCart, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { useSettings } from '../contexts/SettingsContext';
import { getStripe, buildAppearance } from '../lib/stripe';
import { useCart } from '../components/products/useCart';
import { formatMoney, vatRate, cycleCadenceLabel } from '../components/products/productsShared';

const PROMO_REASONS = {
  not_found: "That code isn't valid.",
  inactive: 'This code is no longer active.',
  expired: 'This code has expired.',
  product_not_eligible: "This code doesn't apply to these items.",
  product_list_unreadable: "This code can't be applied right now.",
  usage_limit_reached: 'This code has reached its usage limit.',
  currency_mismatch: "This code can't be used for this purchase.",
};

// Left column — editable order summary + promo.
export function OrderSummary({ cart, appliedPromo, onPromoChange, billingCountry, pack = null }) {
  const [code, setCode] = useState(appliedPromo?.code || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { setCode(appliedPromo?.code || ''); }, [appliedPromo]);

  const subtotal = cart.subtotal;
  const discount = appliedPromo?.discount_cents || 0;
  const taxable = Math.max(0, subtotal - discount);
  const vat = Math.round(taxable * vatRate(billingCountry));
  const total = taxable + vat;

  const apply = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed || busy || !cart.items.length) return;
    setBusy(true); setMsg(null);
    try {
      const res = await api.validatePromo({ code: trimmed, price_id: cart.items[0].price_id });
      if (!res?.valid) {
        onPromoChange(null);
        setMsg({ ok: false, text: PROMO_REASONS[res?.reason] || "That code can't be applied." });
      } else {
        let discountCents = 0;
        if (res.percent_off) discountCents = Math.round(subtotal * (res.percent_off / 100));
        else if (res.amount_off) discountCents = Math.min(res.amount_off, subtotal);
        onPromoChange({ ...res, code: res.code || trimmed, discount_cents: discountCents });
        setMsg({ ok: true, text: res.free ? 'Your order is free.' : 'Promo applied.' });
      }
    } catch (e) {
      onPromoChange(null);
      setMsg({ ok: false, text: e?.message || "Couldn't check that code." });
    } finally { setBusy(false); }
  }, [code, busy, cart.items, subtotal, onPromoChange]);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Order summary</h2>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {cart.items.map((l) => (
          <div key={l.price_id} className="py-3">
            <div className="flex justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{pack ? `${packLabel(pack.unit_amount)} · One-time purchase` : l.name}</div>
                {!pack && <div className="text-xs text-gray-500 dark:text-gray-400">{cycleCadenceLabel(l.cycle || 'onetime')}</div>}
              </div>
              {!pack && <button onClick={() => l && cart.remove(l.price_id)} className="text-xs text-gray-400 hover:text-red-500 h-fit">Remove</button>}
            </div>
            <div className="mt-2 flex items-center justify-between">
              {!pack && <div className="inline-flex items-center border border-gray-300 dark:border-gray-700 rounded-lg overflow-hidden">
                <button onClick={() => cart.changeQty(l.price_id, -1)} className="w-7 h-8 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800">−</button>
                <span className="min-w-[24px] text-center text-sm font-semibold text-gray-900 dark:text-gray-100">{l.quantity}</span>
                <button onClick={() => cart.changeQty(l.price_id, 1)} className="w-7 h-8 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800">+</button>
              </div>}
              <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                {formatMoney((Number(l.unit_amount) || 0) * l.quantity, l.currency)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {pack && <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">Adds {formatMoney(pack.unit_amount, pack.currency)} to your top-up balance once the payment is confirmed.</p>}
      {pack && packOfferLines(pack).map(line => <p key={line} className="mt-1 text-sm text-gray-600 dark:text-gray-300" data-testid="checkout-pack-offer">{line}</p>)}
      {!pack && <><div className="mt-4 flex gap-2">
        <input
          value={code}
          onChange={(e) => { setCode(e.target.value); setMsg(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
          placeholder="Promo code"
          autoCapitalize="characters"
          className="flex-1 h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
        <button onClick={apply} disabled={busy || !code.trim()} className="h-10 px-4 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : 'Apply'}
        </button>
      </div>
      {msg && (
        <p className={`mt-2 text-xs flex items-center gap-1 ${msg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          {msg.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} {msg.text}
        </p>
      )}

      </>}
      <div className="mt-4 space-y-2 text-sm border-t border-gray-200 dark:border-gray-800 pt-4">
        <div className="flex justify-between text-gray-500 dark:text-gray-400">
          <span>Subtotal</span>
          <span className="text-gray-900 dark:text-gray-100 font-semibold">{formatMoney(subtotal, cart.currency)}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
            <span>Discount ({appliedPromo?.code})</span>
            <span className="font-semibold">−{formatMoney(discount, cart.currency)}</span>
          </div>
        )}
        <div className="flex justify-between text-gray-500 dark:text-gray-400">
          <span>VAT ({Math.round(vatRate(billingCountry) * 100)}%, est.)</span>
          <span className="text-gray-900 dark:text-gray-100 font-semibold">{formatMoney(vat, cart.currency)}</span>
        </div>
        <div className="flex justify-between items-baseline pt-2 border-t border-gray-200 dark:border-gray-800">
          <span className="text-sm font-bold text-gray-900 dark:text-gray-100">Total</span>
          <span className="text-2xl font-extrabold text-gray-900 dark:text-gray-100">{formatMoney(total, cart.currency)}</span>
        </div>
      </div>
    </div>
  );
}

// Right column — Stripe payment form (mounted inside <Elements>).
function PaymentForm({ email, fullName, onCountryChange, onPay, submitting, error }) {
  const stripe = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    onPay(stripe, elements);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Email</label>
        <input
          type="email"
          value={email}
          disabled
          className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-500 dark:text-gray-400"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Card details</label>
        <PaymentElement options={{ layout: 'tabs' }} onReady={() => setReady(true)} />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Billing address</label>
        <AddressElement
          options={{
            mode: 'billing',
            fields: { phone: 'never' },
            defaultValues: {
              ...(fullName ? { name: fullName } : {}),
              address: { country: 'US' },
            },
          }}
          onChange={(ev) => {
            if (ev?.value?.address?.country) onCountryChange(ev.value.address.country);
          }}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || !elements || submitting || !ready}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors"
      >
        {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</> : 'Pay & complete order'}
      </button>
      <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1.5">
        <Lock className="w-3 h-3" /> Secured by Stripe · Your card details never touch our servers.
      </p>
    </form>
  );
}

// A pack and the retired URL never mount useCart: even a stored promo stays untouched.
export default function CheckoutPage() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  if (params.get('ai_topup') === '1') return <Navigate to={TOKEN_PACKS_PATH} replace />;
  if (params.has('token_pack')) return <TokenPackCheckout key={params.get('token_pack')} uid={params.get('token_pack')} />;
  return <CartCheckout />;
}

function CartCheckout() {
  const cart = useCart();
  return <Checkout cart={cart} />;
}

export function TokenPackCheckout({ uid }) {
  const [reading, setReading] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    setReading({ loading: true });
    aiBudgetApi.topUp().then(data => { if (live) setReading({ data }); })
      .catch(() => { if (live) setReading({ error: true }); });
    return () => { live = false; };
  }, [uid]);
  // CR7 consumes CR2's pack list, not D750's deprecated single-product fields.
  const state = aiTokenState(reading);
  // The environment fallback has no pack uid; its advertised price id is its key.
  const pack = state === 'ready' && Array.isArray(reading.data?.packs)
    ? reading.data.packs.find(p => p.uid === uid || (p.uid == null && p.price_id === uid)) : null;
  const cart = useMemo(() => pack && sellableLine(pack) ? {
    items: [{ ...pack, name: packLabel(pack.unit_amount), quantity: 1, cycle: 'onetime' }],
    subtotal: pack.unit_amount, currency: pack.currency, promo: null,
  } : null, [pack]);
  if (state !== 'ready' || !cart) return <div className="max-w-lg mx-auto py-16 text-center text-gray-700 dark:text-gray-300" aria-busy={state === 'loading'}>
    <h1 className="text-lg font-bold">{state === 'loading' ? 'Loading token pack…' : state === 'unreadable' ? 'Unreadable' : TOPUP_UNAVAILABLE}</h1>
    {state === 'unreadable' && <p>The token pack could not be read. Refresh to retry.</p>}
    <a href="/pricing/products" className="mt-4 inline-flex text-violet-600 dark:text-violet-400">Back to Plans &amp; Pricing</a>
  </div>;
  return <Checkout cart={cart} pack={pack} />;
}

export function Checkout({ cart, pack = null }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { effectiveTheme } = useSettings();
  const isDark = effectiveTheme === 'dark';

  const email = user?.email || '';
  const fullName = user?.full_name || user?.name || '';

  const stripePromise = useMemo(() => getStripe(), []);
  const [stripeConfigured, setStripeConfigured] = useState(null);
  useEffect(() => { stripePromise.then((s) => setStripeConfigured(s !== null)); }, [stripePromise]);

  const appliedPromo = cart.promo;
  const setAppliedPromo = cart.setPromo;
  const [billingCountry, setBillingCountry] = useState('');
  const [company, setCompany] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [savePm, setSavePm] = useState(false);

  const [clientSecret, setClientSecret] = useState(null);
  const [orderRef, setOrderRef] = useState(null);
  const [freeOrder, setFreeOrder] = useState(false);
  const [intentError, setIntentError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [payError, setPayError] = useState(null);

  const nonceRef = useRef(null);
  if (nonceRef.current == null) {
    nonceRef.current =
      (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
  }

  // Empty cart → nothing to check out.
  const empty = cart.items.length === 0;

  // Create / refresh the combined order PaymentIntent whenever the cart, promo
  // or billing country changes. Server recomputes amounts (never trusts client).
  useEffect(() => {
    if (empty || stripeConfigured !== true) return;
    let cancelled = false;
    setIntentError(null);
    setClientSecret(null);
    setOrderRef(null);
    setFreeOrder(false);
    const body = {
      items: cart.items.map((l) => ({ price_id: l.price_id, quantity: l.quantity })),
      nonce: nonceRef.current,
    };
    if (!pack && appliedPromo?.code) body.promo_code = appliedPromo.code;
    if (billingCountry) body.billing_country = billingCountry;
    api.createOrderIntent(body)
      .then((res) => {
        if (cancelled) return;
        if (pack && res?.free) throw new Error('The token-pack order could not be read. Refresh to retry.');
        setOrderRef(res?.order_ref || null);
        if (res?.free) {
          setFreeOrder(true);
          setClientSecret(null);
        } else {
          setFreeOrder(false);
          setClientSecret(res?.client_secret || null);
        }
      })
      .catch((e) => { if (!cancelled) setIntentError(e?.message || 'Could not start checkout.'); });
    return () => { cancelled = true; };
  }, [empty, stripeConfigured, cart.items, appliedPromo, billingCountry, pack]);

  const finish = useCallback(async (paymentIntentId) => {
    try {
      if (paymentIntentId && !pack) await api.confirmOrder(paymentIntentId);
    } catch {
      // Fulfilment also runs server-side via webhook; the confirmation page
      // reads the authoritative order. Don't block the redirect on a 409.
    }
    if (!pack) cart.clear();
    const packQuery = pack ? `&token_pack=${encodeURIComponent(pack.uid ?? pack.price_id)}` : '';
    navigate(`/checkout/confirmation?order=${encodeURIComponent(orderRef)}${packQuery}`);
  }, [cart, navigate, orderRef, pack]);

  // Free order (100%-off promo) — server already fulfilled; just redirect.
  const completeFree = useCallback(async () => {
    if (!orderRef) return;
    cart.clear();
    navigate(`/checkout/confirmation?order=${encodeURIComponent(orderRef)}`);
  }, [cart, navigate, orderRef]);

  const pay = useCallback(async (stripe, elements) => {
    if (submitting) return;
    setSubmitting(true);
    setPayError(null);
    try {
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setPayError(submitError.message || 'Please check your payment details.');
      setSubmitting(false);
      return;
    }
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      confirmParams: {
        payment_method_data: {
          billing_details: { name: fullName || undefined, email: email || undefined },
        },
        ...(!pack && savePm ? { setup_future_usage: 'off_session' } : {}),
      },
    });
    if (confirmError) {
      setPayError(pack ? `The payment did not go through, so no tokens were added. ${confirmError.message || ''}`.trim() : confirmError.message || 'Payment failed. Please try again.');
      setSubmitting(false);
      return;
    }
    const status = paymentIntent?.status;
    if (status === 'succeeded' || status === 'processing' || status === 'requires_capture') {
      await finish(paymentIntent?.id);
      return;
    }
    setPayError(pack ? 'The payment did not go through, so no tokens were added.' : 'Payment could not be completed. Please try another card.');
    setSubmitting(false);
    } catch (error) {
      const message = error?.message || 'Payment could not be completed. Please try another card.';
      setPayError(pack ? `The payment did not go through, so no tokens were added. ${message}` : message);
      setSubmitting(false);
    }
  }, [submitting, fullName, email, savePm, finish, pack]);

  if (empty) {
    return (
      <div className="max-w-lg mx-auto py-16 text-center">
        <span className="inline-flex w-16 h-16 rounded-2xl bg-violet-50 dark:bg-violet-950/40 text-violet-300 dark:text-violet-500 items-center justify-center mb-4">
          <ShoppingCart size={30} />
        </span>
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">Your order is empty</h1>
        <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">Add one-time items from the catalog to check out.</p>
        <button onClick={() => navigate('/pricing/products')} className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium">
          <ArrowLeft size={15} /> Back to Plans &amp; Pricing
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <button onClick={() => navigate('/pricing/products')} className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-violet-600 dark:hover:text-violet-400 mb-2">
          <ArrowLeft size={15} /> Back to Plans &amp; Pricing
        </button>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Checkout</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <OrderSummary
          cart={cart}
          pack={pack}
          appliedPromo={appliedPromo}
          onPromoChange={setAppliedPromo}
          billingCountry={billingCountry}
        />

        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Payment</h2>

          {stripeConfigured === null && (
            <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2 animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading payment form…
            </div>
          )}
          {stripeConfigured === false && (
            <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Payments are not configured in this environment.</span>
            </div>
          )}
          {intentError && (
            <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{intentError}</span>
            </div>
          )}

          {/* Optional company / VAT + save-card toggle */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Company (optional)</label>
              <input value={company} onChange={(e) => setCompany(e.target.value)} className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">VAT number (optional)</label>
              <input value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500" />
            </div>
          </div>

          {stripeConfigured === true && freeOrder && (
            <div className="space-y-3">
              <div className="rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 p-3 text-sm text-emerald-700 dark:text-emerald-300 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Your promo covers the full amount — no payment required.</span>
              </div>
              <button onClick={completeFree} className="w-full px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-semibold">
                Complete free order
              </button>
            </div>
          )}

          {stripeConfigured === true && !freeOrder && clientSecret && (
            <Elements
              key={`${clientSecret}:${effectiveTheme}`}
              stripe={stripePromise}
              options={{ clientSecret, appearance: buildAppearance(isDark) }}
            >
              {!pack && <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input type="checkbox" checked={savePm} onChange={(e) => setSavePm(e.target.checked)} className="rounded border-gray-300 dark:border-gray-700 text-violet-600 focus:ring-violet-500" />
                Save this payment method for future purchases
              </label>}
              <PaymentForm
                email={email}
                fullName={fullName}
                onCountryChange={setBillingCountry}
                onPay={pay}
                submitting={submitting}
                error={payError}
              />
            </Elements>
          )}

          {stripeConfigured === true && !freeOrder && !clientSecret && !intentError && (
            <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2 animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin" /> Preparing your order…
            </div>
          )}
        </div>
        {pack && <p className="text-xs text-gray-500 dark:text-gray-400">Sold by Axal VC Management LLC.</p>}
    </div>
    </div>
  );
}
