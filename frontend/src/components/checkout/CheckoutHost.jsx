import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { loadPlans } from '../../lib/planPrices';
import { heldCard } from '../../lib/pricingModel';
import { isSuperAdminUser, shellRoleFor } from '../../lib/shellRole';
import { useViewMode } from '../../contexts/ViewModeContext';
import CheckoutSheet from './CheckoutSheet';
import { CHECKOUT_EVENT, TAB_OF_FAMILY, familyOfKey, planForKey } from './checkoutEntry';

/**
 * D1054 (#2905) — the one place the checkout sheet opens outside Pricing.
 * Mounted once beside the paywall (App.jsx); it renders nothing until
 * `openCheckout` asks for a plan, then:
 *   - reads the plans once per page load (`loadPlans`, D1050) and finds the
 *     plan by its catalogue key;
 *   - for an Advisor or Operating Partner, reads their plan status, so the
 *     sheet knows a change from a new plan (D1049), with Try again;
 *   - for a Super Admin, reads whether Stripe is in test mode (the publishable
 *     key's `pk_test_` prefix on `GET /api/payments/config`) for PAYX16's pill;
 *   - and draws D1048's sheet over the current page, with no route change.
 * A plans read that fails says so in place, with Try again; it never opens a
 * sheet on a guessed price.
 */

const SUB = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const LINK = 'text-[13px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300';

function useOnce(fetcher, on) {
  const [state, setState] = useState({ status: on ? 'loading' : 'idle', body: null });
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!on) { setState({ status: 'idle', body: null }); return undefined; }
    let live = true;
    setState({ status: 'loading', body: null });
    fetcher().then((body) => { if (live) setState({ status: 'ready', body }); }, () => { if (live) setState({ status: 'unreadable', body: null }); });
    return () => { live = false; };
  }, [fetcher, on, round]);
  return [state, useCallback(() => setRound((n) => n + 1), [])];
}

export default function CheckoutHost({ user, bridge }) {
  // Mounted beside the paywall, outside the shell's view-mode provider: the role is the session's own then.
  const role = useViewMode()?.shellRole ?? (user ? shellRoleFor(user.role, user) : null);
  const [ask, setAsk] = useState(null);
  useEffect(() => {
    const on = (e) => { if (e?.detail?.plan_key) setAsk(e.detail); };
    window.addEventListener(CHECKOUT_EVENT, on);
    return () => window.removeEventListener(CHECKOUT_EVENT, on);
  }, []);

  const family = familyOfKey(ask?.plan_key);
  const tab = TAB_OF_FAMILY[family] || null;
  const wantPlan = !!ask && (family === 'advisor' || family === 'partner') && role === family;
  const [plans, retryPlans] = useOnce(loadPlans, !!ask);
  const [planRead, retryPlan] = useOnce(api.planStatus, wantPlan);
  const superAdmin = isSuperAdminUser(user);
  const [config] = useOnce(api.paymentsConfig, !!ask && superAdmin);
  const testMode = superAdmin && config.status === 'ready' && /^pk_test_/.test(String(config.body?.publishable_key || ''));

  if (!ask) return null;
  const close = () => setAsk(null);
  const plan = plans.status === 'ready' ? planForKey(plans.body, ask.plan_key) : null;
  if (!plan) {
    const reading = plans.status === 'loading';
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="checkout-host-backdrop">
        <div role="dialog" aria-modal="true" aria-label="Checkout" className="flex w-full max-w-[420px] flex-col gap-2 rounded-[16px] bg-white px-5 py-5 dark:bg-gray-900" data-testid={reading ? 'checkout-host-reading' : 'checkout-host-unreadable'}>
          <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{reading ? 'Reading the plan…' : 'This plan couldn’t be read just now.'}</span>
          {!reading && <p className={`m-0 ${SUB}`}>That doesn’t mean it’s free. No payment can start until its price is read.</p>}
          <div className="flex gap-3">
            {!reading && plans.status !== 'ready' && <button type="button" className={LINK} onClick={retryPlans} data-testid="checkout-host-retry">Try again</button>}
            <button type="button" className={LINK} onClick={close} data-testid="checkout-host-close">Close</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <CheckoutSheet
      key={`${ask.plan_key}:${ask.interval}`}
      plan={plan}
      user={user}
      role={role}
      held={tab ? heldCard(user, role, tab, wantPlan ? planRead : null) : null}
      planRead={wantPlan ? planRead : null}
      onRetryPlan={retryPlan}
      interval={ask.interval}
      from={ask.from}
      unlocks={ask.unlocks}
      testMode={testMode}
      onClose={close}
      {...(bridge ? { bridge } : {})}
    />
  );
}
