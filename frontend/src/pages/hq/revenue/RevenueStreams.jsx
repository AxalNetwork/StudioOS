import React from 'react';
import {
  CoverageMark, Figure, Section, When, Why, TABLE, TD, TH, NUM,
} from './RevenueStates.jsx';
import {
  TREND_REASON, UNRECORDED_CURRENCY, finite, isReady, moneyFigure, pendingState, periodLabel, statementTotals,
  summaryTemporal, tokenMarginView,
} from './revenueModel.js';

/**
 * D5039 (canvas RV04, RV04b, RV07) — Revenue streams, the trend and AI
 * economics.
 *
 * STREAMS. Contracted, invoiced and collected are kept apart. The licence row
 * is a contracted run-rate (a quarter of each active annual fee, D5039's
 * relabel) and never "collected"; its invoiced and collected cells are Not
 * recorded until a ledger backs them. Revenue-share statements are HQ's
 * intercompany claims for the period: owed and paid as HQ recorded them, not
 * recognised revenue. A Coverage column replaces the old Read column, and its
 * one explanation is in the coverage drawer. No total row: the only figures
 * per currency are of different kinds (a run-rate and a claim), and adding them
 * would be a number nobody can use.
 *
 * TREND. No monthly series is recorded, so nothing is drawn, not a line of
 * zeros: the honest state, with its reason once, in the drawer.
 */

const na = <span className="text-axal-muted dark:text-gray-400">n/a</span>;

export function RevenueStreams({ summary, periodStatements, period, onWhy }) {
  const ready = isReady(summary);
  const fees = ready ? summary.licence_fees : null;
  const token = ready ? summary.token_cost : null;
  const tokenView = tokenMarginView(token);
  const totals = statementTotals(periodStatements);
  const pending = { state: pendingState(summary), text: null };
  const nr = <Figure figure={{ state: 'not_recorded', text: null }} />;

  return (
    <Section
      id="revenue-streams"
      title="Revenue streams"
      when={<When kind="period" period={period} />}
      sub="Contracted, invoiced and collected kept apart · native currency"
      testId="hq-revenue-streams-section"
    >
      <div className="relative overflow-x-auto">
        <table className={TABLE}>
          <caption className="sr-only">Revenue by stream, {periodLabel(period)}, native currency</caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>Stream</th>
              <th scope="col" className={`${TH} ${NUM}`}>Contracted run-rate</th>
              <th scope="col" className={`${TH} ${NUM}`}>Invoiced</th>
              <th scope="col" className={`${TH} ${NUM}`}>Collected</th>
              <th scope="col" className={`${TH} ${NUM}`}>Cost</th>
              <th scope="col" className={`${TH} ${NUM}`}>Margin</th>
              <th scope="col" className={TH}>Coverage</th>
            </tr>
          </thead>
          <tbody data-testid="hq-revenue-streams">
            {!ready && (
              <tr><td className={TD}><b>Licence fees</b></td><td className={`${TD} ${NUM}`}><Figure figure={pending} /></td><td className={TD} colSpan={4} /><td className={TD}><CoverageMark state={pending.state} /></td></tr>
            )}
            {ready && !fees?.available && (
              <tr>
                <td className={TD}><b>Licence fees</b></td>
                <td className={`${TD} ${NUM}`}><Figure figure={{ state: 'unavailable', text: null }} /></td>
                <td className={`${TD} ${NUM}`}>{nr}</td><td className={`${TD} ${NUM}`}>{nr}</td>
                <td className={`${TD} ${NUM}`}>{na}</td><td className={`${TD} ${NUM}`}>{na}</td>
                <td className={TD}><CoverageMark state="unavailable" /> <Why source="licence_fees" onOpen={onWhy} /></td>
              </tr>
            )}
            {ready && fees?.available && fees.by_currency.map((row) => (
              <tr key={row.currency}>
                <td className={TD}>
                  <b>Licence fees · {row.currency}</b>
                  <small className="block text-[12.5px] text-axal-muted dark:text-gray-400">{row.licences} active licence{row.licences === 1 ? '' : 's'} · <When kind={summaryTemporal(summary, 'licence_fees')} period={period} /></small>
                </td>
                <td className={`${TD} ${NUM}`}><Figure figure={moneyFigure(row.quarter_cents, row.currency, { incomplete: finite(fees.active_without_fee) > 0 })} /></td>
                <td className={`${TD} ${NUM}`}>{nr}</td>
                <td className={`${TD} ${NUM}`}>{nr}</td>
                <td className={`${TD} ${NUM}`}><span className="text-axal-muted dark:text-gray-400">No cost of goods</span></td>
                <td className={`${TD} ${NUM}`}>{na}</td>
                <td className={TD}><CoverageMark state="partial" label="Run-rate only" /> <Why source="licence_fees" onOpen={onWhy} /></td>
              </tr>
            ))}
            {ready && fees?.available && !fees.by_currency.length && (
              <tr><td className={TD}><b>Licence fees</b></td><td className={`${TD} ${NUM}`} colSpan={5}><Figure figure={{ state: 'zero', text: null }} absentLabel="No active licence fee" /></td><td className={TD}><CoverageMark state="complete" /></td></tr>
            )}

            {totals === null && (
              <tr>
                <td className={TD}><b>Revenue-share statements</b></td>
                <td className={`${TD} ${NUM}`}>{na}</td>
                <td className={`${TD} ${NUM}`} colSpan={2}><Figure figure={{ state: pendingState(periodStatements), text: null }} /></td>
                <td className={`${TD} ${NUM}`}>{na}</td><td className={`${TD} ${NUM}`}>{na}</td>
                <td className={TD}><CoverageMark state={pendingState(periodStatements)} /> <Why source="statements" onOpen={onWhy} /></td>
              </tr>
            )}
            {totals && totals.map((t) => (
              <tr key={`st:${t.currency}`}>
                <td className={TD}>
                  <b>Revenue-share statements · {t.currency === UNRECORDED_CURRENCY ? 'currency not recorded' : t.currency}</b>
                  <small className="block text-[12.5px] text-axal-muted dark:text-gray-400">{t.count} drawn · intercompany claims, not recognised revenue</small>
                </td>
                <td className={`${TD} ${NUM}`}>{na}</td>
                <td className={`${TD} ${NUM}`}>
                  <Figure figure={moneyFigure(t.owed, t.currency === UNRECORDED_CURRENCY ? null : t.currency, { incomplete: t.floors > 0 })} />
                  <small className="block text-[12px] text-axal-muted dark:text-gray-400">owed (claim)</small>
                </td>
                <td className={`${TD} ${NUM}`}>
                  <Figure figure={moneyFigure(t.paid, t.currency === UNRECORDED_CURRENCY ? null : t.currency)} />
                  <small className="block text-[12px] text-axal-muted dark:text-gray-400">paid, recorded by HQ</small>
                </td>
                <td className={`${TD} ${NUM}`}>{na}</td><td className={`${TD} ${NUM}`}>{na}</td>
                <td className={TD}>
                  <CoverageMark state={t.floors ? 'partial' : 'complete'} label={t.floors ? `Partial · ${t.floors} ${t.floors === 1 ? 'floor' : 'floors'}` : undefined} />
                  {' '}<Why source="statements" onOpen={onWhy} />
                </td>
              </tr>
            ))}
            {totals && !totals.length && (
              <tr>
                <td className={TD}><b>Revenue-share statements</b></td>
                <td className={`${TD} ${NUM}`}>{na}</td>
                <td className={`${TD} ${NUM}`} colSpan={2}><Figure figure={{ state: 'not_recorded', text: null }} absentLabel={periodLabel(period) ? `No ${periodLabel(period)} statements yet` : 'No statements yet'} /></td>
                <td className={`${TD} ${NUM}`}>{na}</td><td className={`${TD} ${NUM}`}>{na}</td>
                <td className={TD}><CoverageMark state="not_recorded" label="Drawing held" /> <Why source="statements" onOpen={onWhy} /></td>
              </tr>
            )}

            <tr>
              <td className={TD}><b>Subscriptions</b><small className="block text-[12.5px] text-axal-muted dark:text-gray-400">Stripe · per customer only</small></td>
              <td className={`${TD} ${NUM}`}>{na}</td>
              <td className={`${TD} ${NUM}`}>{ready ? nr : <Figure figure={pending} />}</td>
              <td className={`${TD} ${NUM}`}>{ready ? nr : <Figure figure={pending} />}</td>
              <td className={`${TD} ${NUM}`}>{na}</td><td className={`${TD} ${NUM}`}>{na}</td>
              <td className={TD}><CoverageMark state={ready ? 'not_recorded' : pending.state} label={ready ? 'Missing ledger' : undefined} /> <Why source="subscriptions" onOpen={onWhy} /></td>
            </tr>

            <tr>
              <td className={TD}><b>AI / tokens</b><small className="block text-[12.5px] text-axal-muted dark:text-gray-400">USD</small></td>
              <td className={`${TD} ${NUM}`}>{na}</td>
              <td className={`${TD} ${NUM}`}>{ready ? nr : <Figure figure={pending} />}</td>
              <td className={`${TD} ${NUM}`}>{ready ? nr : <Figure figure={pending} />}</td>
              <td className={`${TD} ${NUM}`}>{ready ? (tokenView.cost ? <Figure figure={{ state: 'recorded', text: tokenView.cost }} /> : <Figure figure={{ state: 'unavailable', text: null }} />) : <Figure figure={pending} />}</td>
              <td className={`${TD} ${NUM}`}>{ready
                ? <Figure figure={tokenView.margin ? { state: 'recorded', text: tokenView.margin } : { state: tokenView.state === 'predates' ? 'not_recorded' : 'unavailable', text: null }} />
                : <Figure figure={pending} />}</td>
              <td className={TD}>
                <CoverageMark state={!ready ? pending.state : (tokenView.state === 'ok' ? (tokenView.partial ? 'partial' : 'complete') : (tokenView.state === 'predates' ? 'not_recorded' : 'unavailable'))} />
                {' '}<Why source="ai_margin" onOpen={onWhy} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {/* Never one number. Said on the page, not only in the code. */}
      <p className="mt-3 text-[12.5px] text-axal-muted dark:text-gray-400">
        Rows are not added together: each is in its own currency, and a run-rate and a claim are different kinds of figure.
      </p>
    </Section>
  );
}

/** RV04 — the trend, only where a series exists. None does yet, so this is its honest state. */
export function RevenueTrend({ period, onWhy }) {
  return (
    <Section id="revenue-trend" title="Trend" when={<When kind="period" period={period} />} testId="hq-revenue-trend">
      <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-axal-hairline p-4 dark:border-gray-700" data-testid="hq-revenue-trend-empty">
        <Figure figure={{ state: 'not_recorded', text: null }} absentLabel="No monthly series recorded" />
        <p className="text-[13px] text-axal-muted dark:text-gray-400">Nothing is drawn rather than a line of zeros. <Why source="ledger" onOpen={onWhy} /></p>
        <span className="sr-only">{TREND_REASON}</span>
      </div>
    </Section>
  );
}

/**
 * RV07 — AI economics, margin first. The margin is the headline; top-up
 * revenue, model cost, credits given, the included allowance and the call
 * count are its breakdown. One explanation for the block, in the drawer.
 * Pure over the `token_cost` payload (D5027's `tokenMarginView`).
 */
export function AiEconomics({ token, period, onWhy }) {
  const v = tokenMarginView(token);
  const marginFigure = v.state === 'ok'
    ? { state: v.partial ? 'incomplete' : (v.tone === 'zero' ? 'zero' : 'recorded'), text: v.margin }
    : { state: v.state === 'predates' ? 'not_recorded' : 'unavailable', text: null };
  const cov = v.state === 'ok' ? (v.partial ? 'partial' : 'complete') : (v.state === 'predates' ? 'not_recorded' : 'unavailable');
  const part = (text) => (text ? { state: 'recorded', text } : { state: v.state === 'ok' || v.state === 'predates' ? 'not_recorded' : 'unavailable', text: null });
  const calls = token?.available === true ? finite(token.calls) : null;
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]" data-testid="hq-revenue-token-pnl">
      <div className="flex flex-col items-start gap-2 rounded-xl border border-axal-hairline bg-axal-ground p-4 dark:border-gray-700 dark:bg-gray-950/40">
        <span className="font-mono text-[12px] font-bold uppercase tracking-[.05em] text-axal-muted dark:text-gray-400">AI margin</span>
        <span data-testid="hq-revenue-ai-margin">
          <Figure figure={marginFigure} large negative={v.tone === 'negative'} />
        </span>
        <span className="flex flex-wrap items-center gap-1.5"><CoverageMark state={cov} label={cov === 'partial' ? 'Partial coverage' : undefined} /><When kind="period" period={period} /></span>
        <p className="text-[13px] leading-relaxed text-axal-muted dark:text-gray-400">
          {v.state === 'ok' ? 'Top-up revenue, less its share of the cost, less credits HQ gave.' : v.reason}
          {' '}<Why source="ai_margin" onOpen={onWhy} label="Data coverage" />
        </p>
      </div>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 text-[13.5px]">
        {[
          ['Top-up revenue', part(v.topupSpend)],
          ['Cost of that top-up use', part(v.topupCost)],
          ['Model and inference cost', v.cost ? { state: 'recorded', text: v.cost } : { state: 'unavailable', text: null }],
          ['Credits given', part(v.given)],
          ['Included allowance used', part(v.included)],
          ['Calls', calls === null ? { state: 'unavailable', text: null } : { state: calls ? 'recorded' : 'zero', text: calls.toLocaleString() }],
        ].map(([label, f]) => (
          <React.Fragment key={label}>
            <dt className="border-b border-axal-hairline py-2 text-axal-muted dark:border-gray-800 dark:text-gray-400">{label}</dt>
            <dd className="border-b border-axal-hairline py-2 text-right dark:border-gray-800"><Figure figure={f} /></dd>
          </React.Fragment>
        ))}
      </dl>
      {v.coverage && <p className="text-[12.5px] text-axal-muted dark:text-gray-400 md:col-span-2" data-testid="hq-revenue-token-coverage">{v.coverage}. Admin-licence runs are left out; included allowance is not revenue here.</p>}
    </div>
  );
}

/** D5027's name for the block, kept so its tests and callers read one component. */
export const TokenPnl = AiEconomics;

export function AiEconomicsSection({ summary, period, onWhy }) {
  const token = isReady(summary) ? summary.token_cost : null;
  return (
    <Section id="revenue-ai" title="AI economics" when={<When kind="period" period={period} />} sub="USD · platform-wide; not attributed to a licence" testId="hq-revenue-ai-section">
      {isReady(summary)
        ? <TokenPnl token={token} period={period} onWhy={onWhy} />
        : <Figure figure={{ state: pendingState(summary), text: null }} />}
    </Section>
  );
}
