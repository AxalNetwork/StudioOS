/**
 * D1053 (#2904) — confirming a payment that has no card form on the sheet:
 * a saved card (PAYX3 B), and an upgrade whose prorated invoice asks the bank
 * to confirm (PAYX4 A, PAYX6). Loaded only when the member presses Pay.
 *
 * Each resolves `{ error, status }` with Stripe's error as given; the sheet's
 * decline map turns it into words. A missing Stripe key resolves an error the
 * map reads as "Payment didn't go through", never a charge.
 */
import { getStripe } from '../../lib/stripe';

const NOT_SET_UP = { type: 'api_error', code: 'processing_error' };

export async function confirmSaved(clientSecret, paymentMethod) {
  const stripe = await getStripe();
  if (!stripe) return { error: NOT_SET_UP, status: null };
  const { error, paymentIntent } = await stripe.confirmPayment({ clientSecret, confirmParams: { payment_method: paymentMethod }, redirect: 'if_required' });
  return { error: error || null, status: paymentIntent?.status || null };
}

export async function confirmIntent(clientSecret) {
  const stripe = await getStripe();
  if (!stripe) return { error: NOT_SET_UP, status: null };
  const { error, paymentIntent } = await stripe.confirmPayment({ clientSecret, redirect: 'if_required' });
  return { error: error || null, status: paymentIntent?.status || null };
}
