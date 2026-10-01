import React, { useState } from 'react';
import { api } from '../../../lib/api';
import {
  Section, Field, SaveNote, inputClass, buttonClass, ghostButtonClass, formatDay,
} from '../kit';

/**
 * Delivery · Board — the engagement lifecycle and the invoice ledger (D395).
 *
 * WHERE THIS CAME FROM. `/partner/operations/engagements` (`EngagementsPage`)
 * was the only page a firm could use to start an engagement, mark it delivered,
 * issue its invoice or cancel it, and the only one listing what had been
 * invoiced and what was waiting. That page had no canvas, and D304 retires a
 * page only into a canvas-built one doing the same job, so the job moves here,
 * under the board that already lists every engagement this firm holds. The
 * Delivery canvas draws no lifecycle control; the writes are the product's own
 * (`POST /engagements/:id/{start,deliver,invoice,cancel}`), not a design
 * invention, and nothing is added to the Worker for them.
 *
 * THE STEPS ARE THE WORKER'S, MIRRORED. `engTransition` in `routes/needs.ts`
 * decides which transition a status allows and answers anything else with a
 * 409; `lifecycleStepsFor` offers exactly that set so no button is drawn that
 * the Worker would refuse. The Worker stays the boundary.
 *
 * AN INVOICE IS A REAL DOCUMENT with a real number (migration 188); no payment
 * rail is implied, and the ledger says "issued", never "paid".
 */

export const LIFECYCLE_LABEL = {
  accepted: 'Accepted',
  in_progress: 'In progress',
  delivered: 'Delivered',
  reviewed: 'Reviewed',
  invoiced: 'Invoiced',
  cancelled: 'Cancelled',
};

const STEP_LABEL = {
  start: 'Start work',
  deliver: 'Mark delivered',
  invoice: 'Issue invoice',
  cancel: 'Cancel',
};

/** The transitions `engTransition` accepts from a status, in the order a firm takes them. */
export function lifecycleStepsFor(status) {
  const steps = [];
  if (status === 'accepted') steps.push('start');
  if (status === 'accepted' || status === 'in_progress') steps.push('deliver');
  if (status === 'delivered' || status === 'reviewed') steps.push('invoice');
  if (status && !['reviewed', 'invoiced', 'cancelled'].includes(status)) steps.push('cancel');
  return steps;
}

/**
 * The ledger's line for a row: issued (with its number and date), awaiting an
 * invoice, or nothing yet. An invoiced row with no number on it says so rather
 * than printing a blank where the number goes.
 */
export function ledgerLine(row) {
  if (row.status === 'invoiced') {
    const when = row.invoiced_at ? formatDay(row.invoiced_at) : null;
    const num = row.invoice_id ? `Invoice ${row.invoice_id}` : 'Invoice issued, no number recorded';
    return when ? `${num} · issued ${when}` : num;
  }
  if (row.status === 'delivered' || row.status === 'reviewed') {
    return row.delivered_at
      ? `Delivered ${formatDay(row.delivered_at)} · awaiting invoice`
      : 'Delivered · awaiting invoice';
  }
  return null;
}

/** What each step sends, through the same four client methods the retired page used. */
export function runStep(client, step, id, text) {
  const note = (text || '').trim() || undefined;
  if (step === 'start') return client.startEngagement(id);
  if (step === 'deliver') return client.deliverEngagement(id, { delivery_notes: note });
  if (step === 'invoice') return client.invoiceEngagement(id);
  if (step === 'cancel') return client.cancelEngagement(id, { reason: note });
  throw new Error(`Unknown step: ${step}`);
}

function LifecycleRow({ row, client, onChanged }) {
  const [open, setOpen] = useState(null); // 'deliver' | 'cancel' | null
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const steps = lifecycleStepsFor(row.status);
  const ledger = ledgerLine(row);

  const go = async (step) => {
    setBusy(true); setNote(null);
    try {
      await runStep(client, step, row.engagement_id, text);
      setOpen(null); setText('');
      setNote({ ok: true, text: `${STEP_LABEL[step]}: done.` });
      if (onChanged) await onChanged();
    } catch (e) {
      setNote({ ok: false, text: e?.message || `${STEP_LABEL[step]} did not go through.` });
    }
    setBusy(false);
  };

  return (
    <li className="rounded-lg border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900" data-testid="lifecycle-row">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{row.client || 'Client not recorded'}</span>
          {row.scope && <span className="ml-2 text-[12px] text-axal-muted">{row.scope}</span>}
        </div>
        <span className="text-[11px] font-bold uppercase tracking-wide text-axal-faint">
          {LIFECYCLE_LABEL[row.status] || row.status}
        </span>
      </div>
      {ledger && <p className="mt-1 text-[12px] text-axal-muted" data-testid="ledger-line">{ledger}</p>}
      {steps.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {steps.map((step) => (
            <button
              key={step}
              type="button"
              disabled={busy}
              className={step === 'cancel' ? ghostButtonClass : buttonClass}
              onClick={() => (step === 'deliver' || step === 'cancel'
                ? setOpen(open === step ? null : step)
                : go(step))}
            >
              {STEP_LABEL[step]}
            </button>
          ))}
        </div>
      )}
      {open && (
        <div className="mt-3 rounded-lg border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700">
          <Field
            label={open === 'deliver' ? 'Delivery notes' : 'Reason for cancelling'}
            hint={open === 'deliver'
              ? 'What was handed over. The client reads this with the engagement.'
              : 'Kept on the engagement, so whoever reads it next knows why it stopped.'}
          >
            <textarea className={inputClass} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} className={buttonClass} onClick={() => go(open)}>
              {open === 'deliver' ? 'Mark delivered' : 'Cancel the engagement'}
            </button>
            <button type="button" className={ghostButtonClass} onClick={() => { setOpen(null); setText(''); }}>
              Back
            </button>
          </div>
        </div>
      )}
      <SaveNote note={note} />
    </li>
  );
}

/**
 * The section under the board. `rows` are the board's own items, so a row here
 * is always a row the board drew; `client` is injectable for tests and defaults
 * to the api client.
 */
export default function EngagementLifecycle({ rows, client = api, onChanged }) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return null;
  const awaiting = list.filter((r) => r.status === 'delivered' || r.status === 'reviewed').length;
  const issued = list.filter((r) => r.status === 'invoiced').length;
  return (
    <Section title="Lifecycle and invoice ledger">
      <p className="mb-2 text-[12px] leading-relaxed text-axal-muted" data-testid="ledger-summary">
        {issued} invoiced · {awaiting} awaiting an invoice. An invoice here is an issued document with its
        own number; nothing on this page records that it was paid.
      </p>
      <ul className="space-y-2">
        {list.map((r) => (
          <LifecycleRow key={r.engagement_id} row={r} client={client} onChanged={onChanged} />
        ))}
      </ul>
    </Section>
  );
}
