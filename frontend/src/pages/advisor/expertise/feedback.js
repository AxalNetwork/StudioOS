/**
 * D4828 (#4828, EX-14 and EX-16) — what Expertise says after a save, and how
 * a field's limit is counted. Pure, so the zones and their tests read one copy.
 *
 * ONE FEEDBACK PATTERN. A save, a failure and a destructive outcome are each
 * one sentence in `InlineSaveStatus` (`kit.jsx`): a save is announced politely,
 * a failure as an alert. The canvas's pair is "Profile updated" against "Not
 * saved, your text is kept": a failed save never clears what the person typed,
 * and the sentence says so.
 *
 * A LIMIT IS COUNTED, NEVER CUT. The Worker trims a value and refuses one
 * longer than its limit (`services/advisorLimits.ts`, D4674). An input's
 * `maxLength` cut a paste silently at the limit, so the text the person saw
 * was not the text they meant. The fields now carry a live counter instead,
 * and a value over its limit blocks the save and says by how much.
 */

export const SAVED = Object.freeze({
  profile: 'Profile updated.',
});

/** The failed-save sentence: the text stays in the form, and the reason follows. */
export const NOT_SAVED_KEPT = 'Not saved, your text is kept.';
export function notSavedKept(reason) {
  const why = String(reason || '').trim();
  return why ? `${NOT_SAVED_KEPT} ${why}` : NOT_SAVED_KEPT;
}

/** How long a value is, the way the Worker counts it: trimmed, in string length. */
export function limitState(value, limit) {
  const used = String(value ?? '').trim().length;
  const max = Number(limit);
  const over = Number.isFinite(max) ? Math.max(0, used - max) : 0;
  return { used, limit: max, over, ok: over === 0 };
}

/** The counter's words: "12 of 200 characters", or how far over and what to do. */
export function limitLine({ used = 0, limit, over = 0 } = {}) {
  if (over > 0) {
    return `${over} ${over === 1 ? 'character' : 'characters'} over the ${limit} limit. Shorten it to save; nothing is cut.`;
  }
  return `${used} of ${limit} characters`;
}

/** The draft keys whose values are over their limits, in the limits' order. */
export function overLimitKeys(draft, limits) {
  return Object.entries(limits || {})
    .filter(([key, max]) => draft && Object.hasOwn(draft, key) && !limitState(draft[key], max).ok)
    .map(([key]) => key);
}

/** The sentence a blocked save shows, naming each field by its label. */
export function overLimitLine(keys, labels = {}) {
  const names = (keys || []).map((k) => labels[k] || k.replace(/_/g, ' '));
  if (!names.length) return '';
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return notSavedKept(`${list} ${names.length === 1 ? 'is' : 'are'} over the limit.`);
}
