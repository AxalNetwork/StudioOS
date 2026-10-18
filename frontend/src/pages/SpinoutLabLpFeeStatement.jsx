// D717 decision 13 (#1859) — the LP's issued management fee statements on the
// LP workspace (L12, "Management fee statement · LP view"), drawn at every
// width. The figures are the frozen `mgmt_fee_statement/1` from
// GET /api/funds/lp-portal's `fee_statements`, through
// `lib/lpFeeStatementModel.js`. Nothing on a statement is paid by the LP, so
// it carries no account and no pay-to block: the LP funds the fee through a
// capital call, whose panel carries the phone check.
import React, { useState } from 'react';
import { Unreadable, Unrecorded } from '../ui';
import {
  NOTHING_DUE,
  feeStatementHeader,
  feeStatementList,
  feeStatementRows,
  isReadableStatement,
} from '../lib/lpFeeStatementModel';

const CARD = 'rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900';
const LBL = 'text-[11px] font-bold uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500';

/**
 * One statement. `onDownloadPdf` draws "Download PDF" only when it is a
 * function: no LP route serves a fee-statement file today, so the workspace
 * passes none. #1860 passes one where a notice record has a PDF.
 */
export function FeeStatementView({ statement, fundName, onDownloadPdf }) {
  const figures = statement?.figures;
  const head = feeStatementHeader(statement, fundName);
  const readable = isReadableStatement(figures);
  return (
    <div className={`${CARD} overflow-hidden text-gray-900 dark:text-gray-100`} data-testid={`fee-statement-${statement?.uid ?? 'one'}`}>
      <div className="border-b border-[#ececf1] dark:border-gray-800 px-5 py-4">
        {head.eyebrow && (
          <div className="text-[10px] font-bold uppercase tracking-[.1em] text-[#7d7889] dark:text-gray-400">{head.eyebrow}</div>
        )}
        <div className="mt-1 text-[19px] font-extrabold">{head.title}</div>
        {head.line && <div className="text-[12.5px] text-[#615c6e] dark:text-gray-400">{head.line}</div>}
      </div>
      <div className="px-5 py-[14px]">
        {!readable ? (
          <Unreadable what="This statement" claim="This is not a claim that nothing was charged." />
        ) : (
          <>
            {feeStatementRows(figures).map((r) => (
              <div
                key={r.key}
                className={`flex min-h-[44px] items-center justify-between gap-3 border-b border-[#f4f3f7] dark:border-gray-800 text-[14px] ${r.strong ? 'font-extrabold' : 'font-medium'}`}
              >
                <span>{r.label}</span>
                <span className="tabular-nums">{r.value ?? <Unrecorded />}</span>
              </div>
            ))}
            <p className="mt-[14px] text-[13px] leading-[1.5] text-[#4a4553] dark:text-gray-300">{NOTHING_DUE}</p>
          </>
        )}
        {typeof onDownloadPdf === 'function' && (
          <button
            type="button"
            onClick={onDownloadPdf}
            className="mt-4 h-[48px] w-full rounded-[12px] bg-[#6d28d9] text-[15px] font-bold text-white"
          >
            Download PDF
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The section under My commitment: the caller's own statements, newest first,
 * the newest open. Opening another row closes the first.
 */
export function FeeStatements({ portal, failed, onReload }) {
  const list = failed ? { state: 'unreadable', items: [] } : feeStatementList(portal);
  const [openUid, setOpenUid] = useState(null);
  const open = openUid ?? list.items[0]?.uid ?? null;
  return (
    <section data-testid="section-fee-statements">
      <div className="mb-2.5"><div className={LBL}>Management fee statements</div></div>
      {list.state === 'unreadable' ? (
        <div className={`${CARD} p-5`} data-testid="status-fee-statements-unreadable">
          <Unreadable what="Your management fee statements" claim="This is not a claim that none was issued." onRetry={onReload} />
        </div>
      ) : list.state === 'none' ? (
        <div className={`${CARD} p-5 text-[12.5px] text-gray-500 dark:text-gray-400`} data-testid="status-no-fee-statements">
          No management fee statement has been issued to you yet.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {list.items.map((item) => {
            const isOpen = item.uid === open;
            return (
              <div key={item.uid}>
                <button
                  type="button"
                  aria-expanded={isOpen ? 'true' : 'false'}
                  onClick={() => setOpenUid(item.uid)}
                  className={`${CARD} flex min-h-[44px] w-full items-center justify-between gap-3 px-4 text-left text-[13px] text-gray-800 dark:text-gray-200`}
                >
                  <span>{item.label}{item.corrects ? ' · corrects an earlier statement' : ''}</span>
                  <span className="flex items-center gap-2 font-bold tabular-nums">
                    {item.net ?? <Unrecorded />}<span aria-hidden="true">›</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="mt-2">
                    <FeeStatementView statement={item.statement} fundName={item.statement?.fund_name} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
