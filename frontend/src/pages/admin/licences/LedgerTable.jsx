/**
 * D4819 (#4819), Build part 1 — the populated ledger: the counts line, the
 * Needs HQ summary whose items filter the table, and the nine-column table
 * (boards L01 and L02), with a stacked list in its place on a phone. Every
 * cell is one primary state; a value the reads do not give is said as None,
 * Not recorded, Unavailable or Not instrumented (`../licenceLedgerModel.js`),
 * never as 0.
 */
import React from 'react';
import {
  NOT_INSTRUMENTED, NOT_ON_LEDGER, attentionCell, notInstrumentedCell, renewalCell, requestsCell, territoryCell,
} from '../licenceLedgerModel';
import { STATUS_TONE, Chip } from './licenceShared';

const TAG = {
  value: 'text-gray-900 dark:text-gray-100',
  none: 'text-gray-600 dark:text-gray-400',
  reading: 'text-gray-400 dark:text-gray-500',
  due: 'font-medium text-amber-800 dark:text-amber-300',
  overdue: 'font-semibold text-rose-700 dark:text-rose-300',
  not_recorded: 'italic text-gray-500 dark:text-gray-400',
  unavailable: 'font-semibold text-red-700 dark:text-red-300',
  not_instrumented: 'rounded-full border border-dotted border-gray-400 px-2 text-[11px] text-gray-500 dark:border-gray-600 dark:text-gray-400',
};

/** One cell's state, with its word. Unavailable carries its "!" so the state is never colour alone. */
export function StateTag({ c, testId }) {
  return (
    <span className={`whitespace-nowrap ${TAG[c.state] || TAG.value}`} data-state={c.state} data-testid={testId}>
      {c.state === 'unavailable' ? `! ${c.label}` : c.label}
    </span>
  );
}

/**
 * A column the ledger read does not carry: said as such, linking to the
 * section that reads it. Each link is written out whole below, so the route
 * guard (`admin_route_reachability.test.mjs`) reads it as a door.
 */
function NotOnLedger({ uid, col, href, onOpen }) {
  const c = notInstrumentedCell();
  const { label, section } = NOT_ON_LEDGER[col];
  return (
    <a
      href={href} onClick={(e) => onOpen(e, uid, section)}
      title={`The ledger does not read this licence's ${label.toLowerCase()} state. Open the licence to see it.`}
      data-testid={`licence-cell-${col}`}
    >
      <StateTag c={c} />
    </a>
  );
}

export function CountsAndNeeds({ counts, countsUnavailable, onRetry, needs, chosen, onToggle, scope }) {
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-[240px_minmax(0,1fr)]">
      <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="licence-counts">
        <h2 className="text-[10px] font-bold uppercase tracking-[.07em] text-gray-500 dark:text-gray-400">Licences</h2>
        {countsUnavailable || !counts ? (
          <p className="mt-1 text-sm">
            <StateTag c={{ state: 'unavailable', label: 'Unavailable' }} />{' '}
            <button type="button" onClick={onRetry} className="text-xs font-semibold text-indigo-700 underline dark:text-indigo-300">Retry</button>
          </p>
        ) : (
          <>
            <p className="mt-1 font-mono text-[22px] font-bold leading-tight text-gray-900 dark:text-gray-100">{counts.head}</p>
            <p className="text-[12.5px] text-gray-700 dark:text-gray-300">{counts.parts.join(' · ')}</p>
          </>
        )}
      </section>
      <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="licence-needs">
        <h2 className="text-[10px] font-bold uppercase tracking-[.07em] text-gray-500 dark:text-gray-400">
          Needs HQ{scope ? ` · ${scope}` : ''}
        </h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {needs.map((n) => (n.state === 'value' ? (
            <button
              key={n.key} type="button" role="checkbox" aria-checked={chosen.includes(n.key)}
              onClick={() => onToggle(n.key)} data-testid={`licence-need-${n.key}`}
              className={`min-h-[28px] rounded-full border px-3 text-xs font-semibold ${
                chosen.includes(n.key)
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200'
                  : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
              }`}
            >
              {n.label}
            </button>
          ) : (
            <span
              key={n.key} data-testid={`licence-need-${n.key}`} data-state={n.state}
              className="inline-flex min-h-[28px] items-center rounded-full border border-dashed border-gray-300 px-3 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400"
            >
              {n.label}
            </span>
          )))}
        </div>
        <p className="mt-2 text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="licence-needs-not-instrumented">
          Not instrumented on the ledger yet: {NOT_INSTRUMENTED.join(' · ')}. Open a licence to see them.
        </p>
      </section>
    </div>
  );
}

const COLUMNS = ['Licence / studio', 'Territory', 'Status', 'Renewal', 'Agreement', 'Branch', 'Requests', 'Billing', 'Attention'];

function Identity({ l, onOpen }) {
  return (
    <>
      <a
        href={`/admin/licences/${encodeURIComponent(l.uid)}`} onClick={(e) => onOpen(e, l.uid)}
        className="inline-flex items-center gap-1.5 font-semibold text-gray-900 hover:underline dark:text-gray-100"
        data-testid="licence-row-link"
      >
        {/* D198 / H28 — a white-label row shows the operator's own colour; a subsidiary none. */}
        {l.kind === 'white_label' && l.brand_kit?.primary_hex && (
          <span
            data-testid="licence-row-swatch" aria-hidden="true"
            className="inline-block h-3 w-3 shrink-0 rounded-sm border border-black/10"
            style={{ backgroundColor: l.brand_kit.primary_hex }}
          />
        )}
        {l.brand_name}
      </a>
      <small className="block font-mono text-[11px] text-gray-500 dark:text-gray-400">
        {l.licence_ref} · {l.kind === 'white_label' ? 'White-label' : 'Axal subsidiary'}
      </small>
    </>
  );
}

const statusWord = (s) => String(s).replace('_', ' ');

/**
 * The table. `onOpen(event, uid, section?)` opens the licence in the page
 * (a plain click) and leaves a modified click to the browser, so every row's
 * link is a real deep link that opens in a new tab or is copied whole.
 */
export function LedgerTable({ rows, reads, onOpen, onRetryRequests, footer }) {
  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900" data-testid="licence-ledger">
      <div className="hidden md:block">
        <table className="w-full border-collapse text-[12.5px]" data-testid="licence-ledger-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c} scope="col" className="whitespace-nowrap border-b border-gray-200 bg-gray-50 px-3 py-2 text-left font-mono text-[10px] font-bold uppercase tracking-[.07em] text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const read = reads[l.uid];
              const req = requestsCell(read);
              return (
                <tr key={l.uid} className="border-b border-gray-100 last:border-0 dark:border-gray-800" data-testid="licence-row" data-uid={l.uid}>
                  <td className="px-3 py-2.5 align-middle"><Identity l={l} onOpen={onOpen} /></td>
                  <td className="px-3 py-2.5"><StateTag c={territoryCell(l)} testId="licence-cell-territory" /></td>
                  <td className="px-3 py-2.5"><Chip tone={STATUS_TONE[l.status]}>{statusWord(l.status)}</Chip></td>
                  <td className="px-3 py-2.5 font-mono text-[11.5px]"><StateTag c={renewalCell(l)} testId="licence-cell-renewal" /></td>
                  <td className="px-3 py-2.5"><NotOnLedger uid={l.uid} col="agreement" href={`/admin/licences/${encodeURIComponent(l.uid)}/agreement`} onOpen={onOpen} /></td>
                  <td className="px-3 py-2.5"><NotOnLedger uid={l.uid} col="branch" href={`/admin/licences/${encodeURIComponent(l.uid)}/operations`} onOpen={onOpen} /></td>
                  <td className="px-3 py-2.5">
                    <StateTag c={req} testId="licence-cell-requests" />
                    {req.state === 'unavailable' && (
                      <button type="button" onClick={() => onRetryRequests(l.uid)} className="ml-1 text-[11px] font-semibold text-indigo-700 underline dark:text-indigo-300">Retry</button>
                    )}
                  </td>
                  <td className="px-3 py-2.5"><NotOnLedger uid={l.uid} col="billing" href={`/admin/licences/${encodeURIComponent(l.uid)}/fee-invoices`} onOpen={onOpen} /></td>
                  <td className="px-3 py-2.5"><StateTag c={attentionCell(l, read)} testId="licence-cell-attention" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* A phone has no room for nine columns: each licence is one row with
          its identity, its primary state and what needs HQ (board L20's
          triage order). The other columns are the licence's own sections. */}
      <ul className="divide-y divide-gray-100 md:hidden dark:divide-gray-800" data-testid="licence-ledger-list">
        {rows.map((l) => {
          const read = reads[l.uid];
          return (
            <li key={l.uid} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0"><Identity l={l} onOpen={onOpen} /></div>
              <div className="flex shrink-0 flex-col items-end gap-1 text-[12px]">
                <Chip tone={STATUS_TONE[l.status]}>{statusWord(l.status)}</Chip>
                <StateTag c={attentionCell(l, read)} />
              </div>
            </li>
          );
        })}
      </ul>
      {footer}
    </section>
  );
}
