/**
 * D5914 (#5914, Deals v2 board DE14, canvas section DX14): the one shell the
 * consequential deal dialogs are drawn in. Pass, Move to diligence, Commit,
 * Withdraw and Record transfer each put their fields in it.
 *
 *   · It is the shared `Lightbox`: focus moves in, Tab stays inside, Escape
 *     and the backdrop close it, and focus returns to the control that opened
 *     it. On a phone it is a bottom sheet with 44px buttons.
 *   · Never a browser prompt or confirm.
 *   · A refusal stays in the dialog in the Worker's words, with "Nothing was
 *     recorded." when the sentence does not already say so. A local check
 *     (a missing reason) is said the same way and sends nothing.
 *   · In Super Admin Investor preview (D5915, owner's answer B) the action is
 *     replaced by Return to HQ, which leaves the preview through the shell's
 *     own exit. Nothing is sent.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Lightbox, actionDanger, actionGhost, actionPrimary } from '../../ui';
import { reportError } from '../../lib/log';
import { useViewMode } from '../../contexts/ViewModeContext.js';
import { NOTHING_RECORDED, PREVIEW_ACT, PREVIEW_LINE, PREVIEW_NOTICE, previewActive, refusalWords, saysNothingChanged } from './dealActionModel.js';

const PHONE = 'max-sm:min-h-[44px] max-sm:flex-1';
const REFUSED = 'm-0 rounded-[9px] border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200';
const WARN = 'm-0 rounded-[9px] border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200';
const YOU = 'm-0 flex gap-2 rounded-[9px] border border-axal-lavender-edge bg-axal-lavender px-3 py-2 text-[12.5px] text-axal-violet-deep dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200';

/**
 * A refusal: a sentence, or `{ title, body, tone }` (Record transfer's). `local`
 * marks a check made before anything was sent, which needs no "Nothing was recorded.".
 */
export function DialogRefusal({ refusal, testId }) {
  if (!refusal) return null;
  if (typeof refusal === 'object' && refusal.title) {
    return (
      <div className={refusal.tone === 'warn' ? WARN : REFUSED} role="alert" data-testid={testId}>
        <div className="font-semibold">{refusal.title}</div>
        {refusal.body && <div className="mt-0.5">{refusal.body}{saysNothingChanged(refusal.body) ? '' : ` ${NOTHING_RECORDED}`}</div>}
      </div>
    );
  }
  const text = typeof refusal === 'object' ? refusal.text : refusal;
  const local = typeof refusal === 'object' && refusal.local;
  return <p className={REFUSED} role="alert" data-testid={testId}>{text}{local || saysNothingChanged(text) ? '' : ` ${NOTHING_RECORDED}`}</p>;
}

export default function DealActionDialog({
  title, sub, testId, act, busyLabel = 'Saving…', danger = false, cancel = 'Cancel',
  check, onConfirm, onDone, onClose, children, guarded = true, goId, fallback = 'That could not be saved. Try again.',
  refusalOf, initialRefusal = null, width = 480, initialFocus,
}) {
  const mode = useViewMode();
  const preview = guarded && previewActive(mode);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(initialRefusal);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const close = () => { if (!busy) onClose?.(); };
  const go = async () => {
    if (busy) return;
    const bad = check?.();
    if (bad) { setRefusal(typeof bad === 'string' ? { text: bad, local: true } : { ...bad, local: true }); return; }
    setBusy(true); setRefusal(null);
    try {
      const out = await onConfirm();
      if (live.current) setBusy(false);
      onDone?.(out);
    } catch (e) {
      reportError(`DealAction:${testId}`, e);
      if (!live.current) return;
      setRefusal(refusalOf ? refusalOf(e) : refusalWords(e, fallback));
      setBusy(false);
    }
  };
  const leave = () => { onClose?.(); mode?.exitPreview?.(); };
  return (
    <Lightbox label={title} title={title} sub={sub} onClose={close} width={width} testId={testId} phone="sheet" initialFocus={initialFocus}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={`${actionGhost} ${PHONE}`} onClick={close} disabled={busy} data-testid={`${testId}-cancel`}>{cancel}</button>
          {preview
            ? <button type="button" className={`${actionPrimary} ${PHONE}`} onClick={leave} data-testid={`${testId}-hq`}>{PREVIEW_ACT}</button>
            : <button type="button" className={`${danger ? actionDanger : actionPrimary} ${PHONE}`} onClick={go} disabled={busy} aria-busy={busy || undefined} data-testid={goId || `${testId}-go`}>{busy ? busyLabel : act}</button>}
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-4 text-[13px] text-axal-ink dark:text-gray-100">
        {preview && (
          <div className={YOU} role="note" data-testid={`${testId}-preview`}>
            <span aria-hidden="true">▲</span>
            <div><b>{PREVIEW_NOTICE}</b> {PREVIEW_LINE}</div>
          </div>
        )}
        {children}
        <DialogRefusal refusal={refusal} testId={`${testId}-refused`} />
      </div>
    </Lightbox>
  );
}
