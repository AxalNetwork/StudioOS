/**
 * D900 (#2679) — "Keep mine, with a note": the founder keeps a stated figure
 * the record disagrees with, and says why. Shared by the deck's check (PD13)
 * and the narrative's (NAR7, #2696).
 *
 * The note sits on the claim (migration 645) beside the figure it was written
 * against (`note_value`). The state stays what the check found: a kept
 * Mismatch is still a Mismatch, with neither figure presumed right. Once the
 * founder states another figure the note no longer applies, and a read says
 * so. Only a Mismatch takes a note; clearing one is always allowed.
 *
 * One cycle row per note, under the claim's own module, never the note's text
 * or a figure.
 */
import type { Env } from '../types';
import { logCycleWriteStatement } from './cycleActivity';
import type { ModuleSlug } from './raiseCycle';

export const CLAIM_NOTE_MAX = 500;

/** The Raise module a surface's claim is written under. */
const MODULE: Record<string, ModuleSlug> = {
  deck: 'pitch-deck', narrative: 'investor-narrative', readiness: 'fundraising-readiness', use_of_funds: 'use-of-funds', cap_table: 'cap-table',
};

export class ClaimNoteError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 409;
  readonly sentence: string;
  constructor(code: string, status: 400 | 404 | 409, sentence: string) {
    super('claim_note_refused'); this.code = code; this.status = status; this.sentence = sentence;
  }
}

/** A note's text, trimmed, or the refusal. */
export function noteText(v: unknown): string {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t) throw new ClaimNoteError('note_required', 400, 'Say why you keep your figure.');
  if (t.length > CLAIM_NOTE_MAX) throw new ClaimNoteError('note_too_long', 400, `A note is at most ${CLAIM_NOTE_MAX} characters.`);
  return t;
}

/**
 * Writes (or, with `text` null, clears) the founder's note on one claim of
 * this venture. The caller has already decided the reader is the founder.
 */
export async function setClaimNote(env: Env, projectId: number, userId: number, claimUid: string, text: string | null) {
  const claim = await env.DB.prepare('SELECT id, surface, state, stated_value FROM raise_claims WHERE uid = ? AND project_id = ?')
    .bind(claimUid, projectId).first<{ id: number; surface: string; state: string; stated_value: string | null }>();
  if (!claim) throw new ClaimNoteError('not_found', 404, 'This claim is not available in this venture.');
  if (text != null && claim.state !== 'mismatch') {
    throw new ClaimNoteError('not_mismatch', 409, 'Only a figure that differs from the record takes a note. Run the check again.');
  }
  const at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const module: ModuleSlug = MODULE[claim.surface] ?? 'fundraising-readiness';
  await env.DB.batch([
    env.DB.prepare('UPDATE raise_claims SET note = ?, note_value = ?, noted_at = ?, noted_by = ? WHERE id = ? AND project_id = ?')
      .bind(text, text == null ? null : claim.stated_value, text == null ? null : at, text == null ? null : userId, claim.id, projectId),
    logCycleWriteStatement(env, {
      projectId, userId, cycle: 'raise', module, entityId: null,
      action: text == null ? 'claim_note_cleared' : 'claim_kept_with_note',
      summary: text == null ? 'Note on a kept figure cleared' : 'Stated figure kept, with a note',
    }),
  ]);
  return { claim_id: claimUid, note: text == null ? null : { text, at }, state: claim.state };
}
