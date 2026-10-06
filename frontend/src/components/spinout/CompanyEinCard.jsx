// D579 (#1206) — the company's EIN on the Lab Incorporate page.
//
// The number is stored encrypted by the Worker (routes/company_ein.ts). This
// card shows the last four digits only. The full number appears in one place:
// the founder's own edit field, read with `full` when they open it and dropped
// again when they close it. Storing a valid EIN marks the Lab's
// `ein_received`; the Worker does that, not this card.
//
// Every number in a test of this card is synthetic.
import React, { useState } from 'react';
import { Hash } from 'lucide-react';
import { companyEinApi } from '../../lib/api/companyEin.js';
import { reportError } from '../../lib/log';
import { Unrecorded } from '../../ui';

export const EIN_SHAPE = /^\d{2}-\d{7}$/;
export const EIN_REASONS = {
  none: 'No EIN is recorded for this company yet. The IRS issues it after the state approves the filing.',
  unreadable: 'The EIN record could not be read. Reload to try again.',
  noProject: 'There is no company record yet.',
  invalid: 'Enter the EIN as two digits, a hyphen and seven digits (NN-NNNNNNN).',
};
/** What the investor preview shows: investors never read the EIN (the owner's answer 2A). */
export const EIN_NOT_SHARED = 'Investors do not see the EIN: only the founders, company editors and Axal admins read it (D579).';

/** The masked line for a read: `••-•••1234`, Not recorded, or Unreadable. */
export function EinValue({ ein }) {
  if (!ein || ein.status === 'loading') return '…';
  if (ein.status === 'unreadable') return <Unrecorded reason={EIN_REASONS.unreadable}>Unreadable</Unrecorded>;
  if (ein.status === 'no-project') return <Unrecorded reason={EIN_REASONS.noProject} />;
  return ein.data?.recorded ? ein.data.masked : <Unrecorded reason={EIN_REASONS.none} />;
}

/** The investor preview's tile: never the number, whether or not one is stored. */
export function EinPreviewValue({ ein }) {
  if (!ein || ein.status === 'loading') return '…';
  if (ein.status === 'unreadable') return <Unrecorded reason={EIN_REASONS.unreadable}>Unreadable</Unrecorded>;
  if (ein.status === 'ready' && ein.data?.recorded) return <Unrecorded reason={EIN_NOT_SHARED}>Not shared</Unrecorded>;
  return <Unrecorded reason={EIN_REASONS.none} />;
}

export default function CompanyEinCard({ projectId, ein, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const canEdit = !!projectId && ein?.status === 'ready';

  const open = async () => {
    setErr(''); setBusy(true);
    try {
      const full = ein?.data?.recorded ? await companyEinApi.read(projectId, { full: true }) : null;
      setValue(full?.ein || '');
      setEditing(true);
    } catch (e) {
      reportError('CompanyEinCard:open', e);
      setErr(EIN_REASONS.unreadable);
    } finally {
      setBusy(false);
    }
  };
  const close = () => { setEditing(false); setValue(''); setErr(''); };
  const save = async (e) => {
    e.preventDefault();
    const v = value.trim();
    if (!EIN_SHAPE.test(v)) { setErr(EIN_REASONS.invalid); return; }
    setBusy(true); setErr('');
    try {
      const saved = await companyEinApi.save(projectId, v);
      close();
      onSaved?.(saved);
    } catch (e2) {
      reportError('CompanyEinCard:save', e2);
      setErr(e2?.code === 'ein_invalid' ? EIN_REASONS.invalid : (e2?.message || 'The EIN could not be saved.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-4" data-testid="card-company-ein">
      <div className="flex items-center gap-2 mb-1.5">
        <Hash size={15} className="text-violet-600" />
        <span className="text-[12.5px] font-bold text-gray-900 dark:text-gray-100">Company EIN</span>
      </div>
      {editing ? (
        <form onSubmit={save} className="flex flex-wrap items-center gap-2 text-[12px]">
          <input
            type="text" inputMode="numeric" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)}
            placeholder="NN-NNNNNNN" aria-label="EIN" data-testid="input-company-ein"
            className="border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 font-mono dark:bg-gray-900"
          />
          <button type="submit" disabled={busy} className="px-2.5 py-1 rounded-lg bg-violet-600 text-white disabled:opacity-50">Save</button>
          <button type="button" onClick={close} className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700">Cancel</button>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-2 text-[12px] text-gray-600 dark:text-gray-300">
          <span className="font-mono" data-testid="text-company-ein"><EinValue ein={ein} /></span>
          {canEdit && (
            <button type="button" onClick={open} disabled={busy} data-testid="button-edit-company-ein" className="text-violet-700 dark:text-violet-300 font-semibold">
              {ein.data?.recorded ? 'Edit' : 'Add EIN'}
            </button>
          )}
        </div>
      )}
      {err && <p role="alert" className="mt-1.5 text-[11.5px] text-red-700 dark:text-red-300">{err}</p>}
      <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">Stored encrypted. Only the last four digits are shown; investors do not see it.</p>
    </div>
  );
}
