/**
 * D1506 (#3757, A13 part 2) — an outside image in a deck is copied into the
 * venture's own storage when the deck is saved, and the slide then names the
 * copy. An image that cannot be copied refuses the save, naming it (the
 * owner's pick, 2026-11-01). Exports run the same copy for an older version
 * first, so the export browser only ever loads our own origin.
 *
 * Where an image URL can sit on a slide: the slide's `image_url`, an image
 * field's `value`, an image block's `image_url`, and the background's
 * `image_url`. Our own file URL (`/api/decks/images/<uid>/file` on our host)
 * is left as it is.
 *
 * Each copy is fetched by `fetchExternalImage` (https, public addresses only,
 * redirects checked hop by hop, 5 MB), stripped and measured by
 * `prepareImage` (50 MP), stored once per venture by its SHA-256, and kept as
 * a `deck_images` row (`source: 'upload'`, kept, the saver as its author).
 */
import type { Env } from '../../types';
import { dohResolver, type Resolver } from '../../integrations/customMcp';
import { assertStorageRoom, noteStorageLanded } from '../storageRoom';
import { fetchExternalImage, prepareImage, sha256Hex } from './imageSafety';

/** The most outside images one save copies; more is refused rather than slowing a save without end. */
export const MAX_COPIES_PER_SAVE = 12;
export type ExportImageCopies = Record<string, string>;

/** Bounded, signed print-link references: URL hashes to stored image ids, never arbitrary URLs. */
export function checkedExportImageCopies(value: unknown): ExportImageCopies | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_COPIES_PER_SAVE || entries.some(([key, uid]) => !/^[a-f0-9]{64}$/.test(key) || typeof uid !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(uid))) return null;
  return Object.fromEntries(entries);
}

const urlHash = (url: string) => sha256Hex(new TextEncoder().encode(url));

/** Apply only this venture's kept image references while rendering a signed export. */
export async function applyExportImageCopies(env: Env, projectId: number, slides: any[], copies: ExportImageCopies, requestUrl: string): Promise<any[]> {
  const rows = await env.DB.prepare("SELECT uid FROM deck_images WHERE project_id = ? AND state = 'kept' AND uid IN (SELECT value FROM json_each(?))")
    .bind(projectId, JSON.stringify(Object.values(copies))).all<{ uid: string }>();
  const allowed = new Set((rows.results ?? []).map((row) => row.uid));
  const out = JSON.parse(JSON.stringify(slides));
  for (const sp of spots(out)) {
    const value = sp.get();
    if (typeof value !== 'string') continue;
    const uid = copies[await urlHash(value)];
    if (uid && allowed.has(uid)) sp.set(new URL(`/api/decks/images/${uid}/file`, requestUrl).toString(), uid);
  }
  return out;
}

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

export type CopyDeps = { resolve?: Resolver; fetcher?: typeof fetch };
export type CopyResult = { ok: true; slides: any[]; copied: number; failed: Array<{ image_url: string; code: string }>; imageCopies?: ExportImageCopies } | { ok: false; image_url: string; code: string; status?: number };

/**
 * `save` refuses on the first image that cannot be copied (the owner's pick).
 * `export` copies what it can and leaves the rest as they are: the export
 * says such an image is missing, as it always did, and the export browser
 * cannot load it. With no storage bound, an export copies nothing.
 */
export type CopyMode = 'save' | 'export';

/**
 * The slides with every outside image copied and renamed. In `save` mode the
 * first image that cannot be copied refuses instead; nothing is half-done:
 * rows already stored by this call stay as kept library images, and the
 * slides are not written.
 */
export async function copyExternalImages(
  env: Env,
  o: { projectId: number; deckId: number | null; user: { id: number; role?: string | null }; requestUrl: string; slides: any[]; mode?: CopyMode },
  deps: CopyDeps = {},
): Promise<CopyResult> {
  const mode = o.mode ?? 'save';
  const slides = JSON.parse(JSON.stringify(o.slides ?? []));
  const all = externalImageUrls(slides, o.requestUrl);
  if (!all.length) return { ok: true, slides, copied: 0, failed: [] };
  if (mode === 'save' && all.length > MAX_COPIES_PER_SAVE) return { ok: false, image_url: all[MAX_COPIES_PER_SAVE], code: 'too_many_images' };
  if (!env.FILES) return mode === 'save' ? { ok: false, image_url: all[0], code: 'storage_unavailable' } : { ok: true, slides, copied: 0, failed: [] };
  const urls = all.slice(0, MAX_COPIES_PER_SAVE);
  const failed: Array<{ image_url: string; code: string }> = all.slice(MAX_COPIES_PER_SAVE).map((image_url) => ({ image_url, code: 'too_many_images' }));
  const resolve = deps.resolve ?? dohResolver(deps.fetcher ?? fetch);
  const copies = new Map<string, string>();
  for (const url of urls) {
    const got = await fetchExternalImage(url, resolve, deps.fetcher ?? fetch);
    if (!got.ok) { if (mode === 'save') return { ok: false, image_url: url, code: got.code }; failed.push({ image_url: url, code: got.code }); continue; }
    const img = await prepareImage(got.bytes);
    if (!img.ok) { if (mode === 'save') return { ok: false, image_url: url, code: img.code }; failed.push({ image_url: url, code: img.code }); continue; }
    const same = await env.DB.prepare('SELECT uid FROM deck_images WHERE project_id = ? AND sha256 = ?').bind(o.projectId, img.sha256).first<{ uid: string }>();
    if (same) { copies.set(url, same.uid); continue; }
    let ticket;
    try { ticket = await assertStorageRoom(env, { projectId: o.projectId }, img.bytes.byteLength, o.user); }
    catch (e) {
      if (!(e instanceof Response)) throw e;
      if (mode === 'save') return { ok: false, image_url: url, code: 'storage_full', status: e.status };
      failed.push({ image_url: url, code: 'storage_full' }); continue;
    }
    const uid = crypto.randomUUID();
    const key = `deck-images/${o.projectId}/${uid}.${img.ext}`;
    try { await env.FILES.put(key, img.bytes, { httpMetadata: { contentType: img.mime }, customMetadata: { projectId: String(o.projectId), userId: String(o.user.id) } }); }
    catch { if (mode === 'save') return { ok: false, image_url: url, code: 'image_unsaved' }; failed.push({ image_url: url, code: 'image_unsaved' }); continue; }
    const removeUnlinkedCopy = async () => {
      try { await env.FILES!.delete(key); } catch { console.warn('[deck-image-copy] cleanup_failed'); }
    };
    let inserted: { uid: string } | null;
    try {
      inserted = await env.DB.prepare(`INSERT INTO deck_images (uid, project_id, deck_id, r2_key, mime, size_bytes, width, height, sha256, source, use, alt, state, created_by, kept_at, kept_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'upload', 'content', '', 'kept', ?, datetime('now'), ?)
        ON CONFLICT DO NOTHING RETURNING uid`)
        .bind(uid, o.projectId, o.deckId, key, img.mime, img.bytes.byteLength, img.width, img.height, img.sha256, o.user.id, o.user.id).first<{ uid: string }>();
    } catch {
      await removeUnlinkedCopy();
      if (mode === 'save') return { ok: false, image_url: url, code: 'image_unsaved' };
      failed.push({ image_url: url, code: 'image_unsaved' }); continue;
    }
    if (!inserted) {
      // Another save/export won the hash's unique index after our initial read.
      await removeUnlinkedCopy();
      const winner = await env.DB.prepare('SELECT uid FROM deck_images WHERE project_id = ? AND sha256 = ?').bind(o.projectId, img.sha256).first<{ uid: string }>();
      if (winner) { copies.set(url, winner.uid); continue; }
      if (mode === 'save') return { ok: false, image_url: url, code: 'image_unsaved' };
      failed.push({ image_url: url, code: 'image_unsaved' }); continue;
    }
    await noteStorageLanded(env, ticket);
    copies.set(url, inserted.uid);
  }
  for (const sp of spots(slides)) {
    const v = sp.get();
    const uid = typeof v === 'string' ? copies.get(v) : undefined;
    if (uid) sp.set(new URL(`/api/decks/images/${uid}/file`, o.requestUrl).toString(), uid);
  }
  const imageCopies = Object.fromEntries(await Promise.all([...copies].map(async ([url, uid]) => [await urlHash(url), uid])));
  return { ok: true, slides, copied: copies.size, failed, imageCopies };
}

/** The sentence a refused copy shows, by code. */
export function copyRefusalMessage(code: string): string {
  switch (code) {
    case 'too_many_images': return `A save copies at most ${MAX_COPIES_PER_SAVE} outside images. Upload the rest, or save in parts.`;
    case 'image_too_large': return 'An outside image is over 5 MB or 50 megapixels. Upload a smaller copy.';
    case 'image_unreadable': return 'An outside image is not a PNG, JPEG or WebP picture we can read. Upload it instead.';
    case 'storage_full': return 'There is no room left on the storage plan to copy an outside image. Nothing was saved.';
    case 'storage_unavailable': case 'image_unsaved': return 'Outside images cannot be stored right now. Nothing was saved; try again in a moment.';
    default: return 'An outside image could not be fetched safely (https only, a public address, no off-site redirects). Upload it instead. Nothing was saved.';
  }
}
