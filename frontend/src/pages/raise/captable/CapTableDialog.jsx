import React, { useState } from 'react';
import { Lightbox, actionDanger, actionGhost, actionPrimary } from '../../../ui';

/**
 * D1026 (#2863) — the in-page dialog every Cap table change opens (never a
 * browser pop-up): what it changes and who sees it, the fields, then Cancel
 * and the action. The Worker's refusal sits under the buttons, in its words.
 */
export function useWrite(onDone) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const run = async (write) => {
    setBusy(true); setRefusal('');
    try {
      const out = await write();
      onDone?.(out);
      return out;
    } catch (e) {
      setRefusal(e?.message || 'That could not be saved. Nothing was changed.');
      return null;
    } finally { setBusy(false); }
  };
  return { busy, refusal, run, setRefusal };
}

export default function CapTableDialog({ title, sub, onClose, action, tone = 'primary', disabled, onAction, write, testId, children }) {
  const footer = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={actionGhost} onClick={onClose} disabled={write.busy} data-testid={`${testId}-cancel`}>Cancel</button>
        {action ? (
          <button type="button" className={tone === 'danger' ? actionDanger : actionPrimary} onClick={onAction} disabled={disabled || write.busy} data-testid={`${testId}-go`}>
            {write.busy ? 'Saving…' : action}
          </button>
        ) : null}
      </div>
      {write.refusal ? <p role="alert" className="m-0 text-[12px] font-semibold text-red-700 dark:text-red-300" data-testid={`${testId}-refusal`}>{write.refusal}</p> : null}
    </div>
  );
  return (
    <Lightbox label={title} title={title} sub={sub} onClose={write.busy ? () => {} : onClose} testId={testId} footer={footer} pageBelow="lg">
      <div className="flex flex-col gap-3 px-1 py-1 text-[13px] text-axal-ink dark:text-gray-100">{children}</div>
    </Lightbox>
  );
}
