/**
 * #4660 (part 3): what the page says about the member's own text of a draft,
 * from `useDraftEdits`'s state. It claims a text is stored only once the Worker
 * has said so. A failed or conflicting save keeps the text on the page and
 * offers Save again; closing while text is unsaved shows `CloseNotice`, never a
 * silent discard.
 */
import { BTN, ERROR, MUTED } from './emailParts.jsx';

const WORDS = {
  idle: 'Kept in Axal VC as Eadwyn wrote it.',
  dirty: 'Changes not saved yet…',
  saving: 'Saving…',
  saved: 'Your edits are saved.',
};

export default function DraftSaveLine({ state, onRetry, testId = 'draft-save-state' }) {
  const status = state?.status ?? 'idle';
  if (status === 'failed' || status === 'conflict') {
    return <p className={`m-0 flex flex-wrap items-center gap-2 text-[12.5px] ${ERROR}`} role="alert" data-testid={testId} data-state={status}>
      {state.error}
      <button type="button" className={BTN} onClick={onRetry} data-testid={`${testId}-retry`}>Save again</button>
    </p>;
  }
  return <p className={`m-0 text-[12px] ${MUTED}`} role="status" data-testid={testId} data-state={status}>{WORDS[status] ?? WORDS.idle}</p>;
}

/** Shown when a close was pressed with text not stored yet: it saved first, and if that failed, it stays. */
export function CloseNotice({ closing, onRetry, onCloseAnyway, testId = 'draft-close-notice' }) {
  if (!closing) return null;
  if (closing === 'saving') return <p className={`m-0 text-[12.5px] ${MUTED}`} role="status" data-testid={testId}>Saving your changes before closing…</p>;
  return <div className={`${ERROR} flex flex-wrap items-center gap-2`} role="alert" data-testid={testId}>
    <span>Your latest changes are not saved, so this is still open.</span>
    <button type="button" className={BTN} onClick={onRetry} data-testid={`${testId}-retry`}>Try saving again</button>
    <button type="button" className={BTN} onClick={onCloseAnyway} data-testid={`${testId}-discard`}>Close without saving</button>
  </div>;
}
