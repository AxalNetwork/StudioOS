import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { aiBudgetApi } from '../../lib/api/aiBudget';
import { reportError } from '../../lib/log';
import { Card, EmptyState, Pill, RailFrame, Unrecorded, Unreadable, WorkerRail } from '../../ui';
import { useAccountRead } from '../account/AccountCenter';
import { microUsd, planLabel, whenLabel } from '../account/usageModel';

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
 */

export const REASON_MIN = 10;

/** A USD field as typed: a number, 0 or more, at most six decimals. */
export function parseUsd(text) {
  const t = String(text ?? '').trim();
  if (!/^\d+(\.\d{1,6})?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** The plan row's source, as the canvas words it. */
export function sourceView(p) {
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
                <span className="text-right font-mono text-[12.5px]">{microUsd(p.daily_microusd)}</span>
                <span className="text-right font-mono text-[12.5px]">{microUsd(p.monthly_microusd)}</span>
                <span className="min-w-0"><Pill tone={src.tone} data-testid="hq-allowance-source">{src.text}</Pill></span>
                <button type="button" className="text-right text-[12px] font-semibold text-axal-muted hover:text-rose-900 dark:text-gray-400" onClick={() => onEdit(p)} data-testid="hq-allowance-edit-open">Edit</button>
              </div>
            );
          })}
      {plans && plans.some((p) => sourceView(p).nr) && (
        <div className="border-t border-axal-hairline px-4 py-2.5 text-xs text-axal-muted dark:border-gray-800 dark:text-gray-400" data-testid="hq-allowances-default-note">
          Set by: a plan on the platform default records no editor. The default comes from the deployment.
        </div>
      )}
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

/**
 * D750 (#1841) — one plain sentence per top-up state, from
 * `GET /api/ai-budget/top-up/status`. The ID shows as its last six characters
 * only; the reading never carries a key.
 */
export const TOPUP_REASON_LINES = {
  missing_from_catalog: (mode) => `The price is not in the catalog mirror and Stripe does not know it in ${mode} mode.`,
  inactive: () => 'The price or its product is archived in Stripe. The top-up needs an active price.',
  not_one_time: () => 'STRIPE_PRICE_AI_TOPUP names a recurring price. The top-up needs a one-time USD price.',
  not_usd: () => 'STRIPE_PRICE_AI_TOPUP names a price that is not in US dollars. The top-up needs a one-time USD price.',
  bad_amount: () => 'The price has no whole, positive amount. The top-up needs a fixed amount in cents.',
  bad_config: () => 'STRIPE_PRICE_AI_TOPUP does not look like a Stripe price ID (price_…).',
  mode_mismatch: (mode) => `STRIPE_PRICE_AI_TOPUP is a price from the other Stripe mode; the secret key is ${mode} mode.`,
};
export function topUpStatusLine(s) {
  if (!s || typeof s.state !== 'string') return null;
  const mode = s.mode === 'live' ? 'live' : 'test';
  const suffix = typeof s.price_id_suffix === 'string' ? s.price_id_suffix : null;
  if (s.state === 'unset') return { tone: 'neutral', text: 'STRIPE_PRICE_AI_TOPUP is not set, so members are told the top-up isn\'t available yet.' };
  if (s.state === 'ready') return { tone: 'success', text: `The top-up is on sale${suffix ? ` (price …${suffix})` : ''}, ${mode} mode. Members see Add tokens.` };
  const line = TOPUP_REASON_LINES[s.reason];
  return s.state === 'not_ready' && line ? { tone: 'warning', text: `${line(mode)}${suffix ? ` Price …${suffix}.` : ''} Members are told it isn't available yet.` } : null;
}
export function TopUpReadinessCard({ status }) {
  const line = status.status === 'ready' ? topUpStatusLine(status.data) : null;
  return (
    <Card padding="none" className="overflow-hidden" data-testid="hq-topup-readiness">
      <div className="border-b border-axal-hairline px-4 py-3 text-sm font-bold dark:border-gray-800">AI top-up</div>
      <div className="px-4 py-3 text-[12.5px]">
        {status.status === 'loading' ? <p className="text-axal-muted">Reading the top-up…</p>
          : !line ? <Unreadable what="The AI top-up" claim="Nothing about the top-up has changed." onRetry={status.reload} />
            : <p data-testid="hq-topup-readiness-line" data-tone={line.tone}>{line.text}</p>}
      </div>
    </Card>
  );
}

export default function PlatformAllowancesPage() {
  const caps = useAccountRead(() => aiBudgetApi.caps());
  const reviews = useAccountRead(() => aiBudgetApi.reviews());
  const topUpStatus = useAccountRead(() => aiBudgetApi.topUpStatus());
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
          note="This rail reads back the plans' allowances and the runs held for a check. It changes nothing; Edit, Charge and Refund on the page do, and the Worker records who and why."
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
          <p className="mt-1 text-[13px] text-axal-muted dark:text-gray-400">The daily and monthly AI allowance each plan includes, and runs held for a check.</p>
        </div>
        {done && <p role="status" className="rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[12px] dark:border-gray-800 dark:bg-gray-800/40" data-testid="hq-allowances-done">{done}</p>}
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
          <PlansCard caps={caps} editing={editing} onEdit={(p) => { setEditing(p.licence_key); setDone(null); }} />
          <div className="flex flex-col gap-3">
            {editPlan && (
              <EditPlanForm key={editPlan.licence_key} plan={editPlan} onCancel={() => setEditing(null)}
                onSaved={(msg) => { setEditing(null); setDone(msg); caps.reload(); }} />
            )}
            <HeldCard reviews={reviews} onSettled={(msg) => { setDone(msg); reviews.reload(); }} />
            <TopUpReadinessCard status={topUpStatus} />
          </div>
        </div>
      </div>
    </RailFrame>
  );
}
