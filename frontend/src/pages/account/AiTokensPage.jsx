import { Link } from 'react-router-dom';
import { ADD_TOKENS_PATH } from '../../lib/aiTokens';
import { aiBudgetApi } from '../../lib/api/aiBudget';
import { activeSupportSession } from '../../lib/supportSession';
import { useViewMode } from '../../contexts/ViewModeContext';
import { useAuth } from '../../hooks/useAuthSync';
import { PhoneBar } from '../../ui';
import { BTN, LoadingRows, PanelCard, useAccountRead } from './AccountCenter';
import {
  AI_TOKENS_PAGE, CARDS, FIRST_RULE, KEYS_WAIT, LINKS, NOT_YET, RUN_OUT, SUPPORT_NOTICE, UNREADABLE_BALANCE, WAITS,
  availableView, canBuy, limitRows, stopState,
} from './aiTokensModel';

/**
 * D1277 (#2482) — `/account/usage/ai-tokens`, Usage's third page (Overview ·
 * Cost · AI tokens · Limits · Storage), from the canvas "AI tokens".
 *
 * STEP 1 reads `GET /api/ai-budget/me` and `GET /api/ai-budget/limit`:
 *   Card 1  Available now: the allowance left plus the token balance, what is
 *           held named apart, the bar, and the one stop that applies now in
 *           the Worker's own words (TOKB3, TOKB4). Add tokens only where
 *           tokens would help.
 *   Card 4  the plan's allowance, the member's own monthly limit, and HQ's cap
 *           when HQ set one; each key's limit is step 2.
 *   Card 5  what happens when tokens run out.
 * Cards 2 and 3 (holds in progress, the price list) still say "Not read here
 * yet" with their reason until #3304 (D1278) lands. A block whose read failed
 * says so with Try again; it never blanks the page. A support session reads
 * and cannot buy (TOKB10).
 */
const MONO = 'font-mono tabular-nums';
const LINK = 'text-[13px] font-bold text-axal-violet hover:underline dark:text-violet-300';
const ROW = 'grid grid-cols-1 items-center gap-x-3 gap-y-0.5 border-t border-axal-hairline py-2 text-[13px] sm:grid-cols-[130px_minmax(0,1fr)_auto] dark:border-gray-800';
const SEGMENT = {
  allowance: 'bg-axal-violet dark:bg-violet-400',
  balance: 'bg-sky-500',
  held: 'bg-amber-500 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,.45)_0_3px,transparent_3px_6px)]',
};

function AddTokens({ wide = false, testId = 'ai-tokens-add' }) {
  return <Link to={ADD_TOKENS_PATH} className={`${BTN.primary} ${wide ? 'w-full' : ''}`} data-testid={testId}>Add tokens</Link>;
}

function Waiting({ id }) {
  return <>
    <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
    <p className="mt-1 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid={`ai-tokens-wait-${id}`}>{WAITS[id]}</p>
  </>;
}

function ReadFailed({ text, onRetry, testId }) {
  return <div className="flex flex-col gap-2" data-testid={testId}>
    <p className="m-0 text-[13.5px] text-axal-ink dark:text-gray-100">{text}</p>
    {onRetry && <button type="button" className={`${BTN.ghost} w-fit`} onClick={onRetry} data-testid={`${testId}-retry`}>Try again</button>}
  </div>;
}

function Stop({ stop, buy }) {
  if (!stop) return null;
  return <div role="status" className="flex flex-col gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid={`ai-tokens-stop-${stop.id}`}>
    <span className={stop.id === 'ai_paused' ? 'font-bold' : undefined}>{stop.text}</span>
    {stop.sub && <span>{stop.sub}</span>}
    {stop.link === 'limits' && <Link to={LINKS.limits} className={LINK}>Change in Limits ›</Link>}
    {stop.addTokens && buy && <AddTokens testId="ai-tokens-stop-add" />}
  </div>;
}

/** Card 1 (TOKB1, TOKB3 crop 2, TOKB4, TOKB6, TOKB7, TOKB8, TOKB9). */
function Available({ me, limit, buy, now }) {
  if (me.status === 'loading') return <div data-testid="ai-tokens-available-loading"><p className="m-0 text-[12.5px] text-axal-muted">Reading…</p><LoadingRows lines={3} /></div>;
  const v = me.status === 'ready' ? availableView(me.data, now) : null;
  if (!v) return <ReadFailed text={UNREADABLE_BALANCE} onRetry={me.reload} testId="ai-tokens-available-unreadable" />;
  const stop = stopState(me.data, limit.status === 'ready' ? limit.data : null, now);
  const total = v.segments.reduce((n, s) => n + s.micro, 0);
  return <div className="flex flex-col gap-3" data-testid="ai-tokens-available-body">
    <div className="flex flex-col gap-1.5">
      <div className={`${MONO} text-[34px] font-bold leading-tight tracking-[-0.02em] text-axal-ink dark:text-gray-100`} data-testid="ai-tokens-available-figure">{v.available}</div>
      <p className="m-0 max-w-[640px] text-[13px] leading-relaxed text-axal-muted dark:text-gray-400" data-testid="ai-tokens-available-summary">{v.summary}</p>
    </div>
    <Stop stop={stop} buy={buy} />
    <div role="img" aria-label={v.srSummary} className="flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800" data-testid="ai-tokens-bar">
      {total > 0 && v.segments.map((s) => <div key={s.id} className={`min-w-[4px] ${SEGMENT[s.id]}`} style={{ flex: `${s.micro} 1 0` }} data-testid={`ai-tokens-bar-${s.id}`} />)}
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-axal-muted dark:text-gray-400" aria-hidden="true">
      {v.segments.map((s) => <span key={s.id} className="inline-flex items-center gap-1.5"><span className={`h-3 w-3 rounded-[3px] ${SEGMENT[s.id]}`} />{s.label} <span className={MONO}>{s.value}</span></span>)}
    </div>
    <div>
      <div className={ROW} data-testid="ai-tokens-row-allowance">
        <span className="font-bold text-axal-ink dark:text-gray-100">Plan allowance</span>
        {v.noAllowance
          ? <><span className="text-axal-muted dark:text-gray-400">No plan allowance. Your AI runs use AI tokens.</span><Link to={LINKS.plans} className={LINK}>See plans ›</Link></>
          : <><span className="text-axal-muted dark:text-gray-400"><span className={MONO}>{v.used}</span> of <span className={MONO}>{v.of}</span> used · resets <span className={MONO}>{v.resets}</span></span><Link to={LINKS.cost} className={LINK}>See Cost ›</Link></>}
      </div>
      <div className={ROW} data-testid="ai-tokens-row-balance">
        <span className="font-bold text-axal-ink dark:text-gray-100">Token balance</span>
        <span className="text-axal-muted dark:text-gray-400"><span className={MONO}>{v.balance}</span> · never expires</span>
        <Link to={LINKS.billing} className={LINK}>History in Billing ›</Link>
      </div>
      <div className={ROW} data-testid="ai-tokens-row-held">
        <span className="font-bold text-axal-ink dark:text-gray-100">{v.review ? 'Held for review' : 'Held now'}</span>
        <span className="text-axal-muted dark:text-gray-400"><span className={MONO}>{v.held}</span>{v.heldMicro > 0 && !v.review ? ' · returns within 5 minutes if unused' : ''}</span>
        <span />
      </div>
    </div>
    {!v.noAllowance && <p className="m-0 text-[12px] leading-relaxed text-axal-muted dark:text-gray-400">{FIRST_RULE}</p>}
  </div>;
}

/** Card 4, step 1's rows (TOKB1, TOKB6). */
function Limits({ me, limit }) {
  if (me.status === 'loading') return <LoadingRows lines={3} />;
  const r = limitRows(me.status === 'ready' ? me.data : null, limit.status === 'loading' ? undefined : limit.status === 'ready' ? limit.data : null);
  return <div className="flex flex-col" data-testid="ai-tokens-limits-body">
    <div className="flex flex-col gap-1 border-t border-axal-hairline py-3 first:border-t-0 dark:border-gray-800" data-testid="ai-tokens-limit-plan">
      <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Plan allowance</span>
      {r.plan.state === 'ok' && <span className="text-[13px] text-axal-muted dark:text-gray-400"><span className={MONO}>{r.plan.perMonth}</span> a month{r.plan.from ? ` · From your ${r.plan.from} plan` : ''}</span>}
      {r.plan.state === 'none' && <span className="text-[13px] text-axal-muted dark:text-gray-400">{r.plan.text}</span>}
      {r.plan.state === 'unreadable' && <ReadFailed text="Your plan’s allowance could not be read." onRetry={me.reload} testId="ai-tokens-limit-plan-unreadable" />}
    </div>
    <div className="flex flex-col gap-1.5 border-t border-axal-hairline py-3 dark:border-gray-800" data-testid="ai-tokens-limit-own">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Your monthly limit</span>
        <Link to={LINKS.limits} className={LINK}>{r.own.state === 'none' ? 'Set one in Limits ›' : 'Change in Limits ›'}</Link>
      </div>
      {r.own.state === 'loading' && <LoadingRows lines={1} />}
      {r.own.state === 'none' && <span className="text-[13px] text-axal-muted dark:text-gray-400">No limit set.</span>}
      {r.own.state === 'unreadable' && <ReadFailed text="Your monthly limit could not be read. That is not the same as no limit." onRetry={limit.reload} testId="ai-tokens-limit-own-unreadable" />}
      {r.own.state === 'ok' && <>
        <span className="text-[13px] text-axal-muted dark:text-gray-400"><span className={MONO}>{r.own.spent}</span> of <span className={MONO}>{r.own.limit}</span></span>
        <div className="h-1.5 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800" role="meter" aria-label="Your monthly limit used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.own.pct}>
          <div className="h-full rounded-full bg-axal-violet dark:bg-violet-400" style={{ width: `${r.own.pct}%` }} />
        </div>
      </>}
    </div>
    <div className="flex flex-col gap-1 border-t border-axal-hairline py-3 dark:border-gray-800" data-testid="ai-tokens-limit-keys">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Per API key</span>
        <Link to={LINKS.keys} className={LINK}>Manage keys ›</Link>
      </div>
      <span className="text-[12.5px] text-axal-muted dark:text-gray-400">{KEYS_WAIT}</span>
    </div>
    {r.hq && <div className="flex flex-col gap-1 border-t border-axal-hairline py-3 dark:border-gray-800" data-testid="ai-tokens-limit-hq">
      <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Set by StudioOS</span>
      <span className={`text-[13px] text-axal-muted dark:text-gray-400`}>{r.hq}</span>
    </div>}
  </div>;
}

/** Card 5 (TOKB1). */
function RunOut() {
  return <div data-testid="ai-tokens-run-out-body">
    {RUN_OUT.map((r) => <p key={r.id} className="m-0 border-t border-axal-hairline py-2.5 text-[13px] leading-relaxed text-axal-ink first:border-t-0 dark:border-gray-800 dark:text-gray-100" data-testid={`ai-tokens-run-out-${r.id}`}>{r.text}</p>)}
  </div>;
}

/** The page, from its two reads. `buy` is false in a support session; `who` is the member's name for its notice. */
export function AiTokensView({ me, limit, buy = true, who = null, now = new Date() }) {
  return <div className="flex min-w-0 flex-col gap-4" data-testid="usage-ai-tokens-page">
    <div className="-mx-[22px] lg:hidden"><PhoneBar back={{ label: 'Usage', to: '/account/usage' }} title={AI_TOKENS_PAGE.title} sub={AI_TOKENS_PAGE.sub} /></div>
    <Link to="/account/usage" className="hidden lg:block text-xs font-semibold text-axal-violet dark:text-violet-300">← Usage overview</Link>
    <header className="hidden lg:flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-xl font-extrabold tracking-axal-heading">{AI_TOKENS_PAGE.title}</h2><p className="mt-1 text-[13px] text-axal-muted dark:text-gray-400">{AI_TOKENS_PAGE.sub}</p></div>
      {buy && <AddTokens />}
    </header>
    {buy && <div className="lg:hidden"><AddTokens wide testId="ai-tokens-add-phone" /></div>}
    {!buy && <p role="status" className="m-0 rounded-[10px] border border-axal-hairline bg-gray-50 px-3 py-2.5 text-[13px] text-axal-ink dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100" data-testid="ai-tokens-support">{SUPPORT_NOTICE(who)}</p>}
    {CARDS.map((c) => <PanelCard key={c.id} title={c.title} data-testid={`ai-tokens-${c.id}`}>
      {c.id === 'available' && <Available me={me} limit={limit} buy={buy} now={now} />}
      {c.id === 'limits' && <Limits me={me} limit={limit} />}
      {c.id === 'run_out' && <RunOut />}
      {WAITS[c.id] && <Waiting id={c.id} />}
    </PanelCard>)}
  </div>;
}

export default function AiTokensPage() {
  const me = useAccountRead(() => aiBudgetApi.mine());
  const limit = useAccountRead(() => aiBudgetApi.spendLimit());
  const view = useViewMode();
  const { user } = useAuth() || {};
  const buy = canBuy({ hqSupport: !!activeSupportSession(), impersonating: !!view?.isImpersonating });
  return <AiTokensView me={me} limit={limit} buy={buy} who={user?.name || null} />;
}
