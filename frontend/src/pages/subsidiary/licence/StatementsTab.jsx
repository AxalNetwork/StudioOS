/**
 * D804 (#2241) — the Licences page's Statements tab (canvas board L4),
 * `/admin/my-licence/statements`.
 *
 * READ FROM D798 (`licenceAccountApi.statements`): the table, its first row
 * open on its streams (the four the canvas draws, the royalty included once
 * D802 stores it), "Estimated" and "Not reported" chips; "How to pay HQ" from
 * the masked `payment`, or its refusal's sentence; the usage reports, with
 * "Send now" only where the Worker says a send is possible (a branch); and
 * "Dispute a line", a request to HQ that never writes the statement.
 * "Annual licence fee invoices" are D802's (`fee_invoices`): drawn when the
 * answer carries them, and said to be missing when it does not.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { licenceAccountApi } from '../../../lib/api/licenceAccount';
import { reportError } from '../../../lib/log';
import { canSendNow, disputeCents, payRows, statementRows, usageRows } from './licenceTabsModel';

const CARD = 'rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const H = 'mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100';
const BTN = 'rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800';
const INPUT = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900';
const CHIP = {
  Estimated: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200',
  'Not reported': 'border-gray-300 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
};
const STATUS_TONE = {
  Issued: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  Paid: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Disputed: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
  Void: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
};

function StatementTable({ rows, onDispute }) {
  const [open, setOpen] = useState(() => new Set(rows.filter((r) => r.open).map((r) => r.uid)));
  if (!rows.length) return <p className="text-sm text-gray-500">HQ has issued no statement for this licence yet.</p>;
  const toggle = (uid) => setOpen((s) => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  return (
    <div className="overflow-x-auto" data-testid="statement-table">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
            {['Period', 'Gross', 'Share', 'Owed', 'Paid', 'Disputed', 'Status', ''].map((h) => <th key={h || 'act'} className="px-2 py-1.5 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <React.Fragment key={r.uid}>
              <tr className="border-t border-gray-100 dark:border-gray-800">
                <td className="px-2 py-2">
                  <button type="button" onClick={() => toggle(r.uid)} aria-expanded={open.has(r.uid)} className="inline-flex items-center gap-1 font-medium text-gray-900 dark:text-gray-100">
                    {open.has(r.uid) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{r.p}
                  </button>
                </td>
                <td className="px-2 py-2 tabular-nums">{r.g}</td>
                <td className="px-2 py-2 tabular-nums">{r.s}</td>
                <td className="px-2 py-2 tabular-nums">{r.o}</td>
                <td className="px-2 py-2 tabular-nums">{r.pd}</td>
                <td className="px-2 py-2 tabular-nums">{r.d}</td>
                <td className="px-2 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[r.st] || STATUS_TONE.Void}`}>{r.st}</span></td>
                <td className="px-2 py-2 text-right">{r.disputable && <button type="button" className={BTN} onClick={() => onDispute(r)}>Dispute a line</button>}</td>
              </tr>
              {open.has(r.uid) && (
                <tr data-testid={`statement-streams-${r.uid}`}>
                  <td colSpan={8} className="bg-gray-50 px-6 py-2 dark:bg-gray-950">
                    <ul className="grid gap-1 sm:grid-cols-2">
                      {r.streams.map((x) => (
                        <li key={x.key} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-gray-700 dark:text-gray-300">{x.t}</span>
                          <span className="flex items-center gap-2">
                            {x.chip && <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${CHIP[x.chip]}`}>{x.chip}</span>}
                            <span className="tabular-nums text-gray-900 dark:text-gray-100">{x.v}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    {r.reference && <div className="mt-1 text-[11px] text-gray-500">Payment reference: <span className="font-mono">{r.reference}</span></div>}
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HowToPay({ payment }) {
  const p = payRows(payment);
  return (
    <section className={CARD} data-testid="how-to-pay">
      <h3 className={H}>How to pay HQ</h3>
      {p.refusal
        ? <p className="text-sm text-gray-600 dark:text-gray-400" data-testid="pay-refusal">{p.refusal}</p>
        : (
          <dl className="space-y-1 text-xs">
            {p.rows.map((r) => (
              <div key={`${r.k}-${r.v}`} className="flex justify-between gap-3">
                <dt className="text-gray-500">{r.k}</dt>
                <dd className={`text-right text-gray-900 dark:text-gray-100 ${r.mono ? 'font-mono' : ''}`}>{r.v}</dd>
              </div>
            ))}
            {p.warning && <p className="pt-1 text-[11px] text-amber-700 dark:text-amber-300">{p.warning}</p>}
          </dl>
        )}
      <p className="mt-2 text-[11px] text-gray-500">Quote the statement&apos;s payment reference. HQ records your payment; nothing here marks it paid.</p>
    </section>
  );
}

function FeeInvoices({ invoices }) {
  return (
    <section className={CARD} data-testid="fee-invoices">
      <h3 className={H}>Annual licence fee invoices</h3>
      {!Array.isArray(invoices)
        ? <p className="text-xs text-gray-500">Annual fee invoices are not on this page yet: HQ does not issue them here yet.</p>
        : invoices.length === 0
          ? <p className="text-xs text-gray-500">No annual fee invoice has been issued.</p>
          : (
            <ul className="space-y-1.5 text-xs">
              {invoices.map((v) => (
                <li key={v.uid || v.title} className="flex items-center justify-between gap-2">
                  <span><span className="font-medium text-gray-900 dark:text-gray-100">{v.title}</span><span className="block text-gray-500">{String(v.issued_on || '').slice(0, 10)}{v.amount ? ` · ${v.amount}` : ''}</span></span>
                  <span className="flex items-center gap-2"><span className="text-gray-600">{v.status}</span>{v.pdf_url && <a className={BTN} href={v.pdf_url}>PDF</a>}</span>
                </li>
              ))}
            </ul>
          )}
    </section>
  );
}

function UsageReports({ usage }) {
  const rows = usageRows(usage);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState('');
  const send = canSendNow(usage);
  return (
    <section className={CARD} data-testid="usage-reports">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Usage reports</h3>
        {usage?.report_day && <span className="text-[11px] text-gray-500">due by day {usage.report_day}</span>}
      </div>
      {rows.length > 0 && (
        <ul className="space-y-1 text-xs">
          {rows.map((r) => (
            <li key={r.m} className="flex justify-between gap-2">
              <span className="text-gray-700 dark:text-gray-300">{r.m}</span>
              <span className={r.late ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-gray-600 dark:text-gray-400'}>{r.st}</span>
            </li>
          ))}
        </ul>
      )}
      {usage?.report_day_reason && <p className="mt-1 text-[11px] text-gray-500">{usage.report_day_reason}</p>}
      {send ? (
        <div className="mt-2">
          <button type="button" className={BTN} disabled={sending} data-testid="usage-send-now"
            onClick={async () => {
              setSending(true); setResult('');
              try {
                const r = await licenceAccountApi.sendUsage();
                setResult(r?.sent ? 'Sent to HQ.' : (r?.reason || 'HQ did not take the report.'));
              } catch (e) { reportError('licence_usage_send_failed', e); setResult(e?.message || 'The report could not be sent.'); } finally { setSending(false); }
            }}>
            {sending ? <Loader2 size={12} className="animate-spin" /> : 'Send now'}
          </button>
          {result && <p className="mt-1 text-[11px] text-gray-600" role="status">{result}</p>}
        </div>
      ) : usage?.send_now_reason && <p className="mt-1 text-[11px] text-gray-500">{usage.send_now_reason}</p>}
    </section>
  );
}

/** "Dispute a line": an amount and a reason, sent to HQ as a request (D798). */
export function DisputeForm({ row, onDone, onCancel, api = licenceAccountApi }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const c = disputeCents(amount, row.owed_cents);
    if (!c.ok) { setErr(c.message); return; }
    if (reason.trim().length < 10) { setErr('Say why, in at least 10 characters, so HQ can check it.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await api.disputeStatement(row.uid, c.cents, reason.trim());
      onDone?.(r);
    } catch (e2) { reportError('licence_dispute_failed', e2); setErr(e2?.message || 'The dispute could not be sent.'); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className={`${CARD} space-y-2`} data-testid="dispute-form">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Dispute a line · {row.p}</h3>
      <label className="block text-xs text-gray-600 dark:text-gray-400">Amount ({row.currency})
        <input className={`${INPUT} mt-0.5`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1200" />
      </label>
      <label className="block text-xs text-gray-600 dark:text-gray-400">Reason
        <textarea className={`${INPUT} mt-0.5`} rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this line is wrong" />
      </label>
      {err && <p className="text-[11px] text-red-600" role="alert">{err}</p>}
      <p className="text-[11px] text-gray-500">This asks HQ to check the line. It changes nothing on the statement until HQ records it.</p>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">Send dispute</button>
        <button type="button" onClick={onCancel} className={BTN}>Cancel</button>
      </div>
    </form>
  );
}

/** The tab, given D798's answer. Separate from the loader so a test can draw it. */
export function StatementsView({ answer, onReload }) {
  const [disputing, setDisputing] = useState(null);
  const [sent, setSent] = useState('');
  if (answer?.available === false) {
    return (
      <div className="space-y-4" data-testid="statements-tab">
        <div className={CARD}><p className="text-sm text-gray-600 dark:text-gray-400">{answer.reason}</p></div>
        <UsageReports usage={answer.usage} />
      </div>
    );
  }
  const rows = statementRows(answer?.statements);
  return (
    <div className="space-y-4" data-testid="statements-tab">
      <section className={CARD}><StatementTable rows={rows} onDispute={(r) => { setSent(''); setDisputing(r); }} /></section>
      {sent && <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">{sent}</p>}
      {disputing && (
        <DisputeForm row={disputing} onCancel={() => setDisputing(null)}
          onDone={(r) => { setDisputing(null); setSent(`Sent to HQ. HQ answers by ${String(r?.escalation?.due_at || '').slice(0, 10) || 'its response time'}.`); onReload?.(); }} />
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <HowToPay payment={answer?.payment} />
        <FeeInvoices invoices={answer?.fee_invoices} />
        <UsageReports usage={answer?.usage} />
      </div>
    </div>
  );
}

export default function StatementsTab() {
  const [answer, setAnswer] = useState(undefined);
  const load = useCallback(() => {
    licenceAccountApi.statements()
      .then(setAnswer)
      .catch((e) => { reportError('licence_statements_load_failed', e); setAnswer(null); });
  }, []);
  useEffect(load, [load]);
  if (answer === undefined) return <p className="text-sm text-gray-500">Loading…</p>;
  if (answer === null) return <p className="text-sm text-red-600">Your statements could not be read. Nothing here is a statement that you owe nothing.</p>;
  return <StatementsView answer={answer} onReload={load} />;
}
