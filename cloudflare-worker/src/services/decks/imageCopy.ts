/**
 * D1506 (#3757, follow-up to #3986) — an outside image in a deck is copied
 * into the venture's own storage when the deck is saved, and the slide then
 * names the copy. An image that cannot be copied refuses the save, naming it
 * (the owner's pick, 2026-11-01). Exports run the same copy over the stored
 * version first, so an older deck's outside image is exported from our copy
 * instead of dropping out behind the export browser's allow-list.
 *
 * Where an image URL can sit on a slide: the slide's `image_url`, an image
 * field's `value`, an image block's `image_url`, and the background's
 * `image_url`. Our own file URL (`/api/decks/images/<uid>/file` on our host)
 * is left as it is.
 *
 * Each copy goes the way `POST /api/decks/:id/images/import` does (#3986):
 * `fetchExternalImage` (https, a public host at every hop, 8 s, 5 MB), the
 * type sniffed, the size read from the header (50 MP), the metadata stripped,
 * the stripped bytes hashed, and one row per picture per venture
 * (migration 718). A copy is a kept `deck_images` row (`source: 'upload'`),
 * so a saved version can read it.
 */
import type { Env } from '../../types';
import { assertStorageRoom, noteStorageLanded } from '../storageRoom';
import { EXTENSION, UPLOAD_MAX_BYTES, sniffMime } from './images';
import { imageSize, sha256Hex, stripMetadata, tooManyPixels, type ImageMime } from './imageBytes';
import { fetchExternalImage } from './imageFetch';

/** The most outside images one save copies; more is refused rather than slowing a save without end. */
export const MAX_COPIES_PER_SAVE = 12;

const OWN_PATH = /^\/api\/decks\/images\/[0-9a-f-]{36}\/file$/;
const OWN_HOSTS = ['axal.vc', 'app.axal.vc'];

/** Whether a URL is one of our own stored deck images. */
export function isOwnImageUrl(url: string, requestUrl?: string): boolean {
  let u: URL;
  try { u = new URL(url, requestUrl); } catch { return false; }
  const hosts = new Set(OWN_HOSTS);
  if (requestUrl) { try { hosts.add(new URL(requestUrl).hostname.toLowerCase()); } catch { /* none */ } }
  return OWN_PATH.test(u.pathname) && hosts.has(u.hostname.toLowerCase());
}

type Spot = { get: () => unknown; set: (url: string, uid: string) => void };

/** Every place a slide names an image, as a getter and a setter. */
function spots(slides: any[]): Spot[] {
  const out: Spot[] = [];
  for (const s of Array.isArray(slides) ? slides : []) {
    if (!s || typeof s !== 'object') continue;
    out.push({ get: () => s.image_url, set: (url) => { s.image_url = url; } });
    for (const f of Array.isArray(s.fields) ? s.fields : []) {
      if (f && f.kind === 'image') out.push({ get: () => f.value, set: (url) => { f.value = url; } });
    }
    for (const b of Array.isArray(s.blocks) ? s.blocks : []) {
      if (b && b.kind === 'image') out.push({ get: () => b.image_url, set: (url, uid) => { b.image_url = url; b.image_id = uid; } });
    }
    if (s.background && typeof s.background === 'object') {
      out.push({ get: () => s.background.image_url, set: (url, uid) => { s.background.image_url = url; s.background.image_id = uid; } });
    }
  }
  return out;
}

/** The distinct outside image URLs a deck's slides name, in order. */
export function externalImageUrls(slides: any[], requestUrl?: string): string[] {
  const seen = new Set<string>();
  for (const sp of spots(slides)) {
    const v = sp.get();
    if (typeof v === 'string' && v && !isOwnImageUrl(v, requestUrl)) seen.add(v);
  }
  return [...seen];
}

/**
 * `save` refuses on the first image that cannot be copied (the owner's pick).
 * `export` copies what it can and leaves the rest as they are: the export
 * says such an image is missing, as it does on main. With no storage bound,
 * an export copies nothing.
 */
export type CopyMode = 'save' | 'export';
export type CopyResult =
  | { ok: true; slides: any[]; copied: number; failed: Array<{ image_url: string; code: string }> }
  | { ok: false; image_url: string; code: string };

type Copied = { ok: true; uid: string } | { ok: false; code: string };

/** One outside image, stored once per venture (or the row that already holds it). */
async function copyOne(env: Env, o: { projectId: number; deckId: number | null; user: { id: number; role?: string | null } }, url: string, fetcher: typeof fetch): Promise<Copied> {
  const got = await fetchExternalImage(url, UPLOAD_MAX_BYTES, fetcher);
  if (!got.ok) return { ok: false, code: got.code };
  const mime = sniffMime(got.bytes) as ImageMime | null;
  if (!mime) return { ok: false, code: 'image_unreadable' };
  const size = imageSize(got.bytes, mime);
  if (!size) return { ok: false, code: 'image_unreadable' };
  if (tooManyPixels(size)) return { ok: false, code: 'image_too_large' };
  const bytes = stripMetadata(got.bytes, mime);
  const sha = await sha256Hex(bytes);
  const same = await env.DB.prepare('SELECT id, uid, state FROM deck_images WHERE project_id = ? AND sha256 = ?').bind(o.projectId, sha).first<{ id: number; uid: string; state: string }>();
  if (same && same.state === 'kept') return { ok: true, uid: same.uid };
  // A discarded or proposed row gives up its hash, as an upload's does (#3986): the copy is a kept row of its own.
  if (same) await env.DB.prepare('UPDATE deck_images SET sha256 = NULL WHERE id = ? AND project_id = ?').bind(same.id, o.projectId).run();
  let ticket;
  try { ticket = await assertStorageRoom(env, { projectId: o.projectId }, bytes.byteLength, o.user); }
  catch (e) { if (e instanceof Response) return { ok: false, code: 'storage_full' }; throw e; }
  const uid = crypto.randomUUID();
  const key = `deck-images/${o.projectId}/${uid}.${EXTENSION[mime]}`;
  try { await env.FILES!.put(key, bytes, { httpMetadata: { contentType: mime }, customMetadata: { projectId: String(o.projectId), userId: String(o.user.id) } }); }
  catch { return { ok: false, code: 'image_unsaved' }; }
  const at = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO deck_images (uid, project_id, deck_id, r2_key, mime, size_bytes, width, height, sha256, source, use, alt, state, created_by, kept_at, kept_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'upload', 'content', '', 'kept', ?, ?, ?)`)
    .bind(uid, o.projectId, o.deckId, key, mime, bytes.byteLength, size.width, size.height, sha, o.user.id, at, o.user.id).run();
  await noteStorageLanded(env, ticket);
  return { ok: true, uid };
}

/**
 * The slides with every outside image copied and renamed. In `save` mode the
 * first image that cannot be copied refuses instead, and the slides are not
 * written; copies already stored by this call stay as kept library images.
 */
export async function copyExternalImages(
  env: Env,
  o: { projectId: number; deckId: number | null; user: { id: number; role?: string | null }; requestUrl: string; slides: any[]; mode?: CopyMode },
  deps: { fetcher?: typeof fetch } = {},
): Promise<CopyResult> {
  const mode = o.mode ?? 'save';
  const fetcher = deps.fetcher ?? fetch;
  const slides = JSON.parse(JSON.stringify(o.slides ?? []));
  const all = externalImageUrls(slides, o.requestUrl);
  if (!all.length) return { ok: true, slides, copied: 0, failed: [] };
  if (mode === 'save' && all.length > MAX_COPIES_PER_SAVE) return { ok: false, image_url: all[MAX_COPIES_PER_SAVE], code: 'too_many_images' };
  if (!env.FILES) return mode === 'save' ? { ok: false, image_url: all[0], code: 'storage_unavailable' } : { ok: true, slides, copied: 0, failed: [] };
  const failed = all.slice(MAX_COPIES_PER_SAVE).map((image_url) => ({ image_url, code: 'too_many_images' }));
  const copies = new Map<string, string>();
  for (const url of all.slice(0, MAX_COPIES_PER_SAVE)) {
    const r = await copyOne(env, o, url, fetcher);
    if (r.ok) { copies.set(url, r.uid); continue; }
    if (mode === 'save') return { ok: false, image_url: url, code: r.code };
    failed.push({ image_url: url, code: r.code });
  }
  for (const sp of spots(slides)) {
    const v = sp.get();
    const uid = typeof v === 'string' ? copies.get(v) : undefined;
    if (uid) sp.set(new URL(`/api/decks/images/${uid}/file`, o.requestUrl).toString(), uid);
  }
  return { ok: true, slides, copied: copies.size, failed };
}

/** The sentence a refused copy shows, by code. */
export function copyRefusalMessage(code: string): string {
  switch (code) {
    case 'too_many_images': return `A save copies at most ${MAX_COPIES_PER_SAVE} outside images. Upload the rest, or save in parts.`;
    case 'too_large': return 'An outside image is over 5 MB. Upload a smaller copy. Nothing was saved.';
    case 'image_too_large': return 'An outside image is over 50 megapixels. Upload a smaller copy. Nothing was saved.';
    case 'image_unreadable': return 'An outside image is not a PNG, JPEG or WebP picture we can read. Upload it instead. Nothing was saved.';
    case 'storage_full': return 'There is no room left on the storage plan to copy an outside image. Nothing was saved.';
    case 'storage_unavailable': case 'image_unsaved': return 'Outside images cannot be stored right now. Nothing was saved; try again in a moment.';
    default: return 'An outside image could not be fetched safely (a public https address, no unsafe redirects). Upload it instead. Nothing was saved.';
  }
}
