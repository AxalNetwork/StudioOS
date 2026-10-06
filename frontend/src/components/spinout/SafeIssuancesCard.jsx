// D578 (#1205) — the Lab Capital page's SAFE card.
//
// Lists the startup's SAFEs (investor, amount, valuation cap, discount,
// status) from `safe_issuances` and the e-sign envelope each was sent in
// (routes/safe_issuances.ts), and records a new one's terms. The form is a
// post-money SAFE with a valuation cap and no discount (S1's Q1 A for the
// owner), so Discount reads "None in this form", never a number.
//
// Status comes from the envelope and nowhere else: a SAFE with no envelope is
// a draft. Nothing can be sent until the counsel-approved SAFE text is
// registered; the Worker refuses and the card says why, rather than offering a
// button that fails. A failed read is Unreadable, never an empty list.
import React, { useCallback, useEffect, useState } from 'react';
import { FileSignature } from 'lucide-react';
import { safeIssuancesApi } from '../../lib/api/safeIssuances.js';
import { reportError } from '../../lib/log';
import { Unreadable } from '../../ui';

export const NOT_SENDABLE =
  'Sending waits on the counsel-approved SAFE text. Until it is registered, a SAFE here is a record of agreed terms, not a document anyone has signed.';
export const NO_DISCOUNT = 'None in this form';
export const RECORD_ERRORS = {
  investor_name_required: 'Enter the investor’s name.',
  amount_cents_invalid: 'Enter the purchase amount in whole dollars.',
  valuation_cap_cents_invalid: 'Enter the post-money valuation cap in whole dollars.',
  prospect_not_on_project: 'That prospect belongs to another round.',
  discount_not_in_form: 'This SAFE form has no discount.',
};

export const usd = (cents) => (Number.isInteger(cents)
  ? (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  : null);

/** Whole dollars typed in a field → integer cents, or null when it is not a positive whole number. */
export function dollarsToCents(v) {
  const t = String(v ?? '').replace(/[,\s$]/g, '');
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t) * 100;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** The note, then the SAFEs or the empty line, for a list the Worker returned. */
export function SafeList({ data }) {
  const safes = data?.safes || [];
  return (
    <>
    {data?.sendable === false && (
      <p className="text-[11.5px] text-amber-700 dark:text-amber-300 mb-2" data-testid="safe-not-sendable">{NOT_SENDABLE}</p>
    )}
    {safes.length === 0 ? (
      <p className="text-[12px] text-gray-500 dark:text-gray-400" data-testid="safe-empty">No SAFE has been recorded for this round.</p>
    ) : (
      <table className="w-full text-[12px]" data-testid="safe-table">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-wider text-gray-400">
            <th className="py-1 pr-3 font-bold">Investor</th>
            <th className="py-1 pr-3 font-bold text-right">Amount</th>
            <th className="py-1 pr-3 font-bold text-right">Valuation cap</th>
            <th className="py-1 pr-3 font-bold">Discount</th>
            <th className="py-1 font-bold">Status</th>
          </tr>
        </thead>
        <tbody>
          {safes.map((s) => (
            <tr key={s.uid} className="border-t border-gray-100 dark:border-gray-800 text-gray-700 dark:text-gray-200">
              <td className="py-1.5 pr-3">{s.investor_name}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{usd(s.amount_cents)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{usd(s.valuation_cap_cents)}</td>
              <td className="py-1.5 pr-3 text-gray-500">{NO_DISCOUNT}</td>
              <td className="py-1.5" data-testid={`safe-status-${s.uid}`}>{s.status?.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
    </>
  );
}

export default function SafeIssuancesCard({ projectId, prospects = [] }) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [form, setForm] = useState({ prospect_id: '', investor_name: '', amount: '', cap: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      setState({ status: 'ready', data: await safeIssuancesApi.list(projectId) });
    } catch (e) {
      reportError('SafeIssuancesCard:list', e);
      setState({ status: 'unreadable', data: null });
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const pickProspect = (id) => {
    const p = prospects.find((x) => String(x.id) === id);
    setForm((f) => ({ ...f, prospect_id: id, investor_name: p ? (p.name || p.firm || f.investor_name) : f.investor_name }));
  };

  const record = async (e) => {
    e.preventDefault();
    const amount = dollarsToCents(form.amount);
    const cap = dollarsToCents(form.cap);
    if (!form.investor_name.trim()) { setErr(RECORD_ERRORS.investor_name_required); return; }
    if (amount === null) { setErr(RECORD_ERRORS.amount_cents_invalid); return; }
    if (cap === null) { setErr(RECORD_ERRORS.valuation_cap_cents_invalid); return; }
    setBusy(true); setErr('');
    try {
      await safeIssuancesApi.record(projectId, {
        investor_name: form.investor_name.trim(),
        amount_cents: amount,
        valuation_cap_cents: cap,
        ...(form.prospect_id ? { prospect_id: Number(form.prospect_id) } : {}),
      });
      setForm({ prospect_id: '', investor_name: '', amount: '', cap: '' });
      load();
    } catch (e2) {
      reportError('SafeIssuancesCard:record', e2);
      setErr(RECORD_ERRORS[e2?.code || e2?.data?.error] || e2?.message || 'The SAFE was not recorded.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5" data-testid="card-safes">
      <div className="flex items-center gap-2 mb-1">
        <FileSignature size={15} className="text-violet-600" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">SAFEs · post-money, valuation cap, no discount</span>
      </div>
      {state.status === 'unreadable' ? (
        <Unreadable what="This round’s SAFEs" claim="This is not a claim that none have been recorded." onRetry={load} />
      ) : state.status === 'loading' ? (
        <p className="text-[12px] text-gray-500">Loading…</p>
      ) : (
        <>
          <SafeList data={state.data} />
          <form onSubmit={record} className="mt-3 flex flex-wrap items-center gap-2 text-[12px]" data-testid="safe-record-form">
            {prospects.length > 0 && (
              <select value={form.prospect_id} onChange={(e) => pickProspect(e.target.value)} aria-label="Prospect" className="border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 dark:bg-gray-900">
                <option value="">No prospect</option>
                {prospects.map((p) => <option key={p.id} value={String(p.id)}>{p.name || p.firm || `Prospect ${p.id}`}</option>)}
              </select>
            )}
            <input value={form.investor_name} onChange={(e) => setForm((f) => ({ ...f, investor_name: e.target.value }))} placeholder="Investor" aria-label="Investor" className="border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 dark:bg-gray-900" />
            <input value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="Amount (USD)" inputMode="numeric" aria-label="Amount" className="border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 w-32 dark:bg-gray-900" />
            <input value={form.cap} onChange={(e) => setForm((f) => ({ ...f, cap: e.target.value }))} placeholder="Valuation cap (USD)" inputMode="numeric" aria-label="Valuation cap" className="border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 w-40 dark:bg-gray-900" />
            <button type="submit" disabled={busy} className="px-2.5 py-1 rounded-lg bg-violet-600 text-white disabled:opacity-50">Record terms</button>
          </form>
          {err && <p role="alert" className="mt-1.5 text-[11.5px] text-red-700 dark:text-red-300">{err}</p>}
        </>
      )}
    </div>
  );
}
