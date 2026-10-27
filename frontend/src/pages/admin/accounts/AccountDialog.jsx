import React, { useState } from 'react';
import { useEscapeClose } from '../../../components/useEscapeClose';
import { reasonReady, refusalSentence } from './accountDrawerModel';

/**
 * D1306 (#3403, ACC7) — the one in-page dialog every account change opens, in
 * place of `window.confirm`, `window.prompt` and `alert`. It says what the
 * change does and who is told, asks for a reason where the Worker wants one,
 * and keeps a refusal inside itself in one sentence: the dialog stays open and
 * nothing is assumed to have happened.
 *
 * `spec` comes from `accountDrawerModel.accountDialog`. `onConfirm(reason)`
 * returns the change's promise; the dialog closes only when it resolves.
 */
export default function AccountDialog({ spec, onCancel, onConfirm, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEscapeClose(onCancel);
  if (!spec) return null;
  const ready = reasonReady(spec, reason);

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm(reason.trim());
      if (onDone) onDone();
    } catch (e) {
      setError(refusalSentence(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" data-testid="account-dialog">
      <div role="dialog" aria-modal="true" aria-labelledby="account-dialog-title"
        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-900">
        <h3 id="account-dialog-title" className="text-base font-bold text-gray-900 dark:text-gray-100">{spec.title}</h3>
        {(spec.paras || []).map((p) => (
          <p key={p} className="mt-2 text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400">{p}</p>
        ))}
        {spec.reason && (
          <>
            <label htmlFor="account-dialog-reason" className="mt-4 block text-[12px] font-medium text-gray-700 dark:text-gray-300">
              {spec.reason.label}{spec.reason.required ? ' · required' : ' · optional'}
            </label>
            <textarea id="account-dialog-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={spec.reason.placeholder} maxLength={spec.reason.max || undefined} data-testid="account-dialog-reason"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100" />
            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              {spec.reasonNote || (spec.reason.required ? 'At least ten characters. It is recorded with the change.' : 'Recorded with the change if you give one.')}
            </p>
          </>
        )}
        {spec.note && <p className="mt-3 text-[11.5px] text-gray-500 dark:text-gray-400">{spec.note}</p>}
        {spec.told && <p className="mt-2 text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="account-dialog-told">{spec.told}</p>}
        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300" data-testid="account-dialog-error">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} data-testid="account-dialog-cancel"
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200">
            Cancel
          </button>
          <button type="button" onClick={confirm} disabled={busy || !ready} data-testid="account-dialog-confirm"
            className={`rounded-lg px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${spec.confirm.tone === 'neg' ? 'bg-red-700 hover:bg-red-800' : 'bg-violet-600 hover:bg-violet-700'}`}>
            {busy ? 'Working…' : spec.confirm.label}
          </button>
        </div>
      </div>
    </div>
  );
}
