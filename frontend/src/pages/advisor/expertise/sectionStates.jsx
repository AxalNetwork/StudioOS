import React from 'react';
import { DataState } from '../../../ui';
import { isLicenceSentence } from './licenceRefusal';
import { limitLine, limitState } from './feedback';

/**
 * D4828 (#4828, EX-14 and EX-16) — the states and the feedback every Expertise
 * zone draws, on #5129's shared components (`ui/Honesty.jsx`). `kit.jsx` reads
 * these: `ZoneBody` draws `SectionState` for a zone that names `what` it reads,
 * `Field` draws `LimitCounter` under a control that has a `limit`, and the kit
 * re-exports `InlineSaveStatus` (and `SaveNote`, its shipped name).
 */

/** "Your services" → "your services", for a sentence that does not start with it. */
const midSentence = (what) => String(what).replace(/^Your\b/, 'your');

/**
 * One Expertise section's loading, refused or unavailable state. Exactly one applies:
 *
 *   loading      a skeleton in the section's place, and the word for a screen
 *                reader ("Loading your services…"): a skeleton is only shapes;
 *   refused      the Advisor licence refusal (#5363): Refused, the licence
 *                sentence and where to get one, and no Try again, because
 *                reading again cannot change the answer;
 *   unavailable  the read failed: the Unavailable chip, the zone's own fixed
 *                sentence, what this is not evidence of, and Try again for this
 *                section only. Never a zero and never the empty state.
 */
export function SectionState({ what, loading, error, onRetry }) {
  if (loading) {
    return (
      <div role="status" aria-busy="true" data-section-state="loading">
        <span className="sr-only">{`Loading ${midSentence(what)}…`}</span>
        <DataState state="loading" size="block" />
      </div>
    );
  }
  if (error && isLicenceSentence(error)) {
    return (
      <DataState state="refused" size="block" claim={error} data-testid="advisor-licence-required"
        accessRoute={<span className="text-[12px] text-gray-600 dark:text-gray-400">This account does not hold the Advisor licence. Ask HQ to add it.</span>} />
    );
  }
  if (error) {
    return (
      <DataState state="unavailable" size="block" claim={error} announce="always" onRetry={onRetry} retryLabel="Try again"
        reason="Nothing is shown rather than an empty list, because an empty list would say you have no records. Other sections are unaffected." />
    );
  }
  return null;
}

/**
 * A field's limit, counted live (EX-16). Returns the props the control takes
 * (its counter in `aria-describedby`, and `aria-invalid` over the limit) and the
 * counter to draw under it, or nulls when the field has no limit. Nothing is
 * cut: the control carries no maxLength, and the zone blocks the save.
 */
export function useLimit(control, limit) {
  const id = React.useId();
  if (!limit || !React.isValidElement(control)) return { id: null, props: null, node: null };
  const count = limitState(control.props.value, limit);
  const node = (
    <span id={id} aria-live={count.ok ? 'off' : 'polite'} data-field-limit={count.ok ? 'within' : 'over'}
      className={`mt-1 flex items-center gap-1 text-[11px] tabular-nums ${count.ok ? 'text-axal-faint' : 'font-semibold text-red-700 dark:text-red-300'}`}>
      {/* Over the limit says so in words and with a cross, never by colour alone. */}
      {count.ok ? null : <span aria-hidden="true">✕</span>}
      {limitLine(count)}
    </span>
  );
  return { id, props: count.ok ? {} : { 'aria-invalid': 'true' }, node };
}

/**
 * Saved / not saved, said once, above the thing that was saved: the canvas's
 * `InlineSaveStatus`, THE ONE FEEDBACK COMPONENT for a save, a failed save and
 * a destructive outcome ("Profile updated" against "Not saved, your text is
 * kept"). `SaveNote` is this component under the name its importers use.
 *
 * D4711: THE REGION IS ALWAYS THERE, EMPTY OR NOT. A screen reader announces a
 * live region's changes, not its arrival, so the region renders empty from the
 * start and the sentence lands in it. A failure is also `role="alert"` (#4698,
 * D4924's Delivery forms): an alert interrupts, and it is how a refusal is found
 * by role. A save stays the polite status around it.
 *
 * A tick or a cross leads the sentence, so saved and not saved differ by shape
 * as well as by hue (WCAG 1.4.1). The glyph is hidden from a screen reader,
 * which hears the sentence and the alert.
 */
export function InlineSaveStatus({ note, testid }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" data-testid={testid}>
      {note ? (
        <p role={note.ok ? undefined : 'alert'} data-save-status={note.ok ? 'saved' : 'not-saved'}
          className={`mt-2 flex items-start gap-1.5 text-[12px] font-semibold ${note.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
          {/* The sentence comes first in the markup, as it shipped; the glyph is drawn before it (`order-first`). */}
          {note.text}
          <SaveGlyph ok={note.ok} />
        </p>
      ) : null}
    </div>
  );
}

/** A tick or a cross drawn as lines: no text, so the sentence read is the sentence alone. */
function SaveGlyph({ ok }) {
  return (
    <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 12 12" className="order-first mt-[2px] flex-none" data-save-glyph={ok ? 'tick' : 'cross'}>
      {ok
        ? <><line x1="2" y1="6.5" x2="4.8" y2="9.2" stroke="currentColor" strokeWidth="1.8" /><line x1="4.8" y1="9.2" x2="10" y2="3" stroke="currentColor" strokeWidth="1.8" /></>
        : <><line x1="2.5" y1="2.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1.8" /><line x1="9.5" y1="2.5" x2="2.5" y2="9.5" stroke="currentColor" strokeWidth="1.8" /></>}
    </svg>
  );
}

/** The shipped name for `InlineSaveStatus`, kept for its importers. */
export const SaveNote = InlineSaveStatus;
