import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Lock, X } from 'lucide-react';
import {
  ACTIVATING, NOT_YET, PROCESSING_CLOSE, RENEWS, SECURE_LINE, SELLER_LINE, TITLE, TOTALS_WAIT,
  familyOf, includedLines, intervalsOf, sheetMode,
} from './checkoutModel';

/**
 * D1048 (#2451) — the checkout sheet, built to the owner's "Checkout" canvas
 * (PAYX1–PAYX21). It opens in place over the page, with no route change, so
 * Back and Esc close it. Pricing's Upgrade and "Get …" open it today; the
 * paywall, Billing and Usage join in part 6.
 *
 * THE INTEGRATION, NOT THE WHOLE CANVAS (D1048 §3). The left column is the
 * plan as the public plans read gives it. The right column is today's
 * payment form (`AxalCheckout`, the Payment Element on `POST
 * /api/payments/intent`, which grants the plan and refuses a second
 * subscription since D892). It mounts only when the member presses
 * Continue, because the intent makes a subscription in Stripe. The designed
 * refusals, the activating poll, the quote and a plan change in place wait
 * for parts 3 to 5.
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
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const LINK = 'text-[13px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300';
const MONO = 'font-mono tabular-nums';
// Loaded on Continue: Stripe's module reads its key on import, and Pricing need not carry it until then.
const AxalCheckout = lazy(() => import('../AxalCheckout'));
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Esc closes, focus moves in and stays inside, and returns to the opener on close. */
function useDialog(onClose) {
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

function Summary({ plan, spec, interval, setInterval, intervals }) {
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
            <button key={k} type="button" aria-pressed={interval === k} onClick={() => setInterval(k)} data-testid={`checkout-interval-${k}`}
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
      <div className="flex flex-col gap-1 border-t border-axal-hairline pt-3 dark:border-gray-700" data-testid="checkout-totals">
        <div className="flex justify-between text-[13px]"><span>Subtotal</span><span className={MONO}>{price.subtotal}</span></div>
        <p className={`m-0 ${SUB}`}>{TOTALS_WAIT}</p>
      </div>
    </div>
  );
}

/** The payment column for a mode that does not pay here (D1048 §3). */
function NotHere({ mode, onClose }) {
  const body = {
    staff: ['Staff account · no plan needed', 'Admin and Super Admin accounts hold no plan.', null],
    explorer: ['Choose your profile first.', 'Plans belong to a profile: Founder, Investor, Advisor or Operating Partner. You can still buy AI tokens without a plan.', <Link key="p" to="/onboarding" className={LINK} onClick={onClose}>Choose a profile</Link>],
    other: ['This plan is for another profile.', 'Plans are sold to the profile they belong to.', null],
    unsellable: ['This plan’s price couldn’t be read just now.', 'That doesn’t mean it’s free. No payment can start until a price is on sale.', null],
    change: ['You already pay for a plan in this group.', 'A plan change is made on Billing, with the difference prorated, until it can be made here (part 3).', <Link key="b" to="/account/billing" className={LINK} onClick={onClose}>Open Billing</Link>],
  }[mode];
  return (
    <div className="flex flex-col items-start gap-2 rounded-[10px] border border-axal-hairline px-4 py-4 dark:border-gray-700" data-testid={`checkout-mode-${mode}`}>
      <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{body[0]}</span>
      <p className={`m-0 ${SUB}`}>{body[1]}</p>
      {body[2]}
    </div>
  );
}

export default function CheckoutSheet({ plan, spec, user, role, held, interval: start = 'monthly', onClose }) {
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(null);
  const intervals = intervalsOf(plan);
  const [interval, setInterval] = useState(intervals[start] ? start : intervals.monthly ? 'monthly' : 'yearly');
  const mode = sheetMode({ user, role, plan, held });
  const price = intervals[interval];
  const close = () => onClose?.();
  const box = useDialog(close);
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 sm:items-center" data-testid="checkout-backdrop">
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="checkout-title" tabIndex={-1}
        className="relative flex max-h-full w-full flex-col overflow-y-auto bg-white outline-none dark:bg-gray-900 sm:max-h-[88vh] sm:max-w-[880px] sm:rounded-[16px]"
        data-testid="checkout-sheet">
        <div className="flex items-center justify-between border-b border-axal-hairline px-5 py-3 dark:border-gray-700">
          <h2 id="checkout-title" className="m-0 text-[16px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{TITLE}</h2>
          <button type="button" aria-label="Close" onClick={close} className="grid h-11 w-11 place-items-center rounded-[9px] text-axal-muted hover:bg-axal-ground dark:text-gray-400 dark:hover:bg-gray-800"><X size={18} aria-hidden="true" /></button>
        </div>
        {paid ? (
          <div className="flex flex-col items-start gap-3 px-6 py-6" data-testid="checkout-accepted">
            <Check size={22} aria-hidden="true" className="text-axal-positive" />
            <h3 className="m-0 text-[18px] font-extrabold text-axal-ink dark:text-gray-100">{paid.free ? 'Your code covered the first payment.' : 'Payment received.'}</h3>
            <p className={`m-0 ${SUB}`}>{ACTIVATING}</p>
            <p className={`m-0 ${SUB}`}>The receipt, with its invoice number, arrives by email and appears in Billing. What changed on your plan is {NOT_YET.toLowerCase()} here (part 3).</p>
            <div className="flex flex-wrap gap-3">
              <Link to="/account/billing" className={LINK} onClick={close}>Open Billing</Link>
              <button type="button" className={LINK} onClick={close}>Close</button>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 px-5 py-5 sm:grid-cols-[360px_1fr]">
            {mode === 'unsellable' ? <p className={SUB}>{NOT_YET}</p> : <Summary plan={plan} spec={spec} interval={interval} setInterval={setInterval} intervals={intervals} />}
            <div className="flex flex-col gap-3.5" data-testid="checkout-payment">
              <span className={EYE}>Payment</span>
              {mode !== 'pay' ? <NotHere mode={mode} onClose={close} /> : paying ? (
                <>
                  <Suspense fallback={<p className={`m-0 ${SUB}`}>Loading payment form…</p>}>
                    <AxalCheckout key={price.priceId} priceId={price.priceId} description={plan.plan_name || spec?.name} onSuccess={(res) => setPaid(res || {})} />
                  </Suspense>
                  <p className={`m-0 ${SUB}`}>{PROCESSING_CLOSE}</p>
                </>
              ) : (
                <>
                  <p className={`m-0 ${SUB}`}>Card, Apple Pay where your device offers it, and promo codes, in Stripe’s payment form.</p>
                  <button type="button" className={PRIMARY} onClick={() => setPaying(true)} data-testid="checkout-continue">Continue to payment</button>
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
