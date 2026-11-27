import React, { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Pill } from '../../ui';
import { titleCase } from '../../lib/absence';
import { CONTENT_STATUS_TONE } from './learningModel';

/** The studio's form parts (D562 stage 2), shared by the item editor and the course builder. */

export const INPUT = 'w-full rounded-axal-md border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink placeholder:text-axal-faint dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
export const BUTTON = 'inline-flex items-center gap-1 rounded-axal-sm px-3 py-1.5 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
export const PRIMARY = `${BUTTON} bg-axal-violet text-white hover:bg-axal-violet-deep`;
export const SECONDARY = `${BUTTON} border border-axal-hairline text-axal-ink hover:border-axal-violet/40 dark:border-gray-700 dark:text-gray-200`;
export const DANGER = `${BUTTON} border border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40`;

/** A labelled input, textarea or select. `full` spans both columns. */
export function Field({ id, label, hint, full = false, children }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label htmlFor={id} className="mb-1 block text-[12px] font-semibold text-axal-ink dark:text-gray-200">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11.5px] text-axal-faint dark:text-gray-500">{hint}</p>}
    </div>
  );
}

/** The route's refusal, as it came: the studio never rewrites a route's sentence. */
export function ErrorLine({ error, testid = 'studio-error' }) {
  if (!error) return null;
  return <p className="text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid={testid}>{error}</p>;
}

export function StatusPill({ status }) {
  return <Pill tone={CONTENT_STATUS_TONE[status] || 'neutral'}>{titleCase(status) || 'Status not recorded'}</Pill>;
}

/** A destructive step asked twice: the sentence, then the button that does it. */
export function ConfirmRow({ text, action, onConfirm, onCancel, busy, testid }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-axal-md border border-red-200 bg-red-50/60 px-3 py-2 dark:border-red-900 dark:bg-red-950/30" data-testid={testid}>
      <span className="text-[12.5px] text-red-800 dark:text-red-200">{text}</span>
      <button type="button" className={DANGER} onClick={onConfirm} disabled={busy}>{action}</button>
      <button type="button" className={SECONDARY} onClick={onCancel}>Cancel</button>
    </div>
  );
}

/**
 * Publish, unpublish and archive, by the stored status: publish anything not
 * published, unpublish (back to draft) anything not a draft, archive anything
 * not archived. Archiving asks first, because members lose the content at once.
 */
export function StatusActions({ status, what, onStatus, busy }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="space-y-2" data-testid="studio-status-actions">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-axal-muted dark:text-gray-400">Status</span>
        <StatusPill status={status} />
        {status !== 'published' && (
          <button type="button" className={PRIMARY} onClick={() => onStatus('publish')} disabled={busy} data-testid="button-studio-publish">Publish</button>
        )}
        {status !== 'draft' && (
          <button type="button" className={SECONDARY} onClick={() => onStatus('unpublish')} disabled={busy} data-testid="button-studio-unpublish">Unpublish</button>
        )}
        {status !== 'archived' && !confirming && (
          <button type="button" className={DANGER} onClick={() => setConfirming(true)} disabled={busy} data-testid="button-studio-archive">Archive</button>
        )}
      </div>
      {confirming && (
        <ConfirmRow
          text={`Archive this ${what}? Members lose it at once; it stays here, and can be published again.`}
          action="Archive"
          busy={busy}
          onConfirm={() => { setConfirming(false); onStatus('archive'); }}
          onCancel={() => setConfirming(false)}
          testid="studio-confirm-archive"
        />
      )}
    </div>
  );
}

/** Up and down, each disabled at its end. */
export function MoveButtons({ index, count, onMove, label, busy }) {
  return (
    <span className="inline-flex gap-1">
      <button type="button" className={SECONDARY} onClick={() => onMove(-1)} disabled={busy || index === 0} aria-label={`Move ${label} up`}>
        <ArrowUp size={13} aria-hidden="true" />
      </button>
      <button type="button" className={SECONDARY} onClick={() => onMove(1)} disabled={busy || index === count - 1} aria-label={`Move ${label} down`}>
        <ArrowDown size={13} aria-hidden="true" />
      </button>
    </span>
  );
}
