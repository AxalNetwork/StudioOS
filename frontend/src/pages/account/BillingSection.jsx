// D4618 part 2 (#4618): Billing and orders (board AC-6), moved unchanged out of
// `../SettingsPage.jsx` and loaded with its section (`lazySection`), so the
// checkout, the dashboard and the role panels are fetched only when Billing
// opens. `BillingTab` reads the plan once (`useBillingStatus`) and the billing
// overview once (`useBillingReads`, D4617), and hands both to every card and
// to `BillingDashboard`, so Payment details and the dashboard share one read
// and one invalidation. "No card" and "payment details unavailable" stay
// `BillingCards.jsx`'s and `BillingDashboard.jsx`'s rule.
import Card from './AccountCard.jsx';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { CheckCircle2 } from 'lucide-react';
import { Orders, PlanHeader, useBillingStatus } from './AccountBilling';
import AutoReloadCard from './AutoReloadCard';
import { BuyTokensCard, PaymentDetailsCard, PlanAllowanceCard, TokenBalanceCard, useBillingReads } from './BillingCards';
import ColleagueSeatsPanel from '../ColleagueSeatsPanel';
import AxalCheckout from '../../components/AxalCheckout';
import { TIER_PLANS } from '../../components/PaywallModal';
import { openCheckout } from '../../components/checkout/checkoutEntry';
import { FREE, priceText, usePlansRead } from '../../lib/planPrices';
import BillingDashboard from '../../components/BillingDashboard';
import { formatStripeAmount } from '../../lib/money';

// Task #6 — Live tier billing tab. Reads /api/billing/tier/status; "Upgrade"
// opens Stripe Checkout for the chosen tier (or the dev-upgrade fallback when
// Stripe isn't configured); "Manage subscription" opens the Stripe billing
// portal so users can update card / cancel / download invoices.
//
// Task #7 (W-2) — Investors hit the same tab but see InvestorBillingPanel
// (Pro / Institutional plans, ROI quotas, seat management for institutional).
//
// D568 — Billing and orders. The canvas's plan line and orders list sit on
// top (`PlanHeader`, `Orders`), and the role's panel follows. The plan is read
// ONCE here and handed to both, so the line and the panel cannot disagree and
// a change made in the panel refreshes the line; each panel's own "Current
// plan" card is the line now and was removed.
export function BillingTab({ data, flash }) {
  const role = String(data?.role || '').toLowerCase();
  const billing = useBillingStatus(role);
  const reads = useBillingReads({ role });
  let panel;
  if (role === 'investor') {
    panel = <InvestorBillingPanel data={data} flash={flash} billing={billing} overview={reads.overview} />;
  } else if (role === 'founder') {
    panel = <FounderBillingPanel data={data} flash={flash} billing={billing} overview={reads.overview} />;
  } else {
    // Every other signed-in role (partner, advisor, …) gets the generic
    // account-plan pipeline: a persona plan ladder + native subscription
    // management. Roles with no plan_group / no persona plans fall back inside
    // PersonaBillingPanel to the saved-cards-and-receipts view — no regression.
    panel = <PersonaBillingPanel data={data} flash={flash} billing={billing} overview={reads.overview} />;
  }
  return (
    <>
      <BillingConsole key={role} role={role} billing={billing} reads={reads} />
      {panel}
    </>
  );
}


// D792 (#2217) — Billing, B3 of the "Usage & Billing console" canvas, in its
// order: Token balance and Included with your plan; Buy tokens; the plan and
// Payment details beside Auto-reload (D794); then the orders, each with its
// invoice. The role's panel follows as before.
function BillingConsole({ role, billing, reads }) {
  return (
    <div className="flex flex-col gap-3" data-testid="billing-console">
      <div className="grid gap-3 md:grid-cols-2">
        <TokenBalanceCard me={reads.me} />
        <PlanAllowanceCard me={reads.me} />
      </div>
      <BuyTokensCard topUp={reads.topUp} />
      <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <PlanHeader role={role} billing={billing} />
          <PaymentDetailsCard role={role} overview={reads.overview} />
        </div>
        <AutoReloadCard />
      </div>
      <Orders />
    </div>
  );
}


// Task #39 — billing surface for roles without a subscription plan ladder.
// Reuses the in-app BillingDashboard (saved cards, any subscription, invoices,
// and one-off payment history) in its "general" variant, which swaps the
// subscription-centric empty-state copy for neutral wording. `scope="founder"`
// reads the user's general `stripe_customer_id` — the same customer that backs
// one-off purchases — so receipts for incorporation, expert sessions, and
// other à la carte buys appear here.
function GenericBillingPanel({ flash, overview }) {
  return (
    <Card title="Billing" description="Your saved cards, payments, and receipts.">
      <BillingDashboard scope="founder" variant="general" flash={flash} overviewRead={overview} />
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-3">
        Questions? Contact <a className="text-violet-700 hover:underline" href="mailto:billing@axal.vc">billing@axal.vc</a>.
      </div>
    </Card>
  );
}


// Persona plan catalog (display copy). Names / features mirror the
// marketing pricing pages; the paid "Pro" tier resolves its real Stripe price
// server-side at checkout (or a keyless dev-upgrade), so this stays display-only
// and never hardcodes a price id. Keyed by the plan_group the backend derives
// from the role (partner → 'partner', advisor → 'advisor').
// D1050 (#2901): no price is typed here. Pro's price is the plans read's
// (`lib/planPrices.js`), under the plan group's licence key; Starter is free.
const PERSONA_PLANS = {
  partner: {
    label: 'Partner',
    // D4653 part 2 (#4653): no Stripe Connect payouts and no verified partner badge (D676: neither runs).
    starter: { name: 'Starter', tagline: 'Get listed and answer posted needs.',
      features: ['Marketplace + directory listing', 'Manage up to 3 service offers', 'Respond to Needs Board posts'] },
    pro: { name: 'Pro', tagline: 'For partners who want inbound demand on tap.',
      features: ['Unlimited service offers', 'Priority placement in search + directory', 'Full partner analytics dashboard', 'Partner deal portal access'] },
  },
  advisor: {
    label: 'Advisor',
    starter: { name: 'Starter', tagline: 'Publish a profile and take founder matches.',
      features: ['Public advisor profile + expertise tags', 'Founder matching', 'Office Hours workspace', 'Ratings + trust badge'] },
    pro: { name: 'Pro', tagline: 'For advisors who want more reach and better matches.',
      features: ['Priority founder matching', 'Boosted directory visibility', 'Featured advisor placement'] },
  },
};


// Native billing for personas without a bespoke pipeline (partner, advisor/
// advisor, …). Drives the generic /api/billing/plan/* endpoints: current plan +
// trial status, a persona plan ladder with inline (no-redirect) checkout, and
// the shared BillingDashboard for cancel/resume, payment methods, and invoices
// (the persona subscription lives on the general Stripe customer, which
// scope="founder" reads). Falls back to the saved-cards view for any role that
// has no persona plan.
export function PersonaBillingPanel({ flash, billing, overview }) {
  // D568 — the plan read is BillingTab's (`billing`, GET /billing/plan/status),
  // shared with the plan line above. A failed read leaves `status` null, which
  // falls back to the saved-cards view exactly as the panel's own read did.
  const status = billing.status === 'ready' ? billing.data : null;
  const loading = billing.status === 'loading';
  const refresh = billing.reload;
  const busy = false;
  const prices = usePlansRead();

  // Flash on return from a (dev-upgrade) redirect, mirroring the other panels.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgraded') === '1') {
      flash?.('Subscription updated.');
      params.delete('upgraded');
      const q = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (q ? '?' + q : ''));
    }
  }, [flash]);

  const group = status?.plan_group || null;
  const defs = group ? PERSONA_PLANS[group] : null;

  if (loading) {
    return <Card title="Billing" description="Your plan and payments."><div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div></Card>;
  }
  // No persona plan for this role → saved cards + receipts only (no regression).
  if (!group || !defs) {
    return <GenericBillingPanel flash={flash} overview={overview} />;
  }

  const subStatus = String(status?.status || 'free').toLowerCase();
  const isSubscribed = ['active', 'trialing', 'past_due'].includes(subStatus);
  const trialEnds = subStatus === 'trialing' && status?.trial_ends_at ? new Date(status.trial_ends_at) : null;
  const trialDaysLeft = trialEnds ? Math.max(0, Math.ceil((trialEnds.getTime() - Date.now()) / 86_400_000)) : null;
  const hasCustomer = !!status?.has_customer;

  // D1054 (#2905, PAYX14): Subscribe opens the checkout sheet over Billing, on D1051's routes.
  const startCheckout = () => openCheckout({ plan_key: `${group}:pro`, from: { label: 'Billing', href: '/account/billing' } });

  return (
    <>
      {/* D568 — the "Current plan" card that stood here is the plan line at
          the top of the pane now (PlanHeader), read from the same status. */}
      {/* Trial status card — clear countdown + first-charge date. */}
      {subStatus === 'trialing' && trialEnds && (
        <Card title="Trial status" description="You're trialing a paid plan.">
          <div className="rounded-lg border border-violet-300 dark:border-violet-700 bg-violet-50/60 dark:bg-violet-900/20 p-4 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {trialDaysLeft} day{trialDaysLeft === 1 ? '' : 's'} left in your trial
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                Your {defs.pro.name} plan begins on {trialEnds.toLocaleDateString()} — your card is charged then unless
                you cancel before the trial ends. Cancel any time from “Manage subscription” below.
              </div>
            </div>
            <span className="text-xs uppercase tracking-wider px-2.5 py-1 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 font-semibold">
              Ends {trialEnds.toLocaleDateString()}
            </span>
          </div>
        </Card>
      )}

      {/* Manage existing subscription, or the plan ladder + inline checkout. */}
      {isSubscribed && hasCustomer ? (
        <Card title="Manage subscription" description="Change card, cancel, and review invoices without leaving Axal VC.">
          <BillingDashboard scope="founder" flash={flash} onChanged={refresh} overviewRead={overview} />
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-3">
            Questions? Contact <a className="text-violet-700 hover:underline" href="mailto:billing@axal.vc">billing@axal.vc</a>.
          </div>
        </Card>
      ) : (
        <Card title="Plans" description="Upgrade any time. Manage or cancel from this page once subscribed.">
          <div className="grid gap-3 sm:grid-cols-2">
            {[['starter', defs.starter], ['pro', defs.pro]].map(([key, plan]) => {
              const current = key === 'starter' && !isSubscribed;
              return (
                <div key={key}
                  className={`rounded-lg border p-4 flex flex-col ${key === 'pro' ? 'border-violet-600 bg-violet-50/50 dark:bg-violet-900/20' : 'border-gray-200 dark:border-gray-700'}`}>
                  <div className="font-semibold text-gray-900 dark:text-gray-100">{plan.name}</div>
                  <div className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                    <span className="font-semibold" data-testid={`persona-price-${key}`}>{key === 'starter' ? FREE : key === 'pro' ? priceText(prices, group) : 'Custom'}</span>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{plan.tagline}</div>
                  <ul className="mt-3 space-y-1.5 flex-1">
                    {plan.features.map((f) => (
                      <li key={f} className="text-xs text-gray-600 dark:text-gray-300 flex items-start gap-1.5">
                        <CheckCircle2 size={13} className="text-violet-600 dark:text-violet-400 mt-0.5 shrink-0" />{f}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3">
                    {current && (
                      <span className="text-xs uppercase tracking-wider text-violet-700 dark:text-violet-300 font-semibold">Current plan</span>
                    )}
                    {key === 'pro' && (
                      <button type="button" disabled={busy} onClick={startCheckout}
                        className="w-full px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-md text-sm font-medium disabled:opacity-50">
                        {busy ? 'Starting…' : 'Subscribe'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-xs text-gray-500 dark:text-gray-400 mt-3">
            Questions? Contact <a className="text-violet-700 hover:underline" href="mailto:billing@axal.vc">billing@axal.vc</a>.
          </div>
        </Card>
      )}
    </>
  );
}


function FounderBillingPanel({ flash, billing, overview }) {
  // D568 — the tier read is BillingTab's (`billing`, GET /billing/tier/status),
  // shared with the plan line above. It used to fall back to
  // `data.subscription_tier` on a failed read, a field the root settings
  // payload does not carry, so a failed read drew the Free ladder as if it
  // were true. Now a failed read draws nothing here; the plan line above says
  // it could not be read and offers a retry.
  const status = billing.status === 'ready' ? billing.data : null;
  const busy = null;
  const prices = usePlansRead();

  // Auto-flash when the URL carries an upgrade-completion param.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgraded') === '1') {
      flash?.('Subscription updated.');
      params.delete('upgraded');
      const q = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (q ? '?' + q : ''));
    } else if (params.get('upgrade_cancelled') === '1') {
      flash?.('Upgrade cancelled.', 'error');
      params.delete('upgrade_cancelled');
      const q = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (q ? '?' + q : ''));
    }
  }, [flash]);

  if (!status) return null;

  const tier = String(status.tier || 'free').toLowerCase();
  const subStatus = String(status.status || 'active').toLowerCase();
  const hasCustomer = !!status.has_customer;
  // Trial + Spin-Out Lab billing state (from /api/billing/tier/status).
  const trialEnds = subStatus === 'trialing' && status?.trial_ends_at ? new Date(status.trial_ends_at) : null;
  const spinoutLab = status?.spinout_lab?.active ? status.spinout_lab : null;
  const daysUntil = (d) => (d ? Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86_400_000)) : null);
  const trialDaysLeft = daysUntil(trialEnds);

  // D1054 (#2905): Upgrade opens the checkout sheet over Billing; it no longer leaves for Stripe.
  const upgrade = (target) => openCheckout({ plan_key: `founder:${target}`, from: { label: 'Billing', href: '/account/billing' } });

  const refreshStatus = billing.reload;

  const TIER_LABEL = {
    free: FREE,
    growth: `${TIER_PLANS.growth.label} — ${priceText(prices, TIER_PLANS.growth.key)}`,
    studio: `${TIER_PLANS.studio.label} — ${priceText(prices, TIER_PLANS.studio.key)}`,
  };
  const ladder = ['free', 'growth', 'studio'];
  const RANK = { free: 0, growth: 1, studio: 2 };

  return (
    <>
      {/* Spin-Out Lab exception — participants are free for 30 days and are
          never pushed into the standard paid-plan trial / auto-charge flow.
          Surfaced here so the guarantee is explicit inside Billing. */}
      {spinoutLab && (
        <Card title="Spin-Out Lab" description="You're on the house while you run your sprint.">
          <div className="rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-lg font-semibold text-emerald-800 dark:text-emerald-200">
                  Free for {spinoutLab.free_days || 30} days
                </div>
                <div className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                  No card required · you won't be auto-charged during the Lab
                  {spinoutLab.free_until && (
                    <> · free through {new Date(spinoutLab.free_until).toLocaleDateString()}</>
                  )}
                </div>
              </div>
              {typeof spinoutLab.days_remaining === 'number' && (
                <span className="text-xs uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold">
                  {spinoutLab.days_remaining} day{spinoutLab.days_remaining === 1 ? '' : 's'} left
                </span>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* D568 — the "Current plan" card that stood here is the plan line at
          the top of the pane now (PlanHeader), read from the same status. */}
      {/* Trial status card — clear countdown + when the first charge lands, so
          founders on a paid-plan trial always know what happens next and how to
          stop it. Managing/cancelling happens in the subscription card below. */}
      {subStatus === 'trialing' && trialEnds && (
        <Card title="Trial status" description="You're trialing a paid plan.">
          <div className="rounded-lg border border-violet-300 dark:border-violet-700 bg-violet-50/60 dark:bg-violet-900/20 p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {trialDaysLeft} day{trialDaysLeft === 1 ? '' : 's'} left in your trial
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                  Your {TIER_LABEL[tier] || tier} plan begins on {trialEnds.toLocaleDateString()} — your card is
                  charged then unless you cancel before the trial ends. Cancel any time from “Manage subscription” below.
                </div>
              </div>
              <span className="text-xs uppercase tracking-wider px-2.5 py-1 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 font-semibold">
                Ends {trialEnds.toLocaleDateString()}
              </span>
            </div>
          </div>
        </Card>
      )}

      {/* Task #5 — active subscribers manage everything in-app (cancel, resume,
          plan swap with proration, payment methods, invoices). Free users see
          the plan ladder + inline checkout to subscribe. */}
      {hasCustomer && tier !== 'free' ? (
        <Card title="Manage subscription" description="Change plan, cancel, and review invoices without leaving Axal VC.">
          <BillingDashboard scope="founder" flash={flash} onChanged={refreshStatus} overviewRead={overview} />
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-3">
            Questions? Contact <a className="text-violet-700 hover:underline" href="mailto:billing@axal.vc">billing@axal.vc</a>.
          </div>
        </Card>
      ) : (
        <>
          <Card
            title="Plans"
            description={spinoutLab
              ? 'Upgrading is optional while you’re in the Spin-Out Lab — your free window keeps running until it ends.'
              : 'Upgrade any time. Manage or cancel from this page once subscribed.'}
          >
            {spinoutLab && (
              <div className="mb-3 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2">
                You’re free for {spinoutLab.free_days || 30} days in the Spin-Out Lab. Upgrading starts a paid plan
                now — there’s no need to unless you want the extra tooling early.
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              {ladder.map((t) => {
                const current = t === tier;
                const upgradable = RANK[t] > RANK[tier];
                return (
                  <div key={t}
                    className={`rounded-lg border p-4 ${current ? 'border-violet-600 bg-violet-50/50 dark:bg-violet-900/20' : 'border-gray-200 dark:border-gray-700'}`}>
                    <div className="font-semibold text-gray-900 dark:text-gray-100">{t === 'free' ? 'Free' : TIER_PLANS[t].label}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t === 'free' && '1 project · 5 interviews · 3 OKRs'}
                      {t === 'growth' && `${priceText(prices, TIER_PLANS.growth.key)} · Unlimited startups, interviews and OKRs, scoring`}
                      {t === 'studio' && `${priceText(prices, TIER_PLANS.studio.key)} · + Pitch deck, cap table, capital, legal, partner tools`}
                    </div>
                    <div className="mt-3">
                      {current && (
                        <span className="text-xs uppercase tracking-wider text-violet-700 dark:text-violet-300 font-semibold">Current plan</span>
                      )}
                      {upgradable && (
                        <button type="button" disabled={busy === t} onClick={() => upgrade(t)}
                          className="w-full px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-md text-sm font-medium disabled:opacity-50">
                          {busy === t ? 'Opening checkout…' : `Upgrade to ${t}`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-3">
              Questions? Contact <a className="text-violet-700 hover:underline" href="mailto:billing@axal.vc">billing@axal.vc</a>.
            </div>
          </Card>

          <EmbeddedCheckoutCard flash={flash} onPaid={refreshStatus} />
        </>
      )}
    </>
  );
}


// Task #4 — Axal-branded embedded checkout, rendered inside Settings → Billing.
// Lists the mirrored Stripe subscription catalog and lets the user pay inline
// with Stripe Elements (no redirect to checkout.stripe.com). Works for any
// price id returned by the catalog. Hidden entirely when payments aren't
// configured (no publishable key) or the catalog is empty.
function EmbeddedCheckoutCard({ flash, onPaid }) {
  const [prices, setPrices] = useState(null); // null = loading, [] = none
  const [selected, setSelected] = useState(null); // { id, label }

  useEffect(() => {
    let cancelled = false;
    api.catalogProducts('subscription')
      .then((res) => {
        if (cancelled) return;
        const list = [];
        for (const p of res?.products || []) {
          for (const pr of p.prices || []) {
            if (pr.active === false) continue;
            list.push({
              id: pr.id,
              product: p.name,
              amount: pr.unit_amount,
              currency: pr.currency,
              interval: pr.interval || (pr.type === 'recurring' ? 'mo' : null),
              nickname: pr.nickname,
            });
          }
        }
        setPrices(list);
      })
      .catch(() => { if (!cancelled) setPrices([]); });
    return () => { cancelled = true; };
  }, []);

  if (!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY) return null;
  if (prices == null) {
    return (
      <Card title="Pay by card" description="Upgrade without leaving Axal VC.">
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading plans…</div>
      </Card>
    );
  }
  if (prices.length === 0) return null;

  const fmt = (amt, cur) =>
    amt == null ? '—' : formatStripeAmount(amt, cur || 'usd');

  return (
    <Card title="Pay by card" description="Complete your upgrade inline — no redirect to Stripe.">
      {!selected ? (
        <div className="space-y-2">
          {prices.map((pr) => (
            <div key={pr.id}
              className="flex items-center justify-between border border-gray-200 dark:border-gray-700 rounded-lg p-3">
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{pr.product}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {fmt(pr.amount, pr.currency)}{pr.interval ? ` / ${pr.interval}` : ''}
                  {pr.nickname ? ` · ${pr.nickname}` : ''}
                </div>
              </div>
              <button type="button"
                onClick={() => setSelected({ id: pr.id, label: `${pr.product} — ${fmt(pr.amount, pr.currency)}` })}
                className="px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-md text-sm font-medium">
                Select
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{selected.label}</div>
            <button type="button" onClick={() => setSelected(null)}
              className="text-xs text-gray-500 dark:text-gray-400 hover:underline">
              Change plan
            </button>
          </div>
          <AxalCheckout
            priceId={selected.id}
            submitLabel="Subscribe"
            description={selected.label}
            onSuccess={() => { flash?.('Payment successful — your plan is being activated.'); onPaid?.(); }}
            onError={(e) => flash?.(e?.message || 'Payment failed', 'error')}
          />
        </div>
      )}
    </Card>
  );
}


// Task #7 (W-2) — Investor billing UI. Mirrors FounderBillingPanel but uses
// the investor endpoints (`/api/billing/investor/*`) and surfaces:
//   1. Current plan card — tier, status (incl. trialing countdown), renews_at,
//      Manage-subscription button when a Stripe customer exists.
//   2. Plan ladder — Free / Professional / Institutional with monthly+annual
//      toggle and Stripe-checkout buttons.
//   3. Quotas card — warm intros / quarter (used vs cap) and deal-room cap.
//   4. Seat management — only for Institutional plans (list/invite/revoke).
export function InvestorBillingPanel({ flash, billing, overview }) {
  // D568 — the status read is BillingTab's (`billing`, GET
  // /billing/investor/status), shared with the plan line above. A failed read
  // used to raise a toast and then draw the Free ladder and zero quotas below
  // it; now the plan line says it could not be read and this draws nothing.
  const status = billing.status === 'ready' ? billing.data : null;
  const refresh = billing.reload;
  const [billingCycle, setBillingCycle] = useState('monthly');
  const busy = null;
  const prices = usePlansRead();

  // Stripe-redirect flash banners (mirrors FounderBillingPanel).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgraded') === '1') {
      flash?.('Subscription updated.');
      params.delete('upgraded');
      window.history.replaceState({}, '', window.location.pathname + (params.toString() ? '?' + params : ''));
    } else if (params.get('upgrade_cancelled') === '1') {
      flash?.('Upgrade cancelled.', 'error');
      params.delete('upgrade_cancelled');
      window.history.replaceState({}, '', window.location.pathname + (params.toString() ? '?' + params : ''));
    }
  }, [flash]);

  if (!status) return null;

  const tier = String(status.tier || 'free').toLowerCase();
  const hasCustomer = !!status.has_customer;
  const quotas = status.quotas || {};

  // Paid tiers open the sheet in the chosen cycle; Institutional links to Contact Axal VC.
  const upgrade = (target) => openCheckout({ plan_key: `investor:${target}`, interval: billingCycle === 'yearly' ? 'yearly' : 'monthly', from: { label: 'Billing', href: '/account/billing' } });

  const TIER_LABEL = {
    free: 'Free',
    // D1050: the names are the plan catalogue's and the prices the plans read's, per the cycle shown.
    plus: `${TIER_PLANS.plus.label} — ${priceText(prices, TIER_PLANS.plus.key, billingCycle === 'yearly' ? 'year' : 'month')}`,
    professional: `${TIER_PLANS.professional.label} — ${priceText(prices, TIER_PLANS.professional.key, billingCycle === 'yearly' ? 'year' : 'month')}`,
    institutional: `${TIER_PLANS.institutional.label} — Custom`,
  };
  const ladder = ['free', 'plus', 'professional', 'institutional'];
  const RANK = { free: 0, plus: 1, professional: 2, institutional: 3 };

  const introsCap = quotas.intros_per_quarter ?? 3;
  const introsUsed = quotas.intros_used ?? 0;
  const dealroomMax = quotas.dealroom_max ?? 1;
  const seatCount = quotas.seat_count ?? 0;
  const seatCap = quotas.seats ?? 1;

  return (
    <>
      {/* D568 — the "Current plan" card that stood here is the plan line at
          the top of the pane now (PlanHeader), read from the same status,
          including the subscribed tier when it differs from the one that
          applies. */}

      <Card title="Quotas this period" description="Limits reset each calendar quarter.">
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400">Warm intros / quarter</div>
            <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {introsUsed} / {introsCap >= 100000 ? '∞' : introsCap}
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400">Deal rooms (max)</div>
            <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {dealroomMax >= 100000 ? 'Unlimited' : dealroomMax}
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400">Colleague seats</div>
            <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{seatCount} / {seatCap}</div>
          </div>
        </div>
      </Card>

      {/* Task #5 — active subscribers manage plan changes, cancellation,
          payment methods, and invoices in-app; free users see the plan ladder
          + inline checkout to subscribe. */}
      {hasCustomer && tier !== 'free' ? (
        <Card title="Manage subscription" description="Change plan, cancel, and review invoices without leaving Axal VC.">
          <BillingDashboard scope="investor" flash={flash} onChanged={refresh} overviewRead={overview} />
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-3">
            See full feature comparison on the <a className="text-violet-700 hover:underline" href="/pricing?for=investor">investor pricing page</a>.
          </div>
        </Card>
      ) : (
        <Card title="Plans" description="Switch plan or change billing cycle. Manage or cancel from this page once subscribed.">
          <div className="flex justify-end mb-3">
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5 bg-white dark:bg-gray-900 text-xs">
              {[{id:'monthly',label:'Monthly'},{id:'yearly',label:'Annual'}].map((b) => (
                <button key={b.id} type="button" onClick={() => setBillingCycle(b.id)}
                  className={`px-3 py-1 rounded-md transition-colors ${
                    billingCycle === b.id ? 'bg-violet-600 text-white font-medium' : 'text-gray-600 dark:text-gray-300'
                  }`}>{b.label}</button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ladder.map((t) => {
              const current = t === tier;
              const upgradable = t !== 'free' && t !== 'institutional' && RANK[t] !== RANK[tier];
              return (
                <div key={t}
                  className={`rounded-lg border p-4 ${current ? 'border-violet-600 bg-violet-50/50 dark:bg-violet-900/20' : 'border-gray-200 dark:border-gray-700'}`}>
                  <div className="font-semibold text-gray-900 dark:text-gray-100">{TIER_LABEL[t] || t}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t === 'free' && '3 intros/qtr · 1 deal room · browse only'}
                    {t === 'plus' && '10 intros/qtr · 2 deal rooms · research workspace'}
                    {t === 'professional' && '25 intros/qtr · 5 deal rooms · MI exports · calendar'}
                    {t === 'institutional' && '100 intros/qtr · unlimited deal rooms · 4 seats · Carta sync'}
                  </div>
                  <div className="mt-3">
                    {current && (
                      <span className="text-xs uppercase tracking-wider text-violet-700 dark:text-violet-300 font-semibold">Current plan</span>
                    )}
                    {t === 'institutional' && <Link to="/contact" className="text-sm text-violet-700 dark:text-violet-300 underline">Contact Axal VC</Link>}
                    {upgradable && (
                      <button type="button" disabled={busy === t} onClick={() => upgrade(t)}
                        className="w-full px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-md text-sm font-medium disabled:opacity-50">
                        {busy === t ? 'Opening checkout…' : (RANK[t] > RANK[tier] ? `Upgrade to ${t}` : `Switch to ${t}`)}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-3">
            See full feature comparison on the <a className="text-violet-700 hover:underline" href="/pricing?for=investor">investor pricing page</a>.
          </div>
        </Card>
      )}

      <Card title="Compare plans" description="What you get at each tier.">
        <InvestorROITable currentTier={tier} />
      </Card>

      {tier === 'institutional' && <InvestorSeatsCard cap={seatCap} onChange={refresh} />}
    </>
  );
}


// Task #7 (W-2) — ROI comparison table reused by Settings > Billing.
// Mirrors the matrix on /pricing?for=investor so investors see the same
// feature breakdown without leaving the settings page.
const INVESTOR_ROI_ROWS = [
  { feature: 'Pipeline browse + AI scoring',     free: '✓', plus: '✓', pro: '✓',  inst: '✓' },
  { feature: 'Warm intros / quarter',            free: '3', plus: '10', pro: '25', inst: '100' },
  { feature: 'Deal rooms (concurrent)',          free: '1', plus: '2', pro: '5',  inst: 'Unlimited' },
  { feature: 'Calendar bookings with founders',  free: '—', plus: '—', pro: '✓',  inst: '✓' },
  { feature: 'Market Intelligence — exports',    free: '—', plus: '—', pro: '✓',  inst: '✓' },
  { feature: 'Co-invest discovery',              free: '—', plus: '—', pro: '—',  inst: '✓' },
  { feature: 'Carta sync (write)',               free: '—', plus: '—', pro: '—',  inst: '✓' },
  { feature: 'LP reporting + peer benchmarks',   free: '—', plus: '—', pro: '—',  inst: '✓' },
  { feature: 'Founder reference checks',         free: '—', plus: '—', pro: '✓',  inst: '✓' },
  { feature: 'Colleague seats included',         free: '0', plus: '0', pro: '0',  inst: '4' },
];


function InvestorROITable({ currentTier }) {
  const cellCls = (col) => {
    const active =
      (col === 'free' && currentTier === 'free') ||
      (col === 'plus' && currentTier === 'plus') ||
      (col === 'pro' && currentTier === 'professional') ||
      (col === 'inst' && currentTier === 'institutional');
    return `text-center px-3 py-2 ${active ? 'font-semibold text-gray-900 dark:text-gray-100 bg-violet-50/40 dark:bg-violet-900/10' : 'text-gray-700 dark:text-gray-200'}`;
  };
  const headCls = (col) => {
    const active =
      (col === 'free' && currentTier === 'free') ||
      (col === 'plus' && currentTier === 'plus') ||
      (col === 'pro' && currentTier === 'professional') ||
      (col === 'inst' && currentTier === 'institutional');
    return `text-center font-medium px-3 py-2 ${active ? 'text-violet-700 dark:text-violet-300' : 'text-gray-600 dark:text-gray-300'}`;
  };
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800/60">
          <tr>
            <th className="text-left font-medium text-gray-600 dark:text-gray-300 px-3 py-2">Capability</th>
            <th className={headCls('free')}>Free</th>
            <th className={headCls('plus')}>Plus</th>
            <th className={headCls('pro')}>Professional</th>
            <th className={headCls('inst')}>Institutional</th>
          </tr>
        </thead>
        <tbody>
          {INVESTOR_ROI_ROWS.map((r) => (
            <tr key={r.feature} className="border-t border-gray-100 dark:border-gray-800">
              <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{r.feature}</td>
              <td className={cellCls('free')}>{r.free}</td>
              <td className={cellCls('plus')}>{r.plus}</td>
              <td className={cellCls('pro')}>{r.pro}</td>
              <td className={cellCls('inst')}>{r.inst}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


// Seat management is Institutional-only. The endpoints already 403 lower
// tiers; we just hide the UI to avoid confusion. D632 — the panel is the
// canvas's `st-invite`: the invite link once, then each seat's state.
export function InvestorSeatsCard({ cap, onChange }) {
  return (
    <Card title="Colleague seats" description={`Invite up to ${cap} colleagues to share your Institutional account.`}>
      <ColleagueSeatsPanel cap={cap} onChange={onChange} />
    </Card>
  );
}
