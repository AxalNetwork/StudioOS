// D601 (#998; the owner's answer 1A) — the Spin-Out Lab's "Formation orders"
// tab in HQ. An Axal admin moves a paid formation order on by hand:
//   "Packet ready"         attach one of the order's project documents as the packet;
//   "Filed with the state" the date the filing was submitted.
// Each step is recorded with the acting admin (routes/admin_incorporations.ts,
// logAdminAction). Nothing here builds a packet or files with a state.
//
// A failed list read says so with a retry, and a refused step prints the
// Worker's own reason. No step has a default: no document is preselected and
// no date is filled in.
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { adminIncorporationsApi } from '../../lib/api/adminIncorporations.js';
import { reportError } from '../../lib/log';
import { Unrecorded, Unreadable } from '../../ui';

export const STEP_ERRORS = {
  order_not_found: 'That order no longer exists.',
  order_not_awaiting_packet: 'This order is not waiting for its packet any more.',
  document_id_required: 'Choose the document that is the packet.',
  document_not_on_project: 'That document belongs to another project.',
  packet_not_ready: 'Mark the packet ready before recording the filing.',
  filed_on_invalid: 'The filing date is not a calendar date.',
  filed_on_future: 'The filing date is in the future.',
  filed_on_before_payment: 'The filing date is before the order was paid.',
};

export const STATUS_LABEL = {
  paid: 'Paid · packet not built',
  packet_processing: 'Paid · packet not built',
  packet_ready: 'Packet ready · not filed',
  filed: 'Filed with the state',
};

// `request` puts the Worker's code on `e.code` and its body on `e.data` (D258).
export const stepError = (e) => STEP_ERRORS[e?.code || e?.data?.error] || e?.message || 'The step was not recorded.';

/** Which step an order is waiting on: the packet, the filing, or nothing. */
export function nextStep(status) {
  if (status === 'paid' || status === 'packet_processing') return 'packet';
  if (status === 'packet_ready') return 'filed';
  return null;
}

export function OrderRow({ order, onSaved }) {
  const [docId, setDocId] = useState('');
  const [filedOn, setFiledOn] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const step = nextStep(order.status);
  const run = async (fn) => {
    setBusy(true); setErr('');
    try { await fn(); onSaved(); } catch (e) { reportError('AdminFormationOrders:step', e); setErr(stepError(e)); } finally { setBusy(false); }
  };
  const docs = order.documents || [];
  return (
    <tr className="border-t border-gray-100 dark:border-gray-800 align-top" data-testid={`row-formation-${order.id}`}>
      <td className="py-2 pr-3">
        <div className="font-semibold">{order.company_name}</div>
        <div className="text-xs text-gray-500">{order.project_name || `Project ${order.project_id}`} · {order.jurisdiction_id}</div>
      </td>
      <td className="py-2 pr-3 text-xs">{STATUS_LABEL[order.status] || order.status}</td>
      <td className="py-2 pr-3 text-xs">
        {order.packet_document_id
          ? (docs.find((d) => Number(d.id) === Number(order.packet_document_id))?.title || `Document ${order.packet_document_id}`)
          : <Unrecorded reason="No packet has been attached yet." />}
      </td>
      <td className="py-2 pr-3 text-xs">{order.filed_on || <Unrecorded reason="No filing has been recorded yet." />}</td>
      <td className="py-2 text-xs">
        {step === 'packet' && (
          docs.length ? (
            <div className="flex flex-wrap gap-2 items-center">
              <select value={docId} onChange={(e) => setDocId(e.target.value)} aria-label="Packet document" className="border rounded px-1.5 py-1 dark:bg-gray-900">
                <option value="" disabled>Packet document…</option>
                {docs.map((d) => <option key={d.id} value={String(d.id)}>{d.title}</option>)}
              </select>
              <button type="button" disabled={busy || !docId} onClick={() => run(() => adminIncorporationsApi.packetReady(order.id, Number(docId)))}
                className="px-2 py-1 rounded bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">Packet ready</button>
            </div>
          ) : <Unrecorded reason="The project has no documents to attach. Generate the formation documents first.">No documents</Unrecorded>
        )}
        {step === 'filed' && (
          <div className="flex flex-wrap gap-2 items-center">
            <input type="date" value={filedOn} onChange={(e) => setFiledOn(e.target.value)} aria-label="Filed on" className="border rounded px-1.5 py-1 dark:bg-gray-900" />
            <button type="button" disabled={busy || !filedOn} onClick={() => run(() => adminIncorporationsApi.filed(order.id, filedOn))}
              className="px-2 py-1 rounded bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">Filed with the state</button>
          </div>
        )}
        {err && <div role="alert" className="text-red-700 dark:text-red-300 mt-1">{err}</div>}
      </td>
    </tr>
  );
}

export default function AdminFormationOrders() {
  const [state, setState] = useState({ status: 'loading', orders: [] });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const r = await adminIncorporationsApi.list();
      setState({ status: 'ready', orders: r?.orders || [] });
    } catch (e) {
      reportError('AdminFormationOrders:list', e);
      setState({ status: 'unreadable', orders: [] });
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div data-testid="admin-formation-orders" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-600 dark:text-gray-300">Paid formation orders. Record the packet, then the state filing, as each happens.</p>
        <button type="button" onClick={load} className="text-xs font-semibold text-gray-500 flex items-center gap-1.5"><RefreshCw size={12} /> Refresh</button>
      </div>
      {state.status === 'unreadable' ? (
        <Unreadable what="The formation orders" claim="No order is shown as waiting while they cannot be read." onRetry={load} />
      ) : state.status === 'loading' ? (
        <p className="text-xs text-gray-500">Loading…</p>
      ) : state.orders.length === 0 ? (
        <p className="text-xs text-gray-500">No formation order has been paid yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase text-gray-500">
              <th className="pb-1 pr-3">Company</th><th className="pb-1 pr-3">Status</th><th className="pb-1 pr-3">Packet</th>
              <th className="pb-1 pr-3">Filed on</th><th className="pb-1">Next step</th>
            </tr>
          </thead>
          <tbody>{state.orders.map((o) => <OrderRow key={o.id} order={o} onSaved={load} />)}</tbody>
        </table>
      )}
    </div>
  );
}
