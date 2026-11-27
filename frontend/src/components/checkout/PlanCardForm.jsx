import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { useSettings } from '../../contexts/SettingsContext';
import { buildAppearance, getStripe } from '../../lib/stripe';
import { sheetAppearance } from './checkoutModel';

/**
 * D1053 (#2904) — the card form on the sheet (PAYX2), loaded with the sheet so
 * Pricing carries no Stripe until a member opens it.
 *
 * The Payment Element is mounted on a deferred intent (`mode: 'subscription'`)
 * for the quote's amount, so the member fills the card before anything is
 * created in Stripe. Pay then submits the form, asks the Worker to start the
 * subscription (`POST /api/billing/checkout/start`), and confirms its client
 * secret here: 3-D Secure opens in the bank's own window over the sheet. Apple
 * Pay and Google Pay come first where the device offers them.
 *
 * It hands the sheet one object through `onReady`: `submit()` and
 * `confirm(clientSecret)`, each resolving `{ error }` with Stripe's error as
 * given. The sheet's decline map turns that into words; nothing here shows a
 * raw code. Card details never touch Axal's code.
 */
function Inner({ onReady, onChange }) {
  const stripe = useStripe();
  const elements = useElements();
  useEffect(() => {
    if (!stripe || !elements) return;
    onReady?.({
      submit: async () => { const { error } = await elements.submit(); return { error: error || null }; },
      confirm: async (clientSecret) => {
        const { error, paymentIntent } = await stripe.confirmPayment({ elements, clientSecret, redirect: 'if_required' });
        return { error: error || null, status: paymentIntent?.status || null };
      },
    });
  }, [stripe, elements, onReady]);
  return (
    <PaymentElement
      onChange={(e) => onChange?.(!!e?.complete)}
      options={{ layout: 'tabs', paymentMethodOrder: ['apple_pay', 'google_pay', 'card'] }}
    />
  );
}

export default function PlanCardForm({ amount, currency, onReady, onChange, mode = 'subscription' }) {
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
  if (configured === null) return <div className="h-[150px] animate-pulse rounded-[10px] bg-axal-ground dark:bg-gray-800" data-testid="checkout-card-loading" />;
  if (!configured) return null;
  // A deferred intent needs an amount above zero; the charge itself is the Worker's intent.
  // D1287: a token pack is a one-time payment (`mode: 'payment'`) on the order's PaymentIntent.
  const options = { mode: mode === 'payment' ? 'payment' : 'subscription', amount: Math.max(50, Number(amount) || 0), currency: String(currency || 'usd').toLowerCase(), appearance: sheetAppearance(buildAppearance(isDark), isDark) };
  return (
    <Elements key={`${options.mode}:${isDark ? 'd' : 'l'}:${options.amount}:${options.currency}`} stripe={stripePromise} options={options}>
      <Inner onReady={ready} onChange={onChange} />
    </Elements>
  );
}
