import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Lock, X } from 'lucide-react';
import { checkoutApi } from '../../lib/api/billingCheckout';
import {
  FREE_FIRST, NOT_YET, POLL_MS, RENEWS, SECURE_LINE, SELLER_LINE, SLOW_MS, TITLE,
  cardWords, declineFamily, familyOf, includedLines, intervalsOf, newNonce, planKeyOf, promoState, quoteView,
  refusalView, savedCardsApply, sheetMode, signinHref, statusView, whatYouGet,
} from './checkoutModel';

/**
 * D1048 (#2451) — the checkout sheet, built to the owner's "Checkout" canvas
 * (PAYX1–PAYX21). It opens in place over the page, with no route change, so
 * Back and Esc close it. Pricing's Upgrade and "Get …" open it today; the
 * paywall, Billing and Usage join in part 6.
 *
 * D1053 (#2904, part 5): the sheet pays on D1051's routes, and no longer
 * mounts `AxalCheckout` for a plan (token packs keep it until #2452).
 *   - The totals are the quote's (`POST /api/billing/checkout/quote`): subtotal,
 *     discount, VAT and due today, with "Pay [$total]" as the one primary
 *     button. A figure the quote did not send is its reason, never 0.
 *   - A change is quoted and made here: an upgrade now with its proration, a
 *     downgrade at the end of the paid period with the storage note. Both ask
 *     for the authenticator code; the request helper's step-up opens on the
 *     Worker's 403 and the press retries.
 *   - Pay starts the subscription (`POST /api/billing/checkout/start`) and
 *     confirms it here: the card form (`PlanCardForm`, a deferred Payment
 *     Element, Apple Pay first), a saved card, or an upgrade's invoice.
 *     3-D Secure opens in the bank's own window.
 *   - Then the status route (`GET /api/billing/checkout/status`) is polled:
 *     Activating, its slow line after a minute, Accepted with "What you get
 *     now", Scheduled, or Failed.
 *   - A decline is one of five families of words (`declineFamily`); a raw code
 *     is never shown, and every failure says whether money moved.
 *
 * `bridge` is the Stripe side, so a test can stand in for it: the card form,
 * and confirming a saved card or an existing intent.
 */

const PILL = {
  violet: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
  sky: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
  amber: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  muted: 'border-axal-hairline bg-white text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400',
};
const EYE = 'font-mono text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-[44px] w-full items-center justify-center rounded-[9px] px-4 text-[14px] font-bold';
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-60`;
const LINK = 'text-[13px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300';
const MONO = 'font-mono tabular-nums';
const INPUT = 'min-h-[40px] flex-1 rounded-[9px] border border-axal-hairline bg-white px-3 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const ALERT = 'flex flex-col gap-1 rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

// Loaded with the sheet: Stripe's module reads its key on import, and Pricing need not carry it until then.
const PlanCardForm = lazy(() => import('./PlanCardForm'));
export const STRIPE_BRIDGE = {
  CardForm: PlanCardForm,
  confirmSaved: (secret, pm) => import('./stripeBridge').then((m) => m.confirmSaved(secret, pm)),
  confirmIntent: (secret) => import('./stripeBridge').then((m) => m.confirmIntent(secret)),
};

/**
 * The card form failed to load (Stripe.js blocked, or offline): the sheet says
 * so, and that nothing was charged, instead of a blank column.
 */
export class CardFormBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailed?.(); }
  render() {
    if (this.state.failed) {
      return <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="checkout-card-failed">The card form couldn’t load. You were not charged. Reload the page and try again.</p>;
    }
    return this.props.children;
  }
}

/** Esc closes, focus moves in and stays inside, and returns to the opener on close. Pack mode (D1287) shares it. */
export function useDialog(onClose) {
  const box = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = typeof document !== 'undefined' ? document.activeElement : null;
    box.current?.focus?.();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current?.(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const items = [...box.current.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener?.('keydown', onKey);
    return () => { document.removeEventListener?.('keydown', onKey); opener?.focus?.(); };
  }, []);
  return box;
}

function Skel({ h = 'h-4', w = 'w-full', testId }) {
  return <span className={`block ${h} ${w} animate-pulse rounded-[6px] bg-axal-ground dark:bg-gray-800`} data-testid={testId} />;
}

function Totals({ view, read, fallback }) {
  if (read.status === 'loading' && !view) {
    return (
      <div className="flex flex-col gap-1.5 border-t border-axal-hairline pt-3 dark:border-gray-700" data-testid="checkout-totals">
        <div className="flex justify-between text-[13px]"><span>Subtotal</span><span className={MONO}>{fallback}</span></div>
        <Skel w="w-2/3" testId="checkout-totals-loading" />
      </div>
    );
  }
  if (!view) {
    return (
      <div className="flex flex-col gap-1 border-t border-axal-hairline pt-3 dark:border-gray-700" data-testid="checkout-totals">
        <div className="flex justify-between text-[13px]"><span>Subtotal</span><span className={MONO}>{fallback}</span></div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 border-t border-axal-hairline pt-3 dark:border-gray-700" data-testid="checkout-totals">
      {view.rows.map((r) => (
        <div key={r.key} className={`flex justify-between gap-3 text-[13px] ${r.strong ? 'font-bold text-axal-ink dark:text-gray-100' : ''}`} data-testid={`checkout-total-${r.key}`}>
          <span>{r.label}</span>
          {r.value ? <span className={MONO}>{r.value}</span> : <span className="text-right italic text-axal-muted dark:text-gray-400">{r.reason || 'Not recorded'}</span>}
        </div>
      ))}
    </div>
  );
}

function Summary({ plan, spec, interval, setInterval, intervals, view, read, locked }) {
  const fam = familyOf(plan);
  const price = intervals[interval] || intervals.monthly || intervals.yearly;
  return (
    <div className="flex flex-col gap-3.5" data-testid="checkout-summary">
      <span className={EYE}>Your plan</span>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold ${PILL[fam.tone]}`}>{fam.label}</span>
      </div>
      <h3 className="m-0 text-[20px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{plan.plan_name || spec?.name || 'Plan'}</h3>
      {spec?.tag ? <p className={`m-0 ${SUB}`}>{spec.tag}</p> : null}
      {intervals.monthly && intervals.yearly ? (
        <div className="flex gap-[3px] self-start rounded-[9px] bg-axal-ground p-[3px] dark:bg-gray-800" role="group" aria-label="Billing">
          {[['monthly', 'Monthly'], ['yearly', 'Yearly']].map(([k, t]) => (
            <button key={k} type="button" aria-pressed={interval === k} disabled={locked} onClick={() => setInterval(k)} data-testid={`checkout-interval-${k}`}
              className={`min-h-[36px] rounded-[7px] px-3 text-[12.5px] font-bold ${interval === k ? 'bg-white text-axal-ink shadow-sm dark:bg-gray-900 dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`}>
              {t}{k === 'yearly' && intervals.saving ? ` · ${intervals.saving}` : ''}
            </button>
          ))}
        </div>
      ) : null}
      <div>
        <div className={`${MONO} text-[22px] font-extrabold text-axal-ink dark:text-gray-100`} data-testid="checkout-price">{price.line}</div>
        <p className={`m-0 mt-1 ${SUB}`}>{RENEWS}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={EYE}>Included</span>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="checkout-included">
          {includedLines(plan, spec, interval).map((l) => (
            <li key={l.key} className={`flex items-start gap-2 text-[13px] ${l.measured ? 'text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`}>
              <Check size={15} aria-hidden="true" className={`mt-0.5 shrink-0 ${l.measured ? 'text-axal-positive' : 'text-axal-faint'}`} />
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <Totals view={view} read={read} fallback={price.subtotal} />
    </div>
  );
}

/** The payment column for a mode that does not pay here (D1048 §3, D1053 PAYX19a). */
function NotHere({ mode, plan, interval, onClose, onRetryPlan }) {
  const body = {
    signin: ['Sign in to continue.', `After you sign in, Checkout opens on ${plan?.plan_name || 'this plan'}.`, <Link key="s" to={signinHref(plan, interval)} className={LINK} data-testid="checkout-signin">Sign in</Link>],
    reading: ['Reading your current plan…', 'Payment waits until your current plan is read.', null],
    unreadable: ['Your current plan could not be read.', 'Your current plan is Unreadable. Try again before starting a payment.', null],
    staff: ['Staff account · no plan needed', 'Admin and Super Admin accounts hold no plan.', null],
    explorer: ['Choose your profile first.', 'Plans belong to a profile: Founder, Investor, Advisor or Operating Partner. You can still buy AI tokens without a plan.', <Link key="p" to="/onboarding" className={LINK} onClick={onClose}>Choose a profile</Link>],
    other: ['This plan is for another profile.', 'Plans are sold to the profile they belong to.', null],
    unsellable: ['This plan’s price couldn’t be read just now.', 'That doesn’t mean it’s free. No payment can start until a price is on sale.', null],
  }[mode];
  return (
    <div className="flex flex-col items-start gap-2 rounded-[10px] border border-axal-hairline px-4 py-4 dark:border-gray-700" data-testid={`checkout-mode-${mode}`}>
      <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{body[0]}</span>
      <p className={`m-0 ${SUB}`}>{body[1]}</p>
      {body[2]}
      {mode === 'unreadable' && <button type="button" className={LINK} onClick={onRetryPlan} data-testid="checkout-plan-retry">Try again</button>}
    </div>
  );
}

/** PAYX18: the quote or the start refused; never a Pay button or a price it does not have. */
function Refused({ view, onRetry, onClose, testId }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-[10px] border border-axal-hairline px-4 py-4 dark:border-gray-700" data-testid={testId}>
      <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{view.title}</span>
      <p className={`m-0 ${SUB}`}>{view.line}</p>
      <div className="flex flex-wrap gap-3">
        {view.retry && <button type="button" className={LINK} onClick={onRetry} data-testid={`${testId}-retry`}>Try again</button>}
        {view.billing && <Link to="/account/billing" className={LINK} onClick={onClose}>Open Billing</Link>}
      </div>
    </div>
  );
}

/** PAYX5: the promo code, with its states. A new plan only: a change takes no code. */
function Promo({ promo, state, onApply, onRemove, locked }) {
  const [text, setText] = useState(promo || '');
  if (state.state === 'valid' || state.state === 'covers') {
    return (
      <div className="flex flex-col gap-1" data-testid="checkout-promo">
        <div className="flex items-center justify-between gap-2 text-[13px]">
          <span className="font-bold text-axal-ink dark:text-gray-100">{state.code}{state.amount ? ` · −${state.amount}` : ''}</span>
          <button type="button" className={LINK} onClick={() => { setText(''); onRemove(); }} disabled={locked} data-testid="checkout-promo-remove">Remove</button>
        </div>
        {state.state === 'covers' && <p className={`m-0 ${SUB}`} data-testid="checkout-promo-covers">{FREE_FIRST}</p>}
      </div>
    );
  }
  return (
    <form className="flex flex-col gap-1" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onApply(text.trim()); }} data-testid="checkout-promo">
      <label className={EYE} htmlFor="checkout-promo-code">Promo code</label>
      <div className="flex gap-2">
        <input id="checkout-promo-code" className={INPUT} value={text} onChange={(e) => setText(e.target.value)} disabled={locked || state.state === 'applying'} maxLength={64} data-testid="checkout-promo-input" />
        <button type="submit" className="min-h-[40px] rounded-[9px] border border-axal-hairline px-3 text-[13px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-100" disabled={locked || state.state === 'applying' || !text.trim()} data-testid="checkout-promo-apply">
          {state.state === 'applying' ? 'Applying…' : 'Apply'}
        </button>
      </div>
      {state.line && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="checkout-promo-line">{state.line}</p>}
    </form>
  );
}

/** PAYX7, PAYX8: after Pay, the status route's answer. */
function After({ status, slow, unreadable, free, onClose, onRetry }) {
  const view = statusView(status, { slow });
  const changes = status?.changes?.before ? status.changes : null;
  return (
    <div className="flex flex-col items-start gap-3 px-6 py-6" data-testid={`checkout-after-${view.key}`}>
      {view.key === 'active' && <Check size={22} aria-hidden="true" className="text-axal-positive" />}
      <h3 className="m-0 text-[18px] font-extrabold text-axal-ink dark:text-gray-100">{view.title}</h3>
      {view.line && <p className={`m-0 ${SUB}`}>{view.line}</p>}
      {unreadable && <p className={`m-0 ${SUB}`} data-testid="checkout-status-unreadable">Your payment could not be read just now. That is not the same as a failed payment.</p>}
      {view.key === 'active' && (
        <>
          {free && <p className={`m-0 ${SUB}`}>{FREE_FIRST}</p>}
          {changes && <p className={`m-0 ${SUB}`} data-testid="checkout-changes">From {changes.before.plan_name} to {changes.after.plan_name}.</p>}
          <span className={EYE}>What you get now</span>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="checkout-what-you-get">
            {whatYouGet(status.result).map((l) => (
              <li key={l.key} className={`flex items-start gap-2 text-[13px] ${l.measured ? 'text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`}>
                <Check size={15} aria-hidden="true" className={`mt-0.5 shrink-0 ${l.measured ? 'text-axal-positive' : 'text-axal-faint'}`} /><span>{l.text}</span>
              </li>
            ))}
          </ul>
          <p className={`m-0 ${SUB}`}>The receipt, with its invoice number, arrives by email and appears in Billing.</p>
        </>
      )}
      <div className="flex flex-wrap gap-3">
        {view.key === 'failed' && <button type="button" className={LINK} onClick={onRetry} data-testid="checkout-after-retry">Try again</button>}
        <Link to="/account/billing" className={LINK} onClick={onClose}>Open Billing</Link>
        <button type="button" className={LINK} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export default function CheckoutSheet({ plan, spec, user, role, held, planRead, onRetryPlan, interval: start = 'monthly', onClose, bridge = STRIPE_BRIDGE, pollMs = POLL_MS }) {
  const intervals = intervalsOf(plan);
  const [interval, setInterval] = useState(intervals[start] ? start : intervals.monthly ? 'monthly' : 'yearly');
  const mode = planRead && planRead.status !== 'ready' ? (planRead.status === 'loading' ? 'reading' : 'unreadable') : sheetMode({ user, role, plan, held });
  const planKey = planKeyOf(plan);
  const pays = (mode === 'pay' || mode === 'change') && !!planKey;
  const close = () => onClose?.();
  const box = useDialog(close);

  // The quote: read on open, and again for a new interval or code.
  const [promo, setPromo] = useState('');
  const [tick, setTick] = useState(0);
  const [read, setRead] = useState({ status: pays ? 'loading' : 'idle', data: null, error: null });
  useEffect(() => {
    if (!pays) return undefined;
    let live = true;
    setRead((r) => ({ status: 'loading', data: r.data, error: null }));
    checkoutApi.quote({ planKey, interval, promoCode: promo || undefined })
      .then((data) => { if (live) setRead({ status: 'ok', data, error: null }); }, (error) => { if (live) setRead({ status: 'error', data: null, error }); });
    return () => { live = false; };
  }, [pays, planKey, interval, promo, tick]);
  // While a new interval or code is quoted, the last quote stays drawn and Pay waits.
  const quote = read.status === 'error' ? null : read.data;
  const refreshing = read.status === 'loading';
  const view = quoteView(quote);
  const isNew = quote?.mode === 'new';

  // "Pay with": saved cards, for a new plan outside the investor family (D892 §6).
  const [methods, setMethods] = useState({ status: 'idle', list: [] });
  const wantsCards = isNew && savedCardsApply(plan);
  useEffect(() => {
    if (!wantsCards) return undefined;
    let live = true;
    setMethods({ status: 'loading', list: [] });
    checkoutApi.methods().then((d) => { if (live) setMethods({ status: 'ok', list: Array.isArray(d?.methods) ? d.methods : [] }); },
      () => { if (live) setMethods({ status: 'error', list: [] }); });
    return () => { live = false; };
  }, [wantsCards]);
  const [using, setUsing] = useState('new');
  useEffect(() => { if (methods.status === 'ok' && methods.list[0]?.id) setUsing(methods.list[0].id); }, [methods]);

  const [card, setCard] = useState(undefined);
  const onCardReady = useCallback((api) => setCard(api), []);
  const [phase, setPhase] = useState('form');
  const [failure, setFailure] = useState(null);
  const [started, setStarted] = useState(null);
  const nonce = useRef(newNonce());
  const locked = phase === 'processing';

  // After Pay: poll the status route until it answers, with the slow line after a minute.
  const [status, setStatus] = useState(null);
  const [slow, setSlow] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  useEffect(() => {
    if (phase !== 'status' || !started?.ref) return undefined;
    let live = true;
    let timer = null;
    const since = Date.now();
    const poll = () => {
      checkoutApi.status(started.ref).then((s) => {
        if (!live) return;
        setUnreadable(false);
        setStatus(s);
        if (s?.state === 'activating') { setSlow(Date.now() - since >= SLOW_MS); timer = setTimeout(poll, pollMs); }
      }, () => {
        if (!live) return;
        setUnreadable(true);
        setSlow(Date.now() - since >= SLOW_MS);
        timer = setTimeout(poll, pollMs);
      });
    };
    poll();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [phase, started, pollMs]);

  const pay = async () => {
    // Pay is disabled while a quote is read; the lock stops a second press while one is processed.
    if (locked) return;
    setFailure(null);
    setPhase('processing');
    const newCard = isNew && using === 'new' && !view?.free;
    if (newCard) {
      if (!card) { setFailure({ view: refusalView({ code: 'stripe_not_configured' }) }); setPhase('form'); return; }
      const s = await card.submit();
      // The form marks its own fields; nothing was sent.
      if (s.error) { setPhase('form'); return; }
    }
    let res;
    try {
      res = await checkoutApi.start({ planKey, interval, nonce: nonce.current, promoCode: isNew ? promo || undefined : undefined, paymentMethod: using !== 'new' ? using : undefined });
    } catch (e) {
      setFailure({ view: refusalView(e) });
      setPhase('form');
      return;
    }
    if (res?.client_secret) {
      const r = newCard ? await card.confirm(res.client_secret)
        : isNew && using !== 'new' ? await bridge.confirmSaved(res.client_secret, using)
          : await bridge.confirmIntent(res.client_secret);
      if (r?.error) { setFailure({ view: declineFamily(r.error), decline: true }); setPhase('form'); return; }
    }
    setStarted(res || {});
    setStatus(null);
    setPhase('status');
  };
  const again = () => { setPhase('form'); setStarted(null); setStatus(null); nonce.current = newNonce(); };

  const CardForm = bridge.CardForm;
  const ps = promoState(refreshing ? null : quote, promo);
  const notHere = mode === 'pay' || mode === 'change' ? 'unsellable' : mode;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 sm:items-center" data-testid="checkout-backdrop">
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="checkout-title" tabIndex={-1}
        className="relative flex max-h-full w-full flex-col overflow-y-auto bg-white outline-none dark:bg-gray-900 sm:max-h-[88vh] sm:max-w-[880px] sm:rounded-[16px]"
        data-testid="checkout-sheet">
        <div className="flex items-center justify-between border-b border-axal-hairline px-5 py-3 dark:border-gray-700">
          <h2 id="checkout-title" className="m-0 text-[16px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{TITLE}</h2>
          <button type="button" aria-label="Close" onClick={close} className="grid h-11 w-11 place-items-center rounded-[9px] text-axal-muted hover:bg-axal-ground dark:text-gray-400 dark:hover:bg-gray-800"><X size={18} aria-hidden="true" /></button>
        </div>
        {phase === 'status' ? (
          <After status={status} slow={slow} unreadable={unreadable} free={!!started?.free} onClose={close} onRetry={again} />
        ) : (
          <div className="grid gap-6 px-5 py-5 sm:grid-cols-[360px_1fr]">
            {mode === 'unsellable' ? <p className={SUB}>{NOT_YET}</p> : <Summary plan={plan} spec={spec} interval={interval} setInterval={setInterval} intervals={intervals} view={view} read={read} locked={locked} />}
            <div className="flex flex-col gap-3.5" data-testid="checkout-payment">
              <span className={EYE}>Payment</span>
              {!pays ? (
                <NotHere mode={notHere} plan={plan} interval={interval} onClose={close} onRetryPlan={onRetryPlan} />
              ) : refreshing && !quote ? (
                <div className="flex flex-col gap-2" data-testid="checkout-payment-loading"><Skel h="h-11" /><Skel h="h-[120px]" /><Skel h="h-11" /></div>
              ) : read.status === 'error' ? (
                <Refused view={refusalView(read.error)} onRetry={() => setTick((n) => n + 1)} onClose={close} testId="checkout-refused" />
              ) : (
                <>
                  {view?.change ? (
                    <div className="flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline px-4 py-3 dark:border-gray-700" data-testid={`checkout-change-${view.change}`}>
                      <span className="text-[13.5px] font-bold text-axal-ink dark:text-gray-100">{view.change === 'upgrade' ? 'Upgrade' : 'Downgrade'}</span>
                      <p className={`m-0 ${SUB}`}>{view.line}</p>
                      {view.storage && <p className="m-0 text-[12.5px] text-amber-800 dark:text-amber-200" data-testid="checkout-change-storage">{view.storage}</p>}
                      {view.stepUp && <p className={`m-0 ${SUB}`} data-testid="checkout-step-up">{view.stepUp}</p>}
                    </div>
                  ) : (
                    <>
                      {wantsCards && methods.status === 'ok' && methods.list.length > 0 && (
                        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Pay with" data-testid="checkout-pay-with">
                          <span className={EYE}>Pay with</span>
                          {methods.list.map((m) => (
                            <label key={m.id} className="flex items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100">
                              <input type="radio" name="pay-with" checked={using === m.id} disabled={locked} onChange={() => setUsing(m.id)} data-testid={`checkout-card-${m.id}`} />{cardWords(m)}
                            </label>
                          ))}
                          <label className="flex items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100">
                            <input type="radio" name="pay-with" checked={using === 'new'} disabled={locked} onChange={() => setUsing('new')} data-testid="checkout-card-new" />A new card
                          </label>
                          {using !== 'new' && <p className={`m-0 ${SUB}`}>A saved card asks for your authenticator code first.</p>}
                        </div>
                      )}
                      {methods.status === 'error' && <p className={`m-0 ${SUB}`} data-testid="checkout-methods-unreadable">Your saved cards could not be read. You can pay with a new card.</p>}
                      {using === 'new' && !view?.free && (
                        <CardFormBoundary>
                          <Suspense fallback={<Skel h="h-[150px]" testId="checkout-card-loading" />}>
                            <CardForm amount={quote?.total_due_today ?? quote?.unit_amount} currency={quote?.currency} onReady={onCardReady} />
                          </Suspense>
                        </CardFormBoundary>
                      )}
                      {card === null && <p className={`m-0 ${SUB}`} data-testid="checkout-not-set-up">Payments aren’t set up here. Nothing can be bought here yet. You were not charged.</p>}
                      <Promo promo={promo} state={ps} locked={locked} onApply={(code) => setPromo(code)} onRemove={() => setPromo('')} />
                    </>
                  )}
                  {failure && (
                    <div className={ALERT} role="alert" data-testid={failure.decline ? `checkout-decline-${failure.view.key}` : `checkout-start-refused-${failure.view.key}`}>
                      <span className="font-bold">{failure.view.title}</span>
                      <span>{failure.view.line}</span>
                      {failure.decline && <span className="flex gap-3"><button type="button" className={LINK} onClick={pay} data-testid="checkout-decline-retry">Try again</button>
                        <button type="button" className={LINK} onClick={() => { setFailure(null); setUsing('new'); }} data-testid="checkout-decline-other">Use another method</button></span>}
                    </div>
                  )}
                  <button type="button" className={PRIMARY} onClick={pay} disabled={locked || refreshing || !quote || (using === 'new' && isNew && !view?.free && !card)} data-testid="checkout-pay">
                    {locked ? 'Processing…' : view?.button || 'Pay'}
                  </button>
                  {locked && <p className="m-0 text-[12.5px] font-bold text-axal-ink dark:text-gray-100" data-testid="checkout-processing">Don’t close this window.</p>}
                  {view && !view.due && view.rows.find((r) => r.key === 'due')?.reason && <p className={`m-0 ${SUB}`}>{view.rows.find((r) => r.key === 'due').reason}</p>}
                </>
              )}
              <p className={`m-0 flex items-start gap-1.5 ${SUB}`}><Lock size={13} aria-hidden="true" className="mt-0.5 shrink-0" />{SECURE_LINE}</p>
              <p className={`m-0 ${SUB}`}>{SELLER_LINE}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
