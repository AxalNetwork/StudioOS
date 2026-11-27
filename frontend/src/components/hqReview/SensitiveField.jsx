import React, { useState } from 'react';
import { Eye, Loader2 } from 'lucide-react';
import { SENSITIVE, shownWhen } from './hqReviewCopy';

/**
 * D634 (#1392) — canvas `hq-sensitive`: one identity field, masked until
 * "Show".
 *
 * The record read only ever carries the mask (`kyc_data.masked`, a partner
 * profile's `masked`). "Show" calls `onShow`, which is the field's own route
 * (`GET /kyc/admin/:id/sensitive/:field`, `GET /profiling/admin/:email/
 * sensitive/ein`). That route writes the showing to `activity_logs` before it
 * returns the value, so the line under a shown value is a fact, not a
 * promise. A field the member did not submit is "Not recorded" with its
 * reason, and offers no Show.
 */
export default function SensitiveField({ label, masked, nrReason = SENSITIVE.nrNotSubmitted, onShow, initialShown = null }) {
  const [shown, setShown] = useState(initialShown);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const show = async () => {
    setBusy(true); setErr('');
    try {
      setShown(await onShow());
    } catch (e) {
      setErr(e?.message || 'The value could not be shown. Nothing was logged; try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-1.5" data-testid="hq-sensitive-field">
      <div className="text-xs text-gray-500">{label}</div>
      {masked == null ? (
        <div className="text-xs italic text-gray-500" data-testid="hq-sensitive-nr">{nrReason}</div>
      ) : shown ? (
        <>
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100" data-testid="hq-sensitive-value">{shown.value}</div>
          <div className="text-[11px] text-gray-500" data-testid="hq-sensitive-log">
            Shown by {shown.shown_by || 'you'} · {shownWhen(shown.shown_at) || 'just now'} · logged
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-gray-700 dark:text-gray-300" data-testid="hq-sensitive-mask">{masked}</span>
          <button type="button" onClick={show} disabled={busy} className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:underline disabled:opacity-60 dark:text-violet-300" data-testid="hq-sensitive-show">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />} Show
          </button>
        </div>
      )}
      {err && <div className="text-[11px] text-red-700 dark:text-red-300" role="alert">{err}</div>}
    </div>
  );
}

/** The line every review window with masked fields carries. */
export function SensitiveLine() {
  return <p className="text-[11px] text-gray-500" data-testid="hq-sensitive-line">{SENSITIVE.line}</p>;
}

/** The KYC record's masked fields, in the canvas's order. */
export const KYC_FIELDS = [
  { field: 'date_of_birth', label: 'Date of birth' },
  { field: 'id_number', label: 'ID number' },
  { field: 'address', label: 'Address' },
  { field: 'phone', label: 'Phone' },
];

/**
 * The KYC review window's sensitive block: four masked fields, each with
 * Show, and the tax ID the KYC form does not ask for. `onShow(field)` is the
 * logged route for one field.
 */
export function KycSensitiveFields({ masked, onShow }) {
  const m = masked || {};
  return (
    <div data-testid="hq-kyc-sensitive">
      <SensitiveLine />
      <div className="mt-1 grid grid-cols-1 gap-x-3 sm:grid-cols-2">
        {KYC_FIELDS.map(({ field, label }) => (
          <SensitiveField key={field} label={label} masked={m[field] ?? null} onShow={() => onShow(field)} />
        ))}
        <SensitiveField label="Tax ID" masked={null} nrReason={SENSITIVE.nrTaxIdKyc} />
      </div>
    </div>
  );
}
