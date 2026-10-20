import { useEffect, useMemo, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { buildAppearance, getStripe } from '../../lib/stripe';
import { BTN } from './AccountCenter';
import { refusalText } from './accountCenterModel';

/**
 * D794 (#2219) — the card form for Billing's Auto-reload card, loaded only
 * when a card is being added. The card is entered on Stripe's own element and
 * confirmed as the member's SetupIntent for off-session use
 * (`POST /api/ai-budget/auto-reload/setup`); StudioOS never sees the number.
 */
/** Stripe's own card element, confirmed as an off-session SetupIntent. Hands back the SetupIntent's id. */
export default function AutoReloadCardSetup({ api, onSaved, onCancel }) {
  const stripePromise = useMemo(() => getStripe(), []);
  const [secret, setSecret] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    api.autoReloadSetup(crypto.randomUUID().replace(/-/g, ''))
      .then((r) => { if (live) r?.client_secret ? setSecret(r.client_secret) : setError('The card form could not be started.'); })
      .catch((e) => { if (live) setError(refusalText(e, 'The card form could not be started.')); });
    return () => { live = false; };
  }, [api]);
  if (error) return <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="auto-reload-setup-error">{error}</p>;
  if (!secret) return <p className="m-0 text-[12.5px] text-axal-muted">Preparing the secure card form…</p>;
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  return (
    <Elements stripe={stripePromise} options={{ clientSecret: secret, appearance: buildAppearance(dark) }}>
      <CardForm onSaved={onSaved} onCancel={onCancel} />
    </Elements>
  );
}

function CardForm({ onSaved, onCancel }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const confirm = async () => {
    if (!stripe || !elements || busy) return;
    setBusy(true); setError(null);
    const { error: submitError } = await elements.submit();
    if (submitError) { setError(submitError.message || 'Check the card details.'); setBusy(false); return; }
    const { error: confirmError, setupIntent } = await stripe.confirmSetup({ elements, redirect: 'if_required' });
    setBusy(false);
    if (confirmError) { setError(confirmError.message || 'The card was not saved.'); return; }
    if (setupIntent?.status === 'succeeded') onSaved(setupIntent.id);
    else setError('The card was not saved. Try another card.');
  };
  return (
    <div className="flex flex-col gap-2 rounded-axal-sm border border-axal-hairline p-3 dark:border-gray-700">
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={BTN.ghost} onClick={onCancel}>Cancel</button>
        <button type="button" className={BTN.primary} onClick={confirm} disabled={busy || !stripe}>{busy ? 'Saving the card…' : 'Use this card'}</button>
      </div>
    </div>
  );
}
