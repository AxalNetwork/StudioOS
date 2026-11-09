import React from 'react';
import { Unreadable } from '../../../ui';
import { CoverageMark, Figure, StateMark, Section, When, Why, TABLE, TD, TH, NUM, BTN } from './RevenueStates.jsx';
import { isReady, pendingState, subsidiaryRows } from './revenueModel.js';

/**
 * D5039 (canvas RV06) — Subsidiaries, reporting health first: whether each
 * branch reported the period and how fresh that is, then what the period's
 * statement claims (owed, paid, outstanding). HQ revenue per subsidiary is not
 * measured: every stream a branch reports arrives unmeasured (D266), so the
 * gross shown is only ever a drawn statement's, and a licence with no
 * statement says Not drawn, never 0. The reason lives in the coverage drawer.
 */

const COVERAGE_FOR = { recorded: 'complete', incomplete: 'partial', stale: 'stale', not_reported: 'not_reported' };

export function SubsidiariesSection({ summary, periodStatements, period, currentPeriod, licenceUid, nowMs, onOpen, onRetry, onWhy }) {
  const coverage = isReady(summary) ? summary.usage_coverage : null;
  const rows = subsidiaryRows({ coverage, periodStatements, period, currentPeriod, nowMs, licenceUid });
  return (
    <Section
      id="revenue-subsidiaries"
      title="Subsidiaries"
      when={<When kind="period" period={period} />}
      sub="Reporting health first; HQ revenue per subsidiary is not measured yet"
      testId="hq-revenue-usage-coverage"
      actions={<Why source="subsidiaries" onOpen={onWhy} />}
    >
      {!isReady(summary) && <Figure figure={{ state: pendingState(summary), text: null }} />}
      {isReady(summary) && !coverage?.available && (
        <Unreadable what="Subsidiary usage reports" claim="This is not a claim that no branch reported." onRetry={onRetry} />
      )}
      {rows && rows.length === 0 && <p className="text-[13px] text-axal-muted dark:text-gray-400">No territory licence to report on.</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
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
                  <td className={`${TD} ${NUM}`}><Figure figure={r.gross} absentLabel={r.gross.label} /></td>
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
        AI margin and promotion spend per subsidiary are not shown: AI usage is not tied to a licence, and branches report promotion spend unevenly.
      </p>
    </Section>
  );
}
