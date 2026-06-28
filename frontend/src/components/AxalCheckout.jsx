import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { Loader2, Lock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { useSettings } from '../contexts/SettingsContext';
import { getStripe, buildAppearance, STRIPE_PUBLISHABLE_KEY } from '../lib/stripe';
import Skeleton from './Skeleton';

/**
 * Task #4 — Axal-branded embedded checkout component.
 *
 * Renders Stripe Elements (Payment Element) INSIDE the app so users pay without
 * ever leaving for checkout.stripe.com. The component:
 *   1. Fetches a `client_secret` from `POST /api/payments/intent` for the given
 *      price id (or ad-hoc amount).
 *   2. Mounts <Elements> with an Axal-themed appearance (light/dark aware).
 *   3. Confirms the payment in-app via `stripe.confirmPayment({ redirect:
 *      'if_required' })` — a 3DS / SCA challenge surfaces inline (Stripe renders
 *      it in a modal/iframe), never redirecting to Stripe.
 *   4. Fires `onSuccess(result)` / `onError(error)` callbacks for callers.
 *
 * Card data is captured exclusively by Stripe Elements — raw card numbers never
 * touch our code (PCI scope stays SAQ A) and are never logged.
 *
 * Props:
 *   clientSecret — pre-created PaymentIntent client_secret (e.g. a booking
 *                  intent minted server-side with a Connect destination
 *                  transfer). When provided, the component renders that intent
 *                  directly and skips its own POST /api/payments/intent fetch.
 *   priceId      — Stripe price id (recurring → subscription, one-time → charge)
 *   amount       — ad-hoc one-time amount in the smallest currency unit (cents)
 *   currency     — ISO currency for the ad-hoc path (default 'usd')
 *   quantity     — line quantity (default 1)
 *   description  — optional charge description
 *   submitLabel  — button label (default 'Pay now')
 *   onSuccess(result) — fired after a successful / processing confirmation
 *   onError(error)    — fired on a terminal payment error
 */
// Task #9 — friendly copy for each server-side promo rejection `reason`.
const PROMO_REASONS = {
  not_found: "That code isn't valid.",
  inactive: 'This code is no longer active.',
  expired: 'This code has expired.',
  product_not_eligible: "This code doesn't apply to this item.",
  usage_limit_reached: 'This code has reached its usage limit.',
  currency_mismatch: "This code can't be used for this purchase.",
  amount_below_minimum: 'This code lowers the total below the minimum we can process.',
};
function promoReasonText(reason) {
  return PROMO_REASONS[reason] || "That code can't be applied to this purchase.";
}

function formatMoney(cents, currency) {
  const amt = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (currency || 'usd').toUpperCase(),
    }).format(amt);
  } catch {
    return `${amt.toFixed(2)} ${(currency || '').toUpperCase()}`.trim();
  }
}

export default function AxalCheckout(props) {
  const { priceId, amount, currency, quantity, description, clientSecret: providedClientSecret } = props;
  const { effectiveTheme } = useSettings();
  const isDark = effectiveTheme === 'dark';

  const stripePromise = useMemo(() => getStripe(), []);
  // Task #16 — runtime key: resolve the async getStripe() promise so we can
  // distinguish loading (null) → configured (true) → not configured (false)
  // without hard-gating on the build-time STRIPE_PUBLISHABLE_KEY env var.
  const [stripeConfigured, setStripeConfigured] = useState(null); // null=loading
  useEffect(() => {
    stripePromise.then((s) => setStripeConfigured(s !== null));
  }, [stripePromise]);

  const [clientSecret, setClientSecret] = useState(providedClientSecret || null);
  const [intentKind, setIntentKind] = useState(providedClientSecret ? 'payment' : null);
  const [loadError, setLoadError] = useState(null);
  // Task #9 — applied promo (the validate-preview result) + free-order state.
  const [appliedPromo, setAppliedPromo] = useState(null);
  // A 100%-off (free) promo activates the purchase the instant we fetch the
  // intent, so we gate that behind an explicit confirm click instead of
  // auto-fetching like the paid path does.
  const [freeConfirm, setFreeConfirm] = useState(false);
  const [freeResult, setFreeResult] = useState(null);
  const promoCode = appliedPromo?.code || '';
  const promoFree = !!appliedPromo?.free;
  // Keep onSuccess out of the effect deps (its identity can change every
  // render) — call through a ref so the free-activation fires exactly once.
  const onSuccessRef = useRef(props.onSuccess);
  onSuccessRef.current = props.onSuccess;
  // Stable nonce per mount so retries of the same purchase reuse the
  // server-side idempotency key instead of creating duplicate intents.
  const nonceRef = useRef(null);
  if (nonceRef.current == null) {
    nonceRef.current =
      (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
      String(Date.now());
  }

  useEffect(() => {
    // Wait until the runtime key check resolves. stripeConfigured===null means
    // still loading; false means no key configured. Either way, no backend
    // intent/subscription call should be made — Stripe would reject it anyway
    // and we'd be creating orphan/incomplete objects in Stripe.
    if (stripeConfigured !== true) return;
    // Caller-supplied secret (e.g. a booking PaymentIntent created server-side
    // with a Connect destination transfer) — render it directly, no fetch.
    if (providedClientSecret) {
      setClientSecret(providedClientSecret);
      setIntentKind('payment');
      setLoadError(null);
      return;
    }
    if (priceId == null && amount == null) {
      setLoadError('Nothing to pay for.');
      return;
    }
    // Free promo applied but not yet confirmed — don't fetch the intent (that
    // would activate the subscription / grant the unlock immediately). Render
    // the explicit "Complete free order" button instead.
    if (promoCode && promoFree && !freeConfirm) {
      setClientSecret(null);
      setLoadError(null);
      setFreeResult(null);
      return;
    }
    let cancelled = false;
    setClientSecret(null);
    setLoadError(null);
    const body = { nonce: nonceRef.current };
    if (priceId != null) body.price_id = priceId;
    if (amount != null) {
      body.amount = amount;
      if (currency) body.currency = currency;
    }
    if (quantity != null) body.quantity = quantity;
    if (description) body.description = description;
    // Promo code flows into the idempotency key server-side, so applying or
    // removing a code re-fetches a fresh discounted (or full-price) intent.
    if (promoCode) body.promo_code = promoCode;

    api
      .paymentIntent(body)
      .then((res) => {
        if (cancelled) return;
        // Zero-due (100%-off) order — no PaymentIntent to confirm; the server
        // already activated the subscription / granted the unlock.
        if (res?.free) {
          setFreeResult(res);
          onSuccessRef.current?.({ ...res, free: true, kind: res.kind });
          return;
        }
        if (!res?.client_secret) {
          setLoadError('Could not start checkout. Please try again.');
          return;
        }
        setClientSecret(res.client_secret);
        setIntentKind(res.kind || null);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e?.message || 'Could not start checkout. Please try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [stripeConfigured, priceId, amount, currency, quantity, description, providedClientSecret, promoCode, promoFree, freeConfirm]);

  // Still resolving the runtime key — show a neutral loading placeholder.
  if (stripeConfigured === null) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-4 text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2 animate-pulse">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Loading payment form…</span>
      </div>
    );
  }

  // Publishable key unavailable at runtime → graceful unavailable state.
  if (!stripeConfigured) {
    return (
      <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>Payments are not configured in this environment.</span>
      </div>
    );
  }

  // Promo codes only apply to catalog-priced purchases (a raw ad-hoc amount has
  // no product to scope the allow-list against, and the server rejects it).
  const showPromo = priceId != null && !providedClientSecret;
  const promoField = showPromo ? (
    <PromoField
      priceId={priceId}
      applied={appliedPromo}
      onApply={(preview) => {
        setAppliedPromo(preview);
        setFreeConfirm(false);
        setFreeResult(null);
        setLoadError(null);
      }}
      onRemove={() => {
        setAppliedPromo(null);
        setFreeConfirm(false);
        setFreeResult(null);
        setLoadError(null);
      }}
    />
  ) : null;

  let body;
  if (freeResult) {
    body = (
      <div className="rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 p-4 text-sm text-green-700 dark:text-green-300 flex items-start gap-2">
        <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
        <span>Order complete — your code covered the full amount. Thank you!</span>
      </div>
    );
  } else if (loadError) {
    body = (
      <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>{loadError}</span>
      </div>
    );
  } else if (promoCode && promoFree && !freeConfirm) {
    body = (
      <button
        type="button"
        onClick={() => setFreeConfirm(true)}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors"
      >
        Complete free order
      </button>
    );
  } else if (!clientSecret) {
    body = <CheckoutSkeleton />;
  } else {
    const appearance = buildAppearance(isDark);
    body = (
      // Re-mount Elements when the client secret or theme changes — Stripe only
      // reads `appearance` at Elements creation time.
      <Elements
        key={`${clientSecret}:${effectiveTheme}`}
        stripe={stripePromise}
        options={{ clientSecret, appearance }}
      >
        <CheckoutForm
          {...props}
          intentKind={intentKind}
          clientSecret={clientSecret}
        />
      </Elements>
    );
  }

  return (
    <div className="space-y-4">
      {promoField}
      {body}
    </div>
  );
}

/**
 * Task #9 — promo code entry + live preview. "Apply" calls
 * `POST /api/payments/promo/validate` which validates the code against the
 * product allow-list + usage limit and recomputes the discount server-side
 * (the client amount is never trusted). On success the parent re-fetches a
 * discounted intent; rejections surface inline with a friendly message.
 */
function PromoField({ priceId, applied, onApply, onRemove }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const apply = async () => {
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api.validatePromo({ code: trimmed, price_id: priceId });
      if (!res?.valid) {
        setErr(promoReasonText(res?.reason));
        setBusy(false);
        return;
      }
      onApply(res);
      setBusy(false);
    } catch (e) {
      setErr(e?.message || "Couldn't check that code. Please try again.");
      setBusy(false);
    }
  };

  if (applied) {
    const savings = applied.free
      ? 'your order is free'
      : applied.percent_off
        ? `${applied.percent_off}% off applied`
        : `${formatMoney(applied.amount_off, applied.currency)} off`;
    return (
      <div className="rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 p-3 text-sm text-green-700 dark:text-green-300 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 min-w-0">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span className="truncate">
            Code <strong>{applied.code}</strong> — {savings}
          </span>
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 text-xs font-medium text-green-700 dark:text-green-300 underline hover:no-underline"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor="promo-code" className="block text-xs font-medium text-gray-600 dark:text-gray-400">
        Promo code
      </label>
      <div className="flex gap-2">
        <input
          id="promo-code"
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            }
          }}
          placeholder="Enter code"
          autoComplete="off"
          autoCapitalize="characters"
          className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
        <button
          type="button"
          onClick={apply}
          disabled={busy || !code.trim()}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
        </button>
      </div>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </div>
  );
}

function CheckoutForm({ submitLabel, onSuccess, onError, intentKind }) {
  const stripe = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [succeeded, setSucceeded] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    setError(null);

    // Run client-side validation first so empty/invalid fields surface inline.
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message || 'Please check your payment details.');
      setSubmitting(false);
      return;
    }

    // `redirect: 'if_required'` keeps 3DS / SCA challenges inline (Stripe renders
    // the challenge in a modal) and only returns a redirect URL when the payment
    // method genuinely requires a full redirect (none of ours do).
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });

    if (confirmError) {
      const msg = confirmError.message || 'Payment failed. Please try again.';
      setError(msg);
      setSubmitting(false);
      onError?.(confirmError);
      return;
    }

    // succeeded | processing both count as a completed confirmation from the
    // user's perspective; the webhook reconciles final state server-side.
    const status = paymentIntent?.status;
    if (status === 'succeeded' || status === 'processing' || status === 'requires_capture') {
      setSucceeded(true);
      setSubmitting(false);
      onSuccess?.({ paymentIntent, kind: intentKind });
      return;
    }

    // Unexpected non-terminal status (e.g. requires_payment_method after a
    // declined card already handled above) — surface a generic message.
    setError('Payment could not be completed. Please try another card.');
    setSubmitting(false);
  };

  if (succeeded) {
    return (
      <div className="rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 p-4 text-sm text-green-700 dark:text-green-300 flex items-start gap-2">
        <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
        <span>Payment successful. Thank you!</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!ready && <CheckoutSkeleton />}
      <div className={ready ? '' : 'hidden'}>
        <PaymentElement onReady={() => setReady(true)} options={{ layout: 'tabs' }} />
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {ready && (
        <>
          <button
            type="submit"
            disabled={!stripe || !elements || submitting}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing…
              </>
            ) : (
              submitLabel || 'Pay now'
            )}
          </button>
          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1.5">
            <Lock className="w-3 h-3" />
            Secured by Stripe · Your card details never touch Axal VC's servers.
          </p>
        </>
      )}
    </form>
  );
}

/** Loading skeleton that mirrors the Payment Element + pay button layout. */
function CheckoutSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <Skeleton h={14} w="35%" />
      <Skeleton h={44} w="100%" rounded="rounded-lg" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton h={44} w="100%" rounded="rounded-lg" />
        <Skeleton h={44} w="100%" rounded="rounded-lg" />
      </div>
      <Skeleton h={44} w="100%" rounded="rounded-lg" />
    </div>
  );
}
