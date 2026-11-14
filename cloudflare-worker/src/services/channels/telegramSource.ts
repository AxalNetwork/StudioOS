/** D866 §4 (#2618): source changes are scoped to the proven chat/session.
 * The temporary model token is visible only inside one atomic D1 batch:
 * a replay or a competing edit that loses the claim cannot touch proposals.
 */
import type { Env } from '../../types';
import type { ChannelConnection } from './connections';
import type { ThreadRow } from './threads';
import { refKey } from './events';
import { IntakeError, writableSession, TRANSCRIPT_MIRROR_MAX_BYTES } from '../interviewIntake';
import { SOURCE_DELETED_TEXT, SOURCE_DELETED_NOTE } from '../interviewSessions';
import { toSegments, type SegmentRow } from '../interviewStructuring';
import { enqueueDigest } from '../validateEngine';

export async function changeTelegramSource(
  env: Env, conn: ChannelConnection, thread: ThreadRow, messageIds: readonly string[], text: string | null,
): Promise<number> {
  if (conn.provider !== 'telegram' || thread.provider !== 'telegram' || thread.status !== 'assigned'
    || thread.integration_id !== conn.integrationId || thread.user_id !== conn.userId
    || !thread.session_id || !thread.interview_id || text === '') return 0;
  let session;
  try { ({ session } = await writableSession(env, conn.userId, thread.session_id)); }
  catch (err) { if (err instanceof IntakeError) return 0; throw err; }
  if (session.interview_id !== thread.interview_id || session.submitted_via !== 'telegram') return 0;
  let changed = 0;
  const rows = (await env.DB.prepare(
      `SELECT id, start_ms, end_ms, speaker_label, text, source_ref, model FROM interview_transcript_segments
        WHERE session_id = ? AND source = 'final' ORDER BY COALESCE(start_ms, 0), id`,
    ).bind(session.id).all<SegmentRow & { id: number; source_ref: string | null; model: string | null }>()).results ?? [];
  // Telegram replacements are nonempty, and deletion keeps a span marker,
  // so offsets do not change during this delivery. Read and map only once.
  const spans = new Map(toSegments(rows).map((span) => [span.id, span]));
  for (const messageId of new Set(messageIds)) {
    const hash = await refKey('telegram', messageId);
    for (const row of rows.filter((r) => r.source_ref === hash && r.model === 'channel:telegram')) {
      const span = spans.get(row.id);
      const replacement = text ?? SOURCE_DELETED_TEXT;
      if (!span || row.text === replacement) continue;
      const token = `channel:telegram:change:${crypto.randomUUID()}`;
      const [claim] = await env.DB.batch([
        env.DB.prepare(
          `UPDATE interview_transcript_segments SET text = ?, model = ?, source_lang = NULL, translated_text = NULL,
             translated_lang = NULL, translation_model = NULL, translation_reservation_uid = NULL,
             translation_status = ?, translation_attempts = 0
            WHERE id = ? AND session_id = ? AND source_ref = ? AND model = 'channel:telegram' AND text = ?`,
        ).bind(replacement, token, text === null ? 'undetected' : null, row.id, session.id, hash, row.text),
        // Pending is the only undecided state. A simultaneous Accept that won
        // keeps its decision; it can never be deleted by this statement.
        env.DB.prepare(
          `DELETE FROM validate_proposals WHERE session_id = ? AND status = 'pending'
             AND cite_from < ? AND cite_to > ?
             AND EXISTS (SELECT 1 FROM interview_transcript_segments WHERE id = ? AND model = ?)`,
        ).bind(session.id, span.end, span.start, row.id, token),
        ...(text === null ? [env.DB.prepare(
          `UPDATE validate_proposals
              SET citation_json = json_set(
                json_remove(CASE WHEN json_valid(citation_json) THEN citation_json ELSE '{}' END, '$.quote', '$.quote_original'),
                '$.source_deleted', json('true'), '$.source_note', ?)
            WHERE session_id = ? AND status <> 'pending' AND cite_from < ? AND cite_to > ?
              AND EXISTS (SELECT 1 FROM interview_transcript_segments WHERE id = ? AND model = ?)`,
        ).bind(SOURCE_DELETED_NOTE, session.id, span.end, span.start, row.id, token)] : []),
        ...(text === null ? [env.DB.prepare(
          `UPDATE interview_chunk_transcripts SET segments_json = '[]'
            WHERE session_id = ? AND json_valid(segments_json)
              AND EXISTS (SELECT 1 FROM json_each(segments_json) segment WHERE json_extract(segment.value, '$.source_ref') = ?)
              AND EXISTS (SELECT 1 FROM interview_transcript_segments WHERE id = ? AND model = ?)`,
        ).bind(session.id, hash, row.id, token)] : []),
        // Summaries/translations are derived content, so none may retain the
        // replaced words. The next queued engine pass rebuilds them.
        env.DB.prepare(
          `UPDATE interview_sessions SET summary = NULL, summary_model = NULL, summarised_at = NULL,
             summary_citations_json = NULL, digest_json = NULL, digest_kept_at = NULL, digest_kept_by = NULL,
             digest_hash = NULL, digest_note = CASE WHEN consent_status = 'declined' THEN digest_note ELSE NULL END,
             digest_status = CASE WHEN consent_status = 'declined' THEN digest_status WHEN digest_status = 'running' THEN 'running' ELSE 'queued' END,
             status = CASE WHEN status = 'structured' THEN 'transcribed' ELSE status END, updated_at = datetime('now')
            WHERE id = ? AND EXISTS (SELECT 1 FROM interview_transcript_segments WHERE id = ? AND model = ?)`,
        ).bind(session.id, row.id, token),
        // Pasted/legacy text may have no segment. Match a unique complete
        // passage (including its line boundaries); never replace substrings
        // or guess between identical occurrences in this flattened mirror.
        env.DB.prepare(
          `WITH parts AS (
            SELECT substr(transcript, 1, pos - 1) AS prefix, substr(transcript, pos + old_length) AS suffix
              FROM (
                SELECT transcript, instr(char(10) || transcript || char(10), char(10) || ? || char(10)) AS pos,
                       length(?) AS old_length FROM discovery_interviews WHERE id = ?
              ) WHERE pos > 0
                AND instr(substr(char(10) || transcript || char(10), pos + 1), char(10) || ? || char(10)) = 0
          )
          UPDATE discovery_interviews SET transcript = (
            SELECT prefix || CASE WHEN length(CAST(prefix || ? || suffix AS BLOB)) <= ? THEN ? ELSE '' END || suffix FROM parts
          ), updated_at = datetime('now')
            WHERE id = ? AND EXISTS (SELECT 1 FROM parts)
              AND EXISTS (SELECT 1 FROM interview_transcript_segments WHERE id = ? AND model = ?)`,
        ).bind(row.text, row.text, session.interview_id, row.text, replacement, TRANSCRIPT_MIRROR_MAX_BYTES,
          replacement, session.interview_id, row.id, token),
        env.DB.prepare('UPDATE interview_transcript_segments SET model = ? WHERE id = ? AND model = ?')
          .bind(text === null ? 'channel:telegram:deleted' : 'channel:telegram', row.id, token),
      ]);
      changed += Number(claim.meta?.changes ?? 0);
    }
  }
  if (changed) {
    try { await enqueueDigest(env, session.id, conn.userId, 'chat_text_added'); }
    catch (err) {
      // The transcript is committed; its transcribed state lets the quiet
      // sweep recover. Log only an error class, never its content.
      console.error('[channels] source digest not queued', err instanceof Error ? err.name : 'error');
    }
  }
  return changed;
}
