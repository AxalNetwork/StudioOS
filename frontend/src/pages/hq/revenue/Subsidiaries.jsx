import React from 'react';
import { Unreadable } from '../../../ui';
import { CoverageMark, Figure, StateMark, Section, When, Why, TABLE, TD, TH, NUM, BTN } from './RevenueStates.jsx';
import { isReady, pendingState, subsidiaryMetricRows, subsidiaryRows } from './revenueModel.js';

/** D5952 / RV06: branch stream receipts and the separate intercompany statement. */

const COVERAGE_FOR = { recorded: 'complete', incomplete: 'partial', stale: 'stale', not_reported: 'not_reported' };

export function SubsidiariesSection({ summary, periodStatements, period, currentPeriod, licenceUid, nowMs, onOpen, onRetry, onWhy }) {
  const measured = subsidiaryMetricRows(summary, period, currentPeriod, nowMs, licenceUid);
  const hasMetric = isReady(summary) && !!summary.metrics?.revenue_per_subsidiary;
  const coverage = hasMetric ? (measured.metric.values ? { available: true, by_licence: measured.rows.map((r) => ({ ...r, streams_measurable: r.streams.filter((x) => x.figure.text !== null).length })) } : { available: false }) : isReady(summary) ? summary.usage_coverage : null;
  const rows = subsidiaryRows({ coverage, periodStatements, period, currentPeriod, nowMs, licenceUid });
  return (
    <Section
      id="revenue-subsidiaries"
      title="Subsidiaries"
      when={<When kind="period" period={period} />}
      sub="Reported revenue by stream; statements and amounts owed kept separate"
      testId="hq-revenue-usage-coverage"
      actions={<Why source="subsidiaries" onOpen={onWhy} />}
    >
      {!isReady(summary) && <Figure figure={{ state: pendingState(summary), text: null }} />}
      {isReady(summary) && !coverage?.available && (
        hasMetric && measured.metric.state !== 'unavailable'
          ? <Figure figure={{ state: measured.metric.state, text: null }} />
          : <Unreadable what="Subsidiary usage reports" claim="This is not a claim that no branch reported." onRetry={onRetry} />
      )}
      {rows && rows.length === 0 && <p className="text-[13px] text-axal-muted dark:text-gray-400">No territory licence to report on.</p>}
      {rows && rows.length > 0 && (
        <div className="relative overflow-x-auto">
          <table className={TABLE}>
            <caption className="sr-only">Subsidiary reporting and statements for the period</caption>
            <thead>
              <tr>
                <th scope="col" className={TH}>Subsidiary</th>
                <th scope="col" className={TH}>Report</th>
                <th scope="col" className={`${TH} ${NUM}`}>Gross reported</th>
                <th scope="col" className={`${TH} ${NUM}`}>Share</th>
                <th scope="col" className={`${TH} ${NUM}`}>Owed to HQ</th>
                <th scope="col" className={`${TH} ${NUM}`}>Paid</th>
                <th scope="col" className={`${TH} ${NUM}`}>Outstanding</th>
                <th scope="col" className={TH}>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.licence_uid} data-testid={`hq-revenue-subsidiary-${r.licence_uid}`}>
                  <td className={TD}>
                    <b>{r.name}</b>
                    {r.statementUid && <button type="button" className={`${BTN} ml-2 min-h-[28px] px-2 text-[12px]`} onClick={() => onOpen(r.statementUid)} aria-label={`Open ${r.name}'s statement`}>Statement</button>}
                  </td>
                  <td className={TD}><StateMark state={r.report.state} label={r.report.text} /></td>
                  <td className={`${TD} ${NUM}`}>
                    {hasMetric ? (() => {
                      const m = measured.rows.find((x) => x.licence_uid === r.licence_uid);
                      return m?.streams.length ? m.streams.map((x) => <div key={x.stream} className="mb-1"><span className="block text-[12.5px]">{x.stream}</span><Figure figure={x.figure} /></div>) : <StateMark state="not_reported" />;
                    })() : <Figure figure={r.gross} absentLabel={r.gross.label} />}
                  </td>
                  <td className={`${TD} ${NUM} font-mono`}>{r.share || <StateMark state="not_recorded" />}</td>
                  <td className={`${TD} ${NUM}`}><Figure figure={r.owed} absentLabel={r.owed.label} /></td>
                  <td className={`${TD} ${NUM}`}><Figure figure={r.paid} absentLabel={r.paid.label} /></td>
                  <td className={`${TD} ${NUM}`}><b><Figure figure={r.outstanding} absentLabel={r.outstanding.label} /></b></td>
                  <td className={TD}><CoverageMark state={COVERAGE_FOR[r.coverage] || 'partial'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[12.5px] text-axal-muted dark:text-gray-400">
        Stream amounts stay in their reported currencies. Owed, Paid and Outstanding are the statement’s separate HQ claim.
      </p>
    </Section>
  );
}
