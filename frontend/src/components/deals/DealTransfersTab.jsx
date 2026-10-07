import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { api } from '../../lib/api';
import { STATES, amountToCents, centsMoney, transferRefusal, whenLine } from './dealRoomCopy';
import { Loading, Empty, Unreadable, NotRecorded, StatusPill, Refusal, BTN, INPUT } from './DealRoomKit';

/**
 * D630 (#1388) — canvas `dr-transfers`: the deal room's Transfers tab.
 *
 * Each wire: amount, reference, phone-verified or not, note, who recorded it
 * and when, and the firm — or "Not recorded" with its reason when the Worker's
 * `withFirm` (D467) returns no `company_id`.
 *
 * "Record a transfer" is the partner's and the admin's (`POST
 * /deals/:id/transfers` is `requireRole('partner')`, which admits an admin).
 * Each refusal the route gives reads as a sentence: open closing conditions,
 * a closing check that could not be read, an invalid amount, no firm given.
 * The firm is not typed into the form: the Worker takes it from the company
 * switcher (D467), and refuses with `transfer_firm_required` when the
 * recorder belongs to more than one firm and none is chosen.
 */
export default function DealTransfersTab({ dealId, canRecord }) {
  const [state, setState] = useState({ loading: true, error: false, rows: null });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const r = await api.dealTransfers(dealId);
      setState({ loading: false, error: false, rows: Array.isArray(r?.items) ? r.items : [] });
    } catch {
      setState({ loading: false, error: true, rows: null });
    }
  }, [dealId]);
  useEffect(() => { load(); }, [load]);
  return <TransfersView dealId={dealId} state={state} onRetry={load} canRecord={canRecord} onRecorded={load} />;
}

export function TransfersView({ dealId, state, onRetry, canRecord, onRecorded, initialFormOpen = false, initialRefusal = null }) {
  const [formOpen, setFormOpen] = useState(initialFormOpen);
  const cta = canRecord
    ? <button type="button" onClick={() => setFormOpen(true)} className={BTN.primary} data-testid="dr-transfer-cta"><Plus size={14} /> Record a transfer</button>
    : null;
  let body;
  if (state.loading && !state.rows) body = <Loading what="transfers" />;
  else if (state.error) body = <Unreadable onRetry={onRetry}>{STATES.transfers.unread}</Unreadable>;
  else if (!state.rows.length) body = <Empty action={formOpen ? null : cta}>{STATES.transfers.empty}</Empty>;
  else {
    body = (
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900" data-testid="dr-transfers">
        {state.rows.map((t) => (
          <li key={t.uid} className="flex flex-col gap-2 p-3 md:flex-row md:items-start md:justify-between" data-testid="dr-transfer-row">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">{centsMoney(t.amount_cents) || <NotRecorded reason="Not recorded: no amount is stored." />}</span>
                <StatusPill tone={Number(t.phone_verified) ? 'ok' : 'amber'}>{Number(t.phone_verified) ? 'Phone-verified' : 'Not verified'}</StatusPill>
              </div>
              <div className="mt-0.5 font-mono text-xs text-gray-500">{t.reference || 'No reference recorded'}</div>
              {t.note && <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{t.note}</p>}
            </div>
            <dl className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-1 text-xs md:text-right">
              <dt className="text-gray-500">Recorded by</dt>
              <dd>{t.recorded_by_name || `User #${t.recorded_by}`}</dd>
              <dt className="text-gray-500">When</dt>
              <dd>{whenLine(t.recorded_at) || <NotRecorded reason="Not recorded: no time is stored." />}</dd>
              <dt className="text-gray-500">Firm</dt>
              <dd data-testid="dr-transfer-firm">
                {t.company_id != null
                  ? (t.company_name || `Firm #${t.company_id}`)
                  : <NotRecorded reason={STATES.transfers.nrFirm} />}
              </dd>
            </dl>
          </li>
        ))}
      </ul>
    );
  }
  const hasRows = Boolean(state.rows && state.rows.length);
  return (
    <div>
      {canRecord && hasRows && !formOpen && <div className="mb-3 flex justify-end">{cta}</div>}
      {canRecord && formOpen && (
        <RecordTransferForm
          dealId={dealId}
          initialRefusal={initialRefusal}
          onClose={() => setFormOpen(false)}
          onRecorded={() => { setFormOpen(false); onRecorded?.(); }}
        />
      )}
      {body}
    </div>
  );
}

export function RecordTransferForm({ dealId, onClose, onRecorded, initialRefusal = null }) {
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [verified, setVerified] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState(initialRefusal);

  const submit = async (e) => {
    e?.preventDefault?.();
    const cents = amountToCents(amount);
    if (!Number.isFinite(cents)) { setRefusal(transferRefusal({ code: 'transfer_amount_invalid' })); return; }
    setSaving(true); setRefusal(null);
    try {
      await api.dealTransferRecord(dealId, {
        amount_cents: cents,
        reference: reference.trim() || null,
        phone_verified: verified,
        note: note.trim() || null,
      });
      onRecorded?.();
    } catch (err) {
      setRefusal(transferRefusal(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mb-4 rounded-xl border border-violet-200 bg-violet-50/40 p-4 dark:border-violet-900 dark:bg-violet-950/20" data-testid="dr-transfer-form">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Record a transfer</h3>
        <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700" aria-label="Close"><X size={16} /></button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
          Amount (USD)
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="50,000.00" className={`${INPUT} mt-1`} />
        </label>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
          Reference
          <input value={reference} onChange={(e) => setReference(e.target.value)} className={`${INPUT} mt-1`} />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} className="accent-violet-600" />
          Phone-verified with the sender
        </label>
        <p className="text-xs text-gray-500">Firm: the one chosen in the company switcher.</p>
        <label className="block text-xs font-medium text-gray-600 md:col-span-2 dark:text-gray-400">
          Note (optional)
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={`${INPUT} mt-1`} />
        </label>
      </div>
      {refusal && <div className="mt-3"><Refusal refusal={refusal} tone={refusal.code === 'open_conditions_block_transfer' ? 'warn' : 'bad'} /></div>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BTN.ghost}>Cancel</button>
        <button type="submit" disabled={saving} className={BTN.primary} data-testid="dr-transfer-submit">
          {saving && <Loader2 size={14} className="animate-spin" />} Record the transfer
        </button>
      </div>
    </form>
  );
}
