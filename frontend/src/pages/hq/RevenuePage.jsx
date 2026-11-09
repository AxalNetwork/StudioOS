/**
 * HQ · Revenue v2 — the read-only cockpit (D5039, #5039 part 1), drawn to
 * `design/incoming/Revenue v2 Page.dc.html` (boards RV01 to RV15).
 *
 * This file is the page: it makes the reads, keeps the Period and Scope, and
 * lays out the parts. Each part is a file in `./revenue/` (see its README),
 * and the rules they draw by are pure in `./revenue/revenueModel.js`.
 *
 * SEVEN READS, EACH ITS OWN FAILURE. The summary (D1: licence fees, token cost
 * and margin, promotion codes, branch report coverage), the statement ledger
 * twice (every statement, for receivables, which are point in time; and the
 * selected period's, for streams and subsidiaries), open disputes (Stripe),
 * refunds HQ issued (audit rows), the promo ceilings, and the licence list the
 * ceiling editor offers. Stripe being slow costs the dispute figures and
 * nothing else; a failed read says Unavailable with Retry, never 0.
 *
 * THE PERIOD. `?period=` on the summary (D5039): period figures follow it;
 * point-in-time figures (the run-rate, receivables, promotion codes), live
 * ones (disputes) and rolling ones (refunds) say so with their own label.
 *
 * NO CROSS-CURRENCY TOTAL. The cockpit tiles for Invoiced, Collected,
 * Outstanding and Overdue stay Not recorded until a reconciled revenue ledger
 * exists (the reason is in the Data coverage drawer). The licence-fee invoice
 * ledger is a separate zone (D5036): invoiced, collected, outstanding and
 * overdue for licence invoices, per currency, never summed.
 *
 * WRITES, AS TODAY. The statement entry (D453/D458/D514) and the ceiling editor
 * (D228) are today's controls. A refund is reviewed before money moves (D5037,
 * `RefundReviewFlow`). The licence list is still read whole, and only for the
 * ceiling editor's picker.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { licenceLedgerApi } from '../../lib/api/licenceLedger';
import { reportError } from '../../lib/log';
import { RailFrame, WorkerRail, Unreadable, Unrecorded } from '../../ui';
import RefundReviewFlow from '../../components/RefundReviewFlow.jsx';
import HeaderAsk from '../../ui/HeaderAsk.jsx';
import { RevenueHeader, DataCoverageDrawer } from './revenue/RevenueHeader';
import { ExecutiveSummary, NeedsAttention } from './revenue/ExecutiveSummary';
import { AiEconomicsSection, RevenueStreams, RevenueTrend } from './revenue/RevenueStreams';
import { ReceivablesSection, StatementDrawer } from './revenue/Receivables';
import { SubsidiariesSection } from './revenue/Subsidiaries';
import { BillingExceptions } from './revenue/BillingExceptions';
import { PromotionsSection } from './revenue/Promotions';
import {
  UNAVAILABLE, attentionItems, coverageSources, isReady, money, periodLabel, periodOptions,
} from './revenue/revenueModel.js';

// The parts' exports, from the page as they always were, so callers and tests read one module.
export {
  UNAVAILABLE, UNRECORDED_CURRENCY, money, isOpenDispute, evidenceOverdue, ceilingFacts, tokenMarginView,
  statementAllowsPaidInFull, STATEMENT_DRAW_HELD,
} from './revenue/revenueModel.js';
export { BillingExceptions, refundAmountShape } from './revenue/BillingExceptions';
export {
  STATEMENT_PERIOD_RE, statementDrawPayload, statementPaidPayload, statementVoidPayload, statementDisputePayload,
  statementAllowsIssue, licencesDrawableForStatements, floorsInCurrency, StatementFacts, StatementActions,
} from './revenue/StatementActions';
export { StatementDrawHeld } from './revenue/Receivables';
export { ceilingPayload, CEILING_ENFORCEMENT, CeilingEditor } from './revenue/Promotions';
export { TokenPnl } from './revenue/RevenueStreams';

function Stat({ label, value, note, tone = 'text-axal-ink' }) {
  return (
    <div className="rounded-xl border border-axal-hairline bg-axal-ground p-3">
      <div className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{label}</div>
      <div className={`mt-1 text-lg font-extrabold tracking-tight tabular-nums ${tone}`}>{value ?? <Unrecorded />}</div>
      {note && <div className="mt-0.5 text-[10px] text-axal-faint">{note}</div>}
    </div>
  );
}

/**
 * D5036 — the quarters the page offers: the current one and the `count - 1` before it, newest first, as YYYY-Qn.
 * Never a future quarter: the Worker refuses one, because nothing has been invoiced in it.
 */
export function recentQuarters(now, count = 8) {
  const out = [];
  let y = now.getUTCFullYear();
  let q = Math.floor(now.getUTCMonth() / 3) + 1;
  for (let i = 0; i < count; i += 1) {
    out.push(`${y}-Q${q}`);
    q -= 1;
    if (q === 0) { q = 4; y -= 1; }
  }
  return out;
}

/** The reason a billable licence cannot be invoiced, as the page says it. */
export const CANNOT_INVOICE = Object.freeze({
  no_annual_fee: 'records no annual fee',
  no_start_date: 'records no start date, so its licence year cannot be told',
});

/**
 * D5036 — licence fees as the invoice ledger records them. Pure over `licence_invoices` (null while loading), so a
 * test draws every state. Four concepts, never one: the run-rate is in "By stream"; here are invoiced, collected and
 * outstanding for the invoices issued in the period, the receivable as at today with its overdue part listed, void
 * invoices apart, and the billable years nobody invoiced. One row per currency, never summed across them.
 */
export function LicenceInvoices({ invoices, onRetry }) {
  if (!invoices) return <p className="text-[12px] text-axal-faint">Loading the invoice ledger…</p>;
  if (invoices.available !== true) {
    return (
      <div data-testid="hq-revenue-invoices-unreadable">
        <Unreadable what="The licence-fee invoice ledger" claim="This is not a claim that nothing was invoiced or that nothing is owed." onRetry={onRetry} />
      </div>
    );
  }
  const th = 'py-1.5 pr-3';
  const head = 'border-b border-axal-hairline text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint';
  const gaps = invoices.expected_not_invoiced || [];
  const cannot = invoices.cannot_invoice || [];
  const overdue = invoices.overdue || [];
  return (
    <div data-testid="hq-revenue-invoices">
      {invoices.by_currency.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-axal-muted" data-testid="hq-revenue-invoices-none">
          No licence-fee invoice was issued in {invoices.period?.label}. That is a fact of the ledger, not a reading of zero revenue: the run-rate above is what the terms would bring in.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className={head}>
                <th className={th}>Currency</th>
                <th className={th}>Invoiced</th>
                <th className={th}>Collected</th>
                <th className={th}>Outstanding</th>
                <th className={th}>Overdue</th>
                <th className="py-1.5">Void</th>
              </tr>
            </thead>
            <tbody data-testid="hq-revenue-invoices-period">
              {invoices.by_currency.map((b) => (
                <tr key={b.currency} className="border-b border-axal-hairline/60">
                  <td className="py-2 pr-3 font-medium">{b.currency}</td>
                  <td className="py-2 pr-3 tabular-nums">{money(b.invoiced_cents, b.currency)}<div className="text-[10.5px] text-axal-faint">{b.invoices} {b.invoices === 1 ? 'invoice' : 'invoices'}</div></td>
                  <td className="py-2 pr-3 tabular-nums">{money(b.collected_cents, b.currency)}</td>
                  <td className="py-2 pr-3 tabular-nums">{money(b.outstanding_cents, b.currency)}</td>
                  <td className={`py-2 pr-3 tabular-nums ${b.overdue_invoices ? 'text-red-700 dark:text-red-300' : ''}`}>
                    {b.overdue_invoices ? `${money(b.overdue_cents, b.currency)} · ${b.overdue_invoices}` : 'None'}
                  </td>
                  <td className="py-2 tabular-nums text-axal-faint">{b.void_invoices ? `${b.void_invoices} · ${money(b.void_cents, b.currency)}, in no other figure` : 'None'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="hq-revenue-receivable">
        {invoices.receivable_by_currency.length === 0
          ? <Stat label="Receivable today" value="None" note="no open licence-fee invoice, in any period" />
          : invoices.receivable_by_currency.map((b) => (
            <Stat
              key={b.currency}
              label={`Receivable today · ${b.currency}`}
              value={money(b.outstanding_cents, b.currency)}
              tone={b.overdue_invoices ? 'text-red-700 dark:text-red-300' : 'text-axal-ink'}
              note={`${b.open_invoices} open${b.overdue_invoices ? ` · ${money(b.overdue_cents, b.currency)} overdue on ${b.overdue_invoices}` : ' · none overdue'}`}
            />
          ))}
      </div>

      {overdue.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <div className="text-[11px] font-extrabold uppercase tracking-[.08em] text-red-700 dark:text-red-300">Overdue · {invoices.overdue_total}</div>
          <table className="mt-1 w-full text-left text-[12px]">
            <thead>
              <tr className={head}>
                <th className={th}>Licence</th>
                <th className={th}>Invoice</th>
                <th className={th}>Due</th>
                <th className="py-1.5">Outstanding</th>
              </tr>
            </thead>
            <tbody data-testid="hq-revenue-invoices-overdue">
              {overdue.map((o) => (
                <tr key={o.uid} className="border-b border-axal-hairline/60">
                  <td className="py-2 pr-3 font-medium">{o.brand_name || o.licence_ref || o.licence_uid}</td>
                  <td className="py-2 pr-3 text-axal-muted">{o.reference} · {o.period_label}</td>
                  <td className="py-2 pr-3 tabular-nums">{o.due_at} · {o.days_overdue} {o.days_overdue === 1 ? 'day' : 'days'} late</td>
                  <td className="py-2 tabular-nums">{money(o.outstanding_cents, o.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {invoices.overdue_total > overdue.length && (
            <p className="mt-1 text-[10.5px] text-axal-faint">The {overdue.length} longest overdue are listed; the totals above count all {invoices.overdue_total}.</p>
          )}
        </div>
      )}

      {(gaps.length > 0 || cannot.length > 0) && (
        <div className="mt-3 rounded-xl border border-amber-300 p-2.5 dark:border-amber-500/40" data-testid="hq-revenue-invoice-gaps">
          <div className="text-[11px] font-extrabold uppercase tracking-[.08em] text-amber-800 dark:text-amber-300">Expected, not invoiced</div>
          <ul className="mt-1 space-y-0.5 text-[11.5px] leading-relaxed text-axal-muted">
            {gaps.map((g) => (
              <li key={`${g.licence_uid}:${g.period_start}`}>
                {g.brand_name || g.licence_ref} · {g.period_label} · {money(g.amount_cents, g.currency)}
                {g.gap === 'void_not_reissued' ? ' — its only invoice for this year is void, and a year is invoiced once' : ' — the licence year has started and no invoice is issued'}
                {g.status === 'suspended' ? ' (suspended, still billable)' : ''}
              </li>
            ))}
            {cannot.map((x) => (
              <li key={`cannot:${x.licence_uid}`}>{x.brand_name || x.licence_ref} — cannot be invoiced: it {CANNOT_INVOICE[x.reason] || x.reason}.</li>
            ))}
          </ul>
        </div>
      )}

      <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[10.5px] leading-relaxed text-axal-faint">
        <li>{invoices.basis?.invoiced}</li>
        <li>{invoices.basis?.collected}</li>
        <li>{invoices.basis?.receivable}</li>
        <li>{invoices.basis?.void}</li>
        <li>One row per currency; nothing is added across currencies.</li>
      </ul>
    </div>
  );
}

export default function RevenuePage() {
  const [period, setPeriod] = useState(null);       // null until the first summary names the current quarter
  const [scope, setScope] = useState(null);         // a licence uid, or null for all subsidiaries
  const [data, setData] = useState(null);            // null = loading, UNAVAILABLE = failed
  // Disputes load separately on purpose: they are the one figure that comes
  // from Stripe, and folding them into the summary would mean an outage
  // there blanked four zones that read D1 perfectly well.
  const [disputes, setDisputes] = useState(null);
  // Statements and ceilings load separately for the same reason, and because
  // they have writes behind them, so they re-read after an edit without
  // re-fetching the summary.
  const [statements, setStatements] = useState(null);
  const [periodStatements, setPeriodStatements] = useState(null);
  const [ceilings, setCeilings] = useState(null);
  // H21 (D224) — the refunds HQ issued, from their audit rows. Its own read.
  const [refunds, setRefunds] = useState(null);
  // D228 — the licences the ceiling editor offers. Its own read.
  const [licences, setLicences] = useState(null);
  // The drawers: the coverage source to open at (`''` for the top), and the open statement.
  const [coverageAt, setCoverageAt] = useState(null);
  const [statementUid, setStatementUid] = useState(null);

  const load = useCallback((p) => {
    setData(null);
    api.hqRevenue(p || undefined).then((r) => {
      setData(r);
      setPeriod((cur) => cur || r?.quarter?.key || r?.current_period || null);
    }, (e) => { reportError('hq-revenue', e); setData(UNAVAILABLE); });
  }, []);
  const loadDisputes = useCallback(() => {
    setDisputes(null);
    api.adminBillingListDisputes(100).then(setDisputes, (e) => {
      reportError('hq-revenue-disputes', e);
      setDisputes(UNAVAILABLE);
    });
  }, []);
  const loadStatements = useCallback(() => {
    setStatements(null);
    api.statements().then(setStatements, (e) => {
      reportError('hq-revenue-statements', e);
      setStatements(UNAVAILABLE);
    });
  }, []);
  const loadPeriodStatements = useCallback((p) => {
    if (!p) return;
    setPeriodStatements(null);
    api.statements(p).then(setPeriodStatements, (e) => {
      reportError('hq-revenue-statements-period', e);
      setPeriodStatements(UNAVAILABLE);
    });
  }, []);
  const loadCeilings = useCallback(() => {
    setCeilings(null);
    api.promoCeilings().then(setCeilings, (e) => {
      reportError('hq-revenue-ceilings', e);
      setCeilings(UNAVAILABLE);
    });
  }, []);
  const loadRefunds = useCallback(() => {
    setRefunds(null);
    api.adminBillingRefunds().then(setRefunds, (e) => {
      reportError('hq-revenue-refunds', e);
      setRefunds(UNAVAILABLE);
    });
  }, []);
  const loadLicences = useCallback(() => {
    setLicences(null);
    // #4700 — the ledger is paged now; the ceiling picker needs every licence,
    // so this follows the pages, and a run that stops short of the end is
    // unreadable rather than a shorter list.
    licenceLedgerApi.all().then((r) => setLicences(r?.complete ? r.items : UNAVAILABLE), (e) => {
      reportError('hq-revenue-licences', e);
      setLicences(UNAVAILABLE);
    });
  }, []);
  const saveCeiling = useCallback(async (uid, body) => {
    const r = await api.promoCeilingSet(uid, body);
    loadCeilings();
    return r;
  }, [loadCeilings]);
  const updateStatement = useCallback(async (uid, body) => {
    const r = await api.statementUpdate(uid, body);
    loadStatements();
    loadPeriodStatements(period);
    return r;
  }, [loadStatements, loadPeriodStatements, period]);

  useEffect(() => {
    load(null); loadDisputes(); loadStatements(); loadCeilings(); loadRefunds(); loadLicences();
  }, [load, loadDisputes, loadStatements, loadCeilings, loadRefunds, loadLicences]);
  // The period's own statements, once a period is known and each time it changes.
  useEffect(() => { loadPeriodStatements(period); }, [period, loadPeriodStatements]);

  const choosePeriod = (p) => {
    if (!p || p === period) return;
    setPeriod(p);
    load(p);
  };
  const reloadAll = () => {
    load(period); loadDisputes(); loadStatements(); loadPeriodStatements(period); loadCeilings(); loadRefunds();
  };

  const ready = isReady(data);
  const fees = ready ? data.licence_fees : null;
  const currentPeriod = ready ? data.current_period : null;
  const shownPeriod = period || (ready ? data.quarter.key : null);
  const nowMs = Date.now();
  const usageCoverage = ready ? data.usage_coverage : null;
  const scopes = usageCoverage?.available
    ? usageCoverage.by_licence.map((l) => ({ licence_uid: l.licence_uid, name: l.brand_name || l.licence_ref || l.licence_uid }))
    : [];
  const sources = useMemo(
    () => coverageSources({ summary: data, statements, disputes, refunds, ceilings, period: shownPeriod }),
    [data, statements, disputes, refunds, ceilings, shownPeriod],
  );
  const attention = attentionItems({
    summary: data, statements, disputes, ceilings, period: shownPeriod, currentPeriod, nowMs, licenceUid: scope,
  });
  const openStatement = statementUid && isReady(statements) && statements.available
    ? (statements.items || []).find((s) => s.uid === statementUid) || null
    : null;
  const why = (source) => setCoverageAt(source || '');
  const scoped = scope ? scopes.find((s) => s.licence_uid === scope)?.name : null;

  // One line per read that answered (D126), for the rail. Each read can fail
  // alone, so `coverage` is assembled per source rather than gated on `ready`.
  const coverage = [
    ...sources.map((s) => (s.state === 'loading' || s.state === 'unavailable' ? null : `${s.name}: ${s.state.replace(/_/g, ' ')}`)),
  ].filter(Boolean);

  const rail = (
    <WorkerRail
      workspace="Revenue"
      role="super_admin"
      stance="Read-only summary"
      note="This rail summarises licence fees, AI cost and margin, branch statements, promo ceilings, refunds and open disputes, as the page reads them. It moves no money: the paid and disputed totals on a branch statement are figures an HQ operator types in, and the page's one money movement is a refund, which HQ's super admin issues after a step-up with a written reason."
      coverage={coverage}
      coverageNote={coverage.length ? undefined
        : (data === UNAVAILABLE ? 'The revenue summary could not be read, so there is nothing to read back — this is not a claim that no revenue was booked.'
          : 'Loading the revenue summary…')}
      unavailable={[
        ['Reconciled revenue ledger', 'Licence-fee invoices are in their own zone. A ledger that reconciles every stream is not recorded, so the cockpit tiles stay Not recorded.'],
        ['Subscription revenue', 'No local charge ledger; Stripe is read per customer.'],
        ['Revenue per subsidiary', 'Branches report quarters to HQ; every stream today arrives unmeasured (D266), so no amount is totalled.'],
        ['Token P&L per subsidiary', 'Spend is not tied to a licence (U1) and almost no model call carries branch metadata (D261).'],
        ['Promotional spend per code', 'A code names no subsidiary, and no branch reports an issued figure to HQ, so spend against a ceiling is not recorded.'],
      ]}
      data-testid="hq-revenue-rail"
    />
  );

  return (
    <RailFrame rail={rail} data-testid="hq-revenue-page">
      <div className="flex min-w-0 flex-col gap-4">
        <RevenueHeader
          period={shownPeriod}
          periods={periodOptions(currentPeriod)}
          onPeriod={choosePeriod}
          scope={scope}
          scopes={scopes}
          onScope={setScope}
          readAt={ready ? data.read_at : null}
          nowMs={nowMs}
          sources={sources}
          onCoverage={why}
          ask={<HeaderAsk />}
        />

        {data === UNAVAILABLE && (
          <Unreadable
            what="The revenue summary"
            claim="This is not a claim that nothing was earned."
            onRetry={() => load(period)}
          />
        )}
        {scoped && (
          <p className="rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[13px] text-axal-muted dark:border-gray-700 dark:bg-gray-950/40 dark:text-gray-400" data-testid="hq-revenue-scope-note">
            Scope: <b className="text-axal-ink dark:text-gray-100">{scoped}</b>. Receivables, subsidiaries, promotions and Needs attention are narrowed to it.
            The financial position, streams, AI economics and billing exceptions stay platform-wide, because no charge or AI run names its licence (U1).
          </p>
        )}

        <ExecutiveSummary
          summary={data}
          refunds={refunds}
          disputes={disputes}
          period={shownPeriod}
          onWhy={why}
          onRetrySummary={() => load(period)}
          onRetryRefunds={loadRefunds}
          onRetryDisputes={loadDisputes}
        />
        <NeedsAttention items={attention} onStatement={setStatementUid} />
        <RevenueStreams summary={data} periodStatements={periodStatements} period={shownPeriod} onWhy={why} />
        {fees?.available && (
          <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="hq-revenue-run-rate-label">{fees.label || 'Contracted quarterly run-rate'}, not invoiced or collected</p>
        )}
        <LicenceInvoices invoices={ready ? data.licence_invoices : null} onRetry={() => load(period)} />
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <RevenueTrend period={shownPeriod} onWhy={why} />
          <AiEconomicsSection summary={data} period={shownPeriod} onWhy={why} />
        </div>
        <ReceivablesSection statements={statements} licenceUid={scope} onOpen={setStatementUid} onRetry={loadStatements} onWhy={why} />
        <SubsidiariesSection
          summary={data}
          periodStatements={periodStatements}
          period={shownPeriod}
          currentPeriod={currentPeriod}
          licenceUid={scope}
          nowMs={nowMs}
          onOpen={setStatementUid}
          onRetry={() => load(period)}
          onWhy={why}
        />
        <BillingExceptions
          refunds={refunds}
          disputes={disputes}
          nowSec={Math.floor(nowMs / 1000)}
          onRetryRefunds={loadRefunds}
          onRetryDisputes={loadDisputes}
          onWhy={why}
          refundForm={<RefundReviewFlow onDone={loadRefunds} />}
        />
        <PromotionsSection
          summary={data}
          ceilings={ceilings}
          coverage={usageCoverage}
          period={shownPeriod}
          licenceUid={scope}
          licences={licences}
          onSave={saveCeiling}
          onRetry={loadCeilings}
          onWhy={why}
        />
      </div>

      {coverageAt !== null && (
        <DataCoverageDrawer
          sources={sources}
          focus={coverageAt || null}
          period={periodLabel(shownPeriod) || 'Period'}
          readAt={ready ? data.read_at : null}
          onClose={() => setCoverageAt(null)}
          onReload={reloadAll}
        />
      )}
      {openStatement && (
        <StatementDrawer statement={openStatement} onClose={() => setStatementUid(null)} onUpdate={updateStatement} />
      )}
    </RailFrame>
  );
}
