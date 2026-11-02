/**
 * D1545 (#3788): a deck's recorded video, cross-deck paste and button clicks.
 *
 *   POST /api/decks/:id/videos/upload        multipart `file` (MP4, at most 50 MB):
 *                                            { video: { provider: 'mp4', video_id, url } }
 *   GET  /api/decks/videos/:uid/file         the bytes, with Range for the player
 *   POST /api/decks/:id/paste                { from_deck_id, card_uids }: the cards, as a save keeps them
 *   GET  /api/decks/:id/button-clicks        the founder's read: clicks and viewers per button
 *
 * The viewer's click is `POST /api/decks/share/:token/click` in
 * `deck_share_actions.ts`, beside the link's other actions.
 *
 * WHERE A VIDEO LIVES. In R2 alone, at `deck-videos/<uid>.mp4`, its venture
 * and deck in the object's metadata. There is no row (migration: none):
 * `deck_images` holds images only. The uid is random. A file is public once a
 * saved version of one of the venture's decks names it, as a kept image is;
 * before that it is the venture's own, read only by someone who may read the
 * project.
 *
 * WHAT A PASTE CARRIES. A card from another deck the member may read passes
 * through `sanitizeSlides`, the same rule as a save. It arrives with no uid
 * (the editor gives it one), and without the source's status, assignee and
 * notes. From another venture, an image keeps its address and loses its
 * `image_id`, which names the other venture's store. Nothing is saved: the
 * editor places the cards, and the founder saves the version.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { VIDEO_FILE_PATH } from '../services/decks/slideModel';
import decks, { sanitizeSlides } from './decks';

const deckMedia = new Hono<{ Bindings: Env }>();

/** An uploaded video's size cap. */
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
/** At most this many cards in one paste (a deck's cap). */
export const PASTE_MAX = 60;
const UID = /^[0-9a-f-]{36}$/;
const CARD_UID = /^[A-Za-z0-9_-]{1,40}$/;
export const videoKey = (uid: string) => `deck-videos/${uid}.mp4`;

type DeckRow = { id: number; project_id: number; slides: string | null };

async function deckFor(c: any, user: User, deckId: number, write: boolean): Promise<{ deck: DeckRow } | { refused: Response }> {
  const deck = (await c.env.DB.prepare('SELECT id, project_id, slides FROM pitch_decks WHERE id = ?').bind(deckId).first()) as DeckRow | null;
  if (!deck) return { refused: c.json({ error: 'not found' }, 404) };
  try { await projectOwned(c, user, Number(deck.project_id), write ? { write: true } : {}); }
  catch (e: any) { return { refused: e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403) }; }
  return { deck };
}

/** An MP4 file's signature: an `ftyp` box at byte 4. */
export function isMp4(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
}

deckMedia.post('/:id{[0-9]+}/videos/upload', async (c) => {
  const user = await requireAuth(c);
  const got = await deckFor(c, user, Number(c.req.param('id')), true);
  if ('refused' in got) return got.refused;
  if (!c.env.FILES) return refuse(c, 503, { code: 'store_unavailable', message: 'Videos cannot be stored here yet. Try again later.' });
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') return refuse(c, 400, { code: 'file_required', message: 'Choose an MP4 file to upload.' });
  if (file.size > VIDEO_MAX_BYTES) return refuse(c, 413, { code: 'video_too_large', message: 'A video is at most 50 MB.' });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isMp4(bytes)) return refuse(c, 415, { code: 'not_mp4', message: 'Only MP4 videos can be uploaded.' });
  const uid = crypto.randomUUID();
  try {
    await c.env.FILES.put(videoKey(uid), bytes, {
      httpMetadata: { contentType: 'video/mp4' },
      customMetadata: { projectId: String(got.deck.project_id), deckId: String(got.deck.id), userId: String(user.id) },
    });
  } catch {
    console.warn('[deck_media] video not stored', { outcome: 'store_failed' });
    return refuse(c, 503, { code: 'store_failed', message: 'The video could not be stored. Nothing was added. Try again.' });
  }
  return c.json({ video: { provider: 'mp4', video_id: uid, url: new URL(VIDEO_FILE_PATH(uid), c.req.url).toString() } }, 201);
});

/** `bytes=a-b`, `bytes=a-` or `bytes=-n`, against a file of `size` bytes; null for none or a range it cannot serve. */
export function rangeOf(header: string | null | undefined, size: number): { offset: number; length: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (!m[1] && !m[2]) || size <= 0) return null;
  let start: number, end: number;
  if (!m[1]) { const n = Number(m[2]); start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { offset: start, length: end - start + 1 };
}

deckMedia.get('/videos/:uid/file', async (c) => {
  const uid = String(c.req.param('uid') || '').toLowerCase();
  if (!UID.test(uid) || !c.env.FILES) return c.json({ error: 'not found' }, 404);
  const head = await c.env.FILES.head(videoKey(uid));
  const projectId = Number(head?.customMetadata?.projectId);
  if (!head || !Number.isSafeInteger(projectId)) return c.json({ error: 'not found' }, 404);
  // Public once a saved version of the venture's decks names it; the venture's own until then.
  const named = await c.env.DB.prepare('SELECT 1 AS yes FROM pitch_decks WHERE project_id = ? AND instr(slides, ?) > 0 LIMIT 1')
    .bind(projectId, uid).first<{ yes: number }>();
  if (!named) {
    try { const user = await requireAuth(c); await projectOwned(c, user, projectId); }
    catch { return c.json({ error: 'not found' }, 404); }
  }
  const range = rangeOf(c.req.header('range'), head.size);
  const object = await c.env.FILES.get(videoKey(uid), range ? { range } : undefined);
  if (!object) return c.json({ error: 'not found' }, 404);
  const headers: Record<string, string> = {
    'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'",
    'cache-control': named ? 'public, max-age=31536000, immutable' : 'private, no-store',
  };
  if (!range) return new Response(object.body, { headers: { ...headers, 'content-length': String(head.size) } });
  return new Response(object.body, { status: 206, headers: {
    ...headers, 'content-length': String(range.length), 'content-range': `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`,
  } });
});

/** The cards a paste carries: sanitized as a save, with the source's working state and, across ventures, its image ids, left behind. */
export function pastedCards(source: any[], uids: string[], sameVenture: boolean): { cards: any[]; missing: number } {
  const wanted = new Set(uids);
  const picked = source.filter((s) => s && typeof s === 'object' && wanted.has(s.uid));
  const cards = sanitizeSlides(picked).map((card: any) => {
    const { uid, status, assignee, notes, ...rest } = card || {};
    void uid; void status; void assignee; void notes;
    if (!sameVenture) {
      rest.blocks = (Array.isArray(rest.blocks) ? rest.blocks : []).map((b: any) => {
        if (b?.kind !== 'image' || !('image_id' in b)) return b;
        const { image_id, ...img } = b;
        void image_id;
        return img;
      });
      if (rest.background && typeof rest.background === 'object' && 'image_id' in rest.background) {
        const { image_id, ...bg } = rest.background;
        void image_id;
        rest.background = bg;
      }
    }
    return rest;
  });
  return { cards, missing: wanted.size - picked.length };
}

deckMedia.post('/:id{[0-9]+}/paste', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json<any>().catch(() => ({}));
  const fromId = Number(body?.from_deck_id);
  const uids = Array.isArray(body?.card_uids) ? body.card_uids.filter((u: unknown) => typeof u === 'string' && CARD_UID.test(u)) : [];
  if (!Number.isSafeInteger(fromId) || fromId <= 0) return refuse(c, 400, { code: 'from_deck_required', message: 'Say which deck the cards come from.' });
  if (!uids.length || uids.length > PASTE_MAX) return refuse(c, 400, { code: 'cards_required', message: `Choose between 1 and ${PASTE_MAX} cards to paste.` });
  const target = await deckFor(c, user, Number(c.req.param('id')), true);
  if ('refused' in target) return target.refused;
  const source = await deckFor(c, user, fromId, false);
  if ('refused' in source) return source.refused;
  let slides: any[] = [];
  try { slides = JSON.parse(source.deck.slides || '[]'); } catch { slides = []; }
  const { assignCardUids } = await import('../services/decks/cardUids');
  const { cards, missing } = pastedCards(assignCardUids(Array.isArray(slides) ? slides : []), uids, Number(source.deck.project_id) === Number(target.deck.project_id));
  return c.json({ cards, missing });
});

deckMedia.get('/:id{[0-9]+}/button-clicks', async (c) => {
  const user = await requireAuth(c);
  const got = await deckFor(c, user, Number(c.req.param('id')), false);
  if ('refused' in got) return got.refused;
  const rows = await c.env.DB.prepare(
    `SELECT ref_id, COUNT(*) AS clicks, COUNT(DISTINCT view_id) AS viewers
       FROM deck_share_conversions
      WHERE deck_id = ? AND type = 'button_click' AND ref_id IS NOT NULL
      GROUP BY ref_id ORDER BY clicks DESC LIMIT 200`,
  ).bind(got.deck.id).all<{ ref_id: string; clicks: number; viewers: number }>().catch(() => null);
  if (!rows || !Array.isArray(rows.results)) return refuse(c, 503, { code: 'clicks_unreadable', message: 'Button clicks could not be read. Try again.' });
  return c.json({ buttons: rows.results.map((r) => {
    const [card_uid, block_id] = String(r.ref_id).split(':');
    return { card_uid: card_uid || null, block_id: block_id || null, clicks: Number(r.clicks), viewers: Number(r.viewers) };
  }) });
});

export const mount: RouteMount = { path: '/api/decks', router: deckMedia, before: [decks] };
export default deckMedia;
