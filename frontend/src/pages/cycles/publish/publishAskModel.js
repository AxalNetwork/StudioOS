/**
 * #4046 (S1, 2026-11-04) — Ask on Publish to…'s post text: the words and
 * rules of `PublishAskIntent`, with no React and no fetch.
 *
 *   · Ask opens only for a founder who may publish, with at least one place
 *     ticked: Eadwyn writes for the chosen places (`askOpen`).
 *   · Draft is pressable only once the hold is on screen (`canAskDraft`), in
 *     D1442's words ("Holds up to $X · you pay what it uses").
 *   · Accept places the text in the Draft box. Nothing is sent: only the
 *     confirm dialog's Send publishes. Discard leaves the box as it was.
 *   · A text typed over is the founder's own: the "From Eadwyn" mark goes.
 */
import { costLine } from '../../../ui/askPanelModel.js';

export const ASK_LABEL = 'Ask';
export const ASK_NEEDS_PLACE = 'Tick a place first, so Eadwyn writes for it.';
export const ASK_NOT_FOUNDER = 'Only the venture’s founder drafts a post here.';
export const ASK_HOLD_READING = 'Reading what this draft holds…';
export const ASK_ACCEPT_LINE = 'Accept places it in the Draft. Nothing is sent until you confirm Send.';
export const ASK_REPLACES = 'It replaces what the Draft holds now.';
export const ASK_MARK = 'From Eadwyn · edit it before you send. Nothing is sent until you confirm.';
export const ASK_MAX_PLACES = 5;

/** Why Ask is off, or null when it opens. */
export function askOff({ canPublish = false, ticked = [] } = {}) {
  if (!canPublish) return ASK_NOT_FOUNDER;
  if (!ticked.length) return ASK_NEEDS_PLACE;
  return null;
}
export const askOpen = (s) => askOff(s) == null;

/** The ticked places Eadwyn writes for: the first five, as the Worker takes them. */
export const askPlaces = (ticked = []) => [...new Set(ticked)].slice(0, ASK_MAX_PLACES);

/** The hold line, or null while it is not read (never "$0.00"). */
export function askHoldLine(estimate) {
  const n = Number(estimate?.hold_microusd);
  if (estimate?.hold_microusd == null || !Number.isFinite(n) || n <= 0) return null;
  return costLine(n);
}

/** Draft is pressable once its hold is on screen, and not while one runs. */
export const canAskDraft = ({ estimate, busy = false } = {}) => !busy && askHoldLine(estimate) != null;

/** The mark stays while the box still holds exactly what was accepted. */
export const askMarkShown = (accepted, text) => typeof accepted === 'string' && accepted !== '' && accepted === text;
