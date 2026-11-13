/**
 * D1303 (#3400) — who saved an account's internal notes, and when (ACC6:
 * "Last saved on [date] by [Admin Name]"), over migration 639's
 * `account_note_saves`. The notes themselves stay in `users.admin_notes`;
 * this keeps only the saver, the time and the length, never the text.
 */
import type { Env } from '../types';

export type NotesSaved =
  | { recorded: true; by: { id: number | null; name: string | null }; at: string; chars: number }
  | { recorded: false; reason: string; unreadable?: true };

export const NOTES_NOT_RECORDED = 'Not recorded: these notes were saved before who saved them was kept.';
export const NOTES_NONE = 'No notes saved yet.';
export const NOTES_UNREADABLE = 'Who saved these notes could not be read. Try again.';

/** The statement that records a save; it goes in the same batch as the notes themselves. */
export function noteSaveStatement(env: Env, userId: number, savedBy: number, chars: number) {
  return env.DB.prepare(
    `INSERT INTO account_note_saves (user_id, saved_by, saved_at, chars) VALUES (?, ?, datetime('now'), ?)
     ON CONFLICT(user_id) DO UPDATE SET saved_by = excluded.saved_by, saved_at = excluded.saved_at, chars = excluded.chars`,
  ).bind(userId, savedBy, chars);
}

/** The last save, or why there is none. A note saved before migration 639 has no saver, and says so. */
export async function notesSavedOf(env: Env, userId: number, hasNotes: boolean): Promise<NotesSaved> {
  try {
    const r = await env.DB.prepare(
      `SELECT s.saved_by, s.saved_at, s.chars, u.name FROM account_note_saves s LEFT JOIN users u ON u.id = s.saved_by WHERE s.user_id = ?`,
    ).bind(userId).first<{ saved_by: number | null; saved_at: string; chars: number; name: string | null }>();
    if (r) return { recorded: true, by: { id: r.saved_by == null ? null : Number(r.saved_by), name: r.name ?? null }, at: r.saved_at, chars: Number(r.chars) };
    return { recorded: false, reason: hasNotes ? NOTES_NOT_RECORDED : NOTES_NONE };
  } catch {
    return { recorded: false, unreadable: true, reason: NOTES_UNREADABLE };
  }
}
