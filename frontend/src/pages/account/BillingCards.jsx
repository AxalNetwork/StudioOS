import { useState } from 'react';
import { Link } from 'react-router-dom';
import { aiBudgetApi } from '../../lib/api/aiBudget';
import { TOPUP_UNAVAILABLE } from '../../lib/aiTokens';
import { api } from '../../lib/api';
import { Pill, Unreadable } from '../../ui';
import { BTN, LoadingRows, Outcome, PanelCard, useAccountRead } from './AccountCenter';
import { billingSourceFor, refusalText } from './accountCenterModel';
import { NO_CARD, TOKENS_FOOTNOTE, allowanceView, balanceText, packCards, paymentCard } from './billingModel';

/**
 * D792 (#2217) — the Billing page's own cards (B3 of the "Usage & Billing
 * console" canvas): Token balance, Included with your plan, Buy tokens and
 * Payment details. The plan line (`PlanHeader`), Auto-reload (D794) and the
 * orders stay where they were built; `BillingCards` lays the page out around
 * them in the canvas's order. Rules and words are `billingModel.js`.
 *
 * Buy goes to the existing checkout with the chosen pack (D755); this page
 * never takes a payment itself, and never collects card data: the card is
 * managed through Stripe's customer portal.
 */

const LABEL = 'font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-axal-muted dark:text-gray-400';
const MONO = 'font-mono';

function goTo(url) { window.location.assign(url); }

/** Token balance, with Buy tokens (to the pack cards below). */
export function TokenBalanceCard({ me }) {
  const balance = me.status === 'ready' ? balanceText(me.data) : null;
  return (
    <PanelCard data-testid="card-token-balance">
      {me.status === 'loading' ? <LoadingRows lines={1} />
        : me.status !== 'ready' || balance === null
          ? <Unreadable what="Your token balance" claim="This is not a claim that it is zero." onRetry={me.reload} />
          : (
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-col gap-1.5">
                <span className={LABEL}>Token balance</span>
                <span className="font-mono text-[28px] font-medium tracking-[-0.02em] text-axal-ink dark:text-gray-100" data-testid="value-token-balance">
                  {balance} <span className="font-sans text-[13px] font-medium tracking-normal text-axal-muted dark:text-gray-400">AI tokens</span>
                </span>
              </div>
              <a href="#buy-tokens" className={BTN.primary} data-testid="link-buy-tokens">Buy tokens</a>
            </div>
          )}
    </PanelCard>
  );
}

/** Included with your plan: what is left this month, of what, and when it resets; or "No plan: top up as you go." */
export function PlanAllowanceCard({ me, now }) {
  const view = me.status === 'ready' ? allowanceView(me.data, now) : null;
  return (
    <PanelCard data-testid="card-plan-allowance">
      {me.status === 'loading' ? <LoadingRows lines={2} />
        : !view ? <Unreadable what="Your plan's allowance" claim="This is not a claim that your plan includes none." onRetry={me.reload} />
          : (
            <div className="flex flex-col gap-2">
              <span className={LABEL}>Included with your plan</span>
              {view.kind === 'none'
                ? <span className="text-[13.5px] text-axal-ink dark:text-gray-100" data-testid="value-plan-allowance">{view.text}</span>
                : (
                  <>
                    <span className="text-[13.5px] text-axal-ink dark:text-gray-100" data-testid="value-plan-allowance">
                      <span className={`${MONO} font-medium`}>{view.left}</span> of <span className={MONO}>{view.of}</span> left this month, resets <span className={MONO}>{view.resets}</span>
                    </span>
                    <div className="h-1.5 overflow-hidden rounded-full bg-axal-hairline dark:bg-gray-800" role="img" aria-label={`${view.usedPct}% of this month's allowance used`}>
                      <div className="h-full rounded-full bg-axal-violet dark:bg-violet-400" style={{ width: `${view.usedPct}%` }} data-testid="bar-plan-allowance" />
                    </div>
                  </>
                )}
            </div>
          )}
    </PanelCard>
  );
}

/** Buy tokens: the packs on sale, each with its live offer (D790), Buy to the existing checkout, and the footnote. */
export function BuyTokensCard({ topUp }) {
  const cards = topUp.status === 'ready' ? packCards(topUp.data) : [];
  return (
    <div id="buy-tokens" className="scroll-mt-4">
      <PanelCard title="Buy tokens" data-testid="card-buy-tokens">
        {topUp.status === 'loading' ? <LoadingRows lines={2} />
          : topUp.status !== 'ready' ? <Unreadable what="The token packs" claim="This is not a claim that none is on sale." onRetry={topUp.reload} />
            : cards.length === 0 ? <p className="m-0 text-[13px] text-axal-muted dark:text-gray-400" data-testid="buy-tokens-none">{TOPUP_UNAVAILABLE}</p>
              : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" data-testid="buy-tokens-packs">
                  {cards.map((p) => (
                    <div key={p.key} className="flex flex-col gap-1.5 rounded-axal-sm border border-axal-hairline p-3 dark:border-gray-800" data-testid={`pack-${p.key}`}>
                      <span className="font-mono text-[22px] font-medium text-axal-ink dark:text-gray-100">{p.amount}</span>
                      <span className="text-[12px] text-axal-muted dark:text-gray-400">of AI tokens</span>
                      {p.offer && <span className="self-start"><Pill tone="info" data-testid={`pack-offer-${p.key}`}>{p.offer}</Pill></span>}
                      {p.firstOnly && <span className="self-start"><Pill tone="neutral" data-testid={`pack-first-${p.key}`}>First purchase only</Pill></span>}
                      <Link to={p.href} className={`${BTN.ghost} mt-auto`} data-testid={`pack-buy-${p.key}`}>Buy</Link>
                    </div>
                  ))}
                </div>
              )}
        <p className="m-0 mt-3 text-[11.5px] text-axal-muted dark:text-gray-400">{TOKENS_FOOTNOTE}</p>
      </PanelCard>
    </div>
  );
}

/**
 * Payment details: the card's brand, last four and expiry, managed in Stripe's
 * customer portal (the same portal as "Manage billing"). The billing address
 * joins it with D806 (#2245).
 */
export function PaymentDetailsCard({ role, overview, openPortal, navigate = goTo }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const source = billingSourceFor(role);
  const portal = openPortal || (() => api[source.portal]());
  const card = overview.status === 'ready' ? paymentCard(overview.data) : null;
  const hasCustomer = overview.status === 'ready' && overview.data?.has_customer === true;
  const manage = async () => {
    setBusy(true); setOutcome(null);
    try {
      const res = await portal();
      if (res?.url) { navigate(res.url); return; }
      setOutcome({ tone: 'error', text: 'The billing portal sent no address to open.' });
    } catch (e) {
      setOutcome({ tone: 'error', text: refusalText(e, 'The billing portal could not be opened. Try again in a moment.') });
    } finally { setBusy(false); }
  };
  return (
    <PanelCard data-testid="card-payment-details">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={LABEL}>Payment details</span>
          <button type="button" className={BTN.ghost} onClick={manage} disabled={busy || !hasCustomer}
            title={hasCustomer ? undefined : 'Opens once you have a billing account.'} data-testid="button-manage-card">{busy ? 'Opening…' : 'Manage in Stripe ↗'}</button>
        </div>
        {overview.status === 'loading' ? <LoadingRows lines={1} />
          : overview.status !== 'ready' ? <Unreadable what="Billing" claim="Billing could not be read from Stripe." onRetry={overview.reload} />
            : card ? (
              <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="value-payment-card">
                {card.brand} <span className={MONO}>•••• {card.last4}</span>
                {card.expires && <span className="font-normal text-axal-muted dark:text-gray-400"> · expires {card.expires}</span>}
              </span>
            ) : <span className="text-[13px] text-axal-muted dark:text-gray-400" data-testid="value-payment-card">{NO_CARD}</span>}
        <Outcome outcome={outcome} />
      </div>
    </PanelCard>
  );
}

/** The reads the cards share: the AI budget (balance and allowance), the packs, and the billing overview. */
export function useBillingReads({ budget = aiBudgetApi, billingApi = api } = {}) {
  const me = useAccountRead(() => budget.mine());
  const topUp = useAccountRead(() => budget.topUp());
  const overview = useAccountRead(() => billingApi.billingOverview());
  return { me, topUp, overview };
}
