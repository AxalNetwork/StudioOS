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
export default function AxalCheckout(props) {
  const { priceId, amount, currency, quantity, description, clientSecret: providedClientSecret } = props;
  const { effectiveTheme } = useSettings();
  const isDark = effectiveTheme === 'dark';

  const stripePromise = useMemo(() => getStripe(), []);
  const [clientSecret, setClientSecret] = useState(providedClientSecret || null);
  const [intentKind, setIntentKind] = useState(providedClientSecret ? 'payment' : null);
  const [loadError, setLoadError] = useState(null);
  // Stable nonce per mount so retries of the same purchase reuse the
  // server-side idempotency key instead of creating duplicate intents.
  const nonceRef = useRef(null);
  if (nonceRef.current == null) {
    nonceRef.current =
      (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
      String(Date.now());
  }

  useEffect(() => {
    if (!stripePromise) return; // not configured — handled in render
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

    api
      .paymentIntent(body)
      .then((res) => {
        if (cancelled) return;
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
  }, [stripePromise, priceId, amount, currency, quantity, description, providedClientSecret]);

  // No publishable key configured → graceful unavailable state.
  if (!STRIPE_PUBLISHABLE_KEY || !stripePromise) {
    return (
      <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>Payments are not configured in this environment.</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>{loadError}</span>
      </div>
    );
  }

  if (!clientSecret) {
    return <CheckoutSkeleton />;
  }

  const appearance = buildAppearance(isDark);

  return (
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
            Secured by Stripe · Your card details never touch Axal's servers.
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
