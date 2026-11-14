import React, { useRef, useState } from 'react';
import { Unreadable } from '../../../ui';
import StatusBadge from './StatusBadge.jsx';
import DsrOutcomeDialog from './PrivacyActions.jsx';
import { dsrRows, dsrSummary, historyOf, nextAction } from './privacyModel.js';

/**
 * D4803 (#4803, canvas SE06a workspace, SE06b request detail, SE11d phone) —
 * "Data subject requests, their legal due dates and what HQ has recorded."
 *
 *   triage       Open (with the next due date), Due within 7 days, Overdue,
 *                Closed in the last 90 days (by HQ · withdrawn); a figure
 *                whose read did not answer is Unavailable, never 0
 *   table        open requests first, soonest due first, then the ones closed
 *                in the window; Received, Due (a date), Remaining, State; on
 *                phone, cards from the same rows
 *   detail       lifecycle, the facts, the warning that closing records a
 *                decision and erases nothing, Record outcome, and the history;
 *                on phone it replaces the list, with "‹ Privacy" back
 *   action       Record outcome (`PrivacyActions.jsx`), Scope → Review → Result
 *   explanation  the previous zone's full detail, behind "How this is measured"
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const BTN = 'inline-flex min-h-[48px] items-center justify-center rounded-lg border px-3 text-[12.5px] font-bold sm:min-h-[36px]';
const BTN_PLAIN = `${BTN} border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const BTN_PRIMARY = `${BTN} border-violet-700 bg-violet-700 text-white hover:bg-violet-800 dark:border-violet-500 dark:bg-violet-600 dark:hover:bg-violet-700`;

function Figure({ label, value, line, testid }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid={testid}>
      <span className="text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">{label}</span>
      <span className="flex flex-wrap items-center gap-2">
        {value === null
          ? <StatusBadge state="unavailable" label="Unavailable" />
          : <b className="text-[20px] font-extrabold tabular-nums text-axal-ink dark:text-white">{value}</b>}
        {value === 0 && <StatusBadge state="measured_zero" />}
      </span>
      {line && <small className="text-[11.5px] text-axal-muted dark:text-gray-300">{line}</small>}
    </div>
  );
}

function Lifecycle({ row }) {
  const closed = !row.open;
  const steps = [
    { k: 'r', text: `Received ${row.received || ''}`.trim(), on: true, done: true },
    { k: 'o', text: closed ? 'Was open' : 'Open · HQ reviewing', on: !closed, done: closed },
    { k: 'c', text: closed ? `${row.word} ${row.closed || ''}`.trim() : 'Closed', on: closed, done: closed },
  ];
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Request lifecycle" data-testid="dsr-lifecycle">
      {steps.map((s) => (
        <li
          key={s.k}
          aria-current={s.on ? 'step' : undefined}
          className={`rounded-md border px-2 py-1 text-[12px] font-semibold ${s.on ? 'border-violet-700 text-axal-ink dark:border-violet-500 dark:text-white' : s.done ? 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100' : 'border-dashed border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400'}`}
        >
          <span aria-hidden="true">{s.done ? '✓ ' : ''}</span>{s.text}
        </li>
      ))}
    </ol>
  );
}

export function DsrDetail({ row, onRecord, onBack, opener }) {
  const facts = row.open
    ? [
      ['Received', row.receivedFull || 'Not recorded'],
      ['Due', row.due || 'Unknown: the receipt time could not be read'],
      ['Remaining', row.remaining],
      ['Scope', `HQ-held account · user ${row.userId}`],
      ['Next action', nextAction(row)],
    ]
    : [
      ['Received', row.receivedFull || 'Not recorded'],
      ['Closed', row.closedFull || 'Not recorded'],
      ['Outcome', row.word],
      ['Closed by', row.closedBy],
      ['Scope', `HQ-held account · user ${row.userId}`],
    ];
  const history = historyOf(row);
  const summary = [row.label || 'Request', row.kind, row.subject, row.open ? `due ${row.due || 'unknown'}` : row.word].join(' · ');
  return (
    <section aria-labelledby="dsr-detail-h" className={`${CARD} flex flex-col gap-3`} data-testid="dsr-detail" data-open={row.open ? 'true' : 'false'}>
      <button type="button" onClick={onBack} className={`${BTN_PLAIN} self-start md:hidden`} data-testid="dsr-back">‹ Privacy</button>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id="dsr-detail-h" className="text-[15px] font-extrabold tracking-tight text-axal-ink dark:text-white">
            {row.label || 'Request (no ledger number yet)'} · {row.kind}
          </h3>
          <span className="break-words text-[12.5px] text-axal-muted dark:text-gray-300">{row.subject}</span>
        </div>
        <StatusBadge state={row.state} label={row.word} />
      </div>
      <Lifecycle row={row} />
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-[130px_minmax(0,1fr)]">
        {facts.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="font-semibold text-axal-muted dark:text-gray-400">{k}</dt>
            <dd className="min-w-0 break-words text-axal-ink dark:text-gray-100">{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      {row.open && (
        <>
          <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" data-testid="dsr-no-erase">
            <span aria-hidden="true">!</span>
            <span><b>Closing records a decision. It does not erase data.</b> Erasure is done separately. Close as Fulfilled only after you have confirmed it.</span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" ref={opener} onClick={() => onRecord(row)} className={BTN_PRIMARY} data-testid="dsr-record">Record outcome…</button>
            <CopyButton text={summary} />
          </div>
        </>
      )}
      <div className="flex flex-col gap-1">
        <h4 className="text-[12.5px] font-bold text-axal-ink dark:text-white">History</h4>
        <ul className="flex flex-col gap-1 text-[12.5px]" data-testid="dsr-history">
          {history.map((h, i) => (
            <li key={i} className="grid grid-cols-1 gap-x-3 sm:grid-cols-[170px_minmax(0,1fr)]">
              <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{h.at}</span>
              <span className="text-axal-ink dark:text-gray-100">{h.text}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11.5px] text-axal-muted dark:text-gray-400">Who has opened a request is not recorded, so views are not listed.</p>
      </div>
    </section>
  );
}

function CopyButton({ text }) {
  const [done, setDone] = useState(null);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone('Copied'); } catch { setDone('Copy failed'); }
  };
  return <button type="button" onClick={copy} className={BTN_PLAIN} data-testid="dsr-copy-summary">{done || 'Copy request summary'}</button>;
}

/**
 * The workspace. `dsr` is `/overview`'s `dsr` block (null while reading);
 * `unreadable` when the overview itself could not be read; `onReread` reads
 * it again; `children` is the previous zone, behind "How this is measured".
 */
export default function PrivacyWorkspace({ dsr, unreadable, onReread, send, children }) {
  const [selected, setSelected] = useState(null);
  const [acting, setActing] = useState(null);
  const opener = useRef(null);
  const rows = dsrRows(dsr);
  const s = dsrSummary(dsr);
  const row = rows.find((r) => r.key === selected) || null;
  const listUnreadable = Boolean(dsr) && dsr.available === false;

  return (
    <div className="flex flex-col gap-4" data-testid="privacy-workspace">
      <div className="flex flex-col gap-1">
        <h2 className="text-[18px] font-extrabold tracking-tight text-axal-ink dark:text-white">Privacy</h2>
        <p className="text-[12.5px] text-axal-muted dark:text-gray-300">Data subject requests, their legal due dates and what HQ has recorded.</p>
      </div>

      {unreadable ? (
        <Unreadable what="The data subject requests" claim="This is not a claim that none are open or overdue." onRetry={onReread} />
      ) : !dsr ? (
        <p className="text-[12px] text-axal-muted dark:text-gray-400" data-testid="privacy-reading">Reading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="dsr-summary">
            <Figure label="Open" value={s.open} line={s.open ? (s.nextDue ? `next due ${s.nextDue}` : 'due date unknown') : null} testid="dsr-open" />
            <Figure label={`Due within 7 days`} value={s.dueSoon} testid="dsr-due-soon" />
            <Figure label="Overdue" value={s.overdue} testid="dsr-overdue" />
            <Figure
              label={`Closed in last ${s.windowDays} days`}
              value={s.closed}
              line={s.closed === null ? s.recentReason : s.closed ? `${s.closedByHq} closed by HQ · ${s.withdrawn} withdrawn${s.closedTruncated ? ' · the newest 100 are listed' : ''}` : null}
              testid="dsr-closed"
            />
          </div>
          {s.unknownDue > 0 && (
            <p className="text-[12px] text-axal-muted dark:text-gray-300" data-testid="dsr-unknown-due">
              {s.unknownDue} open request{s.unknownDue === 1 ? ' has' : 's have'} a receipt time that could not be read, so {s.unknownDue === 1 ? 'its' : 'their'} due date is unknown. Not counted as due soon or overdue.
            </p>
          )}

          {listUnreadable ? (
            <Unreadable what="The open requests" claim={dsr.reason || 'This is not a claim that none are open.'} onRetry={onReread} />
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
              <section aria-labelledby="dsr-table-h" className={`${CARD} flex flex-col gap-2 ${row ? 'hidden md:flex' : ''}`} data-testid="dsr-list">
                <h3 id="dsr-table-h" className="text-[14px] font-extrabold tracking-tight text-axal-ink dark:text-white">Requests</h3>
                {rows.length === 0 ? (
                  <div className="flex items-center gap-2 text-[12.5px] text-axal-muted dark:text-gray-300" data-testid="dsr-empty">
                    <StatusBadge state="measured_zero" label="None" />
                    No request is open{s.closed === 0 ? `, and none was closed in the last ${s.windowDays} days` : ''}.
                  </div>
                ) : (
                  <>
                    <table className="hidden w-full text-left text-[12.5px] md:table" data-testid="dsr-table">
                      <thead>
                        <tr className="border-b border-axal-hairline text-[11px] text-axal-muted dark:border-gray-800 dark:text-gray-400">
                          <th scope="col" className="py-1.5 pr-3 font-semibold">Request</th>
                          <th scope="col" className="py-1.5 pr-3 font-semibold">Subject</th>
                          <th scope="col" className="py-1.5 pr-3 font-semibold">Received</th>
                          <th scope="col" className="py-1.5 pr-3 font-semibold">Due</th>
                          <th scope="col" className="py-1.5 pr-3 font-semibold">Remaining</th>
                          <th scope="col" className="py-1.5 font-semibold">State</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.key} aria-selected={r.key === selected} className={`border-t border-axal-hairline dark:border-gray-800 ${r.key === selected ? 'bg-violet-50/60 dark:bg-violet-950/20' : ''}`} data-open={r.open ? 'true' : 'false'}>
                            <td className="py-1.5 pr-3">
                              <button type="button" onClick={() => setSelected(r.key)} className="text-left font-bold text-axal-ink underline-offset-2 hover:underline dark:text-white">
                                {r.label || 'No number yet'}
                              </button>
                              <small className="block text-axal-muted dark:text-gray-400">{r.kind}</small>
                            </td>
                            <td className="max-w-[220px] break-words py-1.5 pr-3">{r.subject}</td>
                            <td className="whitespace-nowrap py-1.5 pr-3">{r.received || 'Not recorded'}</td>
                            <td className="whitespace-nowrap py-1.5 pr-3">{r.open ? (r.due || 'Unknown') : '—'}</td>
                            <td className="whitespace-nowrap py-1.5 pr-3 font-semibold">{r.open ? r.remaining : `Closed ${r.closed || ''}`.trim()}</td>
                            <td className="py-1.5"><StatusBadge state={r.state} label={r.word} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <ul className="flex flex-col gap-2 md:hidden" data-testid="dsr-cards">
                      {rows.map((r) => (
                        <li key={r.key}>
                          <button type="button" onClick={() => setSelected(r.key)} className="flex min-h-[48px] w-full flex-col gap-1 rounded-lg border border-axal-hairline p-3 text-left dark:border-gray-700">
                            <span className="flex items-center justify-between gap-2"><b className="min-w-0 break-words">{r.kind} · {r.subject}</b><StatusBadge state={r.state} label={r.word} /></span>
                            <small className="text-axal-muted dark:text-gray-300">
                              {r.label || 'No number yet'} · received {r.received || 'not recorded'}{r.open ? ` · due ${r.due || 'unknown'} · ${r.remaining}` : ` · closed ${r.closed || 'not recorded'}`}
                            </small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {dsr.recent?.available === false && (
                  <p className="text-[12px] text-axal-muted dark:text-gray-300" data-testid="dsr-recent-unreadable">
                    <StatusBadge state="unavailable" /> Closed requests are not listed: {dsr.recent.reason}
                  </p>
                )}
                <p className="text-[11.5px] text-axal-muted dark:text-gray-400">
                  Due date: {dsr.clock?.label ? dsr.clock.label.charAt(0).toLowerCase() + dsr.clock.label.slice(1) : 'the statutory clock from receipt'}, as the product counts it. A request is overdue from the moment that day ends. Shown as a date so no one has to do the arithmetic.
                </p>
              </section>
              {row ? (
                <DsrDetail row={row} onRecord={(r) => setActing(r)} onBack={() => setSelected(null)} opener={opener} />
              ) : (
                <p className="hidden text-[12px] text-axal-muted xl:block dark:text-gray-400">Choose a request to see its due date, next action and history.</p>
              )}
            </div>
          )}
        </>
      )}

      {acting && (
        <DsrOutcomeDialog
          row={acting}
          send={send}
          returnFocus={opener.current}
          onClose={() => setActing(null)}
          onRecorded={() => onReread?.()}
          onReread={onReread}
        />
      )}

      {children && (
        <details className={`${CARD} text-[12px]`} data-testid="privacy-how">
          <summary className="cursor-pointer font-semibold text-axal-ink dark:text-gray-100">How this is measured</summary>
          <div className="mt-3">{children}</div>
        </details>
      )}
    </div>
  );
}
