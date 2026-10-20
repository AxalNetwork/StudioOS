import { useEffect, useState } from 'react';
import { NO_PLAN_LINE } from '../../lib/planAllowance';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../lib/api';
import { aiBudgetApi } from '../../lib/api/aiBudget';
import { usageApi } from '../../lib/api/usage';
import { EmptyState, PhoneBar, PhoneRows, Pill, Unrecorded, Unreadable, usePhoneWidth } from '../../ui';
import { BTN, Chips, INPUT, LoadingRows, PanelCard, useAccountRead } from './AccountCenter';
import {
  NOT_COUNTED, allowanceView, chargedPages, dayAxis, dayBars, filterPages, modelRows, pageOf, pageRows,
  rateRows, receiptView, storageView, STORAGE_AREAS, taskRows, topUpState, topUpRows, purchaseLine,
} from './usageModel';
import { ACCOUNT_PHONE_COPY, ACCOUNT_PHONE_PAGES } from './accountPhone';
import { ADD_TOKENS_PATH, TOPUP_UNAVAILABLE_RUNS, pastAllowanceLine } from '../../lib/aiTokens';

/**
 * D642 (#1435) — the Account center's Usage section, `/account/usage`, built
 * to U1–U6 of the Usage canvas (`us-*` in `Ops Page.dc.html` and
 * `ops-data.js`). The canvas's figures are placeholders; every figure here is
 * read from D640's `/ai-budget/me`, D641's `/ai/me/spend` and `/ai/rates`, and
 * D642's `/usage/storage`.
 *
 * USAGE BELONGS TO THE MEMBER AND THEIR PLAN. No read here takes a company,
 * so switching company in the sidebar changes nothing on this page.
 *
 * EACH CARD LOADS ON ITS OWN. The allowance, the top-up option, the spend
 * report, the rate card and the storage read are five reads, and one that
 * fails costs only the cards that draw it. The spend report is one read
 * behind four cards (days, where, models, last run); each of those cards also
 * honours the report's own `*_recorded` flag for its figure, so a breakdown
 * the Worker could not read is Unreadable on that card alone.
 */

const MONO = 'font-mono tabular-nums';

function Muted({ children, className = '', ...rest }) {
  return <span className={`text-xs text-axal-muted dark:text-gray-400 ${className}`} {...rest}>{children}</span>;
}

function Bar({ pct, label }) {
  return (
    <div className="my-2 h-2 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="h-full rounded-full bg-axal-violet" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Period({ title, period, nrReason, testid }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid={testid}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-axal-muted dark:text-gray-400">{title}</span>
        {period
          ? <span className={`${MONO} text-sm`}>{period.used} <span className="text-xs text-axal-muted dark:text-gray-400">of {period.of}</span></span>
          : <Unrecorded reason={nrReason}>Not recorded</Unrecorded>}
      </div>
      {period ? (
        <>
          <Bar pct={period.pct} label={`${title}: ${period.used} of ${period.of}`} />
          <span className={`${MONO} text-[11.5px] text-axal-muted dark:text-gray-400`}>{period.reset}</span>
        </>
      ) : <span className="text-[12px] text-axal-muted dark:text-gray-400">{nrReason}</span>}
    </div>
  );
}

const STATE_COPY = {
  // D755 (#1916): with nothing on sale, runs wait for the reset (pastAllowanceLine).
  // D783: with no paid plan, every run uses tokens.
  no_allowance: { t: 'No allowance on this plan', d: (v, none) => (v.noPlan ? NO_PLAN_LINE : pastAllowanceLine(none)), tone: 'plain', topUp: true },
  day_used_up: { t: 'Today’s allowance is used up', d: (v, none) => `It resets at 00:00 UTC, ${v.resetIn}. ${pastAllowanceLine(none, { untilThen: true })}`, tone: 'warn', topUp: true },
  month_used_up: { t: 'This month’s allowance is used up', d: (v, none) => `It resets on the 1st at 00:00 UTC. ${pastAllowanceLine(none, { untilThen: true })}`, tone: 'warn', topUp: true },
  paused: { t: 'Runs paused', d: () => 'A run cost more than it held. New runs wait while HQ checks the charge.', tone: 'danger', topUp: false },
};
const TONE = {
  plain: 'border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900',
  warn: 'border-amber-300 bg-amber-50/60 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
  danger: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
};

function AddTokens({ topUp }) {
  if (topUp !== 'available') return null;
  return <a href={ADD_TOKENS_PATH} className={BTN.ghost} data-testid="usage-add-tokens">Add tokens</a>;
}

/**
 * D755 §10 (#1984, part 2): the latest purchase under the top-up balance —
 * waiting, credited, overdue (with the Help Center) or refunded.
 */
function PurchaseNote({ latest, now }) {
  const line = purchaseLine(latest, now.getTime());
  if (!line) return null;
  return (
    <Muted className="leading-snug" data-testid={`usage-topup-${line.state}`} role={line.help ? 'alert' : undefined}>
      {line.text}
      {line.help && <> <a href="/help" className="font-semibold underline" data-testid="usage-topup-help">Help Center</a></>}
    </Muted>
  );
}

/** U1 — the allowance. */
export function AllowanceCard({ budget, product, now = new Date() }) {
  const v = budget.status === 'ready' ? allowanceView(budget.data, now) : null;
  const topUp = product.status === 'ready' ? topUpState(product.data) : product.status === 'loading' ? 'loading' : 'unreadable';
  return (
    <PanelCard title="AI allowance" aside={v ? `Included with your plan: ${v.plan}` : null} data-testid="usage-card-allowance">
      {budget.status === 'loading' ? <LoadingRows lines={4} />
        : !v ? (
          <div data-testid="usage-allowance-unreadable">
            <Unreadable what="Your allowance" claim="The other cards still load." onRetry={budget.reload} />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {v.states.map((s) => {
              const c = STATE_COPY[s];
              return (
                <div key={s} role={s === 'paused' ? 'alert' : 'status'} data-testid={`usage-state-${s}`}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-axal-lg border px-3.5 py-3 ${TONE[c.tone]}`}>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-bold">{c.t}</span>
                    <span className="text-[12.5px] leading-relaxed">{c.d(v, topUp === 'unavailable')}</span>
                  </div>
                  {c.topUp && <AddTokens topUp={topUp} />}
                </div>
              );
            })}
            {!v.noAllowance && (
              <div className="grid gap-4 sm:grid-cols-2">
                {v.dayCapped && <Period title="Today" period={v.today} testid="usage-today" nrReason={`The plan sets no daily allowance. ${pastAllowanceLine(topUp === 'unavailable')}`} />}
                <Period title="This month" period={v.month} testid="usage-month" nrReason={`The plan sets no monthly allowance. ${pastAllowanceLine(topUp === 'unavailable')}`} />
              </div>
            )}
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="flex flex-col gap-0.5 rounded-axal-md border border-axal-hairline px-3 py-2.5 dark:border-gray-800" data-testid="usage-held">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-axal-muted dark:text-gray-400">Held</span>
                <span className={`${MONO} text-base`}>{v.held}</span>
                <Muted className="leading-snug">Held by runs in progress. Returned if a run does not finish within 5 minutes.</Muted>
              </div>
              <div className="flex flex-col gap-0.5 rounded-axal-md border border-axal-hairline px-3 py-2.5 dark:border-gray-800" data-testid="usage-topup">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-axal-muted dark:text-gray-400">Top-up balance</span>
                  <AddTokens topUp={topUp} />
                </div>
                <span className={`${MONO} text-base`}>{v.balance}</span>
                {topUp === 'unavailable' ? (
                  <Muted className="leading-snug" data-testid="usage-topup-unavailable">{TOPUP_UNAVAILABLE_RUNS}</Muted>
                ) : topUp === 'unreadable' ? (
                  <Unreadable what="The top-up option" claim="Your balance above is unaffected." onRetry={product.reload} />
                ) : (
                  <Muted className="leading-snug">Runs use your included allowance first, then your top-up balance.</Muted>
                )}
                {product.status === 'ready' && <PurchaseNote latest={product.data?.latest} now={now} />}
              </div>
            </div>
          </div>
        )}
    </PanelCard>
  );
}

/**
 * The spend report's state for one card: `loading`, `unreadable` (the report,
 * or this card's own breakdown, could not be read) or `ready`.
 */
function spendFor(spend, flag) {
  if (spend.status === 'loading') return 'loading';
  if (spend.status !== 'ready' || !spend.data || spend.data.recorded !== true) return 'unreadable';
  if (flag && spend.data[flag] !== true) return 'unreadable';
  return 'ready';
}

const noRunsThisMonth = (spend) => !spend.data?.month?.calls;

/** U2 — the last 30 days. */
export function DaysCard({ spend }) {
  const st = spendFor(spend, 'days_recorded');
  const bars = st === 'ready' ? dayBars(spend.data.days) : null;
  const empty = bars && bars.every((b) => b.none);
  return (
    <PanelCard title="Last 30 days" data-testid="usage-card-days"
      footer={bars && !empty ? 'Estimated cost per day, UTC. Hover or tap a bar for its runs. A day with no runs is a real $0.00. No allowance line: the allowance may have been different on earlier days.' : null}>
      <div id="days" className="scroll-mt-24" />
      {st === 'loading' ? <LoadingRows lines={3} />
        : !bars ? <Unreadable what="The last 30 days" claim="This is not a claim that you ran nothing." onRetry={spend.reload} />
          : empty ? <EmptyState size="sm" data-testid="usage-days-empty" title="No AI runs in the last 30 days." />
            : (
              <>
                <div className="flex h-[90px] items-end gap-1 border-b border-axal-hairline pb-1 dark:border-gray-800" data-testid="usage-days-bars">
                  {bars.map((b) => (
                    <button key={b.day} type="button" title={b.tip} aria-label={b.tip} data-testid="usage-day"
                      className={`min-w-0 flex-1 rounded-t-[3px] ${b.none ? 'bg-gray-300 dark:bg-gray-700' : b.today ? 'bg-axal-violet' : 'bg-violet-300 dark:bg-violet-700'}`}
                      style={{ height: `${b.height}%` }} />
                  ))}
                </div>
                <div className={`mt-1.5 flex justify-between ${MONO} text-[11px] text-axal-faint`}>
                  {dayAxis(spend.data.days).map((a) => <span key={a}>{a}</span>)}
                </div>
              </>
            )}
    </PanelCard>
  );
}

function FigureRow({ label, runs, cost, nr = false, testid }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_70px_100px] items-center gap-3 border-b border-axal-ground py-2.5 text-[13px] last:border-0 dark:border-gray-800" data-testid={testid}>
      <span className="min-w-0 truncate font-semibold">{nr ? <Pill tone="neutral" className="border-dashed font-medium">{label}</Pill> : label}</span>
      <span className={`${MONO} text-right text-[12.5px]`}>{runs}</span>
      <span className={`${MONO} text-right text-[12.5px]`}>{cost}</span>
    </div>
  );
}

function FigureHead({ first }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_70px_100px] gap-3 border-b border-axal-hairline pb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-axal-muted dark:border-gray-800 dark:text-gray-400">
      <span>{first}</span><span className="text-right">Runs</span><span className="text-right">Est. cost</span>
    </div>
  );
}

/**
 * D776 (#2093) — what the member was charged this month, by the rail's page and
 * option within it, from `GET /ai-budget/runs?group=option`. Each page says how
 * much came from the allowance and how much from tokens. "Not recorded" is a
 * charge or a page the run log did not keep, never $0.00.
 */
export function ChargedView({ runs }) {
  if (runs.status === 'loading') return <LoadingRows lines={4} />;
  const view = runs.status === 'ready' ? chargedPages(runs.data) : null;
  if (!view) return <Unreadable what="What you were charged" claim="This is not a claim that you were charged nothing." onRetry={runs.reload} />;
  if (!view.pages.length) return <EmptyState size="sm" data-testid="usage-charged-empty" title="No AI runs yet this month." />;
  const nr = <Unrecorded reason="These runs were logged before charges were recorded, or are held for a check.">Not recorded</Unrecorded>;
  return (
    <div data-testid="usage-charged">
      <div className="grid grid-cols-[minmax(0,1fr)_70px_100px] gap-3 border-b border-axal-hairline pb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-axal-muted dark:border-gray-800 dark:text-gray-400">
        <span>Page and option</span><span className="text-right">Runs</span><span className="text-right">Charged</span>
      </div>
      {view.pages.map((p) => (
        <div key={p.key} className="border-b border-axal-ground py-2 last:border-0 dark:border-gray-800" data-testid={p.noPage ? 'usage-charged-nopage' : 'usage-charged-page'}>
          <div className="grid grid-cols-[minmax(0,1fr)_70px_100px] items-center gap-3 text-[13px]">
            <span className="min-w-0 truncate font-semibold">
              {p.noPage ? <Pill tone="neutral" className="border-dashed font-medium">Not recorded</Pill>
                : p.href ? <Link to={p.href} className="text-axal-violet hover:underline" data-testid="usage-charged-link">{p.label}</Link>
                  : p.label}
            </span>
            <span className={`${MONO} text-right text-[12.5px]`}>{p.runs}</span>
            <span className={`${MONO} text-right text-[12.5px]`}>{p.charged ?? nr}</span>
          </div>
          {p.chargedMicro != null && (
            <Muted className={MONO} data-testid="usage-charged-split">From your allowance {p.allowance} · from tokens {p.tokens}</Muted>
          )}
          {!p.noPage && p.options.map((o) => (
            <div key={o.key} className="grid grid-cols-[minmax(0,1fr)_70px_100px] items-center gap-3 pl-4 pt-1 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="usage-charged-option">
              <span className="min-w-0 truncate">{o.noOption ? 'No option recorded' : o.label}</span>
              <span className={`${MONO} text-right`}>{o.runs}</span>
              <span className={`${MONO} text-right`}>{o.charged ?? nr}</span>
            </div>
          ))}
        </div>
      ))}
      {view.truncated && <Muted data-testid="usage-charged-truncated">Only the 200 largest are listed.</Muted>}
    </div>
  );
}

/** U3 — where it went this month, by page (with search and pages), by task, or charged (D776). */
export function WhereCard({ spend, initialTab = 'page' }) {
  const [tab, setTab] = useState(initialTab);
  // D776: read only once the member opens the Charged view.
  const runs = useAccountRead(() => aiBudgetApi.runs({ group: 'option' }), { enabled: tab === 'charged' });
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const st = spendFor(spend, tab === 'page' ? 'by_surface_recorded' : 'by_task_recorded');
  const ready = st === 'ready';
  const empty = ready && noRunsThisMonth(spend);
  const pages = ready && tab === 'page' ? pageRows(spend.data.by_surface) : null;
  const tasks = ready && tab === 'task' ? taskRows(spend.data.by_task) : null;
  const filtered = pages ? filterPages(pages, query) : null;
  const shown = filtered ? pageOf(filtered, page) : null;
  return (
    <PanelCard
      title="Where it went this month"
      data-testid="usage-card-where"
      action={(
        <Chips label="Split" items={[
          { key: 'page', label: 'By page', active: tab === 'page', onSelect: () => setTab('page'), testid: 'usage-tab-page' },
          { key: 'task', label: 'By task', active: tab === 'task', onSelect: () => setTab('task'), testid: 'usage-tab-task' },
          { key: 'charged', label: 'Charged', active: tab === 'charged', onSelect: () => setTab('charged'), testid: 'usage-tab-charged' },
        ]} />
      )}
      footer={tab === 'charged' ? 'What you paid for each run, as its hold settled. Runs still in progress are not in these figures yet.'
        : ready && !empty ? 'Estimated from the run log. Runs still in progress are not in these figures yet.' : null}
    >
      <div id="where" className="scroll-mt-24" />
      {tab === 'charged' ? <ChargedView runs={runs} />
        : st === 'loading' ? <LoadingRows lines={4} />
        : !ready ? <Unreadable what="Where it went" claim="This is not a claim that you ran nothing." onRetry={spend.reload} />
          : empty ? <EmptyState size="sm" data-testid="usage-where-empty" title="No AI runs yet this month." />
            : tab === 'page' ? (
              <>
                <input type="search" className={`${INPUT} mb-2`} placeholder="Search pages…" value={query}
                  onChange={(e) => { setQuery(e.target.value); setPage(1); }} aria-label="Search pages" data-testid="usage-where-search" />
                <FigureHead first="Page" />
                {shown.rows.length === 0
                  ? <p className="py-2 text-[13px] text-axal-muted dark:text-gray-400">No page matches this search.</p>
                  : shown.rows.map((r) => (
                    <FigureRow key={r.key} label={r.noPage ? 'No page recorded' : r.label} runs={r.runs} cost={r.cost} nr={r.noPage}
                      testid={r.noPage ? 'usage-where-nopage' : 'usage-where-row'} />
                  ))}
                {shown.rows.some((r) => r.noPage) && <Muted>No page recorded: these runs carry no page.</Muted>}
                {shown.pages > 1 && (
                  <div className="mt-2 flex items-center justify-end gap-2 text-xs" data-testid="usage-where-pages">
                    <button type="button" className={BTN.ghost} disabled={shown.page <= 1} onClick={() => setPage(shown.page - 1)}>Previous</button>
                    <span className={MONO}>{shown.page} of {shown.pages}</span>
                    <button type="button" className={BTN.ghost} disabled={shown.page >= shown.pages} onClick={() => setPage(shown.page + 1)}>Next</button>
                  </div>
                )}
              </>
            ) : (
              <>
                <FigureHead first="What Eadwyn was doing" />
                {tasks.map((r) => <FigureRow key={r.key} label={r.label} runs={r.runs} cost={r.cost} testid="usage-where-task" />)}
              </>
            )}
    </PanelCard>
  );
}

function Tokens({ t }) {
  return t
    ? <span title={t.exact}>{t.short}</span>
    : <Unrecorded reason="A cached answer, a streamed reply or a transcription recorded no count.">{NOT_COUNTED}</Unrecorded>;
}

/** U4 — models this month, then the rate card. */
export function ModelsCard({ spend, rates }) {
  const st = spendFor(spend, 'by_model_recorded');
  const rows = st === 'ready' ? modelRows(spend.data.by_model, rates.status === 'ready' ? rates.data : null) : null;
  const empty = rows && rows.length === 0;
  const rateList = rates.status === 'ready' ? rateRows(rates.data) : null;
  return (
    <div className="flex flex-col gap-3">
      <div id="models" className="scroll-mt-24" />
      <PanelCard title="Models this month" data-testid="usage-card-models"
        footer={rows && !empty ? 'Token counts are short; hover for the exact figure. A cached answer, a streamed reply or a transcription recorded no count: those runs are not counted, never 0 tokens.' : null}>
        {st === 'loading' ? <LoadingRows lines={3} />
          : !rows ? <Unreadable what="Models" claim="This is not a claim that you ran nothing." onRetry={spend.reload} />
            : empty ? <EmptyState size="sm" data-testid="usage-models-empty" title="No AI runs yet this month." />
              : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-[13px]">
                    <thead>
                      <tr className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-axal-muted dark:text-gray-400">
                        <th className="pb-2 text-left font-semibold">Model</th>
                        <th className="pb-2 text-right font-semibold">Runs</th>
                        <th className="pb-2 text-right font-semibold">In</th>
                        <th className="pb-2 text-right font-semibold">Out</th>
                        <th className="pb-2 text-right font-semibold">Est. cost</th>
                        <th className="pb-2 pl-3 text-left font-semibold">Fallback · cached · not counted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((m) => (
                        <tr key={m.id} className="border-t border-axal-ground dark:border-gray-800" data-testid="usage-model-row">
                          <td className="py-2.5 pr-2">
                            <div className="font-semibold">{m.name}</div>
                            <div className="max-w-[260px] truncate font-mono text-[11px] text-axal-muted dark:text-gray-400">{m.id}</div>
                          </td>
                          <td className={`${MONO} text-right`}>{m.runs}</td>
                          <td className={`${MONO} text-right`} data-testid="usage-model-in"><Tokens t={m.tin} /></td>
                          <td className={`${MONO} text-right`} data-testid="usage-model-out"><Tokens t={m.tout} /></td>
                          <td className={`${MONO} text-right`}>{m.cost}</td>
                          <td className={`${MONO} pl-3 text-xs text-axal-muted dark:text-gray-400`}>
                            {m.fallback} fallback · {m.cached} cached
                            {m.notCounted > 0 && <> · <Pill tone="neutral" className="border-dashed font-medium" data-testid="usage-model-not-counted">{m.notCounted} {m.notCounted === 1 ? 'run' : 'runs'} not counted</Pill></>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
      </PanelCard>
      <RatesCard rates={rates} rateList={rateList} />
    </div>
  );
}

/** U4's second card, the rate card. Kept apart so the phone view can draw it below its sections. */
export function RatesCard({ rates, rateList = rates.status === 'ready' ? rateRows(rates.data) : null }) {
  return (
    <PanelCard title="Rates" data-testid="usage-card-rates" footer={rateList ? 'Your allowance and top-up balance are charged at these rates.' : null}>
      {rates.status === 'loading' ? <LoadingRows lines={3} />
        : !rateList ? <Unreadable what="The rates" claim="Your charges are unaffected." onRetry={rates.reload} />
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-[13px]">
                <thead>
                  <tr className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-axal-muted dark:text-gray-400">
                    <th className="pb-2 text-left font-semibold">Model</th>
                    <th className="pb-2 text-right font-semibold">In</th>
                    <th className="pb-2 text-right font-semibold">Out</th>
                    <th className="pb-2 pl-3 text-left font-semibold">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {rateList.map((r) => (
                    <tr key={r.id} className="border-t border-axal-ground dark:border-gray-800" data-testid="usage-rate-row">
                      <td className="py-2.5 pr-2">
                        <div className="flex items-center gap-2 font-semibold">{r.name}{r.retired && <Pill tone="neutral" data-testid="usage-rate-retired">Retired</Pill>}</div>
                        <div className="max-w-[300px] truncate font-mono text-[11px] text-axal-muted dark:text-gray-400">{r.id}</div>
                      </td>
                      <td className={`${MONO} text-right`}>{r.pin}</td>
                      <td className={`${MONO} text-right`}>{r.pout ?? '—'}</td>
                      <td className="pl-3 text-xs text-axal-muted dark:text-gray-400">{r.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </PanelCard>
  );
}

/** U5 — the last run, as a receipt. */
export function LastRunCard({ spend, rates }) {
  const st = spendFor(spend, 'last_run_recorded');
  const r = st === 'ready' ? receiptView(spend.data.last_run, rates.status === 'ready' ? rates.data : null) : null;
  return (
    <PanelCard title="Last run" className="max-w-[560px]" data-testid="usage-card-last-run"
      action={r ? <div className="flex flex-wrap gap-1">{r.flags.map((f) => <Pill key={f.t} tone={f.tone} data-testid="usage-run-flag">{f.t}</Pill>)}</div> : null}>
      <div id="last-run" className="scroll-mt-24" />
      {st === 'loading' ? <LoadingRows lines={4} />
        : st !== 'ready' ? <Unreadable what="The last run" claim="This is not a claim that you ran nothing." onRetry={spend.reload} />
          : !r ? <EmptyState size="sm" data-testid="usage-last-run-empty" title="No AI runs yet." />
            : r.rows.map((row) => (
              <div key={row.k} className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 border-b border-dashed border-axal-hairline py-2 text-[13px] last:border-0 dark:border-gray-800" data-testid={`usage-receipt-${row.k.toLowerCase().replace(/ /g, '-')}`}>
                <span className="text-axal-muted dark:text-gray-400">{row.k}</span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  {row.nr ? <Unrecorded reason={row.sub}>{row.v}</Unrecorded> : <span className={MONO}>{row.v}</span>}
                  {row.sub && <span className="truncate font-mono text-[11px] text-axal-muted dark:text-gray-400">{row.sub}</span>}
                </span>
              </div>
            ))}
    </PanelCard>
  );
}

/** U6 — the files this member uploaded, across all their companies. */
export function StorageCard({ storage, role }) {
  const v = storage.status === 'ready' ? storageView(storage.data) : null;
  return (
    <PanelCard
      title="Storage"
      data-testid="usage-card-storage"
      aside={v && !v.empty ? (v.total != null
        ? <span className={`${MONO} text-base text-axal-ink dark:text-gray-100`} data-testid="usage-storage-total">{v.total} <span className="font-sans text-[13px] text-axal-muted dark:text-gray-400">in {v.files} {v.files === 1 ? 'file' : 'files'}</span></span>
        : <span data-testid="usage-storage-total"><Unrecorded reason={v.anyUnreadable ? 'A place below could not be read.' : 'Some files were stored before sizes were recorded.'}>Total not recorded</Unrecorded></span>) : null}
      footer={v && !v.empty ? 'Other files you keep on StudioOS are not counted yet. No plan sets a storage limit.' : null}
    >
      <div id="storage" className="scroll-mt-24" />
      {storage.status === 'loading' ? <LoadingRows lines={5} />
        : !v ? <Unreadable what="Storage" claim="This is not a claim that you stored nothing." onRetry={storage.reload} />
          : v.empty ? (
            <EmptyState size="sm" data-testid="usage-storage-empty" title="No files uploaded yet."
              cta={role === 'founder' ? { label: 'Open the data room', to: '/raise/data-room' } : undefined} />
          ) : v.places.map((p) => (
            <div key={p.key} className="grid grid-cols-[minmax(0,1.4fr)_80px_100px_minmax(0,1.4fr)] items-center gap-3 border-b border-axal-ground py-2.5 text-[13px] last:border-0 dark:border-gray-800" data-testid={`usage-storage-${p.key}`}>
              <span className="font-semibold">{p.label}</span>
              {p.unreadable ? (
                <span className="col-span-3"><Unreadable what={p.label} claim="The other places still count." onRetry={storage.reload} /></span>
              ) : (
                <>
                  <span className={`${MONO} text-right text-[12.5px]`}>{p.files} {p.files === 1 ? 'file' : 'files'}</span>
                  <span className={`${MONO} text-right text-[12.5px]`}>{p.size ?? <Unrecorded reason="Some of these files were stored before sizes were recorded.">Not recorded</Unrecorded>}</span>
                  <span>{p.noSize > 0 && <Pill tone="neutral" className="border-dashed font-medium" data-testid="usage-storage-nosize">{p.noSize} {p.noSize === 1 ? 'file' : 'files'} with no size recorded</Pill>}</span>
                </>
              )}
            </div>
          ))}
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// D700 (#1662) — A2m, the section on a phone
// ---------------------------------------------------------------------------

const phonePending = (status, what, claim, reload) => (status === 'loading'
  ? <LoadingRows lines={2} />
  : <Unreadable what={what} claim={claim} onRetry={reload} />);

/**
 * D755 §10 (#1984) — every movement of the member's top-up balance, from
 * `/ai-budget/history`: its own read, so a failure blanks only this card.
 * "Show AI runs" asks the Worker for each run's hold, release and spend too.
 * Amounts are the Worker's; nothing here adds them up.
 */
export const TOP_UPS_LIMIT = 50;
export function TopUpsCard({ history, runs = false, onToggleRuns }) {
  const rows = history.status === 'ready' ? topUpRows(history.data) : null;
  return (
    <div id="top-ups">
      <PanelCard title="Your top-ups" data-testid="usage-card-top-ups"
        aside={(
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={runs} onChange={onToggleRuns} data-testid="usage-top-ups-runs" />
            Show AI runs
          </label>
        )}
        footer={rows && history.data?.next_before ? `Showing the latest ${TOP_UPS_LIMIT}.` : null}>
        {history.status === 'loading' ? <LoadingRows lines={3} />
          : !rows ? (
            <div data-testid="usage-top-ups-unreadable">
              <Unreadable what="Your top-ups" claim="The balance above is unaffected." onRetry={history.reload} />
            </div>
          ) : !rows.length ? (
            <div className="flex flex-col items-center gap-2">
              <EmptyState size="sm" data-testid="usage-top-ups-empty" title="No top-ups yet." />
              <a href={ADD_TOKENS_PATH} className={BTN.ghost} data-testid="usage-top-ups-add">Add tokens</a>
            </div>
          ) : (
            <ul className="divide-y divide-axal-hairline dark:divide-gray-800" data-testid="usage-top-ups-rows">
              {rows.map((r) => (
                <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-2 py-2" data-testid={`usage-top-up-${r.kind}`}>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{r.label}</span>
                    <Muted>{[r.when, r.order ? `order ${r.order}` : null].filter(Boolean).join(' · ')}</Muted>
                    {r.note && r.kind !== 'pending' && <Muted className="leading-snug">{r.note}</Muted>}
                  </div>
                  <span className={`${MONO} text-sm`}>
                    {r.amount ?? <Unrecorded reason="The amount was not recorded.">Not recorded</Unrecorded>}
                    {r.kind === 'pending' && <Muted className="ml-1.5">{r.note}</Muted>}
                  </span>
                </li>
              ))}
            </ul>
          )}
      </PanelCard>
    </div>
  );
}

/** The Top-ups card's read and its "Show AI runs" switch. */
function useTopUps() {
  const [runs, setRuns] = useState(false);
  const history = useAccountRead(() => aiBudgetApi.history({ runs, limit: TOP_UPS_LIMIT }));
  const onToggleRuns = () => { setRuns((r) => !r); history.reload(); };
  return { history, runs, onToggleRuns };
}

/** A2m's AI allowance rows: the state lines first, then the periods, holds and balance. */
export function allowanceGroup({ budget, product, now = new Date() }) {
  const v = budget.status === 'ready' ? allowanceView(budget.data, now) : null;
  const group = { label: ACCOUNT_PHONE_PAGES.usage.sections[0], rows: [], testid: 'usage-phone-allowance' };
  if (!v) return { ...group, note: phonePending(budget.status, 'Your allowance', 'The other sections still load.', budget.reload) };
  const topUp = product.status === 'ready' ? topUpState(product.data) : product.status === 'loading' ? 'loading' : 'unreadable';
  // A paused or used-up allowance still says so, above the figures.
  for (const k of v.states) {
    const c = STATE_COPY[k];
    group.rows.push({ key: k, title: c.t, description: c.d(v, topUp === 'unavailable'), testid: `usage-state-${k}`, pill: k === 'paused' ? { label: 'Paused', tone: 'danger' } : null });
  }
  if (!v.noAllowance) {
    const period = (title, p, reason) => (p
      ? { title, description: p.reset, value: `${p.used} of ${p.of}`, bar: p.pct }
      : { title, description: reason, notRecorded: true, notRecordedReason: reason });
    group.rows.push(period('Today', v.today, `The plan sets no daily allowance. ${pastAllowanceLine(topUp === 'unavailable')}`));
    group.rows.push(period('This month', v.month, `The plan sets no monthly allowance. ${pastAllowanceLine(topUp === 'unavailable')}`));
  }
  group.rows.push({ title: ACCOUNT_PHONE_COPY.heldTitle, description: ACCOUNT_PHONE_COPY.heldDescription, value: v.held });
  group.rows.push({ title: ACCOUNT_PHONE_COPY.topUpTitle, description: ACCOUNT_PHONE_COPY.topUpDescription, value: v.balance });
  const purchase = product.status === 'ready' ? purchaseLine(product.data?.latest, now.getTime()) : null;
  if (purchase) {
    group.rows.push({ key: 'latest-top-up', title: 'Your latest top-up', description: purchase.text, testid: `usage-topup-${purchase.state}`,
      ...(purchase.help ? { href: '/help', chevron: true } : {}) });
  }
  if (topUp === 'available') group.cta = { label: ACCOUNT_PHONE_COPY.addTokens, href: ADD_TOKENS_PATH, testid: 'usage-add-tokens' };
  else if (topUp === 'unavailable') group.note = <span data-testid="usage-topup-unavailable">{TOPUP_UNAVAILABLE_RUNS}</span>;
  else if (topUp === 'unreadable') group.note = <Unreadable what="The top-up option" claim="Your balance above is unaffected." onRetry={product.reload} />;
  return group;
}

/** A2m's Models rows: runs and tokens from the run log, and the estimated cost. */
export function modelsGroup({ spend, rates }) {
  const group = { label: ACCOUNT_PHONE_PAGES.usage.sections[1], rows: [], testid: 'usage-phone-models' };
  const st = spendFor(spend, 'by_model_recorded');
  if (st !== 'ready') return { ...group, note: phonePending(st, 'Models', 'This is not a claim that you ran nothing.', spend.reload) };
  const rows = modelRows(spend.data.by_model, rates.status === 'ready' ? rates.data : null);
  if (!rows || !rows.length) return { ...group, note: 'No AI runs yet this month.' };
  // A direction the log did not count says so, never 0.
  const tok = (t) => (t ? t.short : NOT_COUNTED);
  group.rows = rows.map((m) => ({
    key: m.id,
    title: m.name,
    description: `${m.runs} ${m.runs === 1 ? 'run' : 'runs'} · ${tok(m.tin)} in · ${tok(m.tout)} out`,
    value: m.cost,
    testid: 'usage-phone-model',
  }));
  group.note = ACCOUNT_PHONE_COPY.modelsNote;
  return group;
}

/** A2m's Storage rows: every counted file, and those with no size recorded. */
export function storageGroup({ storage }) {
  const group = { label: ACCOUNT_PHONE_PAGES.usage.sections[2], rows: [], testid: 'usage-phone-storage' };
  const v = storage.status === 'ready' ? storageView(storage.data) : null;
  if (!v) return { ...group, note: phonePending(storage.status, 'Storage', 'This is not a claim that you stored nothing.', storage.reload) };
  const reason = v.anyUnreadable ? 'A place where files are kept could not be read.' : 'Some files were stored before sizes were recorded.';
  const total = v.total != null && v.files != null;
  group.rows.push({
    title: ACCOUNT_PHONE_COPY.allFiles,
    description: STORAGE_AREAS.map(([, label]) => label).join(', '),
    ...(total ? { value: `${v.total} · ${v.files}` } : { notRecorded: true, notRecordedReason: reason }),
    testid: 'usage-phone-all-files',
  });
  if (v.noSize > 0) {
    group.rows.push({ title: ACCOUNT_PHONE_COPY.noSizeFiles, value: `${v.noSize} ${v.noSize === 1 ? 'file' : 'files'}`, testid: 'usage-phone-nosize' });
  }
  group.note = 'Other files you keep on StudioOS are not counted yet. No plan sets a storage limit.';
  return group;
}

/**
 * A2m — Usage on a phone, given the section's five reads. The board's three
 * sections come first; the cards it does not draw follow as they stack today
 * (D700 decision 9). No read takes a company.
 */
export function UsagePhoneView({ budget, product, topUps, spend, rates, storage, now = new Date(), details = false }) {
  const page = ACCOUNT_PHONE_PAGES.usage;
  return (
    <div className="flex flex-col gap-3" data-testid="usage-section" data-phone="true">
      <div className="-mx-[22px]">
        {!details && <PhoneBar back={{ label: 'Back' }} title={page.title} sub={page.sub} eadwynLabel={page.title} />}
        <div className="pt-[18px]">
          <PhoneRows groups={[allowanceGroup({ budget, product, now }), modelsGroup({ spend, rates }), storageGroup({ storage })]} />
        </div>
      </div>
      {topUps && <TopUpsCard {...topUps} />}
      <DaysCard spend={spend} />
      <WhereCard spend={spend} />
      <RatesCard rates={rates} />
      <LastRunCard spend={spend} rates={rates} />
    </div>
  );
}

/** The section: the five reads, and the six cards in the canvas's order. */
export default function UsageSection({ role, details = false }) {
  const budget = useAccountRead(() => aiBudgetApi.mine());
  const product = useAccountRead(() => aiBudgetApi.topUp());
  const spend = useAccountRead(() => api.myAiSpend());
  const rates = useAccountRead(() => aiBudgetApi.rates());
  const storage = useAccountRead(() => usageApi.storage());
  const topUps = useTopUps();
  // The canvas's anchors (#days, #where, #models, #last-run, #storage). Each
  // card draws its anchor in every state, so the scroll lands while it loads.
  const { hash } = useLocation();
  useEffect(() => {
    const id = hash ? decodeURIComponent(hash.slice(1)) : '';
    if (id) document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
  }, [hash]);
  const phone = usePhoneWidth();
  if (phone) return <UsagePhoneView budget={budget} product={product} topUps={topUps} spend={spend} rates={rates} storage={storage} details={details} />;
  return (
    <div className="flex flex-col gap-3" data-testid="usage-section">
      {!details && <div>
        <h2 className="text-lg font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">Usage</h2>
        <p className="text-[13px] text-axal-muted dark:text-gray-400">What you have used across all your companies.</p>
      </div>}
      <AllowanceCard budget={budget} product={product} />
      <TopUpsCard {...topUps} />
      <DaysCard spend={spend} />
      <WhereCard spend={spend} />
      <ModelsCard spend={spend} rates={rates} />
      <LastRunCard spend={spend} rates={rates} />
      <StorageCard storage={storage} role={role} />
    </div>
  );
}
