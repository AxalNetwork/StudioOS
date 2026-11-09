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
 * NO CROSS-CURRENCY TOTAL, and no figure without a ledger behind it: Invoiced,
 * Collected, Outstanding, Overdue and the trend are Not recorded until
 * invoice-backed licence revenue and the reconciled ledger exist, with the
 * reason once, in the Data coverage drawer.
 *
 * WRITES, AS TODAY. This slice redesigns no write. The statement entry
 * (D453/D458/D514), the ceiling editor (D228) and the refund (D224, behind the
 * step-up) are today's controls, moved unchanged into the drawer and the
 * sections that own them; the governed flows the canvas draws are the next
 * slice. The licence list is still read whole, and only for the ceiling
 * editor's picker; the scoped picker is later work.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { licenceLedgerApi } from '../../lib/api/licenceLedger';
import { reportError } from '../../lib/log';
import { RailFrame, WorkerRail, Unreadable } from '../../ui';
import HeaderAsk from '../../ui/HeaderAsk.jsx';
import { RevenueHeader, DataCoverageDrawer } from './revenue/RevenueHeader';
import { ExecutiveSummary, NeedsAttention } from './revenue/ExecutiveSummary';
import { AiEconomicsSection, RevenueStreams, RevenueTrend } from './revenue/RevenueStreams';
import { ReceivablesSection, StatementDrawer } from './revenue/Receivables';
import { SubsidiariesSection } from './revenue/Subsidiaries';
import { BillingExceptions } from './revenue/BillingExceptions';
// D5037: the refund is looked up and reviewed before money moves; the Worker refuses one without a review.
import RefundReviewFlow from '../../components/RefundReviewFlow.jsx';
import { PromotionsSection } from './revenue/Promotions';
import {
  UNAVAILABLE, attentionItems, coverageSources, isReady, periodLabel, periodOptions,
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
        ['Invoiced, collected, outstanding, overdue', 'No ledger reconciles licence invoices and payments yet.'],
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
