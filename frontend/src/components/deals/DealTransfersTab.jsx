import React, { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { dealStaffApi } from '../../lib/api/dealStaff.js';
import { verifierOptions } from '../../pages/investor/deals/closingWorkspaceModel';
import { STATES, amountToCents, centsMoney, transferRefusal, whenLine } from './dealRoomCopy';
import { Loading, Empty, Unreadable, NotRecorded, StatusPill, BTN, INPUT } from './DealRoomKit';
import DealActionDialog from './DealActionDialog';
import { refusalWords, transferGateLine } from './dealActionModel';

const GATE_WARN = 'm-0 rounded-[9px] border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200';

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
export default function DealTransfersTab({ dealId, canRecord, currency = 'USD' }) {
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
  return <TransfersView currency={currency} dealId={dealId} state={state} onRetry={load} canRecord={canRecord} onRecorded={load} />;
}

export function TransfersView({ dealId, currency = 'USD', state, onRetry, canRecord, onRecorded, initialFormOpen = false, initialRefusal = null }) {
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
                <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">{centsMoney(t.amount_cents, currency) || <NotRecorded reason="Not recorded: no amount is stored." />}</span>
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
        <RecordTransferForm currency={currency}
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

/**
 * D5914 (#5914, Deals v2 board DE14): Record transfer is a dialog in the DX14
 * shell (`DealActionDialog`): the amount in the deal's currency, the
 * reference, phone verification and who confirmed it (D6889, an Admin, or Not
 * recorded), the note, and the firm from the company switcher. The gate read
 * (`GET /deals/:id/transfer-gate`, D1155) warns before anything is sent when an
 * open IC condition holds the wire; the Worker still decides, and its refusal
 * stays in the dialog in its own words.
 */
export function RecordTransferForm({ dealId, onClose, onRecorded, initialRefusal = null, currency = 'USD' }) {
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [verified, setVerified] = useState(false);
  const [verifier, setVerifier] = useState('');
  const [note, setNote] = useState('');
  const [gate, setGate] = useState({ state: 'loading' });
  const [admins, setAdmins] = useState(null);
  useEffect(() => {
    let live = true;
    dealStaffApi.transferGate(dealId).then((value) => { if (live) setGate({ state: 'ready', value }); }, () => { if (live) setGate({ state: 'unreadable' }); });
    return () => { live = false; };
  }, [dealId]);
  useEffect(() => {
    if (!verified || admins !== null) return undefined;
    let live = true;
    api.listUsers('admin').then((r) => { if (live) setAdmins(Array.isArray(r) ? r : (r?.items || [])); }, () => { if (live) setAdmins(false); });
    return () => { live = false; };
  }, [verified, admins]);
  const warning = transferGateLine(gate);
  const cents = amountToCents(amount, currency);

  const send = () => {
    const body = {
      amount_cents: cents,
      reference: reference.trim() || null,
      phone_verified: verified,
      note: note.trim() || null,
    };
    if (verified && Number(verifier) > 0) body.phone_verified_by = Number(verifier);
    return api.dealTransferRecord(dealId, body);
  };

  return (
    <DealActionDialog testId="dr-transfer-form" goId="dr-transfer-submit" title="Record a transfer" width={520}
      act={Number.isFinite(cents) ? `Record ${centsMoney(cents, currency)} transfer` : 'Record the transfer'} busyLabel="Recording…"
      check={() => (Number.isFinite(cents) ? null : transferRefusal({ code: 'transfer_amount_invalid' }))}
      onConfirm={send}
      refusalOf={(err) => {
        const said = transferRefusal(err);
        return { ...said, body: refusalWords(err, said.body), tone: said.code === 'open_conditions_block_transfer' ? 'warn' : 'bad' };
      }}
      initialRefusal={initialRefusal ? { ...initialRefusal, tone: initialRefusal.code === 'open_conditions_block_transfer' ? 'warn' : 'bad' } : null}
      onDone={() => onRecorded?.()} onClose={onClose}>
      {warning && (
        <div className={warning.tone === 'warn' ? GATE_WARN : 'm-0 text-[12.5px] text-gray-500 dark:text-gray-400'} role={warning.tone === 'warn' ? 'status' : undefined} data-testid="dr-transfer-gate">
          {warning.tone === 'warn' && <span aria-hidden="true" className="mr-1.5 font-bold">!</span>}{warning.text}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
          Amount ({currency})
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="50,000.00" className={`${INPUT} mt-1 font-mono`} data-testid="dr-transfer-amount" />
        </label>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
          Reference
          <input value={reference} onChange={(e) => setReference(e.target.value)} className={`${INPUT} mt-1 font-mono`} data-testid="dr-transfer-reference" />
        </label>
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-700 sm:min-h-0 dark:text-gray-300">
          <input type="checkbox" checked={verified} onChange={(e) => { setVerified(e.target.checked); if (!e.target.checked) setVerifier(''); }} className="accent-violet-600" data-testid="dr-transfer-verified" />
          Phone-verified with the sender
        </label>
        <p className="m-0 self-center text-xs text-gray-500 dark:text-gray-400">Firm: the one chosen in the company switcher.</p>
        {verified && (
          <label className="block text-xs font-medium text-gray-600 sm:col-span-2 dark:text-gray-400">
            Who confirmed it by phone <span className="font-normal text-gray-500 dark:text-gray-400">· an Admin, optional</span>
            <select value={verifier} onChange={(e) => setVerifier(e.target.value)} disabled={!Array.isArray(admins)} className={`${INPUT} mt-1 min-h-[44px] sm:min-h-0`} data-testid="dr-transfer-verifier">
              <option value="">Not recorded</option>
              {(Array.isArray(admins) ? verifierOptions(admins, null) : []).map((o) => <option key={o.id} value={String(o.id)}>{o.label}</option>)}
            </select>
            <span className="mt-0.5 block font-normal text-gray-500 dark:text-gray-400">
              {admins === false ? 'The list of Admins could not be read, so no verifier can be named. The transfer still records.'
                : admins === null ? 'Reading the Admins…' : 'Left as Not recorded, the transfer still records.'}
            </span>
          </label>
        )}
        <label className="block text-xs font-medium text-gray-600 sm:col-span-2 dark:text-gray-400">
          Note (optional)
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={`${INPUT} mt-1`} data-testid="dr-transfer-note" />
        </label>
      </div>
    </DealActionDialog>
  );
}
