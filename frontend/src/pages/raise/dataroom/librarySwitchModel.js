/**
 * D6913 part 2 (#6913, canvas RS-17): the founder's per-room switch on Data room › Access, "Investors' own Ask",
 * over D6869's `GET`/`PUT /api/room-library/settings/:projectUid`. Pure words and rules; `LibrarySwitch.jsx` draws them.
 *
 * Off is the default for every room. When on, an investor the founder granted can add a file they can open to their
 * own Library, and their Ask can cite it while their grant is live. Turning it off goes Scope → Review → Result and
 * removes every copy's reach at once (D6869 `lapseRoom`). Only the room's owner changes it (`can_change`).
 */

export const SWITCH_TITLE = 'Investors’ own Ask';
export const SWITCH_LINE = 'Investors may use open files in their own Ask (Library and Research)';
export const SWITCH_EXPLAINS = 'When on, an investor you granted can add a file they can open to their Library, and their Ask can cite it while their grant is live. You see each Add and Remove in Activity. Turning it off removes every copy’s reach at once. NDA files follow the NDA; this switch never opens them.';
export const OWNER_ONLY = 'Only the room’s owner turns this on or off.';

/** The state line under the switch. */
export function switchState(read) {
  if (!read || read.state !== 'ready') return null;
  return read.allow ? 'On' : 'Off · the default for every room';
}

/** RS-17 Review: what turning it off changes, with the Worker's own count of live copies. */
export function offReview(liveReferences) {
  const n = Number.isInteger(liveReferences) ? liveReferences : null;
  const reach = n == null ? 'Every file in an investor’s Library from this room loses its reach now'
    : n === 0 ? 'No investor has a file from this room in their Library, so nothing loses its reach'
      : `${n} ${n === 1 ? 'file' : 'files'} in investors’ Libraries ${n === 1 ? 'loses its' : 'lose their'} reach now`;
  return [
    reach,
    'Their past answers keep their text; citations read No longer available',
    'Your files and the investors’ room access do not change',
  ];
}

/** RS-17 Result: what happened, from the PUT's own answer. */
export function offResult(answer) {
  const n = Number(answer?.lapsed);
  if (!Number.isFinite(n)) return 'Turned off. Investors can no longer add this room’s files to their Library.';
  return n === 0
    ? 'Turned off. No file had to lose its reach.'
    : `Turned off. ${n} ${n === 1 ? 'file' : 'files'} in investors’ Libraries lost their reach.`;
}
export const ON_RESULT = 'Turned on. An investor you granted can now add a file they can open to their Library.';

const REFUSALS = {
  owner_only: OWNER_ONLY,
  room_not_found: 'This room could not be found.',
  bad_allow_library: 'Say whether the switch is on or off.',
};
export function switchError(e) {
  const code = e?.code || e?.data?.error || null;
  return (code && REFUSALS[code]) || 'Nothing changed. Try again.';
}
