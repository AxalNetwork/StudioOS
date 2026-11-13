/**
 * D1102 (#2982, migration 608) — whether the demo-day deck says the data room
 * needs an NDA, and what a write may store as the founder's choice.
 *
 * THE FOUNDER'S CHOICE WINS. `projects.data_room_nda_choice` is 1 (Yes), 0 (No)
 * or NULL (not chosen). A choice is kept as made, No included. The old
 * `data_room_nda_required` column is never read for it: its 0 still means
 * "unset or No" (migration 608's header).
 *
 * AN UNSET CHOICE DERIVES FROM THE ROOM'S OWN GATES: true when any file an
 * investor can be admitted to is gated `nda`. "Can be admitted to" is the
 * file's own tier and window (`tierAdmits`, asked for the most an investor can
 * hold: committed, every folder), so a file shared with nobody, or whose window
 * has closed, asks no one for an NDA. Whether anyone has signed one yet is not
 * asked: `readableRoomFiles` counts an `nda` file only once a granted investor
 * has signed, so it would answer No for exactly the room that needs one.
 *
 * A ROOM THAT CANNOT BE READ IS null, never false: the deck then says
 * "Unreadable" rather than "Not required".
 */
import type { Env } from '../types';
import { tierAdmits } from './dataRoomAccess';

export type NdaChoice = 0 | 1 | null;

/** The stored choice: 1 or 0 is a choice; anything else, NULL included, is none. */
export function storedNdaChoice(v: unknown): NdaChoice {
  return v === 1 || v === 0 ? v : null;
}

/**
 * What a write received, as a choice to store: Yes or No (`true`/`false`, or
 * 1/0), else `undefined`. There is no clear back to unset: a choice, once made,
 * is changed by the other choice.
 */
export function ndaChoiceInput(v: unknown): 0 | 1 | undefined {
  if (v === true || v === 1) return 1;
  if (v === false || v === 0) return 0;
  return undefined;
}

/** True when any file an investor can be admitted to is gated `nda`. Throws when the files cannot be read. */
export async function roomGatesAskNda(env: Env, projectId: number, now: number = Date.now()): Promise<boolean> {
  const res: { success?: boolean; results?: { access_tier: string | null; access_expires_at: string | null }[] } = await env.DB.prepare(
    "SELECT access_tier, access_expires_at FROM data_room_files WHERE project_id = ? AND visibility = 'nda'",
  ).bind(projectId).all();
  if (res.success === false || !Array.isArray(res.results)) throw new Error('Data room files unreadable');
  return res.results.some((f) => tierAdmits(f, true, now, null));
}

/** The deck's `nda_required`: the founder's choice; else the room's gates; else null when they cannot be read. */
export async function deckNdaRequired(env: Env, projectId: number, stored: unknown): Promise<boolean | null> {
  const choice = storedNdaChoice(stored);
  if (choice !== null) return choice === 1;
  try { return await roomGatesAskNda(env, projectId); }
  catch { return null; }
}
