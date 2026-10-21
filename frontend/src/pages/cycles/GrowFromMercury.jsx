import { useState } from 'react';
import { cyclesWrite } from '../../lib/api/cycles';
import { mercuryView, monthLabel } from './growFromMercury';

/**
 * D840 part 3 (#2348) — a Grow module's "From Mercury" part (`id="from-mercury"`),
 * from the module read's `parts.from_mercury`:
 *
 *   - Revenue and traction: money in and net burn by month, invoices paid, open
 *     and overdue, and how many credits landed from a paid invoice;
 *   - Durable company-building: cash, treasury and runway;
 *   - Team expansion: payroll by month, and hires affordable at current runway,
 *     a computed figure and never a plan;
 *   - Distribution: marketing spend by month, and spend and CAC by channel;
 *   - Partner network: payments to an Axal partner, proposed. Only the founder
 *     accepts or dismisses; nothing is linked without Accept.
 *
 * The founder syncs on demand ("Sync from Mercury"); nothing reads their bank
 * on a schedule. Each figure says "From Mercury, as of <date>". A team member may delete a
 * figure, and the next sync leaves it deleted. Anyone outside the founder's
 * company sees only the sentence that the figures are the team's.
 */
export default function GrowFromMercury({ slug, part, projectId, reload }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const view = mercuryView(part);
  if (view.empty) return null;
  const act = async (key, fn, failed) => {
    setBusy(key); setError('');
    try { await fn(); reload?.(); } catch (e) { setError(e?.message || failed); } finally { setBusy(null); }
  };
  const remove = (id) => act(`d${id}`, () => cyclesWrite.grow.deleteMercuryFact(projectId, id), 'That figure could not be deleted.');
  const del = (id) => (projectId && id != null ? (
    <button type="button" disabled={busy != null} onClick={() => remove(id)} data-testid={`mercury-delete-${id}`}
      className="text-[11px] font-semibold text-axal-muted underline-offset-2 hover:underline disabled:opacity-50 dark:text-gray-400">Delete</button>
  ) : null);
  return (
    <section id="from-mercury" className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid={`cycle-part-mercury-${slug}`} aria-labelledby="from-mercury-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id="from-mercury-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">From Mercury</h2>
        <span className="flex items-baseline gap-2">
          <span className={FAINT}>{view.source || 'Read-only, from the founder’s own Mercury'}</span>
          {view.canSync && projectId && (
            <button type="button" disabled={busy != null} data-testid="mercury-sync"
              onClick={() => act('sync', () => cyclesWrite.grow.syncMercury(projectId), 'Mercury could not be read. Nothing changed; try again.')}
              className="rounded-md border border-axal-hairline px-2.5 py-0.5 text-[11.5px] font-bold text-axal-ink disabled:opacity-50 dark:border-gray-700 dark:text-gray-200">{busy === 'sync' ? 'Syncing…' : 'Sync from Mercury'}</button>
          )}
        </span>
      </div>
      {view.state === 'unreadable' && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="mercury-unreadable">{view.reason}</p>}
      {(view.state === 'team_only' || view.state === 'not_recorded') && <p className={MUTED} data-testid={`mercury-${view.state}`}>{view.reason}</p>}
      {view.state === 'ok' && slug === 'revenue-and-traction' && (
        <>
          <Rows title="Money in and net burn by month" testid="mercury-months" rows={view.months.map((m) => ({ key: m.id, label: monthLabel(m.month), value: `In ${m.cash_in} · Net burn ${m.net_burn}` }))} />
          {view.invoices.length > 0
            ? <Rows title="Invoices" testid="mercury-invoices" rows={view.invoices.map((i) => ({ key: i.id, label: STATE[i.state] || i.state, value: `${i.count} · ${i.amount}`, del: del(i.id) }))} />
            : view.invoicesReason && <p className={MUTED}>{view.invoicesReason}</p>}
          {view.creditsLanded != null && <p className={LINE} data-testid="mercury-credits-landed">{view.creditsLanded} {view.creditsLanded === 1 ? 'credit' : 'credits'} on the ledger from Mercury. A credit that matches one paid invoice lands by itself; pick the others in the revenue ledger.</p>}
        </>
      )}
      {view.state === 'ok' && slug === 'durable-company-building' && (
        <Rows title="Cash and runway" testid="mercury-cash" rows={[
          view.cash && { key: 'cash', label: 'Cash', value: view.cash.text, sub: view.cash.source, del: del(view.cash.id) },
          view.treasury && { key: 'treasury', label: 'Treasury', value: view.treasury.text, sub: view.treasury.source, del: del(view.treasury.id) },
          view.runway && { key: 'runway', label: 'Runway', value: view.runway.text, sub: view.runway.source, del: del(view.runway.id) },
        ].filter(Boolean)} />
      )}
      {view.state === 'ok' && slug === 'team-expansion' && (
        <>
          <Rows title="Payroll by month" testid="mercury-payroll" rows={view.payroll.map((p) => ({ key: p.id, label: monthLabel(p.month), value: p.amount, del: del(p.id) }))} />
          {view.hires && (
            <div className="flex flex-col gap-0.5" data-testid="mercury-hires">
              <h3 className={SUB}>Hires affordable at current runway · computed</h3>
              <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">{view.hires.text}</p>
              <p className={LINE}>{view.hires.words}</p>
            </div>
          )}
        </>
      )}
      {view.state === 'ok' && slug === 'distribution' && (
        <>
          <Rows title="Marketing and advertising spend" testid="mercury-spend" rows={view.spend.map((p) => ({ key: p.id, label: monthLabel(p.month), value: p.amount, del: del(p.id) }))} />
          {view.channels.length > 0 && (
            <Rows title={`By channel · ${monthLabel(view.spendMonth)}`} testid="mercury-channels" rows={view.channels.map((c) => ({ key: c.id, label: c.name, value: `${c.spend} · ${c.customers} ${c.customers === 1 ? 'customer' : 'customers'} · CAC ${c.cac}`, del: del(c.id) }))} />
          )}
        </>
      )}
      {view.state === 'ok' && slug === 'partner-network' && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="mercury-proposals">
          {view.proposals.map((p) => (
            <li key={p.id} className="flex flex-col gap-1 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid={`mercury-proposal-${p.id}`}>
              <p className="m-0 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{p.sentence || p.company}</p>
              <span className={FAINT}>{p.linked || 'Proposed by Mercury'}{p.source ? ` · ${p.source}` : ''}</span>
              {p.state === 'pending' && view.canDecide && projectId && (
                <div className="flex gap-2 pt-1">
                  <button type="button" disabled={busy != null} data-testid={`mercury-accept-${p.id}`}
                    onClick={() => act(p.id, () => cyclesWrite.grow.acceptMercuryPartner(projectId, p.id), 'That proposal could not be accepted.')}
                    className="rounded-md bg-axal-violet px-3 py-1 text-[12px] font-bold text-white transition-colors hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50">{busy === p.id ? 'Saving…' : 'Accept'}</button>
                  <button type="button" disabled={busy != null} data-testid={`mercury-dismiss-${p.id}`}
                    onClick={() => act(p.id, () => cyclesWrite.grow.dismissMercuryPartner(projectId, p.id), 'That proposal could not be dismissed.')}
                    className="rounded-md border border-axal-hairline px-3 py-1 text-[12px] font-bold text-axal-ink disabled:opacity-50 dark:border-gray-700 dark:text-gray-200">Dismiss</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="mercury-error">{error}</p>}
    </section>
  );
}

function Rows({ title, testid, rows }) {
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid={testid}>
      <h3 className={SUB}>{title}</h3>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {rows.map((r) => (
          <li key={r.key} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{r.label}</span>
            <span className="flex items-baseline gap-2">
              <span className={LINE}>{r.value}</span>
              {r.del}
            </span>
            {r.sub && <span className={`${FAINT} basis-full`}>{r.sub}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const STATE = { paid: 'Paid', open: 'Open', overdue: 'Overdue' };
const SUB = 'm-0 text-[11px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
const LINE = 'm-0 text-[12px] text-axal-ink/80 dark:text-gray-300';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const FAINT = 'text-[11px] text-axal-faint dark:text-gray-500';
