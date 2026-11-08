import React from 'react';
import { Link } from 'react-router-dom';
import { Figure, When, Why, BTN } from './RevenueStates.jsx';
import {
  LEDGER_FIGURES, currencyPosition, isReady, pendingState, summaryCurrencies, summaryTemporal, tokenMarginView,
} from './revenueModel.js';

/**
 * D5039 (canvas RV01, RV02, RV14b) — the first viewport: the financial
 * position, then what needs attention.
 *
 * DEPARTURE FROM THE CANVAS, ON PURPOSE. RV01 draws Invoiced, Collected,
 * Outstanding and Overdue per currency with sample figures. No ledger backs
 * them yet, so they are drawn once, as Not recorded, with the reason in the
 * coverage drawer — four tiles of "Not recorded" repeated under every currency
 * would say the same nothing several times. The figures that ARE read come per
 * native currency underneath: the contracted run-rate, refunds and open
 * disputes. Nothing is converted and nothing is summed across currencies.
 */

function Kpi({ label, figure, when, note, why, onWhy, attention = false, testId }) {
  return (
    <div
      className={`flex min-w-0 flex-col items-start gap-1.5 rounded-xl border bg-white p-3.5 dark:bg-gray-900 ${attention ? 'border-amber-300 shadow-[inset_3px_0_0_#d97706] dark:border-amber-800' : 'border-axal-hairline dark:border-gray-700'}`}
      data-testid={testId}
    >
      <span className="font-mono text-[12px] font-bold uppercase tracking-[.05em] text-axal-muted dark:text-gray-400">{label}</span>
      <Figure figure={figure} large />
      <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-axal-muted dark:text-gray-400">
        {when}
        {note && <span>{note}</span>}
        {why && <Why source={why} onOpen={onWhy} />}
      </span>
    </div>
  );
}

const GRID = 'grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6';

export function ExecutiveSummary({ summary, refunds, disputes, period, onWhy, onRetrySummary, onRetryRefunds, onRetryDisputes }) {
  const currencies = summaryCurrencies({ summary, refunds, disputes });
  const token = isReady(summary) ? summary.token_cost : null;
  const v = tokenMarginView(token);
  const marginFigure = !isReady(summary)
    ? { state: pendingState(summary), text: null }
    : (v.state === 'ok'
      // Partial: some runs settled before the charge ledger and sit outside the margin, so the mark says so.
      ? { state: v.partial ? 'incomplete' : (v.tone === 'zero' ? 'zero' : 'recorded'), text: v.margin }
      : { state: v.state === 'predates' ? 'not_recorded' : 'unavailable', text: null });
  const anyLoading = !isReady(summary) || !isReady(refunds) || !isReady(disputes);
  const feesWhen = <When kind={summaryTemporal(summary, 'licence_fees')} period={period} />;

  return (
    <section aria-labelledby="hq-revenue-position-h" className="flex flex-col gap-3" data-testid="hq-revenue-summary">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="hq-revenue-position-h" className="text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Financial position</h2>
        <span className="text-[12.5px] text-axal-muted dark:text-gray-400">Native currency only · no FX conversion · currencies are never added together</span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="hq-revenue-ledger-tiles">
        {LEDGER_FIGURES.map((label) => (
          <Kpi
            key={label}
            label={label}
            figure={{ state: 'not_recorded', text: null }}
            when={<When kind={label === 'Outstanding' || label === 'Overdue' ? 'now' : 'period'} period={period} />}
            note="No ledger yet"
            why="ledger"
            onWhy={onWhy}
          />
        ))}
      </div>

      {currencies.map((cur) => {
        const p = currencyPosition(cur, { summary, refunds, disputes });
        return (
          <div key={cur} className="flex flex-col gap-2" data-testid={`hq-revenue-position-${cur}`}>
            <div className="font-mono text-[12px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">{cur}</div>
            <div className={GRID}>
              <div className="col-span-2">
                <Kpi
                  label="Contracted run-rate"
                  figure={p.runRate}
                  when={feesWhen}
                  note={Number.isFinite(p.runRate.licences) ? `¼ of ${p.runRate.licences} active annual ${p.runRate.licences === 1 ? 'fee' : 'fees'} · not invoiced` : null}
                  why="licence_fees"
                  onWhy={onWhy}
                />
              </div>
              <div className="col-span-2">
                <Kpi
                  label="Refunds"
                  figure={p.refund}
                  when={<When kind="d30" />}
                  note={Number.isFinite(p.refund.count) ? `${p.refund.count} through HQ` : null}
                  why={p.refund.state === 'unavailable' ? 'refunds' : null}
                  onWhy={onWhy}
                />
              </div>
              <div className="col-span-2">
                <Kpi
                  label="Open disputes"
                  figure={p.dispute}
                  when={<When kind="live" />}
                  note={p.dispute.atRisk ? `${p.dispute.atRisk} at risk` : null}
                  attention={p.dispute.state === 'recorded'}
                  why={p.dispute.state === 'unavailable' ? 'disputes' : null}
                  onWhy={onWhy}
                />
              </div>
            </div>
          </div>
        );
      })}
      {!currencies.length && !anyLoading && (
        <p className="text-[13px] text-axal-muted dark:text-gray-400" data-testid="hq-revenue-no-currency">
          No active licence fee, refund or open dispute in any currency.
        </p>
      )}
      {!currencies.length && anyLoading && (
        <div className={GRID}>
          {['Contracted run-rate', 'Refunds', 'Open disputes'].map((l) => (
            <div key={l} className="col-span-2"><Kpi label={l} figure={{ state: 'loading', text: null }} /></div>
          ))}
        </div>
      )}
      {/* A failed read keeps its own Retry; the tiles above say Unavailable, never 0. */}
      <div className="flex flex-wrap gap-2">
        {summary !== null && !isReady(summary) && <button type="button" className={BTN} onClick={onRetrySummary}>Retry the revenue summary</button>}
        {refunds !== null && !isReady(refunds) && <button type="button" className={BTN} onClick={onRetryRefunds}>Retry refunds</button>}
        {disputes !== null && !isReady(disputes) && <button type="button" className={BTN} onClick={onRetryDisputes}>Retry disputes</button>}
      </div>

      <div className="flex flex-col gap-2">
        <div className="font-mono text-[12px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">Streams without a full ledger</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Kpi label="Subscription revenue" figure={isReady(summary) ? { state: 'not_recorded', text: null } : { state: pendingState(summary), text: null }} when={<When kind="period" period={period} />} note="No local subscription ledger" why="subscriptions" onWhy={onWhy} />
          <Kpi label="AI margin · USD" figure={marginFigure} when={<When kind="period" period={period} />} note={v.cost ? `cost ${v.cost}` : null} why="ai_margin" onWhy={onWhy} />
        </div>
      </div>
    </section>
  );
}

const SEV = {
  critical: { word: 'Critical', glyph: '■', cls: 'text-red-700 dark:text-red-300' },
  warning: { word: 'Warning', glyph: '▲', cls: 'text-amber-800 dark:text-amber-300' },
  info: { word: 'Info', glyph: 'i', cls: 'text-axal-muted dark:text-gray-400' },
};

/**
 * Needs attention — only items the reads can truly show, most urgent first.
 * Drawn only when there is one: an empty queue is no section at all.
 */
export function NeedsAttention({ items, onStatement }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="hq-revenue-attention-h" className="rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900 sm:p-5" data-testid="hq-revenue-attention">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="hq-revenue-attention-h" className="text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Needs attention</h2>
        <span className="font-mono text-[12.5px] text-axal-muted dark:text-gray-400">{items.length} · most urgent first</span>
      </div>
      <ol className="divide-y divide-axal-hairline dark:divide-gray-800">
        {items.map((a) => {
          const sev = SEV[a.severity];
          const btn = `${BTN} ${a.severity === 'critical' ? 'border-axal-ink bg-axal-ink text-white hover:bg-black dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white' : ''}`;
          return (
            <li key={a.key} className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[96px_minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4" data-severity={a.severity}>
              <span className={`font-mono text-[12px] font-extrabold uppercase tracking-[.05em] ${sev.cls}`}><span aria-hidden="true">{sev.glyph} </span>{sev.word}</span>
              <div className="min-w-0">
                <b className="block text-[14px] text-axal-ink dark:text-gray-100">{a.title}</b>
                <span className="block text-[13px] text-axal-muted dark:text-gray-400">{a.detail}</span>
              </div>
              <span className="font-mono text-[13px] font-bold tabular-nums text-axal-ink dark:text-gray-100">{a.amount || ''}</span>
              {a.action.kind === 'link' && <Link to={a.action.to} className={btn}>{a.action.label}</Link>}
              {a.action.kind === 'anchor' && <a href={a.action.href} className={btn}>{a.action.label}</a>}
              {a.action.kind === 'statement' && <button type="button" className={btn} onClick={() => onStatement?.(a.action.uid)}>{a.action.label}</button>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
