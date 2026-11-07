/**
 * D4692 (#4692) — what a Practice page says when the Worker refuses a booking or
 * engagement change, apart from the pages that draw it (a pure module, so a test
 * can load it without React).
 *
 * The Worker's sentence is shown as written: a refusal says what rule applied in
 * plain words and names nothing about anyone else's record. A CONFLICT is the one
 * refusal with a remedy the page can offer: 409 `changed_while_looking` means the
 * record moved after it was read (another press, another tab, the other party),
 * so the page offers to reload it and leaves whatever the person typed alone.
 */

export const CHANGED_CODE = 'changed_while_looking';

/** True when the refusal is "this record changed while you were looking at it". */
export function isStale(error) {
  return Number(error?.status) === 409 && error?.code === CHANGED_CODE;
}

/** The note a failed change shows: the Worker's words, or `fallback` when it sent none. */
export function failureNote(error, fallback) {
  return { ok: false, text: error?.message || fallback, stale: isStale(error) };
}
