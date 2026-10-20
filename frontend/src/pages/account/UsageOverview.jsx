import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { toUtcInstant } from '../../lib/notices';
import { aiBudgetApi } from '../../lib/api/aiBudget';
import { EmptyState, PhoneBar, Pill, Unrecorded, Unreadable } from '../../ui';
import { BTN, LoadingRows, PanelCard, useAccountRead } from './AccountCenter';
import { overviewScopeFor } from './BillingCards';
import { allowanceView, balanceText } from './billingModel';
import { limitView, packOrdersCard } from './limitsModel';
import { INVOICES_PENDING, USAGE_SUBTITLE, costReadable, recentInvoices } from './costModel';
import { DailyCostChart, TokenUsageChart } from './UsageCharts';

const OPEN = 'text-xs font-semibold text-axal-violet hover:underline dark:text-violet-300';
const VALUE = 'font-mono text-[28px] font-medium tracking-tight';
export const OVERVIEW_LINKS = Object.freeze({
  spend: '/account/usage/cost', balance: '/account/billing', daily: '/account/usage/cost',
  tokens: '/account/usage/cost', limits: '/account/usage/limits', invoices: '/account/billing',
});
export function UsageBar({ pct, label }) {
  return <div className="my-2 h-1.5 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800"
    role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
    <div className="h-full rounded-full bg-axal-violet dark:bg-violet-400" style={{ width: `${pct}%` }} />
  </div>;
}
export function UsageCardState({ read, what, children }) {
  if (read?.status === 'loading') return <LoadingRows lines={3} />;
  if (read?.status !== 'ready') return <Unreadable what={what} claim="No missing amount is shown as zero." onRetry={read?.reload} />;
  return children;
}
function Open({ card, children }) { return <Link to={OVERVIEW_LINKS[card]} className={OPEN}>{children} →</Link>; }

export function SpendOverview({ limit }) {
  const v = limit.status === 'ready' ? limitView(limit.data) : null;
  return <PanelCard title="Spend this month" action={<Open card="spend">Open cost</Open>} data-testid="overview-spend">
    <UsageCardState read={limit} what="Your monthly spend">
      {!v ? <Unrecorded reason="The spend read did not return this month's charge.">Not recorded</Unrecorded> : <>
        <div className={VALUE}>{v.spent}</div>
        {v.set ? <><p className="mt-2 text-xs">{v.pct}% of your {v.limit} limit</p><UsageBar pct={v.pct} label="Monthly spend limit used" /></>
          : <p className="mt-2 text-xs">No limit set. <Link to={OVERVIEW_LINKS.limits} className={OPEN}>Set a limit</Link></p>}
      </>}
    </UsageCardState>
  </PanelCard>;
}
export function BalanceOverview({ me, overview, autoReload }) {
  const balance = me.status === 'ready' ? balanceText(me.data) : null;
  const allowance = me.status === 'ready' ? allowanceView(me.data) : null;
  const methods = overview.status === 'ready' && Array.isArray(overview.data?.payment_methods) ? overview.data.payment_methods : null;
  return <PanelCard title="Token balance" action={<Open card="balance">Open billing</Open>} data-testid="overview-balance">
    <UsageCardState read={me} what="Your token balance">
      {balance == null ? <Unrecorded reason="The read did not return a token balance.">Not recorded</Unrecorded>
        : <div className={VALUE}>{balance} <span className="font-sans text-xs font-medium tracking-normal">AI tokens</span></div>}
      <p className="mt-2 text-xs">{allowance?.kind === 'plan' ? `${allowance.left} left of this month's plan allowance`
        : allowance?.kind === 'none' ? allowance.text : 'Not recorded: this month’s plan allowance was not returned.'}</p>
    </UsageCardState>
    <div className="mt-2 flex flex-wrap gap-2">
      <UsageCardState read={autoReload} what="Auto-reload">
        {typeof autoReload.data?.enabled === 'boolean'
          ? <Pill tone={autoReload.data.enabled ? 'info' : 'neutral'}>{autoReload.data.enabled ? 'Auto-reload on' : 'Auto-reload off'}</Pill>
          : <Unrecorded reason="The auto-reload state was not returned.">Not recorded</Unrecorded>}
      </UsageCardState>
      <UsageCardState read={overview} what="Payment methods">
        {methods == null || overview.data?.degraded?.includes('payment_methods')
          ? <Unreadable what="Payment methods" claim="No absence of a card is assumed." onRetry={overview.reload} />
          : methods.length === 0 ? <Pill tone="warn">No payment method</Pill> : null}
      </UsageCardState>
    </div>
  </PanelCard>;
}
export function LimitsOverview({ me, limit }) {
  const allowance = me.status === 'ready' ? allowanceView(me.data) : null;
  const v = limit.status === 'ready' ? limitView(limit.data) : null;
  const packs = limit.status === 'ready' ? packOrdersCard(limit.data) : null;
  return <PanelCard title="Billing and limits" action={<Open card="limits">Open limits</Open>} data-testid="overview-limits">
    <UsageCardState read={me} what="The plan allowance">
      {allowance?.kind === 'plan' ? <><p className="text-xs">Plan allowance used · {allowance.usedPct}%</p><UsageBar pct={allowance.usedPct} label="Plan allowance used" /></>
        : <p className="text-xs">{allowance?.text || 'Not recorded: the plan allowance was not returned.'}</p>}
    </UsageCardState>
    <UsageCardState read={limit} what="Billing limits">
      {v?.set ? <><p className="mt-3 text-xs">Spend limit used · {v.pct}%</p><UsageBar pct={v.pct} label="Spend limit used" /></>
        : <p className="mt-3 text-xs">{v ? 'No limit set' : 'Not recorded: the spend limit was not returned.'}</p>}
      {packs ? <><p className="mt-3 text-xs">Token-pack orders today · {packs.today} of {packs.perDay}</p><UsageBar pct={packs.pct} label="Token-pack orders in the last 24 hours" /><p className="text-xs text-axal-muted dark:text-gray-400">Rolling window: {Number.isSafeInteger(limit.data.pack_orders.window_hours) && limit.data.pack_orders.window_hours > 0 ? `${limit.data.pack_orders.window_hours} hours` : <Unrecorded reason="The order window's duration was not returned.">Not recorded</Unrecorded>}. Auto-reloads count.</p></>
        : limit.data?.pack_orders_reason ? <Unreadable what="Token-pack orders" claim="The spend limit above is unaffected." onRetry={limit.reload} />
          : <Unrecorded reason="Today's token-pack order count was not returned.">Not recorded</Unrecorded>}
    </UsageCardState>
  </PanelCard>;
}
function InvoicePdf({ row }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!row.href) return <Unrecorded reason="No PDF was recorded for this invoice.">Not recorded</Unrecorded>;
  if (row.href.startsWith('https:')) return <a href={row.href} target="_blank" rel="noopener noreferrer" className={OPEN}>PDF ↗</a>;
  const download = async () => {
    setBusy(true); setError('');
    try {
      const result = await api.orderInvoiceBlob(row.href.split('/')[3]);
      const a = document.createElement('a'); a.href = result.url; a.download = result.filename; a.click();
      setTimeout(() => URL.revokeObjectURL(result.url), 1000);
    } catch { setError('Unreadable: the invoice PDF could not be downloaded. Try again.'); }
    finally { setBusy(false); }
  };
  return <><button type="button" className={BTN.ghost} onClick={download} disabled={busy}>{busy ? 'Opening…' : 'PDF'}</button>{error && <span role="alert">{error}</span>}</>;
}
/** Ready for D806; no request is made to an endpoint that is not mounted yet. */
export function RecentInvoices({ invoices }) {
  const rows = invoices.status === 'ready' ? recentInvoices(invoices.data) : null;
  return <PanelCard title="Recent invoices" action={<Open card="invoices">Open billing</Open>} data-testid="overview-invoices">
    {invoices.status === 'not_recorded' ? <p className="text-xs text-axal-muted dark:text-gray-400">Not recorded: {INVOICES_PENDING}</p>
      : <UsageCardState read={invoices} what="Recent invoices">
        {!rows ? <Unrecorded reason="The invoice list was not returned.">Not recorded</Unrecorded>
          : <>{invoices.data.degraded?.includes('stripe') && <Unreadable what="Plan invoices" claim="The order invoices below still load." onRetry={invoices.reload} />}
            {!rows.length ? <EmptyState size="sm" title="No invoices yet." /> : rows.map((row) => {
              let amount = null;
              try { if (Number.isSafeInteger(row.amount_cents) && row.currency) amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: row.currency }).format(row.amount_cents / 100); } catch { /* invalid currency remains missing */ }
              const date = new Date(toUtcInstant(row.date) || NaN);
              return <div key={`${row.kind}:${row.id}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-hairline py-3 text-xs last:border-0 dark:border-gray-800">
                <div className="min-w-0"><time>{Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</time><p className="break-words font-semibold">{row.description || 'Not recorded'}</p></div>
                <Pill tone={row.status === 'paid' ? 'info' : 'neutral'}>{{ paid: 'Paid', refunded: 'Refunded', partly_refunded: 'Partly refunded', open: 'Open', void: 'Void' }[row.status] || 'Not recorded'}</Pill><span className="font-mono">{amount ?? 'Not recorded'}</span><InvoicePdf row={row} />
              </div>;
            })}</>}
      </UsageCardState>}
  </PanelCard>;
}
export function UsageOverviewView({ me, limit, overview, autoReload, cost, invoices, month }) {
  return <div className="flex min-w-0 flex-col gap-4" data-testid="usage-overview">
    <div className="-mx-[22px] lg:hidden"><PhoneBar back={{ label: 'Account', to: '/account' }} title="Usage" sub={USAGE_SUBTITLE} /></div>
    <header className="hidden lg:block"><h2 className="text-xl font-extrabold tracking-axal-heading">Usage</h2><p className="mt-1 text-[13px] text-axal-muted dark:text-gray-400">{USAGE_SUBTITLE}</p></header>
    <div className="grid min-w-0 gap-3 md:grid-cols-2"><SpendOverview limit={limit} /><BalanceOverview me={me} overview={overview} autoReload={autoReload} /></div>
    <h3 className="text-xs font-semibold uppercase tracking-wide text-axal-muted dark:text-gray-400">Spend breakdown</h3>
    <div className="grid min-w-0 gap-3 md:grid-cols-2">
      <PanelCard title="Daily cost, last 30 days" action={<Open card="daily">Open cost</Open>} data-testid="overview-daily"><UsageCardState read={cost} what="Daily cost">{costReadable(cost.data) ? <DailyCostChart data={cost.data} /> : <Unrecorded reason="The daily cost breakdown was not returned.">Not recorded</Unrecorded>}</UsageCardState></PanelCard>
      <PanelCard title="Token usage, input vs output" action={<Open card="tokens">Open cost</Open>} data-testid="overview-tokens"><UsageCardState read={cost} what="Token usage">{costReadable(cost.data) ? <TokenUsageChart data={cost.data} /> : <Unrecorded reason="The daily token counts were not returned.">Not recorded</Unrecorded>}</UsageCardState></PanelCard>
    </div>
    {month?.status === 'ready' && costReadable(month.data) && month.data.totals.runs === 0 && !month.data.truncated && <><EmptyState size="sm" title="No AI runs yet this month." /><Link to="/studio" className={BTN.ghost}>Open Studio</Link></>}
    <div className="grid min-w-0 gap-3 md:grid-cols-2"><LimitsOverview me={me} limit={limit} /><RecentInvoices invoices={invoices} /></div>
  </div>;
}
export default function UsageOverview({ role }) {
  const me = useAccountRead(() => aiBudgetApi.mine());
  const limit = useAccountRead(() => aiBudgetApi.spendLimit());
  const overview = useAccountRead(() => api.billingOverview(overviewScopeFor(role)));
  const autoReload = useAccountRead(() => aiBudgetApi.autoReload());
  const cost = useAccountRead(() => aiBudgetApi.cost({ range: '30d', group: 'model' }));
  const month = useAccountRead(() => aiBudgetApi.cost({ range: 'mtd', group: 'model' }));
  const { hash } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (/^#(?:days|where|models|last-run|storage)$/.test(hash)) navigate(`/account/usage/cost${hash}`, { replace: true });
  }, [hash, navigate]);
  return <UsageOverviewView me={me} limit={limit} overview={overview} autoReload={autoReload} cost={cost} month={month} invoices={{ status: 'not_recorded' }} />;
}
