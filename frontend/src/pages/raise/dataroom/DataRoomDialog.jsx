import React, { useState } from 'react';
import { Lightbox, actionDanger, actionGhost, actionPrimary } from '../../../ui';

/**
 * D1106 (#2986) — the one in-page dialog every Data room change opens. It says
 * what the change does before anything is saved; the refusal, if the Worker
 * gives one, stays inside it. Never a browser pop-up.
 *
 * `onConfirm` returns a promise. While it runs the dialog is busy and cannot
 * be closed; a throw keeps it open with its sentence.
 */
export default function DataRoomDialog({ copy, onClose, onConfirm, danger = false, children = null, disabled = false, refusalOf = null, testId = 'dataroom-dialog' }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const close = () => { if (!busy) onClose(); };
  const go = async () => {
    setBusy(true); setRefusal(null);
    try { await onConfirm(); } catch (e) { setRefusal(refusalOf ? refusalOf(e) : (e?.message || 'That did not go through. Try again.')); setBusy(false); }
  };
  return (
    <Lightbox label={copy.title} title={copy.title} onClose={close} testId={testId}
      footer={(
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={actionGhost} onClick={close} disabled={busy}>{danger ? 'Keep' : 'Cancel'}</button>
            <button type="button" className={danger ? actionDanger : actionPrimary} onClick={go} disabled={busy || disabled} data-testid={`${testId}-go`}>{busy ? 'Saving…' : copy.action}</button>
          </div>
          {refusal ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid={`${testId}-refusal`}>{refusal}</p> : null}
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-4 text-[13px] leading-normal text-axal-ink dark:text-gray-100">
        {copy.body ? <p className="m-0" data-testid={`${testId}-body`}>{copy.body}</p> : null}
        {children}
      </div>
    </Lightbox>
  );
}

/** A Worker refusal as one sentence; a co-founder's gate is the owner's. */
export function roomRefusal(e) {
  const status = Number(e?.status);
  if (status === 403 && (e?.data?.code === 'owner_only' || e?.code === 'owner_only')) return 'Only the venture’s owner can do that.';
  if (status === 409) return 'Something else changed this a moment ago. Close this and try again.';
  if (status === 404) return 'That is no longer in the room.';
  if (status === 423) return 'Changes are paused for your account right now. Reading still works.';
  return 'That did not go through. Try again.';
}
