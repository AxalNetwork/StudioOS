import React, { useState } from 'react';
import { Unreadable } from '../../../ui';
import Sheet from '../../../ui/Sheet.jsx';
import { StateShape } from '../security/StatusBadge.jsx';
import { Figure, StateMark, Section, When, Why, TABLE, TD, TH, NUM, BTN } from './RevenueStates.jsx';
import { StatementActions } from './StatementActions.jsx';
import { StatementActionFlow } from './StatementActionFlow.jsx';
import {
  RECEIVABLE_STATUSES, STATEMENT_DRAW_HELD, UNAVAILABLE, UNRECORDED_CURRENCY, countFigure, isReady, outstandingByCurrency,
  periodLabel, receivableCounts, receivableRows, receivableStatus, statementFacts,
} from './revenueModel.js';

/**
 * D5039 (canvas RV05, RV14a, RV14c) — Receivables, built from the statements
 * HQ has drawn, and the statement drawer.
 *
 * A statement is an intercompany claim: what the branch reported times the
 * licence's revenue share, with paid and disputed as HQ recorded them. It is
 * point in time ("As of now"), so it does not follow the Period selector.
 * Statements record no due date, so Due is Not recorded and there is no
 * Overdue status; disputed claims sort first. Drawing a new statement is held
 * by the owner's policy (D514): a policy state, with no action.
 *
 * Below 1024px the table becomes cards (RV14a, RV14c), so nothing shrinks to
 * an unreadable size.
 */

const STATUS_TONE = {
  disputed: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200',
  issued: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200',
  draft: 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-300',
  paid: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200',
  void: 'border-axal-hairline text-axal-muted line-through dark:border-gray-700 dark:text-gray-400',
};
const STATUS = Object.fromEntries(RECEIVABLE_STATUSES.map((s) => [s.key, s]));

export function ReceivableStatus({ status }) {
  const s = STATUS[status] || STATUS.draft;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-bold leading-none ${STATUS_TONE[s.key]}`} data-status={s.key}>
      <StateShape shape={s.shape} />{s.word}
    </span>
  );
}

/** D514 — the policy state the canvas draws instead of a Draw button. */
export function StatementDrawHeld() {
  return (
    <div role="note" className="flex items-start gap-2.5 rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2.5 dark:border-gray-700 dark:bg-gray-950/40" data-testid="hq-revenue-statement-draw-held">
      <span aria-hidden="true" className="mt-0.5 font-bold text-axal-muted dark:text-gray-400">⏸</span>
      <p className="text-[13px] leading-relaxed text-axal-muted dark:text-gray-400">
        <b className="block text-axal-ink dark:text-gray-100">Statement creation · policy decision required</b>
        {STATEMENT_DRAW_HELD}
      </p>
    </div>
  );
}

const FILTERS = [{ key: 'all', word: 'All' }, ...RECEIVABLE_STATUSES];

export function ReceivablesSection({ statements, licenceUid, onOpen, onRetry, onWhy }) {
  const [filter, setFilter] = useState('all');
  const rows = receivableRows(statements, { licenceUid });
  const counts = receivableCounts(rows);
  const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
  const totals = outstandingByCurrency(rows);
  const ready = isReady(statements) && statements.available;

  return (
    <Section
      id="revenue-receivables"
      title="Receivables"
      when={<When kind="now" />}
      sub="Revenue-share statements · intercompany claims, not recognised revenue"
      testId="hq-revenue-receivables"
    >
      {statements === UNAVAILABLE && (
        <Unreadable what="The statement ledger" claim="This is not a claim that nothing is owed." onRetry={onRetry} />
      )}
      {isReady(statements) && !statements.available && <p className="text-[13px] text-axal-muted dark:text-gray-400"><StateMark state="unavailable" /> {statements.reason}</p>}
      {statements === null && <StateMark state="loading" />}

      {ready && (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter receivables by status" data-testid="hq-revenue-receivable-filters">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`min-h-[32px] rounded-full border px-3 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet ${filter === f.key ? 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200' : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}
              >
                {f.word}<span className="ml-1 font-mono font-normal text-axal-muted dark:text-gray-400">{counts[f.key]}</span>
              </button>
            ))}
          </div>

          {rows.length === 0 && (
            <p className="mb-3 text-[13px] text-axal-muted dark:text-gray-400" data-testid="hq-revenue-statements-empty">
              No statement has been drawn{licenceUid ? ' for this subsidiary' : ''}.
            </p>
          )}

          {shown.length > 0 && (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className={TABLE}>
                  <caption className="px-3 pb-2 text-left font-mono text-[12px] font-bold uppercase tracking-[.05em] text-axal-muted dark:text-gray-400">
                    {shown.length} of {rows.length} shown · disputed first
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>Subsidiary</th>
                      <th scope="col" className={TH}>Receivable</th>
                      <th scope="col" className={`${TH} ${NUM}`}>Owed</th>
                      <th scope="col" className={`${TH} ${NUM}`}>Paid</th>
                      <th scope="col" className={`${TH} ${NUM}`}>Outstanding</th>
                      <th scope="col" className={TH}>Due</th>
                      <th scope="col" className={TH}>Status</th>
                      <th scope="col" className={TH}><span className="sr-only">Open</span></th>
                    </tr>
                  </thead>
                  <tbody data-testid="hq-revenue-statements">
                    {shown.map((r) => (
                      <tr key={r.uid}>
                        <td className={TD}><b>{r.who}</b></td>
                        <td className={TD}>{r.receivable}</td>
                        <td className={`${TD} ${NUM}`}><Figure figure={r.owed} /></td>
                        <td className={`${TD} ${NUM}`}><Figure figure={r.paid} /></td>
                        <td className={`${TD} ${NUM}`}><b><Figure figure={r.outstanding} /></b></td>
                        <td className={TD}><StateMark state="not_recorded" /></td>
                        <td className={TD}><ReceivableStatus status={r.status} /></td>
                        <td className={`${TD} text-right`}>
                          <button type="button" className={BTN} onClick={() => onOpen(r.uid)} aria-label={`Open ${r.who} ${r.receivable}`}>Open ›</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="grid gap-2.5 sm:grid-cols-2 lg:hidden" data-testid="hq-revenue-receivable-cards">
                {shown.map((r) => (
                  <li key={r.uid} className="rounded-xl border border-axal-hairline p-3 dark:border-gray-700">
                    <div className="flex items-start justify-between gap-2">
                      <b className="text-[14px] text-axal-ink dark:text-gray-100">{r.who}</b>
                      <ReceivableStatus status={r.status} />
                    </div>
                    <span className="font-mono text-[12.5px] text-axal-muted dark:text-gray-400">{r.receivable}</span>
                    <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13.5px]">
                      <dt className="text-axal-muted dark:text-gray-400">Owed</dt><dd className="text-right"><Figure figure={r.owed} /></dd>
                      <dt className="text-axal-muted dark:text-gray-400">Paid</dt><dd className="text-right"><Figure figure={r.paid} /></dd>
                      <dt className="text-axal-muted dark:text-gray-400">Outstanding</dt><dd className="text-right font-bold"><Figure figure={r.outstanding} /></dd>
                    </dl>
                    <button type="button" className={`${BTN} mt-2 min-h-[44px] w-full`} onClick={() => onOpen(r.uid)} aria-label={`Open ${r.who} ${r.receivable}`}>Open</button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {totals.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]" data-testid="hq-revenue-owed">
              {totals.map((t) => (
                <span key={t.currency} className="inline-flex items-center gap-1.5">
                  <span className="text-axal-muted dark:text-gray-400">Outstanding in {t.currency === UNRECORDED_CURRENCY ? 'an unrecorded currency' : t.currency}</span>
                  <Figure figure={t.figure} />
                  <span className="text-axal-muted dark:text-gray-400">· {t.count} issued or disputed</span>
                </span>
              ))}
              {/* Same rule as the stream table: per currency, never one figure. */}
              <span className="text-[12.5px] text-axal-muted dark:text-gray-400">One line per currency; statements are not summed across them. Due dates are not recorded. <Why source="statements" onOpen={onWhy} /></span>
            </div>
          )}
        </>
      )}
      <div className="mt-3"><StatementDrawHeld /></div>
    </Section>
  );
}

/**
 * RV05 — one statement, explained: what the branch reported, the share, what
 * HQ is owed, what HQ recorded as paid and what is outstanding; its source;
 * and its history as far as the row records one. The footer offers the
 * governed actions (RV05b; `StatementActions.jsx`), and an action's flow
 * (`StatementActionFlow.jsx`) takes the drawer's body until it is done.
 * Escape closes the flow first, and does nothing while its request is out.
 */
export function StatementDrawer({ statement: s, onClose, onUpdate, onAction, onChanged }) {
  const [flow, setFlow] = useState(null);
  const [flowBusy, setFlowBusy] = useState(false);
  const f = statementFacts(s);
  if (!s || !f) return null;
  const who = s.brand_name || s.licence_ref || s.licence_uid || s.uid;
  const row = (label, node) => (
    <React.Fragment key={label}>
      <dt className="border-b border-axal-hairline py-2 text-axal-muted dark:border-gray-800 dark:text-gray-400">{label}</dt>
      <dd className="border-b border-axal-hairline py-2 text-right font-semibold dark:border-gray-800">{node}</dd>
    </React.Fragment>
  );
  const history = [
    f.drawnAt && [f.drawnAt, 'Drawn'],
    s.status !== 'draft' && f.updatedAt && [f.updatedAt, `Last changed · now ${s.status}`],
    f.paidAt && [f.paidAt, `Paid total entered${f.paidNote ? ` · ${f.paidNote}` : ''}`],
  ].filter(Boolean);
  return (
    <Sheet
      eyebrow="Receivable · revenue-share statement"
      title={`${who} · ${periodLabel(s.period) || s.period}`}
      onClose={() => { if (!flowBusy) onClose(); }}
      onEscape={flow ? () => { if (!flowBusy) setFlow(null); } : undefined}
      width={560}
      testId="hq-revenue-statement-drawer"
      footer={flow ? null : <StatementActions statement={s} onUpdate={onUpdate} onStart={onAction ? setFlow : undefined} />}
    >
      {flow ? (
        <StatementActionFlow
          key={flow}
          kind={flow}
          statement={s}
          onSubmit={onAction}
          onChanged={onChanged}
          onBusy={setFlowBusy}
          onClose={() => setFlow(null)}
        />
      ) : (
      <div className="flex flex-col gap-5 px-5 py-4 text-[13.5px]">
        <div className="flex flex-wrap items-center gap-2"><ReceivableStatus status={receivableStatus(s)} /><span className="text-[13px] text-axal-muted dark:text-gray-400">Due date not recorded</span></div>
        <section>
          <h3 className="mb-1 font-mono text-[12px] font-bold uppercase tracking-[.05em] text-axal-muted dark:text-gray-400">Outstanding</h3>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4">
            {row('Gross reported by the branch', <Figure figure={f.gross} />)}
            {row('Revenue share on the statement', f.share || <StateMark state="not_recorded" />)}
            {row('Owed to HQ', <Figure figure={f.owed} />)}
            {row('Paid · recorded by HQ', <Figure figure={f.paid} />)}
            {row('Disputed', <Figure figure={f.disputed} />)}
            {row('Outstanding', <b><Figure figure={f.outstanding} /></b>)}
          </dl>
          {f.floorReason && <p className="mt-2 text-[13px] text-amber-800 dark:text-amber-300">{f.floorReason}</p>}
          {f.disputeNote && <p className="mt-2 text-[13px] text-axal-muted dark:text-gray-400">Dispute: {f.disputeNote} · who entered it, and when, is not recorded.</p>}
          <p className="mt-2 text-[12.5px] text-axal-muted dark:text-gray-400">An intercompany claim drawn from what the branch reported. It is not reconciled against a bank and is not recognised revenue.</p>
        </section>
        <section>
          <h3 className="mb-1 font-mono text-[12px] font-bold uppercase tracking-[.05em] text-axal-muted dark:text-gray-400">Source</h3>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4">
            {row('Usage reports as of', f.reportsAsOf || <StateMark state="not_recorded" />)}
            {row('Streams unreported', <Figure figure={countFigure(s.unreported_streams)} />)}
            {row('Streams estimated', <Figure figure={countFigure(s.estimated_streams)} />)}
          </dl>
        </section>
        <section>
          <h3 className="mb-1 font-mono text-[12px] font-bold uppercase tracking-[.05em] text-axal-muted dark:text-gray-400">History</h3>
          {history.length
            ? <ul className="divide-y divide-dashed divide-axal-hairline dark:divide-gray-800">{history.map(([d, t]) => <li key={`${d}${t}`} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 py-1.5"><span className="font-mono text-[12.5px] text-axal-muted dark:text-gray-400">{d}</span>{t}</li>)}</ul>
            : <StateMark state="not_recorded" />}
          <p className="mt-1 text-[12.5px] text-axal-muted dark:text-gray-400">The row keeps when it was drawn, last changed and paid. Since D5039 each governed action also keeps who, why and the before and after, in the action record and the audit log.</p>
        </section>
      </div>
      )}
    </Sheet>
  );
}
