import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { aiBudgetApi } from '../../lib/api/aiBudget';
import { tokenPacksApi } from '../../lib/api/tokenPacks';
import { reportError } from '../../lib/log';
import { Card, EmptyState, Pill, RailFrame, Unrecorded, Unreadable, WorkerRail } from '../../ui';
import { useAccountRead } from '../account/AccountCenter';
import { microUsd, planLabel, whenLabel } from '../account/usageModel';
import { BillingCard, ModelsCard, useHqModels } from './HqAiCards';
import { MemberAccountCard, ReconcileCard, TokenPacksCard } from './TokenPacks';
import { REASON_MIN } from './tokenPacksModel';

/**
 * HQ · Platform → AI allowances (D642, #1435) — U7 of the Usage canvas
 * (`hq-allowances` in `Ops Page.dc.html`), for the Super Admin at 1440.
 *
 * Two reads, each its own card: the ten plans' allowances
 * (`GET /api/ai-budget/caps`, D640) and the runs held for a check
 * (`GET /api/ai-budget/reviews`, D640). One failing costs only its card.
 *
 * TWO WRITES, both the Worker's own and both audited there:
 *   - Edit → `PUT /api/ai-budget/caps/:licence`, two US-dollar amounts, 0 or
 *     more, after a confirmation that the change applies at once to every
 *     member on that plan;
 *   - Charge the hold / Refund the hold → `POST /api/ai-budget/reviews/:uid/
 *     charge|refund`, each with a reason of at least 10 characters. The
 *     member is never charged more than the hold; the Worker enforces it.
 *
 * D755 (#1986, CR8) adds three cards from `TokenPacks.jsx`: Token packs (one
 * line per pack, replacing D750's single top-up line, with New pack, Adopt,
 * On sale, Bonus and Archive), one member's AI account with Adjust balance,
 * and Reconcile. HQ never credits a purchase.
 *
 * D776 PR 2 (#2093) adds, read-only, from `HqAiCards.jsx`: How members are
 * charged and Models offered (`GET /api/ai/catalogue/hq`), and inside One
 * member's AI account, that member's month by page and option and each run
 * (`GET /api/ai-budget/members/:id/runs`, audited).
 */

export { REASON_MIN };

/** A USD field as typed: a number, 0 or more, at most six decimals. */
export function parseUsd(text) {
  const t = String(text ?? '').trim();
  if (!/^\d+(\.\d{1,6})?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** The plan row's source, as the canvas words it. */
export function sourceView(p) {
  // D783: a member licence's allowance is 25% of what each member pays, computed, never typed.
  if (p.source === 'computed') return { text: 'Computed: 25% of each member’s plans', tone: 'neutral', nr: false };
  if (p.source !== 'recorded') return { text: 'Platform default', tone: 'neutral', nr: true };
  const who = p.recorded_by_name || null;
  const when = p.recorded_at ? whenLabel(p.recorded_at) : null;
  return { text: ['Set by HQ', who, when].filter(Boolean).join(' · '), tone: 'info', nr: false };
}

const ROSE = 'inline-flex items-center justify-center whitespace-nowrap rounded-axal-sm bg-rose-900 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-rose-950 disabled:cursor-not-allowed disabled:opacity-50';
const GHOST = 'inline-flex items-center justify-center whitespace-nowrap rounded-axal-sm border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:border-rose-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const FIELD = 'w-full rounded-axal-sm border border-axal-hairline bg-white px-2.5 py-1.5 font-mono text-[13px] text-axal-ink focus:outline-none focus:ring-2 focus:ring-rose-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const HEAD = 'border-b border-axal-hairline bg-axal-ground/60 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-axal-muted dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-400';

/** Edit · one plan: two amounts, the confirmation, and the write. */
export function EditPlanForm({ plan, onCancel, onSaved }) {
  const [daily, setDaily] = useState(String(plan.daily_microusd / 1_000_000));
  const [monthly, setMonthly] = useState(String(plan.monthly_microusd / 1_000_000));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const d = parseUsd(daily);
  const m = parseUsd(monthly);
  const label = planLabel(plan.licence_key);
  const submit = async (e) => {
    e.preventDefault();
    if (d == null || m == null) return;
    setBusy(true);
    setError(null);
    try {
      await aiBudgetApi.setCaps(plan.licence_key, d, m);
      onSaved(`${label}: ${microUsd(Math.round(d * 1_000_000))} a day, ${microUsd(Math.round(m * 1_000_000))} a month.`);
    } catch (err) {
      reportError('hq-allowances:caps', err);
      setError(err?.message || 'The allowance was not saved.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card padding="none" className="overflow-hidden border-rose-200 dark:border-rose-900" data-testid="hq-allowance-edit">
      <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-[13.5px] font-bold text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">Edit · {label}</div>
      <form onSubmit={submit} className="flex flex-col gap-2.5 px-4 py-3.5">
        <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">
          Daily (US$, 0 or more)
          <input className={FIELD} inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} data-testid="hq-allowance-daily" aria-invalid={d == null ? 'true' : undefined} />
        </label>
        <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">
          Monthly (US$, 0 or more)
          <input className={FIELD} inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} data-testid="hq-allowance-monthly" aria-invalid={m == null ? 'true' : undefined} />
        </label>
        {(d == null || m == null) && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">Enter each amount in US dollars, 0 or more.</p>}
        <p className="rounded-axal-sm border border-amber-300 bg-amber-50/60 px-2.5 py-2 text-[12.5px] leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" data-testid="hq-allowance-confirm">
          The change applies at once to every member on {label}.
        </p>
        {error && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid="hq-allowance-error">{error}</p>}
        <div className="flex justify-end gap-1.5">
          <button type="button" className={GHOST} onClick={onCancel}>Cancel</button>
          <button type="submit" className={ROSE} disabled={busy || d == null || m == null} data-testid="hq-allowance-apply">Apply to every member</button>
        </div>
      </form>
    </Card>
  );
}

/** One held run, with its two settlements behind a reason. */
export function HeldRun({ run, onSettled }) {
  const [action, setAction] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ok = reason.trim().length >= REASON_MIN;
  const submit = async (e) => {
    e.preventDefault();
    if (!ok || !action) return;
    setBusy(true);
    setError(null);
    try {
      await aiBudgetApi.settleReview(run.uid, action, reason.trim());
      onSettled(`${action === 'charge' ? 'Charged' : 'Refunded'} the hold for ${run.member_name || 'the member'}.`);
    } catch (err) {
      reportError('hq-allowances:settle', err);
      setError(err?.message || 'The hold was not settled.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1.5 border-b border-axal-ground px-4 py-3 last:border-0 dark:border-gray-800" data-testid="hq-held-run">
      <div className="flex flex-wrap justify-between gap-2 text-[13px]">
        <span className="font-semibold">{run.member_name || <Unrecorded reason="The member's name is not recorded.">Member not named</Unrecorded>}</span>
        <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{whenLabel(run.at) ?? run.at}</span>
      </div>
      <div className="flex gap-3.5 font-mono text-[12.5px]">
        <span>held {microUsd(run.held_microusd)}</span>
        <span className="text-red-700 dark:text-red-300">run cost {microUsd(run.recorded_cost_microusd)}</span>
      </div>
      {!action ? (
        <div className="flex gap-1.5">
          <button type="button" className={GHOST} onClick={() => setAction('charge')} data-testid="hq-held-charge">Charge the hold…</button>
          <button type="button" className={GHOST} onClick={() => setAction('refund')} data-testid="hq-held-refund">Refund the hold…</button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-1.5" data-testid="hq-held-form">
          <label className="text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">
            Reason · {action === 'charge' ? 'charging the hold' : 'refunding the hold'}, at least {REASON_MIN} characters
            <input className={`${FIELD} mt-1 font-sans`} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="hq-held-reason" />
          </label>
          {error && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid="hq-held-error">{error}</p>}
          <div className="flex justify-end gap-1.5">
            <button type="button" className={GHOST} onClick={() => { setAction(null); setReason(''); setError(null); }}>Cancel</button>
            <button type="submit" className={ROSE} disabled={busy || !ok} data-testid="hq-held-submit">{action === 'charge' ? 'Charge the hold' : 'Refund the hold'}</button>
          </div>
        </form>
      )}
    </div>
  );
}

export function PlansCard({ caps, editing, onEdit }) {
  const plans = caps.status === 'ready' && Array.isArray(caps.data?.plans) ? caps.data.plans : null;
  return (
    <Card padding="none" className="overflow-hidden" data-testid="hq-allowances-plans">
      <div className={`grid grid-cols-[minmax(0,1.4fr)_90px_100px_minmax(0,1.6fr)_60px] gap-3 px-4 py-2 ${HEAD}`}>
        <span>Plan</span><span className="text-right">Daily</span><span className="text-right">Monthly</span><span>Source</span><span />
      </div>
      {caps.status === 'loading' ? <p className="px-4 py-3 text-[12.5px] text-axal-muted">Reading the allowances…</p>
        : !plans ? <div className="px-4 py-3"><Unreadable what="Allowances" claim="No plan's allowance has changed." onRetry={caps.reload} /></div>
          : plans.map((p) => {
            const src = sourceView(p);
            return (
              <div key={p.licence_key} data-testid="hq-allowance-row"
                className={`grid grid-cols-[minmax(0,1.4fr)_90px_100px_minmax(0,1.6fr)_60px] items-center gap-3 border-b border-axal-ground px-4 py-2.5 text-[13px] last:border-0 dark:border-gray-800 ${editing === p.licence_key ? 'bg-rose-50/50 dark:bg-rose-950/20' : ''}`}>
                <span className="font-semibold">{planLabel(p.licence_key)}</span>
                <span className="text-right font-mono text-[12.5px]">{p.source === 'computed' ? 'None' : microUsd(p.daily_microusd)}</span>
                <span className="text-right font-mono text-[12.5px]">{p.source === 'computed' ? '25%' : microUsd(p.monthly_microusd)}</span>
                <span className="min-w-0"><Pill tone={src.tone} data-testid="hq-allowance-source">{src.text}</Pill></span>
                {p.editable === false ? <span />
                  : <button type="button" className="text-right text-[12px] font-semibold text-axal-muted hover:text-rose-900 dark:text-gray-400" onClick={() => onEdit(p)} data-testid="hq-allowance-edit-open">Edit</button>}
              </div>
            );
          })}
      {plans && plans.some((p) => p.ignored_recorded) && (
        <div className="border-t border-axal-hairline px-4 py-2.5 text-xs text-axal-muted dark:border-gray-800 dark:text-gray-400" data-testid="hq-allowances-ignored-note">
          A cap typed for a member plan before D783 is kept but no longer read: those plans give 25% of what each member pays.
        </div>
      )}
      {plans && plans.some((p) => sourceView(p).nr) && (
        <div className="border-t border-axal-hairline px-4 py-2.5 text-xs text-axal-muted dark:border-gray-800 dark:text-gray-400" data-testid="hq-allowances-default-note">
          Set by: a plan on the platform default records no editor. The default comes from the deployment.
        </div>
      )}
    </Card>
  );
}

/** D783: what each catalogue plan includes, read-only: its price, the share and the monthly allowance. */
export function catalogueRows(caps) {
  const plans = caps?.status === 'ready' && Array.isArray(caps.data?.catalogue) ? caps.data.catalogue : null;
  if (!plans) return null;
  const share = typeof caps.data.share === 'number' ? `${Math.round(caps.data.share * 100)}%` : null;
  return plans.filter((p) => p && p.free === false && Array.isArray(p.prices)).flatMap((p) => p.prices
    .filter((pr) => pr && Number.isSafeInteger(pr.unit_amount) && Number.isSafeInteger(pr.allowance_microusd))
    .map((pr) => ({ key: `${p.product_id}:${pr.price_id}`, plan: p.plan_name || planLabel(p.licence_key),
      price: `${microUsd(pr.unit_amount * 10_000)}${pr.interval === 'year' ? ' / year' : pr.interval === 'month' ? ' / month' : ''}`,
      share, allowance: `${microUsd(pr.allowance_microusd)} / month` })));
}
export function CatalogueCard({ caps }) {
  const rows = catalogueRows(caps);
  return (
    <Card padding="none" className="overflow-hidden" data-testid="hq-allowances-catalogue">
      <div className={`grid grid-cols-[minmax(0,1.6fr)_120px_60px_120px] gap-3 px-4 py-2 ${HEAD}`}>
        <span>Plan</span><span className="text-right">Price</span><span className="text-right">Share</span><span className="text-right">Allowance</span>
      </div>
      {caps.status === 'loading' ? <p className="px-4 py-3 text-[12.5px] text-axal-muted">Reading the plans…</p>
        : !rows ? <div className="px-4 py-3"><Unreadable what="The plans' allowances" claim="No allowance has changed." onRetry={caps.reload} /></div>
          : rows.length === 0 ? <p className="px-4 py-3 text-[12.5px] text-axal-muted" data-testid="hq-allowances-catalogue-none">No paid plan is in the catalogue.</p>
            : rows.map((r) => (
              <div key={r.key} data-testid="hq-allowance-catalogue-row" className="grid grid-cols-[minmax(0,1.6fr)_120px_60px_120px] items-center gap-3 border-b border-axal-ground px-4 py-2.5 text-[13px] last:border-0 dark:border-gray-800">
                <span className="font-semibold">{r.plan}</span>
                <span className="text-right font-mono text-[12.5px]">{r.price}</span>
                <span className="text-right font-mono text-[12.5px]">{r.share}</span>
                <span className="text-right font-mono text-[12.5px]">{r.allowance}</span>
              </div>
            ))}
      <div className="border-t border-axal-hairline px-4 py-2.5 text-xs text-axal-muted dark:border-gray-800 dark:text-gray-400">
        A yearly price gives its share ÷ 12 each month. A member's allowance follows what they pay; one subscribed before D783 reads today's price here until their next billing event. No plan, no allowance.
      </div>
    </Card>
  );
}

export function HeldCard({ reviews, onSettled }) {
  const items = reviews.status === 'ready' && Array.isArray(reviews.data?.items) ? reviews.data.items : null;
  return (
    <Card padding="none" className="overflow-hidden" data-testid="hq-allowances-held">
      <div className="border-b border-axal-hairline px-4 py-3 text-sm font-bold dark:border-gray-800">Runs held for a check</div>
      {reviews.status === 'loading' ? <p className="px-4 py-3 text-[12.5px] text-axal-muted">Reading the held runs…</p>
        : !items ? <div className="px-4 py-3"><Unreadable what="The held runs" claim="This is not a claim that none is held." onRetry={reviews.reload} /></div>
          : items.length === 0 ? <EmptyState size="sm" data-testid="hq-held-empty" title="No run is held for a check." cta={{ label: 'Back to Platform', to: '/admin/platform' }} />
            : items.map((run) => <HeldRun key={run.uid} run={run} onSettled={onSettled} />)}
      {items && items.length > 0 && (
        <div className="border-t border-axal-hairline px-4 py-2.5 text-xs text-axal-muted dark:border-gray-800 dark:text-gray-400">
          Charge and Refund each need a reason of at least 10 characters. The member is never charged more than the hold.
        </div>
      )}
    </Card>
  );
}

// D750's reason lines live in tokenPacksModel.js now, beside the pack lines that replaced its single top-up line.
export { TOPUP_REASON_LINES } from './tokenPacksModel';

export default function PlatformAllowancesPage() {
  const caps = useAccountRead(() => aiBudgetApi.caps());
  const reviews = useAccountRead(() => aiBudgetApi.reviews());
  const packs = useAccountRead(() => tokenPacksApi.status());
  const reconcile = useAccountRead(() => tokenPacksApi.reconcile());
  const models = useHqModels();
  const [editing, setEditing] = useState(null);
  const [done, setDone] = useState(null);
  const plans = caps.status === 'ready' && Array.isArray(caps.data?.plans) ? caps.data.plans : [];
  const editPlan = plans.find((p) => p.licence_key === editing) || null;
  const held = reviews.status === 'ready' && Array.isArray(reviews.data?.items) ? reviews.data.items : null;

  const coverage = [
    caps.status === 'ready' ? `${plans.length} plans, ${plans.filter((p) => p.source === 'recorded').length} set by HQ` : null,
    held ? `${held.length} ${held.length === 1 ? 'run' : 'runs'} held for a check` : null,
  ].filter(Boolean);

  return (
    <RailFrame
      data-testid="hq-allowances-page"
      rail={(
        <WorkerRail
          workspace="AI allowances"
          role="super_admin"
          stance="Sets each plan's AI allowance"
          note="This rail reads back the plans' allowances and the runs held for a check. It changes nothing; Edit, Charge, Refund, the pack controls and Adjust balance on the page do, and the Worker records who and why. Nothing here adds a purchase's tokens."
          coverage={coverage}
          coverageNote={coverage.length ? undefined : 'The allowances could not be read, so there is nothing to read back.'}
          data-testid="hq-allowances-rail"
        />
      )}
    >
      <div className="min-w-0 space-y-4">
        <div>
          <Link to="/admin/platform" className="inline-flex items-center gap-1 text-[12px] font-semibold text-axal-muted hover:text-axal-ink dark:hover:text-gray-100">
            <ArrowLeft size={13} /> Platform
          </Link>
          <h1 className="mt-1 text-2xl font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">AI allowances</h1>
          <p className="mt-1 text-[13px] text-axal-muted dark:text-gray-400">The daily and monthly AI allowance each plan includes, runs held for a check, the token packs members can buy, one member's AI account and their month, what needs reconciling, how members are charged and the models offered.</p>
        </div>
        {done && <p role="status" className="rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[12px] dark:border-gray-800 dark:bg-gray-800/40" data-testid="hq-allowances-done">{done}</p>}
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
          <PlansCard caps={caps} editing={editing} onEdit={(p) => { setEditing(p.licence_key); setDone(null); }} />
          <CatalogueCard caps={caps} />
          <div className="flex flex-col gap-3">
            {editPlan && (
              <EditPlanForm key={editPlan.licence_key} plan={editPlan} onCancel={() => setEditing(null)}
                onSaved={(msg) => { setEditing(null); setDone(msg); caps.reload(); }} />
            )}
            <HeldCard reviews={reviews} onSettled={(msg) => { setDone(msg); reviews.reload(); }} />
            <TokenPacksCard status={packs} onChanged={(msg) => { setDone(msg); packs.reload(); }} />
          </div>
        </div>
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
          <MemberAccountCard />
          <ReconcileCard reconcile={reconcile} />
        </div>
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)]">
          <BillingCard models={models} />
          <ModelsCard models={models} />
        </div>
      </div>
    </RailFrame>
  );
}
