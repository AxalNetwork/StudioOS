/**
 * D1102 (#2982, migration 608) — the founder's NDA choice on Project detail.
 *
 * `project.data_room_nda_choice` is 1 (Yes), 0 (No) or null (not chosen).
 * While it is null the demo-day deck derives "NDA required" from the room's
 * own gates, so the page shows that sentence instead of an unticked box that
 * would read as No. A save sends the choice only when the founder picked one
 * that differs from what is stored: re-sending an untouched value would turn
 * "not chosen" into a No. There is no way back to "not chosen" (the owner's
 * answer on #2982 names none).
 */

/** The stored choice as the page holds it: true, false, or null when not chosen. */
export function ndaChoiceOf(stored) {
  if (stored === 1 || stored === true) return true;
  if (stored === 0 || stored === false) return false;
  return null;
}

/** The Data room section's save body: the URL always; the NDA choice only when the founder changed it. */
export function dataRoomSaveBody(url, choice, stored) {
  const body = { data_room_url: String(url ?? '').trim() || null };
  if (choice !== null && choice !== ndaChoiceOf(stored)) body.data_room_nda_choice = choice;
  return body;
}

export const NDA_CHOICE_LABEL = 'NDA required before access';
export const NDA_CHOICES = [
  { value: true, label: 'Yes' },
  { value: false, label: 'No' },
];
export const NDA_UNSET_LINE = 'Not chosen yet. Until you choose, the deck asks for an NDA when any file you share with investors is NDA-gated.';
