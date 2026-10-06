import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { EmptyState, Pill, Unrecorded, Unreadable } from '../../ui';
import { BTN, Chips, INPUT, LoadingRows, Outcome, PanelCard, useAccountRead } from './AccountCenter';
import { billingSourceFor, dayLabel, filterOrders, orderRow, planSummary, refusalText, ORDER_STATUS } from './accountCenterModel';

/**
 * D568 — Billing and orders: the plan line with "Manage billing", and the
 * orders list. The canvas's `ac_billing` block.
 *
 * ONE PLAN READ FOR THE WHOLE PANE. Each role's billing panel used to read
 * its own status and draw its own "Current plan" card. The plan line here is
 * that card now, and the panels below take the same read as a prop, so a
 * change made in a panel (a cancel, a plan swap) refreshes the line too.
 *
 * "MANAGE BILLING" OPENS THE ROUTE'S PORTAL URL. Investors use
 * `POST /billing/investor/portal`, which asks for a recent authenticator code
 * (the app's step-up prompt handles that); everyone else uses
 * `POST /billing/tier/portal`, which opens the general Stripe customer every
 * other plan lives on. With no billing account the route answers
 * `no_subscription`, so the button is drawn disabled with that reason.
 */

/** The role's plan status, from the one route that role's billing reads. */
export function useBillingStatus(role) {
  const source = billingSourceFor(role);
  return useAccountRead(() => api[source.status]());
}

const STATUS_TONE = { active: 'ok', trialing: 'info', past_due: 'warn', unpaid: 'danger', canceled: 'neutral', incomplete: 'warn' };
const STATUS_WORD = { active: 'Active', trialing: 'Trial', past_due: 'Past due', unpaid: 'Unpaid', canceled: 'Cancelled', incomplete: 'Incomplete' };

function goTo(url) { window.location.assign(url); }

export function PlanHeader({ role, billing, openPortal, navigate = goTo }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const source = billingSourceFor(role);
  const s = billing.status === 'ready' ? planSummary(role, billing.data) : null;
  const portal = openPortal || (() => api[source.portal]());

  const manage = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await portal();
      if (res?.url) { navigate(res.url); return; }
      setOutcome({ tone: 'error', text: 'The billing portal sent no address to open.' });
    } catch (e) {
      setOutcome({ tone: 'error', text: refusalText(e, 'The billing portal could not be opened. Try again in a moment.') });
    } finally { setBusy(false); }
  };

  let renewal = null;
  if (s && s.plan) {
    if (s.status === 'trialing' && dayLabel(s.trialEndsAt)) renewal = `trial ends ${dayLabel(s.trialEndsAt)}`;
    else if (s.paid && dayLabel(s.renewsAt)) renewal = `renews ${dayLabel(s.renewsAt)}`;
    else if (s.paid) renewal = <Unrecorded reason="this plan has no renewal date recorded">renewal not recorded</Unrecorded>;
    else renewal = 'free plan, nothing renews';
  }

  return (
    <PanelCard data-testid="card-plan">
      {billing.status === 'loading' ? <LoadingRows lines={2} />
        : billing.status === 'unreadable' ? (
          <Unreadable what="Your plan" claim={billing.message || 'This is not a claim that you have no plan.'} onRetry={billing.reload} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              {s?.plan ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-axal-ink dark:text-gray-100" data-testid="value-plan">
                    {s.plan}
                    <Pill tone="info">{s.tier}</Pill>
                    {s.status && s.status !== 'active' && s.status !== 'free' && (
                      <Pill tone={STATUS_TONE[s.status] || 'neutral'}>{STATUS_WORD[s.status] || s.status}</Pill>
                    )}
                  </div>
                  <div className="mt-0.5 font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid="value-plan-line">
                    {s.subscribedTier && <>subscribed as {s.subscribedTier}, {s.tier} applies · </>}
                    {s.seats && <>{s.seats.used} of {s.seats.cap} seat{s.seats.cap === 1 ? '' : 's'} · </>}
                    {renewal}
                  </div>
                </>
              ) : (
                <div className="text-[13.5px] text-axal-ink dark:text-gray-100" data-testid="value-plan">
                  No subscription plan applies to this account. Payments and receipts are below.
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to={source.pricing} className={BTN.ghost} data-testid="link-plans-pricing">Plans &amp; Pricing</Link>
              <button
                type="button"
                className={BTN.primary}
                onClick={manage}
                disabled={busy || !s?.hasCustomer}
                title={s?.hasCustomer ? undefined : 'Opens once you have a billing account.'}
                data-testid="button-manage-billing"
              >
                {busy ? 'Opening…' : 'Manage billing ↗'}
              </button>
            </div>
          </div>
        )}
      {s && !s.hasCustomer && billing.status === 'ready' && (
        <p className="mt-2 text-xs text-axal-muted dark:text-gray-400">Manage billing opens once you have a billing account.</p>
      )}
      <div className="mt-2"><Outcome outcome={outcome} /></div>
    </PanelCard>
  );
}

function downloadBlob({ url, filename }) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'invoice.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The orders list. `orders` is the read of `GET /orders/mine`. Each order is a
 * one-time purchase; its status is the store's own (paid, pending or failed),
 * and a paid one has a PDF invoice.
 */
export function OrdersCard({ orders, fetchInvoice = (ref) => api.orderInvoiceBlob(ref), save = downloadBlob }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [year, setYear] = useState('all');
  const [sort, setSort] = useState('newest');
  const [invoice, setInvoice] = useState({ ref: null, error: null });

  const rows = useMemo(
    () => (orders.status === 'ready' && Array.isArray(orders.data?.orders) ? orders.data.orders.map(orderRow) : []),
    [orders.status, orders.data],
  );
  const visible = filterOrders(rows, { query, status, year, sort });
  const statuses = Object.keys(ORDER_STATUS).filter((k) => rows.some((r) => r.statusKey === k));
  const years = [...new Set(rows.map((r) => r.year).filter(Boolean))].sort().reverse();

  const getInvoice = async (ref) => {
    setInvoice({ ref, error: null });
    try {
      save(await fetchInvoice(ref));
      setInvoice({ ref: null, error: null });
    } catch (e) {
      setInvoice({ ref: null, error: { ref, text: e?.message || 'The invoice could not be produced.' } });
    }
  };

  return (
    <PanelCard title="Orders" aside={orders.status === 'ready' ? `${visible.length} of ${rows.length}` : null} data-testid="card-orders" className="@container">
      {orders.status === 'loading' ? <LoadingRows lines={3} />
        : orders.status === 'unreadable' ? (
          <Unreadable what="Your orders" claim={orders.message || 'This is not a claim that you have bought nothing.'} onRetry={orders.reload} />
        ) : rows.length === 0 ? (
          <EmptyState size="sm" data-testid="orders-empty" title="No orders yet." body="One-time purchases, such as a service or a document pack, are listed here with their invoice." cta={{ label: 'See Plans & Pricing', to: '/pricing' }} />
        ) : (
          <>
            <div className="mb-3 flex flex-col gap-2">
              <input type="search" className={INPUT} placeholder="Search orders…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search orders" data-testid="input-orders-search" />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Chips label="Status" items={[
                  { key: 'all', label: 'All', active: status === 'all', onSelect: () => setStatus('all') },
                  ...statuses.map((k) => ({ key: k, label: ORDER_STATUS[k].label, active: status === k, onSelect: () => setStatus(k), testid: `chip-order-${k}` })),
                ]} />
                {years.length > 1 && (
                  <Chips label="Year" items={[
                    { key: 'all', label: 'Any year', active: year === 'all', onSelect: () => setYear('all') },
                    ...years.map((y) => ({ key: y, label: y, active: year === y, onSelect: () => setYear(y) })),
                  ]} />
                )}
                <button type="button" className={`${BTN.link} ml-auto`} onClick={() => setSort((v) => (v === 'newest' ? 'oldest' : 'newest'))} data-testid="button-orders-sort">
                  Sort: {sort === 'newest' ? 'Newest' : 'Oldest'}
                </button>
              </div>
            </div>
            <div role="table" aria-label="Orders" className="text-[13px]">
              <div role="row" className="hidden gap-3 border-b border-axal-hairline pb-2 font-mono text-[10.5px] font-semibold tracking-[0.06em] text-axal-muted dark:border-gray-800 dark:text-gray-400 @xl:grid @xl:grid-cols-[110px_minmax(0,1fr)_110px_96px_64px]">
                <span role="columnheader">DATE</span><span role="columnheader">ITEM</span><span role="columnheader">AMOUNT</span><span role="columnheader">STATUS</span><span role="columnheader"><span className="sr-only">Invoice</span></span>
              </div>
              {visible.length === 0 && <p className="py-3 text-axal-muted dark:text-gray-400">No order matches these filters.</p>}
              {visible.map((r) => (
                <div role="row" key={r.ref || r.when} data-testid={`order-${r.ref}`} className="grid grid-cols-2 items-center gap-x-2.5 gap-y-1 border-b border-axal-hairline py-2.5 last:border-b-0 dark:border-gray-800 @xl:grid-cols-[110px_minmax(0,1fr)_110px_96px_64px] @xl:gap-3">
                  <span role="cell" className="col-span-2 font-mono text-[12px] text-axal-muted dark:text-gray-400 @xl:col-span-1">{dayLabel(r.when) || <Unrecorded>No date</Unrecorded>}</span>
                  <span role="cell" className="font-semibold text-axal-ink dark:text-gray-100">{r.item || <Unrecorded reason="the order carries no item names">Not recorded</Unrecorded>}</span>
                  <span role="cell" className="font-mono text-[12.5px] text-axal-ink dark:text-gray-100">{r.amount || <Unrecorded reason="the order carries no total">Not recorded</Unrecorded>}</span>
                  <span role="cell"><Pill tone={r.status.tone}>{r.status.label}</Pill></span>
                  <span role="cell" className="text-right">
                    {r.paid && r.ref && (
                      <button type="button" className={BTN.link} onClick={() => getInvoice(r.ref)} disabled={invoice.ref === r.ref} data-testid={`button-invoice-${r.ref}`}>
                        {invoice.ref === r.ref ? '…' : 'Invoice'}
                      </button>
                    )}
                  </span>
                  {invoice.error?.ref === r.ref && <span role="alert" className="col-span-full text-[12px] text-red-700 dark:text-red-300">{invoice.error.text}</span>}
                </div>
              ))}
            </div>
          </>
        )}
    </PanelCard>
  );
}

/** The orders read. */
export function Orders() {
  const orders = useAccountRead(() => api.myOrders());
  return <OrdersCard orders={orders} />;
}
