import React, { useRef, useState } from 'react';
import { Lightbox, actionDanger, actionGhost, actionPrimary } from '../../../ui';
import { reportError } from '../../../lib/log';
import { nameClash, refusalWords } from './companiesModel';

/**
 * D1138 (#3018) — the section's two in-page dialogs: answering an invitation
 * addressed to you (CMP5, CMP12) and New company (the header's button; part 5
 * draws CMP6's name-clash board over this one). Each says what it changes
 * before it changes it, and a refusal is said inside the dialog.
 */

const SUB = 'text-[12.5px] leading-[1.5] text-axal-muted dark:text-gray-400';
const ERR = 'm-0 text-[12.5px] text-axal-destructive dark:text-red-400';
const FIELD = 'rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

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

export const NAME_MAX = 200;

/**
 * New company: you become its primary admin, and it becomes active on this
 * device. D1139 (CMP6): a name one of your companies already has is said
 * under the field before anything is sent; the Worker refuses it either way.
 */
export function NewCompanyDialog({ create, companies = [], onClose, onDone }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const lock = useRef(false);
  const trimmed = name.trim();
  const clash = nameClash(trimmed, companies);
  const ready = trimmed.length > 0 && trimmed.length <= NAME_MAX && !clash;
  const close = () => { if (!lock.current) onClose(); };
  const go = async () => {
    if (lock.current || !ready) return;
    lock.current = true; setBusy(true); setRefusal('');
    try { const out = await create(trimmed); onDone(out); } catch (e) {
      reportError('companies:create', e);
      setRefusal(e?.data?.message || e?.message || 'The company could not be created. Try again.');
    } finally { lock.current = false; setBusy(false); }
  };
  return (
    <Lightbox label="New company" title="New company" onClose={close} width={520} testId="new-company-dialog"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={actionGhost} onClick={close} disabled={busy}>Cancel</button>
          <button type="button" className={actionPrimary} onClick={go} disabled={busy || !ready} data-testid="new-company-confirm">{busy ? 'Creating…' : 'Create and make active'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        <p className={`m-0 ${SUB}`}>You become its primary admin. It becomes your active company on this device.</p>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} className={FIELD} data-testid="new-company-name" />
          <span className={SUB}>{trimmed.length} / {NAME_MAX} characters</span>
          {clash ? <span role="alert" className={ERR} data-testid="new-company-clash">You already have a company called {clash}.</span> : null}
        </label>
        {refusal ? <p role="alert" className={ERR} data-testid="new-company-refusal">{refusal}</p> : null}
      </div>
    </Lightbox>
  );
}
