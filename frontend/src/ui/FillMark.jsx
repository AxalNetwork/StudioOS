import React, { useId, useState } from 'react';
import Lightbox from './Lightbox.jsx';
import { fillsApi } from '../lib/api/fills.js';
import { fillRunLine } from '../lib/fillRun.js';
import { cardLines, markView } from '../lib/fillSheet.js';

/**
 * D1327 (#3488, part 4 of #2431) — Fill with Eadwyn's one mark (AF2, AF8),
 * on every profile's page.
 *
 *   FillGlyph        the single-colour Eadwyn glyph (a violet eye with four
 *                    star points), or the neutral "arrow into a box" while AI
 *                    is off and another source can fill
 *   FillTrigger      the 20px round trigger at the end of a blank field's
 *                    label row: "Fill [field] with Eadwyn". Drawn only when
 *                    the sheet read says so (`field.trigger`): never on a typed,
 *                    never-fill or decision field, never for a reader
 *   FillFormTrigger  the form or section's ghost "Fill"; `FillModuleTrigger`
 *                    the module's "Fill with Eadwyn", with "4 waiting"
 *   FillMark         the provenance pill after a filled value's label:
 *                    "Eadwyn", "Eadwyn · edited", "Eadwyn · sourced",
 *                    "Connector · Mercury · 12 Oct", "Recorded · From
 *                    Validate", "Not saved" before Save, a reader's muted
 *                    "Typed", and "Unreadable" when the marks could not be
 *                    read. Pressing it opens the provenance card (AF8) with
 *                    Undo behind a dialog.
 *
 * No model name and no option key is ever drawn: the card's run line is
 * `fillRunLine`'s, which names the control's label.
 */
const VIOLET = 'text-axal-violet dark:text-violet-300';
const PILL = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 align-middle text-[10px] font-bold leading-none';
const TONES = {
  eadwyn: `${PILL} bg-axal-lavender ${VIOLET} dark:bg-violet-950/50`,
  connector: `${PILL} border border-axal-hairline bg-axal-ground text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100`,
  module: `${PILL} border border-axal-hairline bg-axal-ground text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100`,
  typed: `${PILL} border border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400`,
  unreadable: `${PILL} border border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400`,
  placed: `${PILL} border border-dashed border-axal-violet ${VIOLET} dark:border-violet-400`,
};
const GHOST = 'inline-flex min-h-[32px] items-center gap-1.5 rounded-[9px] border border-axal-hairline bg-white px-2.5 text-[12px] font-semibold text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800 dark:text-gray-100 max-sm:min-h-[44px]';
const BTN = 'inline-flex min-h-[32px] items-center rounded-[9px] bg-axal-violet px-3 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50';

/** The glyph at 12, 14 or 16px: one shape, one colour (`currentColor`). */
export function FillGlyph({ size = 12, neutral = false }) {
  if (neutral) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M3 9.5V13h10V9.5" /><path d="M8 2.5v7" /><path d="M5.2 6.8 8 9.6l2.8-2.8" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M8 4.2c-3 0-5.3 2.3-6.2 3.8.9 1.5 3.2 3.8 6.2 3.8s5.3-2.3 6.2-3.8C13.3 6.5 11 4.2 8 4.2Zm0 6.1A2.3 2.3 0 1 1 8 5.7a2.3 2.3 0 0 1 0 4.6Z" />
      <circle cx="8" cy="8" r="1.1" />
      <path d="M8 .4l.45 1.2L9.6 2 8.45 2.4 8 3.6l-.45-1.2L6.4 2l1.15-.4ZM8 12.4l.45 1.2 1.15.4-1.15.4L8 15.6l-.45-1.2L6.4 14l1.15-.4ZM.4 8l1.2-.45L2 6.4l.4 1.15L3.6 8l-1.2.45L2 9.6l-.4-1.15ZM12.4 8l1.2-.45.4-1.15.4 1.15 1.2.45-1.2.45-.4 1.15-.4-1.15Z" />
    </svg>
  );
}

/**
 * The field's trigger (AF2). `field` is the sheet read's: no trigger unless
 * `field.trigger`. `aiOff` draws the neutral glyph, "Fill from your sources".
 */
export function FillTrigger({ field, label, aiOff = false, running = false, busyElsewhere = false, onOpen }) {
  if (field && !field.trigger) return null;
  const name = label || field?.label || 'this field';
  const words = aiOff ? `Fill ${name} from your sources` : `Fill ${name} with Eadwyn`;
  const title = busyElsewhere ? 'Another fill is running' : aiOff ? 'Fill from your sources' : 'Fill with Eadwyn';
  return (
    <button type="button" aria-label={words} title={title} disabled={busyElsewhere || running} onClick={onOpen}
      data-testid={`fill-trigger-${field?.field || 'field'}`}
      className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed max-sm:h-11 max-sm:w-11">
      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${aiOff ? 'bg-axal-ground text-axal-muted dark:bg-gray-800 dark:text-gray-400' : `bg-axal-lavender ${VIOLET} dark:bg-violet-950/50`} ${busyElsewhere ? 'opacity-50' : ''}`}>
        {running ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" /> : <FillGlyph size={12} neutral={aiOff} />}
      </span>
      {running ? <span className="sr-only">Eadwyn is filling</span> : null}
    </button>
  );
}

/** The form or section's "Fill" (AF3). */
export function FillFormTrigger({ aiOff = false, onOpen, disabled = false }) {
  return (
    <button type="button" className={GHOST} onClick={onOpen} disabled={disabled} title={aiOff ? 'Fill from your sources' : 'Fill with Eadwyn'} data-testid="fill-form-trigger">
      <span className={aiOff ? 'text-axal-muted dark:text-gray-400' : VIOLET}><FillGlyph size={14} neutral={aiOff} /></span>Fill
    </button>
  );
}

/** The module's "Fill with Eadwyn", with the count of proposals waiting (AF2). */
export function FillModuleTrigger({ waiting = 0, onOpen, aiOff = false }) {
  return (
    <button type="button" className={GHOST} onClick={onOpen} data-testid="fill-module-trigger">
      <span className={aiOff ? 'text-axal-muted dark:text-gray-400' : VIOLET}><FillGlyph size={14} neutral={aiOff} /></span>
      {aiOff ? 'Fill from your sources' : 'Fill with Eadwyn'}
      {waiting > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" data-testid="fill-module-waiting">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />{`${waiting} waiting`}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The provenance pill (AF2) and its card (AF8). `mark` is D1325's, or
 * `{ state: 'unreadable' }`, or null. `readOnly` (a reader, AF15): no Undo, and
 * an unfilled value reads "Typed". `placed`: "Not saved" before the form's Save.
 */
export function FillMark({ mark, readOnly = false, placed = false, onUndone }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const id = useId();
  const view = markView(mark, { readOnly, placed });
  if (!view) return null;
  const lines = cardLines(mark, mark?.run !== undefined && mark?.source_kind !== 'connector' && mark?.source_kind !== 'module' ? fillRunLine(mark?.run) : null);
  const glyph = view.kind === 'eadwyn' || view.kind === 'placed';
  const pill = (
    <>
      {glyph ? <FillGlyph size={10} /> : view.dot ? <span className={`h-1.5 w-1.5 rounded-full ${view.dot}`} aria-hidden="true" /> : null}
      {view.text}
      {view.edited ? <span className="h-1 w-1 rounded-full bg-current" aria-hidden="true" /> : null}
    </>
  );
  const cls = `${TONES[view.kind] || TONES.typed} ml-1.5`;
  if (!lines.length) return <span className={cls} data-testid="fill-mark" data-kind={view.kind}>{pill}</span>;
  const canUndo = !readOnly && mark?.provenance_id != null && typeof onUndone === 'function';
  return (
    <span className="relative inline-flex">
      <button type="button" className={cls} aria-expanded={open} aria-controls={id} title={lines.join('\n')} onClick={() => setOpen((o) => !o)}
        data-testid="fill-mark" data-kind={view.kind}>{pill}</button>
      {open ? (
        <span id={id} role="group" aria-label="Where this value came from" data-testid="fill-mark-card"
          className="absolute left-0 top-full z-20 mt-1 flex w-[260px] flex-col gap-1.5 rounded-[12px] border border-axal-hairline bg-white p-3 text-left text-[12px] font-normal text-axal-ink shadow-[0_12px_32px_rgba(9,9,11,.14)] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
          {lines.map((l) => <span key={l} className="whitespace-pre-line">{l}</span>)}
          {canUndo ? <button type="button" className={`${GHOST} mt-1 self-start`} onClick={() => setAsking(true)} data-testid="fill-mark-undo">Undo</button> : null}
        </span>
      ) : null}
      {asking ? <UndoDialog mark={mark} onClose={() => setAsking(false)} onDone={(r) => { setAsking(false); setOpen(false); onUndone(r); }} /> : null}
    </span>
  );
}

/** A connector's head mark ("From GitHub" sections): "Connector · GitHub", read only. */
export function ConnectorMark({ provider, asOf = null }) {
  return <FillMark mark={{ source_kind: 'connector', source_ref: provider, source_label: 'connector', source_as_of: asOf }} readOnly />;
}

/** AF8's Undo: what it restores, then `POST /api/fills/:id/undo`. */
function UndoDialog({ mark, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const prior = mark?.prior_value == null || String(mark.prior_value).trim() === '' ? 'Blank' : String(mark.prior_value);
  const go = async () => {
    setBusy(true); setError(null);
    try { onDone(await fillsApi.undo(mark.provenance_id)); }
    catch (e) { setError(typeof e?.message === 'string' && e.message.trim() ? e.message : 'The fill could not be undone.'); }
    finally { setBusy(false); }
  };
  return (
    <Lightbox label="Undo this fill" title="Undo this fill" width={440} onClose={onClose} testId="fill-undo-dialog"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={BTN} onClick={go} disabled={busy} data-testid="fill-undo-confirm">Undo</button>
        </div>
      )}>
      <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">Restore the value that was there before this fill? This saves the form again.</p>
      <p className="m-0 mt-2 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="fill-undo-prior">{`It goes back to: ${prior}`}</p>
      {error ? <p role="alert" className="m-0 mt-2 text-[12.5px] text-red-700 dark:text-red-300" data-testid="fill-undo-error">{error}</p> : null}
    </Lightbox>
  );
}

/**
 * The Market page's fill (`GET /projects/:id/market-assumptions`' `filled`)
 * as a mark: always Eadwyn's, sourced when it carries a citation.
 */
export function marketFillMark(fill) {
  if (!fill) return null;
  return {
    source_kind: 'eadwyn', fill_class: 'sourced', edited: !!fill.edited,
    citation: fill.citation || null, proposed_value: fill.proposed_value ?? null, run: fill.run,
    provenance_id: fill.provenance_id ?? null,
  };
}
