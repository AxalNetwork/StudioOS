import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { useSettings } from '../../contexts/SettingsContext';
import { buildAppearance, getStripe } from '../../lib/stripe';

/**
 * D1054 (#2905, PAYX10) — the card form for a failed renewal, loaded only
 * when the member presses Pay now or Update card on the renewal banner.
 *
 * The Worker prepares the intent first (`POST /api/billing/alerts/:id/pay` or
 * `/update-card`, D1133, behind the authenticator code), so the Payment
 * Element mounts on its client secret:
 *   - `payment`: the open renewal invoice's PaymentIntent, confirmed here;
 *   - `setup`: a SetupIntent for a new card, confirmed here; the banner then
 *     makes it the default card for the next retry.
 *
 * It hands the banner `confirm()` through `onReady`, resolving
 * `{ error, paymentMethod }` with Stripe's error as given. Card details never
 * touch Axal's code.
 */
function Inner({ kind, onReady }) {
  const stripe = useStripe();
  const elements = useElements();
  useEffect(() => {
    if (!stripe || !elements) return;
    onReady?.({
      confirm: async () => {
        if (kind === 'setup') {
          const { error, setupIntent } = await stripe.confirmSetup({ elements, redirect: 'if_required' });
          const pm = setupIntent?.payment_method;
          return { error: error || null, paymentMethod: typeof pm === 'string' ? pm : pm?.id || null };
        }
        const { error } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
        return { error: error || null, paymentMethod: null };
      },
    });
  }, [stripe, elements, kind, onReady]);
  return <PaymentElement options={{ layout: 'tabs', paymentMethodOrder: ['apple_pay', 'google_pay', 'card'] }} />;
}

export default function RenewalPayForm({ clientSecret, kind, onReady }) {
  const { effectiveTheme } = useSettings() || {};
  const isDark = effectiveTheme === 'dark';
  const stripePromise = useMemo(() => getStripe(), []);
  const [configured, setConfigured] = useState(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const ready = useCallback((api) => readyRef.current?.(api), []);
  useEffect(() => {
    let live = true;
    stripePromise.then((s) => {
      if (!live) return;
      setConfigured(!!s);
      if (!s) readyRef.current?.(null);
    }, () => { if (live) { setConfigured(false); readyRef.current?.(null); } });
    return () => { live = false; };
  }, [stripePromise]);
  if (configured === null) return <div className="h-[150px] animate-pulse rounded-[10px] bg-axal-ground dark:bg-gray-800" data-testid="renewal-card-loading" />;
  if (!configured) return null;
  return (
    <Elements key={`${isDark ? 'd' : 'l'}:${clientSecret}`} stripe={stripePromise} options={{ clientSecret, appearance: buildAppearance(isDark) }}>
      <Inner kind={kind} onReady={ready} />
    </Elements>
  );
}
