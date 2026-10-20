import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { aiBudgetApi } from '../../lib/api/aiBudget';
import { PhoneBar, Pill, Unrecorded, Unreadable, usePhoneWidth } from '../../ui';
import { BTN, INPUT, LoadingRows, Outcome, PanelCard, Switch, useAccountRead } from './AccountCenter';
import { refusalText } from './accountCenterModel';
import {
  AUTO_RELOAD_LIMIT_NOTE, LIMITS_PAGE, NO_LIMIT, NO_PLAN_ALLOWANCE, PACK_ORDERS_NOT_READ,
  allowanceCard, autoReloadCard, limitView, packOrdersCard, parseLimitUsd, stopsLine,
} from './limitsModel';

/**
 * D807 (#2246) — `/account/usage/limits`, board B4 of the "Usage & Billing
 * console" canvas: what stops spend, and when it resets.
 *
 * ONE EDITABLE CARD. The monthly spend limit (D788) is the member's one limit:
 * runs and auto-reloads (D794) both stop at it. The plan allowance,
 * auto-reload and today's pack orders are read-only here; auto-reload is
 * changed on Billing.
 *
 * EACH CARD LOADS ON ITS OWN, so one failed read costs that card and never the
 * page. Saving the limit asks for a recent sign-in, as every money setting
 * does: `lib/api.js` prompts for it on `step_up_required` and retries once.
 */

const MONO = 'font-mono tabular-nums';
const LABEL = 'text-[11px] font-semibold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400';

function Meter({ pct, label }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="h-full rounded-full bg-axal-violet" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Loading({ testid }) {
  return <div data-testid={testid} data-state="loading"><LoadingRows lines={2} /></div>;
}

const LIMIT_FIELD_WORDS = 'Enter an amount from $0 to $100,000, with at most two decimals.';

/** The monthly spend limit: the field, Save and Remove, the bar, the notices. */
export function SpendLimitCard({ read, api = aiBudgetApi }) {
  const view = read.status === 'ready' ? limitView(read.data) : null;
  const [text, setText] = useState(view?.set ? String(view.limitUsd) : '');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [fieldError, setFieldError] = useState(null);
  const input = useRef(null);

  const send = async (limitUsd, notify, done) => {
    setBusy(true); setOutcome(null); setFieldError(null);
    try {
      const next = await api.setSpendLimit(limitUsd, notify);
      read.set(next);
      if (limitUsd === null) setText('');
      setOutcome({ tone: 'ok', text: done });
    } catch (e) {
      const words = refusalText(e, 'The limit was not saved. Nothing changed.');
      if (e?.field === 'monthly_limit_usd') setFieldError(words);
      else setOutcome({ tone: 'error', text: words });
    } finally { setBusy(false); }
  };
  const save = (e) => {
    e.preventDefault();
    const n = parseLimitUsd(text);
    if (n === null) { setFieldError(LIMIT_FIELD_WORDS); return; }
    send(n, view?.notify, 'Limit saved.');
  };

  let body;
  if (read.status === 'loading') body = <Loading testid="limit-loading" />;
  else if (!view) body = <Unreadable what="Your spend limit" claim="This is not a claim that there is none." onRetry={read.reload} />;
  else body = (
    <div className="flex flex-col gap-3.5">
      <form onSubmit={save} className="flex flex-wrap items-center gap-2" data-testid="limit-form">
        <label className="flex min-w-[160px] items-center gap-1.5">
          <span className="sr-only">Monthly spend limit in US dollars</span>
          <span className="text-axal-muted dark:text-gray-400" aria-hidden="true">$</span>
          <input ref={input} className={`${INPUT} ${MONO}`} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)}
            aria-invalid={fieldError ? 'true' : undefined} data-testid="limit-input" />
        </label>
        <button type="submit" className={BTN.primary} disabled={busy} data-testid="limit-save">{busy ? 'Saving…' : 'Save'}</button>
        {view.set && <button type="button" className={BTN.ghost} disabled={busy} onClick={() => send(null, undefined, 'Limit removed.')} data-testid="limit-remove">Remove</button>}
      </form>
      {fieldError && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="limit-field-error">{fieldError}</p>}
      {view.set ? (
        <>
          <div className="flex flex-col gap-1.5" data-testid="limit-bar">
            <div className="flex justify-between text-[12.5px]">
              <span><span className={MONO}>{view.spent}</span> spent this month</span>
              <span className={MONO}>{view.pct}%</span>
            </div>
            <Meter pct={view.pct} label={`${view.spent} of ${view.limit}`} />
          </div>
          <div className="flex flex-wrap gap-4" data-testid="limit-notices">
            {[50, 80, 100].map((t) => (
              <span key={t} className="flex items-center gap-2 text-[12.5px]">
                <Switch checked={view.notify[t]} disabled={busy} label={`Notify me at ${t}%`} data-testid={`limit-notify-${t}`}
                  onChange={(on) => send(view.limitUsd, { ...view.notify, [t]: on }, on ? `Notice at ${t}% on.` : `Notice at ${t}% off.`)} />
                {t === 50 ? 'Notify me at 50%' : `${t}%`}
              </span>
            ))}
          </div>
          <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">Notices arrive in your bell and by email.</p>
          <p className="m-0 border-t border-axal-hairline pt-3 text-[13px] text-axal-ink dark:border-gray-800 dark:text-gray-200" data-testid="limit-stops">{stopsLine(view)}</p>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2" data-testid="limit-empty">
          <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">{NO_LIMIT}</p>
          <button type="button" className={BTN.ghost} onClick={() => input.current?.focus()} data-testid="limit-set">Set a limit</button>
        </div>
      )}
      <Outcome outcome={outcome} />
    </div>
  );
  return <PanelCard title="Monthly spend limit" data-testid="card-spend-limit">{body}</PanelCard>;
}

/** The plan allowance, read-only. */
export function PlanAllowanceCard({ budget }) {
  const v = budget.status === 'ready' ? allowanceCard(budget.data) : null;
  let body;
  if (budget.status === 'loading') body = <Loading testid="allowance-loading" />;
  else if (!v) body = <Unreadable what="Your plan allowance" onRetry={budget.reload} />;
  else if (v.none) body = <p className="m-0 text-[12.5px]" data-testid="allowance-none"><Unrecorded reason={NO_PLAN_ALLOWANCE}>Not recorded</Unrecorded> <span className="text-axal-muted dark:text-gray-400">{NO_PLAN_ALLOWANCE}</span></p>;
  else body = (
    <div className="flex flex-col gap-2" data-testid="allowance-figures">
      <span className="text-[13px]"><span className={`${MONO} font-medium`}>{v.perMonth}</span> a month</span>
      <span className="text-[12.5px] text-axal-muted dark:text-gray-400"><span className={MONO}>{v.used}</span> used · resets <span className={MONO}>{v.resets}</span></span>
      <Meter pct={v.pct} label={`Plan allowance: ${v.used} of ${v.perMonth}`} />
    </div>
  );
  return <Small title="Plan allowance · read-only" testid="card-plan-allowance">{body}</Small>;
}

/** Auto-reload, read-only: changed on Billing. */
export function AutoReloadSummary({ read, topUp }) {
  const v = read.status === 'ready' ? autoReloadCard(read.data, topUp.status === 'ready' ? topUp.data : null) : null;
  let body;
  if (read.status === 'loading') body = <Loading testid="auto-reload-loading" />;
  else if (!v) body = <Unreadable what="Auto-reload" claim="This is not a claim that it is off." onRetry={read.reload} />;
  else body = (
    <div className="flex flex-col gap-2" data-testid="auto-reload-summary">
      <span className="self-start"><Pill tone={v.on ? 'ok' : 'neutral'}>{v.on ? 'On' : 'Off'}</Pill></span>
      <span className="text-[12.5px] text-axal-ink dark:text-gray-200">{v.line}</span>
      <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{AUTO_RELOAD_LIMIT_NOTE}</span>
    </div>
  );
  const open = <Link to="/account/billing#auto-reload" className="text-[12px] font-semibold text-axal-violet-deep dark:text-violet-300" data-testid="auto-reload-open-billing">Open billing →</Link>;
  return <Small title="Auto-reload · read-only" aside={open} testid="card-auto-reload-summary">{body}</Small>;
}

/** Today's token-pack orders against the five a day. */
export function PackOrdersCard({ read }) {
  const v = read.status === 'ready' ? packOrdersCard(read.data) : null;
  let body;
  if (read.status === 'loading') body = <Loading testid="pack-orders-loading" />;
  else if (read.status !== 'ready') body = <Unreadable what="Today’s pack orders" onRetry={read.reload} />;
  else if (!v) body = <p className="m-0 text-[12.5px]" data-testid="pack-orders-unrecorded"><Unrecorded reason={PACK_ORDERS_NOT_READ}>Not recorded</Unrecorded> <span className="text-axal-muted dark:text-gray-400">{PACK_ORDERS_NOT_READ}</span></p>;
  else body = (
    <div className="flex flex-col gap-2" data-testid="pack-orders-figures">
      <span className={`${MONO} text-[22px] font-medium`}>{v.today} <span className="text-[13px] text-axal-muted dark:text-gray-400">of {v.perDay}</span></span>
      <Meter pct={v.pct} label={`Token pack orders today: ${v.today} of ${v.perDay}`} />
    </div>
  );
  return (
    <Small title="Token pack orders today" testid="card-pack-orders">
      {body}
      <span className="mt-2 block text-[11.5px] text-axal-muted dark:text-gray-400">Auto-reloads count toward it.</span>
    </Small>
  );
}

function Small({ title, aside = null, testid, children }) {
  return (
    <div className="flex flex-col gap-2 rounded-axal-md border border-axal-hairline bg-white px-4 py-3.5 dark:border-gray-800 dark:bg-gray-900" data-testid={testid}>
      <div className="flex items-center justify-between gap-2"><span className={LABEL}>{title}</span>{aside}</div>
      {children}
    </div>
  );
}

/** The page given its four reads: the header (a phone draws its bar), the limit, then the three read-only cards. */
export function LimitsView({ limit, budget, autoReload, topUp, api = aiBudgetApi, phone = false }) {
  return (
    <div className="flex flex-col gap-3" data-testid="limits-page" data-phone={phone ? 'true' : undefined}>
      {phone ? (
        <div className="-mx-[22px]">
          <PhoneBar back={{ label: 'Usage', to: '/account/usage' }} title={LIMITS_PAGE.title} sub={LIMITS_PAGE.sub} eadwynLabel={LIMITS_PAGE.title} />
        </div>
      ) : (
        <div>
          <h2 className="text-lg font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">{LIMITS_PAGE.title}</h2>
          <p className="text-[13px] text-axal-muted dark:text-gray-400">{LIMITS_PAGE.sub}</p>
        </div>
      )}
      <SpendLimitCard key={limit.status} read={limit} api={api} />
      <div className={`grid items-start gap-3 ${phone ? 'grid-cols-1' : 'lg:grid-cols-3'}`} data-testid="limits-cards">
        <PlanAllowanceCard budget={budget} />
        <AutoReloadSummary read={autoReload} topUp={topUp} />
        <PackOrdersCard read={limit} />
      </div>
    </div>
  );
}

/** `/account/usage/limits`: the four reads. */
export default function LimitsPage() {
  const limit = useAccountRead(() => aiBudgetApi.spendLimit());
  const budget = useAccountRead(() => aiBudgetApi.mine());
  const autoReload = useAccountRead(() => aiBudgetApi.autoReload());
  const topUp = useAccountRead(() => aiBudgetApi.topUp());
  const phone = usePhoneWidth();
  return <LimitsView limit={limit} budget={budget} autoReload={autoReload} topUp={topUp} phone={phone} />;
}
