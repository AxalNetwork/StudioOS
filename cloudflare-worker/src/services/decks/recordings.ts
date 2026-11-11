/**
 * D1590 (#3837, deck v2 F11) — a recorded walkthrough's takes: one per card,
 * camera and microphone in R2, captions from the Listen job's timed cues.
 *
 * Owner decision W = A (2026-11-02): a take is kept until its maker deletes it,
 * or its deck version or account goes. No automatic expiry.
 *   - The maker's delete (`deleteTake`) removes the R2 object and then the row.
 *   - A retake (`supersede`) removes that card's earlier takes the same way, and
 *     never another card's.
 *   - A row that leaves by a cascade (its deck, venture or account deleted)
 *     leaves its object behind; the daily cleanup's `sweepOrphanRecordings`
 *     deletes an object under `deck-recordings/` whose row is gone.
 */
import type { Env } from '../../types';
import type { Caption } from '../ai/speechJobs';

export const KEY_PREFIX = 'deck-recordings/';
/** One take is at most three minutes. */
export const MAX_TAKE_MS = 180_000;
/** The take's file (camera and microphone): at most 40 MB. */
export const MAX_MEDIA_BYTES = 40 * 1024 * 1024;
/** What a take may be stored as. The value is the file's extension. */
export const MEDIA_MIME: Readonly<Record<string, string>> = Object.freeze({
  'video/webm': 'webm', 'video/mp4': 'mp4', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a',
});
/** An orphaned object is swept once it is a day old, so an upload whose row is still being written is never taken. */
export const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
export const SWEEP_MAX = 500;
const UID_IN_KEY = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[a-z0-9]+$/;

export const mediaKey = (projectId: number, uid: string, ext: string) => `${KEY_PREFIX}${projectId}/${uid}.${ext}`;

export type TakeRow = {
  id: number; uid: string; deck_id: number; project_id: number; user_id: number; card: number; take: number; duration_ms: number;
  media_r2_key: string; media_mime: string; media_bytes: number; captions_json: string | null; caption_model: string | null;
  charged_microusd: number | null; created_at: string;
};

/** A take as the client reads it. Captions that were not recorded are null, never an empty list. */
export function takeView(r: TakeRow) {
  let captions: Caption[] | null = null;
  try { const v = r.captions_json ? JSON.parse(r.captions_json) : null; captions = Array.isArray(v) ? v : null; } catch { captions = null; }
  return {
    uid: r.uid, card: Number(r.card), take: Number(r.take), duration_ms: Number(r.duration_ms),
    media_mime: r.media_mime, media_bytes: Number(r.media_bytes), captions, caption_model: r.caption_model,
    charged_microusd: r.charged_microusd == null ? null : Number(r.charged_microusd), created_at: r.created_at,
  };
}

/**
 * The walkthrough of a deck version for its maker: each card's newest take,
 * and `null` for a card not recorded. `cards` is the deck's card count.
 */
export function walkthroughOf(rows: TakeRow[], cards: number) {
  const newest = new Map<number, TakeRow>();
  for (const r of rows) {
    const had = newest.get(Number(r.card));
    if (!had || Number(r.take) > Number(had.take)) newest.set(Number(r.card), r);
  }
  const takes = Array.from({ length: Math.max(0, cards) }, (_, i) => {
    const r = newest.get(i + 1);
    return r ? takeView(r) : null;
  });
  return { cards: takes, recorded: takes.filter(Boolean).length };
}

/** Delete a take: the R2 object first, then the row. False when the object could not be deleted (the row stays, so nothing is lost track of). */
export async function deleteTake(env: Env, row: Pick<TakeRow, 'id' | 'media_r2_key'>): Promise<boolean> {
  try { await env.FILES?.delete(row.media_r2_key); } catch { return false; }
  await env.DB.prepare('DELETE FROM deck_recordings WHERE id = ?').bind(row.id).run();
  return true;
}

/** A retake: every earlier take of this card by this maker goes, row and object. Another card's takes are not read. */
export async function supersede(env: Env, deckId: number, userId: number, card: number, keepUid: string): Promise<number> {
  const old = await env.DB.prepare('SELECT id, media_r2_key FROM deck_recordings WHERE deck_id = ? AND user_id = ? AND card = ? AND uid <> ?')
    .bind(deckId, userId, card, keepUid).all<Pick<TakeRow, 'id' | 'media_r2_key'>>();
  let gone = 0;
  for (const r of old.results || []) if (await deleteTake(env, r)) gone += 1;
  return gone;
}

/**
 * The daily cleanup: an object under `deck-recordings/` whose row is gone (its
 * deck, venture or account was deleted) and that is a day old is deleted.
 * At most SWEEP_MAX objects a run. Counts only in the log.
 */
export async function sweepOrphanRecordings(env: Env, now = new Date()): Promise<{ scanned: number; deleted: number; failed: number }> {
  const out = { scanned: 0, deleted: 0, failed: 0 };
  if (!env.FILES) return out;
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix: KEY_PREFIX, cursor, limit: 500 });
    const objects = (page.objects || []).filter((o: any) => now.getTime() - new Date(o.uploaded).getTime() >= ORPHAN_AGE_MS);
    out.scanned += (page.objects || []).length;
    const uids = objects.map((o: any) => UID_IN_KEY.exec(o.key)?.[1]).filter((u): u is string => !!u);
    const known = new Set<string>();
    if (uids.length) {
      const rows = await env.DB.prepare('SELECT uid FROM deck_recordings WHERE uid IN (SELECT value FROM json_each(?))').bind(JSON.stringify(uids)).all<{ uid: string }>();
      for (const r of rows.results || []) known.add(r.uid);
    }
    for (const o of objects as any[]) {
      if (out.deleted + out.failed >= SWEEP_MAX) return out;
      const uid = UID_IN_KEY.exec(o.key)?.[1];
      if (!uid || known.has(uid)) continue;
      try { await env.FILES.delete(o.key); out.deleted += 1; } catch { out.failed += 1; }
    }
    cursor = page.truncated ? (page as any).cursor : undefined;
  } while (cursor);
  return out;
}
