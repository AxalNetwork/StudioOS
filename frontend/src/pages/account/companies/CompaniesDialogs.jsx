import React, { useRef, useState } from 'react';
import { Lightbox, actionDanger, actionGhost, actionPrimary } from '../../../ui';
import { reportError } from '../../../lib/log';
import { refusalWords } from './companiesModel';

/**
 * D1138 (#3018) — answering an invitation addressed to you (CMP5, CMP12), in
 * an in-page dialog that says what it changes before it changes it, with a
 * refusal said inside it. D1413 (#3696) moved New company to a Sheet
 * (`CreateSheets.jsx`, PF4a), with the name clash said under its field.
 */

const ERR = 'm-0 text-[12.5px] text-axal-destructive dark:text-red-400';

/** One act, said first: `run()` makes the write; its refusal stays in the dialog. */
export function ConfirmDialog({ title, body, button, danger = false, run, onClose, onDone, testId }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const lock = useRef(false);
  const close = () => { if (!lock.current) onClose(); };
  const go = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setRefusal('');
    try { const out = await run(); onDone(out); } catch (e) {
      reportError('companies:answer', e);
      setRefusal(refusalWords(e));
    } finally { lock.current = false; setBusy(false); }
  };
  return (
    <Lightbox label={title} title={title} onClose={close} width={520} testId={testId}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={actionGhost} onClick={close} disabled={busy}>Back</button>
          <button type="button" className={danger ? actionDanger : actionPrimary} onClick={go} disabled={busy} data-testid={`${testId}-confirm`}>{busy ? 'Saving…' : button}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] leading-[1.5] text-axal-ink dark:text-gray-100">{body}</p>
        {refusal ? <p role="alert" className={ERR} data-testid={`${testId}-refusal`}>{refusal}</p> : null}
      </div>
    </Lightbox>
  );
}

/** The longest company name the Worker takes. */
export const NAME_MAX = 200;
