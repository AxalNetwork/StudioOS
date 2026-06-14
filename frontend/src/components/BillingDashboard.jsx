import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { CreditCard, Loader2, FileText, AlertTriangle, RotateCcw, Plus, Lock, X, Star, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useSettings } from '../contexts/SettingsContext';
import { getStripe, buildAppearance, STRIPE_PUBLISHABLE_KEY } from '../lib/stripe';

/**
 * Task #5 — In-app billing dashboard.
 *
 * Replaces the Stripe Customer Portal redirect with an in-app surface that
 * shows the user's active subscription(s), payment methods, upcoming invoice,
 * and recent invoices, plus controls to:
 *   - cancel a subscription (sets cancel_at_period_end; access kept till renewal)
 *   - resume a subscription scheduled to cancel
 *   - swap plans with a live proration preview, confirmed without leaving Axal VC
 *   - add / replace a card (Stripe SetupIntent + Elements `confirmSetup`),
 *     set a saved card as default, and remove a saved card
 *
 * Every action goes through `/api/billing/*` (server-side Stripe REST) so the
 * secret key never reaches the SPA.
 *
 * Props:
 *   scope    — 'founder' | 'investor' (selects which Stripe customer to read)
 *   flash    — toast helper (msg, type?)
 *   onChanged— called after any successful mutation so the parent can refresh
 */
const fmtMoney = (amt, cur) =>
  amt == null
    ? '—'
    : new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: (cur || 'usd').toUpperCase(),
      }).format(amt / 100);

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : '—');

export default function BillingDashboard({ scope = 'founder', flash, onChanged }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState([]);
  const [busy, setBusy] = useState(null);          // action key in flight
  const [preview, setPreview] = useState(null);    // { sub_id, price_id, label, data }

  const load = useCallback(() => {
    setLoading(true);
    api.billingOverview(scope)
      .then((res) => setOverview(res))
      .catch((e) => flash?.(e.message || 'Could not load billing details', 'error'))
      .finally(() => setLoading(false));
  }, [scope, flash]);

  useEffect(() => { load(); }, [load]);

  // Catalog → swap-able plan options for this scope. Founder products carry
  // metadata.tier; investor products carry metadata.investor_tier (with
  // monthly + yearly prices). We surface every active recurring price.
  useEffect(() => {
    let cancelled = false;
    api.catalogProducts('subscription')
      .then((res) => {
        if (cancelled) return;
        const out = [];
        for (const p of res?.products || []) {
          const meta = p.metadata || {};
          const isMine = scope === 'investor' ? !!meta.investor_tier : !!meta.tier;
          if (!isMine) continue;
          for (const pr of p.prices || []) {
            if (pr.active === false || pr.type !== 'recurring') continue;
            out.push({
              price_id: pr.id,
              product: p.name,
              amount: pr.unit_amount,
              currency: pr.currency,
              interval: pr.interval,
            });
          }
        }
        setPlans(out);
      })
      .catch(() => { if (!cancelled) setPlans([]); });
    return () => { cancelled = true; };
  }, [scope]);

  const refreshAll = () => { load(); onChanged?.(); };

  const cancel = async (subId) => {
    if (!window.confirm('Cancel this subscription? You keep access until the end of the current period.')) return;
    setBusy(`cancel:${subId}`);
    try {
      await api.billingCancelSubscription(subId, scope);
      flash?.('Subscription will cancel at period end.');
      refreshAll();
    } catch (e) { flash?.(e.message || 'Could not cancel', 'error'); }
    finally { setBusy(null); }
  };

  const resume = async (subId) => {
    setBusy(`resume:${subId}`);
    try {
      await api.billingResumeSubscription(subId, scope);
      flash?.('Subscription resumed.');
      refreshAll();
    } catch (e) { flash?.(e.message || 'Could not resume', 'error'); }
    finally { setBusy(null); }
  };

  const startSwap = async (sub, plan) => {
    setBusy(`preview:${plan.price_id}`);
    try {
      const data = await api.billingSwapPreview(sub.id, plan.price_id, scope);
      setPreview({
        sub_id: sub.id,
        price_id: plan.price_id,
        label: `${plan.product}${plan.interval ? ` / ${plan.interval}` : ''}`,
        data,
      });
    } catch (e) { flash?.(e.message || 'Could not preview plan change', 'error'); }
    finally { setBusy(null); }
  };

  const confirmSwap = async () => {
    if (!preview) return;
    setBusy('confirm');
    try {
      await api.billingSwapConfirm(preview.sub_id, preview.price_id, scope);
      flash?.('Plan updated.');
      setPreview(null);
      refreshAll();
    } catch (e) { flash?.(e.message || 'Could not change plan', 'error'); }
    finally { setBusy(null); }
  };

  // ---- Payment-method management ------------------------------------------
  const [addingCard, setAddingCard] = useState(false); // SetupIntent modal open

  const makeDefault = async (pmId) => {
    setBusy(`default:${pmId}`);
    try {
      await api.billingPaymentMethodDefault(pmId, scope);
      flash?.('Default card updated.');
      refreshAll();
    } catch (e) { flash?.(e.message || 'Could not set default card', 'error'); }
    finally { setBusy(null); }
  };

  const removeCard = async (pmId) => {
    if (!window.confirm('Remove this card? Future invoices must use another saved card.')) return;
    setBusy(`detach:${pmId}`);
    try {
      await api.billingPaymentMethodDetach(pmId, scope);
      flash?.('Card removed.');
      refreshAll();
    } catch (e) { flash?.(e.message || 'Could not remove card', 'error'); }
    finally { setBusy(null); }
  };

  const onCardAdded = () => {
    setAddingCard(false);
    flash?.('Card saved.');
    refreshAll();
  };

  const subs = overview?.subscriptions || [];
  const currentPriceIds = useMemo(
    () => new Set(subs.flatMap((s) => (s.items || []).map((i) => i.price_id))),
    [subs],
  );

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading billing details…
      </div>
    );
  }

  if (overview && overview.has_customer === false) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-500 dark:text-gray-400">
        No active billing account yet. Subscribe to a plan to manage it here.
      </div>
    );
  }

  if (overview && overview.stripe_configured === false) {
    return (
      <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>Payments are not configured in this environment.</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Active subscriptions */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Active subscriptions</h4>
        {subs.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">No active subscriptions.</div>
        ) : (
          <div className="space-y-3">
            {subs.map((sub) => {
              const item = sub.items?.[0];
              return (
                <div key={sub.id} className="border border-gray-100 dark:border-gray-800 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {item?.nickname || item?.product_id || 'Subscription'}
                        {item?.amount != null && (
                          <span className="text-gray-500 dark:text-gray-400 font-normal">
                            {' '}— {fmtMoney(item.amount, item.currency)}{item.interval ? ` / ${item.interval}` : ''}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Status: <span className="capitalize">{sub.status}</span>
                        {sub.cancel_at_period_end
                          ? <> · Cancels {fmtDate(sub.cancel_at || sub.current_period_end)}</>
                          : sub.current_period_end ? <> · Renews {fmtDate(sub.current_period_end)}</> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {sub.cancel_at_period_end ? (
                        <button type="button" disabled={busy === `resume:${sub.id}`} onClick={() => resume(sub.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-md text-xs font-medium disabled:opacity-50">
                          <RotateCcw className="w-3.5 h-3.5" />
                          {busy === `resume:${sub.id}` ? 'Resuming…' : 'Resume'}
                        </button>
                      ) : (
                        <button type="button" disabled={busy === `cancel:${sub.id}`} onClick={() => cancel(sub.id)}
                          className="px-3 py-1.5 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md text-xs font-medium disabled:opacity-50">
                          {busy === `cancel:${sub.id}` ? 'Cancelling…' : 'Cancel'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Plan switch options (other recurring prices in this scope). */}
                  {plans.filter((p) => !currentPriceIds.has(p.price_id)).length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">Change plan</div>
                      <div className="flex flex-wrap gap-2">
                        {plans.filter((p) => !currentPriceIds.has(p.price_id)).map((p) => (
                          <button key={p.price_id} type="button"
                            disabled={busy === `preview:${p.price_id}`}
                            onClick={() => startSwap(sub, p)}
                            className="px-3 py-1.5 border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded-md text-xs font-medium disabled:opacity-50">
                            {busy === `preview:${p.price_id}` ? 'Previewing…' : `Switch to ${p.product}${p.interval ? ` (${p.interval})` : ''} — ${fmtMoney(p.amount, p.currency)}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Proration preview modal */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPreview(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">Confirm plan change</h4>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">Switching to <span className="font-medium">{preview.label}</span>.</p>
            <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 text-sm">
              <div className="flex justify-between px-3 py-2">
                <span className="text-gray-500 dark:text-gray-400">Proration {Number(preview.data?.proration_amount) < 0 ? '(credit)' : ''}</span>
                <span className="text-gray-900 dark:text-gray-100">{fmtMoney(preview.data?.proration_amount, preview.data?.currency)}</span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-gray-500 dark:text-gray-400">Due now</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">{fmtMoney(preview.data?.amount_due, preview.data?.currency)}</span>
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
              Charges/credits are applied to your existing payment method on file.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setPreview(null)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg text-sm font-medium">
                Cancel
              </button>
              <button type="button" disabled={busy === 'confirm'} onClick={confirmSwap}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                {busy === 'confirm' ? 'Updating…' : 'Confirm change'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment methods */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Payment methods</h4>
          <button type="button" onClick={() => setAddingCard(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded-md text-xs font-medium">
            <Plus className="w-3.5 h-3.5" /> Add card
          </button>
        </div>
        {(overview?.payment_methods || []).length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">No card on file. Add one to keep your subscription active.</div>
        ) : (
          <div className="space-y-2">
            {overview.payment_methods.map((pm) => (
              <div key={pm.id} className="flex items-center justify-between gap-3 border border-gray-100 dark:border-gray-800 rounded-lg p-3 flex-wrap">
                <div className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                  <CreditCard className="w-4 h-4 text-gray-400" />
                  <span className="capitalize">{pm.brand}</span> •••• {pm.last4}
                  {pm.exp_month && pm.exp_year && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">exp {String(pm.exp_month).padStart(2, '0')}/{String(pm.exp_year).slice(-2)}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {pm.is_default ? (
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">Default</span>
                  ) : (
                    <button type="button" disabled={busy === `default:${pm.id}`} onClick={() => makeDefault(pm.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-md text-xs font-medium disabled:opacity-50">
                      <Star className="w-3.5 h-3.5" />
                      {busy === `default:${pm.id}` ? 'Setting…' : 'Make default'}
                    </button>
                  )}
                  <button type="button" disabled={busy === `detach:${pm.id}`} onClick={() => removeCard(pm.id)}
                    title="Remove card"
                    className="inline-flex items-center gap-1 px-2.5 py-1 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md text-xs font-medium disabled:opacity-50">
                    <Trash2 className="w-3.5 h-3.5" />
                    {busy === `detach:${pm.id}` ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Add / replace card modal (Stripe SetupIntent + Elements) */}
      {addingCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAddingCard(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">Add a card</h4>
              <button type="button" onClick={() => setAddingCard(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <CardSetupForm scope={scope} onSuccess={onCardAdded} onCancel={() => setAddingCard(false)} />
          </div>
        </div>
      )}

      {/* Upcoming invoice */}
      {overview?.upcoming_invoice && (
        <section className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Upcoming invoice</h4>
          <div className="text-sm text-gray-700 dark:text-gray-200">
            {fmtMoney(overview.upcoming_invoice.total, overview.upcoming_invoice.currency)}
            {overview.upcoming_invoice.next_attempt && (
              <span className="text-gray-500 dark:text-gray-400"> · due {fmtDate(overview.upcoming_invoice.next_attempt)}</span>
            )}
          </div>
        </section>
      )}

      {/* Recent invoices */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Recent invoices</h4>
        {(overview?.invoices || []).length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">No invoices yet.</div>
        ) : (
          <div className="border border-gray-100 dark:border-gray-800 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
            {overview.invoices.map((inv, idx) => (
              <div key={inv.id || idx} className="flex items-center justify-between px-3 py-2 text-sm">
                <div className="text-gray-700 dark:text-gray-200">
                  {fmtDate(inv.created)}
                  <span className="text-gray-400 dark:text-gray-500"> · {inv.number || inv.id}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-gray-900 dark:text-gray-100">{fmtMoney(inv.total, inv.currency)}</span>
                  <span className="text-xs capitalize text-gray-500 dark:text-gray-400">{inv.status}</span>
                  {(inv.hosted_invoice_url || inv.invoice_pdf) && (
                    <a href={inv.invoice_pdf || inv.hosted_invoice_url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-violet-700 dark:text-violet-300 hover:underline text-xs">
                      <FileText className="w-3.5 h-3.5" /> View
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Card collection via a Stripe SetupIntent. Fetches a SetupIntent client_secret
 * for the scope's customer (server-side, step-up gated), mounts Stripe Elements
 * with the Axal VC appearance, and confirms with `confirmSetup({ redirect:
 * 'if_required' })` so 3DS surfaces inline and we never leave the app. Raw card
 * data is captured exclusively by Stripe Elements (PCI scope stays SAQ A).
 */
function CardSetupForm({ scope, onSuccess, onCancel }) {
  const { effectiveTheme } = useSettings();
  const isDark = effectiveTheme === 'dark';
  const stripePromise = useMemo(() => getStripe(), []);
  const [clientSecret, setClientSecret] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!stripePromise) return;
    if (startedRef.current) return; // create exactly one SetupIntent per mount
    startedRef.current = true;
    let cancelled = false;
    api.billingPaymentMethodSetup(scope)
      .then((res) => {
        if (cancelled) return;
        if (!res?.client_secret) { setLoadError('Could not start card setup. Please try again.'); return; }
        setClientSecret(res.client_secret);
      })
      .catch((e) => { if (!cancelled) setLoadError(e?.message || 'Could not start card setup. Please try again.'); });
    return () => { cancelled = true; };
  }, [stripePromise, scope]);

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
      <div className="space-y-3">
        <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{loadError}</span>
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={onCancel}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg text-sm font-medium">
            Close
          </button>
        </div>
      </div>
    );
  }

  if (!clientSecret) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-6">
        <Loader2 className="w-4 h-4 animate-spin" /> Preparing secure card form…
      </div>
    );
  }

  const appearance = buildAppearance(isDark);
  return (
    <Elements
      key={`${clientSecret}:${effectiveTheme}`}
      stripe={stripePromise}
      options={{ clientSecret, appearance }}
    >
      <SetupForm onSuccess={onSuccess} onCancel={onCancel} />
    </Elements>
  );
}

function SetupForm({ onSuccess, onCancel }) {
  const stripe = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    setError(null);
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message || 'Please check your card details.');
      setSubmitting(false);
      return;
    }
    const { error: confirmError, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
    });
    if (confirmError) {
      setError(confirmError.message || 'Could not save card. Please try again.');
      setSubmitting(false);
      return;
    }
    if (setupIntent?.status === 'succeeded' || setupIntent?.status === 'processing') {
      setSubmitting(false);
      onSuccess?.();
      return;
    }
    setError('Card could not be saved. Please try another card.');
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className={ready ? '' : 'hidden'}>
        <PaymentElement onReady={() => setReady(true)} options={{ layout: 'tabs' }} />
      </div>
      {!ready && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-6">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading card form…
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {ready && (
        <>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg text-sm font-medium">
              Cancel
            </button>
            <button type="submit" disabled={!stripe || !elements || submitting}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
              {submitting ? (<><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>) : 'Save card'}
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1.5">
            <Lock className="w-3 h-3" />
            Secured by Stripe · Your card details never touch Axal VC's servers.
          </p>
        </>
      )}
    </form>
  );
}
