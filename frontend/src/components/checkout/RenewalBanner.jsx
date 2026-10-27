import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { api } from '../../lib/api';
import { billingAlertsApi } from '../../lib/api/billingAlerts';
import { useViewMode } from '../../contexts/ViewModeContext';
import { BANNER_ACTION, STAFF_ROLES, bannerView, dismissKey } from './checkoutEntry';
import { declineFamily, newNonce } from './checkoutModel';

/**
 * D1054 (#2905, PAYX10) — the renewal banner, over every page of the app, from
 * the member's open billing alerts (`GET /api/billing/alerts`, D1052):
 *   - a renewal that didn't go through: Update card and Pay now;
 *   - a payment the bank asks to confirm: Confirm payment;
 *   - a plan that ended (Stripe stopped retrying): Pay now and Open Billing.
 * Each button opens a small sheet over the page:
 *   - Pay now and Update card ask the Worker for the intent first (D1133,
 *     behind the authenticator code; the request helper opens the step-up),
 *     then confirm it on the card form. A new card becomes the default.
 *   - Confirm payment hands the bank's check to Stripe.js (D1052).
 * Dismiss hides the banner for today only (`dismissKey`); the alert stays
 * open on Billing. Staff hold no plan and see none. A read that fails draws
 * nothing: Billing is where an unread alert says so.
 *
 * `bridge` is the Stripe side, so a test can stand in for it.
 */

const RenewalPayForm = lazy(() => import('./RenewalPayForm'));
export const RENEWAL_BRIDGE = {
  PayForm: RenewalPayForm,
  confirmIntent: (secret) => import('./stripeBridge').then((m) => m.confirmIntent(secret)),
};

const SUB = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const LINK = 'text-[13px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300';
const BTN = 'inline-flex min-h-[36px] items-center rounded-[8px] px-3 text-[13px] font-bold';
const PRIMARY = 'inline-flex min-h-[44px] w-full items-center justify-center rounded-[9px] bg-axal-violet px-4 text-[14px] font-bold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-60';

const store = {
  get(k) { try { return k ? window.localStorage.getItem(k) : null; } catch { return null; } },
  set(k) { try { if (k) window.localStorage.setItem(k, '1'); } catch { /* the banner shows again; nothing else */ } },
};

/** A refusal from the alert routes in words; a raw code is never shown. */
export function renewalRefusal(err) {
  const code = String(err?.code || err?.error || '');
  if (code === 'payment_not_needed') return 'This payment is already settled. Nothing was charged.';
  if (code === 'alert_not_found') return 'This alert is closed. Nothing was charged.';
  if (code === 'stripe_not_configured') return 'Payments aren’t set up here. You were not charged.';
  // requireFactor's 403: the session was not signed in with the authenticator app.
  if (code === 'factor_required' || /TOTP required/i.test(String(err?.message || ''))) return 'Sign in with your authenticator app to pay here. Nothing was charged.';
  if (code === 'step_up_cancelled' || err?.message === 'step_up_cancelled') return 'Your authenticator code is needed first. Nothing was charged.';
  return 'The payment couldn’t start just now. You were not charged. Try again in a moment.';
}

function RenewalSheet({ view, action, onClose, onDone, bridge }) {
  const [state, setState] = useState({ phase: 'preparing', secret: null, kind: null, scope: null, error: null });
  const [form, setForm] = useState(undefined);
  const nonce = useRef(newNonce());
  const onReady = useCallback((f) => setForm(f), []);
  const id = view.alert.id;
  const prepare = useCallback(async () => {
    setState({ phase: 'preparing', secret: null, kind: null, scope: null, error: null });
    try {
      if (action === 'confirm') {
        const r = await billingAlertsApi.confirm(id);
        const c = await bridge.confirmIntent(r?.client_secret);
        if (c?.error) { setState({ phase: 'failed', error: declineFamily(c.error).line }); return; }
        setState({ phase: 'done' });
        onDone();
        return;
      }
      const r = action === 'update' ? await billingAlertsApi.updateCard(id, nonce.current) : await billingAlertsApi.pay(id);
      setState({ phase: 'form', secret: r?.client_secret || null, kind: r?.kind === 'setup' ? 'setup' : 'payment', scope: r?.scope || null, error: null });
    } catch (e) {
      setState({ phase: 'refused', error: renewalRefusal(e) });
    }
  }, [action, id, bridge, onDone]);
  useEffect(() => { prepare(); }, [prepare]);

  const submit = async () => {
    if (!form || state.phase === 'processing') return;
    const was = state;
    setState({ ...was, phase: 'processing', error: null });
    const r = await form.confirm();
    if (r?.error) { setState({ ...was, phase: 'form', error: declineFamily(r.error).line }); return; }
    if (was.kind === 'setup' && r?.paymentMethod) {
      try { await api.billingPaymentMethodDefault(r.paymentMethod, was.scope || undefined); } catch {
        setState({ phase: 'done', note: 'Your card was saved, but it couldn’t be made your default card. Choose it in Billing.' });
        onDone();
        return;
      }
    }
    setState({ phase: 'done' });
    onDone();
  };

  const PayForm = bridge.PayForm;
  const title = action === 'update' ? 'Update card' : action === 'confirm' ? 'Confirm payment' : 'Pay now';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" data-testid="renewal-sheet-backdrop">
      <div role="dialog" aria-modal="true" aria-label={title} className="flex w-full max-w-[460px] flex-col gap-3 rounded-[16px] bg-white px-5 py-5 dark:bg-gray-900" data-testid={`renewal-sheet-${action}`}>
        <div className="flex items-center justify-between">
          <h2 className="m-0 text-[16px] font-extrabold text-axal-ink dark:text-gray-100">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-[9px] text-axal-muted hover:bg-axal-ground dark:text-gray-400"><X size={18} aria-hidden="true" /></button>
        </div>
        <p className={`m-0 ${SUB}`}>{view.line}</p>
        {state.phase === 'preparing' && <p className={`m-0 ${SUB}`} data-testid="renewal-preparing">{action === 'confirm' ? 'Opening your bank’s check…' : 'Preparing the payment…'}</p>}
        {state.phase === 'refused' && <p className="m-0 text-[13px] text-red-700 dark:text-red-300" role="alert" data-testid="renewal-refused">{state.error}</p>}
        {state.phase === 'failed' && <p className="m-0 text-[13px] text-red-700 dark:text-red-300" role="alert" data-testid="renewal-failed">{state.error}</p>}
        {(state.phase === 'form' || state.phase === 'processing') && (
          <>
            {state.secret && (
              <Suspense fallback={<div className="h-[150px] animate-pulse rounded-[10px] bg-axal-ground dark:bg-gray-800" />}>
                <PayForm clientSecret={state.secret} kind={state.kind} onReady={onReady} />
              </Suspense>
            )}
            {form === null && <p className={`m-0 ${SUB}`} data-testid="renewal-not-set-up">Payments aren’t set up here. You were not charged.</p>}
            {state.error && <p className="m-0 text-[13px] text-red-700 dark:text-red-300" role="alert" data-testid="renewal-decline">{state.error}</p>}
            <button type="button" className={PRIMARY} onClick={submit} disabled={!form || state.phase === 'processing'} data-testid="renewal-submit">
              {state.phase === 'processing' ? 'Processing…' : state.kind === 'setup' ? 'Save card' : 'Pay now'}
            </button>
          </>
        )}
        {state.phase === 'done' && (
          <div className="flex flex-col gap-1" data-testid="renewal-done">
            <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">
              {state.kind === 'setup' || action === 'update' ? 'Your card is updated. We’ll use it for the next try.' : 'Thanks. Your payment is being confirmed.'}
            </span>
            {state.note && <p className={`m-0 ${SUB}`}>{state.note}</p>}
            <p className={`m-0 ${SUB}`}>The receipt appears in Billing.</p>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          {(state.phase === 'refused' || state.phase === 'failed') && <button type="button" className={LINK} onClick={prepare} data-testid="renewal-retry">Try again</button>}
          <Link to="/account/billing" className={LINK} onClick={onClose}>Open Billing</Link>
          <button type="button" className={LINK} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default function RenewalBanner({ user, bridge = RENEWAL_BRIDGE, now = () => new Date() }) {
  const role = useViewMode()?.shellRole ?? user?.role ?? null;
  const want = !!user && !STAFF_ROLES.has(String(role || '').toLowerCase());
  const [alerts, setAlerts] = useState(null);
  const [round, setRound] = useState(0);
  const [hidden, setHidden] = useState(null);
  const [action, setAction] = useState(null);
  useEffect(() => {
    if (!want) { setAlerts(null); return undefined; }
    let live = true;
    billingAlertsApi.list().then((d) => { if (live) setAlerts(Array.isArray(d?.alerts) ? d.alerts : []); }, () => { if (live) setAlerts(null); });
    return () => { live = false; };
  }, [want, user?.id, round]);
  const reread = useCallback(() => setRound((n) => n + 1), []);

  const view = want ? bannerView(alerts) : null;
  const key = dismissKey(view, now());
  // The sheet keeps the alert it opened on: a paid alert closes on the re-read, and its Done stays drawn.
  const sheet = action && <RenewalSheet view={action.view} action={action.act} bridge={bridge} onClose={() => setAction(null)} onDone={reread} />;
  // One shape whether or not a banner is drawn, so the open sheet is never remounted by a re-read.
  const dismissed = !view || hidden === key || store.get(key) === '1';
  const tone = view?.kind === 'confirm' ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
    : 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200';
  return (
    <>
      {!dismissed && (
        <div role="status" className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 text-[13px] ${tone}`} data-testid={`renewal-banner-${view.kind}`}>
          <AlertTriangle size={16} aria-hidden="true" className="shrink-0" />
          <span className="min-w-0 flex-1"><strong className="font-bold">{view.title}.</strong> {view.line}</span>
          <span className="flex flex-wrap items-center gap-2">
            {view.actions.map((a) => (a === 'billing'
              ? <Link key={a} to="/account/billing" className={`${BTN} border border-current`} data-testid="renewal-action-billing">{BANNER_ACTION.billing}</Link>
              : <button key={a} type="button" className={`${BTN} ${a === view.actions[0] ? 'bg-axal-violet text-white hover:bg-axal-violet-deep' : 'border border-current'}`} onClick={() => setAction({ act: a, view })} data-testid={`renewal-action-${a}`}>{BANNER_ACTION[a]}</button>))}
            <button type="button" className={`${BTN} underline`} onClick={() => { store.set(key); setHidden(key); }} data-testid="renewal-dismiss">Dismiss for today</button>
          </span>
        </div>
      )}
      {sheet}
    </>
  );
}
