/**
 * D857 (#2502): migration 527's columns on `interview_transcript_segments`,
 * for fixtures built from migration 438 that have no `user_settings` table.
 * Read from the migration itself, so a fixture cannot drift from it.
 */
import { readFileSync } from 'node:fs';

const SQL = readFileSync(new URL('../sql/migrations/527_session_translation.sql', import.meta.url), 'utf8');
export const SEGMENT_TRANSLATION_SQL = SQL.replace(/--.*$/gm, '').split(';').map((s) => s.trim())
  .filter((s) => /^ALTER TABLE interview_transcript_segments ADD COLUMN/.test(s)).map((s) => `${s};`).join('\n');

/** Add 527's segment columns to a fixture database that already has 438's tables. */
export function applySessionTranslationColumns(db) {
  db.exec(SEGMENT_TRANSLATION_SQL);
}
