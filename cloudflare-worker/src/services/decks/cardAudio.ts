/**
 * D1569 (#3816, deck v2 D8) — per-card audio in R2, through one writer.
 *
 * The owner's answer to Q1 on #3816 (2026-11-04): every per-card clip is
 * stored under `deck-audio/<project>/<uid>.<ext>` by `putCardAudio`, which
 * checks the venture's storage room first. It is the one row for per-card
 * audio in the R2 writer inventory (`storage_room_d1170.test.ts` SITES) and
 * in the retention inventory (`documentation/operations/DATA_RETENTION.md`).
 * `kind` says whose clip it is: `ai_voice` for a voice-over (D1569).
 * #3837's walkthrough takes were built before this writer, under
 * `deck-recordings/` with their own table (D1590). They stay there until that
 * route moves onto this writer, which is its own change.
 *
 * An AI voice-over's life:
 *   - **Proposed:** the clip is written here and one `ai_rail_proposals` row
 *     (option `deck:voice`, kind `proposal`, status `proposed`) holds its key.
 *     Nothing on the deck names it yet.
 *   - **Accepted:** the card carries `voice: { key, model, label: 'AI voice' }`
 *     in a new version (`slideModel.voiceOf`); the deck version is the record.
 *   - **Discarded:** the object is deleted, then the row is marked discarded.
 *   - **Undecided:** the daily cleanup (`sweepPendingVoice`) deletes a clip
 *     whose proposal is still `proposed` after `PENDING_DAYS`, and withdraws it.
 *
 * Every key read back is checked against the venture it claims
 * (`keyOfProject`), so a card can never name another venture's clip.
 */
import type { Env } from '../../types';
import { assertStorageRoom, noteStorageLanded } from '../storageRoom';

export const AUDIO_PREFIX = 'deck-audio/';
export type ClipKind = 'ai_voice';
/** What a clip may be stored as, by MIME; the value is the key's extension. MeloTTS makes MP3 only. */
export const AUDIO_MIME: Readonly<Record<string, string>> = Object.freeze({ 'audio/mpeg': 'mp3' });
/** One clip is at most 8 MB: a card's script spoken is well under a minute of MP3. */
export const MAX_CLIP_BYTES = 8 * 1024 * 1024;
/** A proposed voice-over nobody decides is deleted after this many days. */
export const PENDING_DAYS = 7;
export const SWEEP_MAX = 200;
/** The rail option a voice-over runs on and its proposal rows are listed under. */
export const VOICE_OPTION = 'deck:voice';

const KEY_RE = /^deck-audio\/([1-9][0-9]{0,11})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(mp3)$/;

export const audioKey = (projectId: number, uid: string, ext: string) => `${AUDIO_PREFIX}${projectId}/${uid}.${ext}`;

/** True when `key` is a per-card clip of this venture, and nothing else. */
export function keyOfProject(key: unknown, projectId: number): key is string {
  if (typeof key !== 'string') return false;
  const m = KEY_RE.exec(key);
  return !!m && Number(m[1]) === Number(projectId);
}

/** True when `key` is any per-card clip's key (the public player reads only these). */
export const isAudioKey = (key: unknown): key is string => typeof key === 'string' && KEY_RE.test(key);

/**
 * Store one clip, after the venture's storage room is checked (413
 * `storage_full` is thrown by the guard). Returns its key and size.
 */
export async function putCardAudio(env: Env, a: {
  projectId: number; kind: ClipKind; bytes: Uint8Array; mime: string; caller: { id: number; role?: string | null } | null;
}): Promise<{ key: string; bytes: number; uid: string }> {
  const ext = AUDIO_MIME[a.mime];
  if (!ext) throw new Error('unsupported_audio');
  if (!a.bytes.byteLength || a.bytes.byteLength > MAX_CLIP_BYTES) throw new Error('clip_size');
  if (!env.FILES) throw new Error('storage_unavailable');
  const room = await assertStorageRoom(env, { projectId: a.projectId }, a.bytes.byteLength, a.caller);
  const uid = crypto.randomUUID();
  const key = audioKey(a.projectId, uid, ext);
  await env.FILES.put(key, a.bytes, { httpMetadata: { contentType: a.mime }, customMetadata: { kind: a.kind } });
  await noteStorageLanded(env, room).catch(() => null);
  return { key, bytes: a.bytes.byteLength, uid };
}

/** Delete one clip. False when R2 refused, so the caller keeps its record of it. */
export async function deleteCardAudio(env: Env, key: string): Promise<boolean> {
  if (!isAudioKey(key) || !env.FILES) return false;
  try { await env.FILES.delete(key); return true; } catch { return false; }
}

/**
 * The daily cleanup: a voice-over still `proposed` after `PENDING_DAYS` is
 * deleted from R2, then its proposal is withdrawn. At most `SWEEP_MAX` a day; a
 * clip R2 refuses to delete keeps its row, so the next day tries again.
 */
export async function sweepPendingVoice(env: Env, now: Date = new Date()): Promise<{ deleted: number; kept: number }> {
  if (!env.FILES) return { deleted: 0, kept: 0 };
  const cutoff = new Date(now.getTime() - PENDING_DAYS * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const rows = await env.DB.prepare(
    `SELECT id, payload_json FROM ai_rail_proposals
      WHERE rail_option = ? AND status = 'proposed' AND created_at < ?
      ORDER BY id LIMIT ?`,
  ).bind(VOICE_OPTION, cutoff, SWEEP_MAX).all<{ id: number; payload_json: string }>();
  let deleted = 0;
  let kept = 0;
  for (const r of rows.results || []) {
    let key: unknown = null;
    try { key = JSON.parse(r.payload_json || '{}')?.key; } catch { key = null; }
    if (isAudioKey(key) && !(await deleteCardAudio(env, key))) { kept += 1; continue; }
    await env.DB.prepare("UPDATE ai_rail_proposals SET status = 'withdrawn', decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'proposed'")
      .bind(r.id).run();
    deleted += 1;
  }
  return { deleted, kept };
}

/** A clip no record names is swept only once it is older than the pending window and a day, so a fresh one is never taken. */
export const ORPHAN_AGE_MS = (PENDING_DAYS + 1) * 24 * 60 * 60 * 1000;

/**
 * The daily cleanup, part two: a clip under `deck-audio/` that no deck version
 * of its venture names and no proposal still holds (its deck, venture or
 * account was deleted) is deleted once it is `ORPHAN_AGE_MS` old. At most
 * `SWEEP_MAX` a run. A clip some version names stays, so Restore can bring it back.
 */
export async function sweepOrphanAudio(env: Env, now: Date = new Date()): Promise<{ scanned: number; deleted: number; failed: number }> {
  const out = { scanned: 0, deleted: 0, failed: 0 };
  if (!env.FILES) return out;
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix: AUDIO_PREFIX, cursor, limit: 500 });
    out.scanned += (page.objects || []).length;
    for (const o of (page.objects || []) as any[]) {
      if (out.deleted + out.failed >= SWEEP_MAX) return out;
      const m = KEY_RE.exec(String(o.key));
      if (!m || now.getTime() - new Date(o.uploaded).getTime() < ORPHAN_AGE_MS) continue;
      const named = await env.DB.prepare(
        `SELECT 1 AS n FROM pitch_decks WHERE project_id = ? AND instr(slides, ?) > 0
         UNION ALL SELECT 1 AS n FROM ai_rail_proposals WHERE rail_option = ? AND status = 'proposed' AND instr(payload_json, ?) > 0
         LIMIT 1`,
      ).bind(Number(m[1]), o.key, VOICE_OPTION, o.key).first<{ n: number }>();
      if (named) continue;
      try { await env.FILES.delete(o.key); out.deleted += 1; } catch { out.failed += 1; }
    }
    cursor = page.truncated ? (page as any).cursor : undefined;
  } while (cursor);
  return out;
}
