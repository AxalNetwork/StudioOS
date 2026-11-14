/**
 * D1199 (#3149, part 4 of #2382) — a product-testing programme's logo:
 * TST7's logo field and the squares on TST2, TST4 and TST5.
 *
 * THE BYTES DECIDE THE TYPE. What the browser declared is never read. A PNG is
 * its eight-byte signature and an IHDR chunk; an SVG is UTF-8 text whose first
 * element is `<svg`. Anything else is refused as `not_an_image`.
 *
 * SQUARE, SMALL, SAFE.
 * - At most `LOGO_MAX_BYTES`.
 * - Square: the PNG's IHDR width equals its height, and the SVG's `viewBox`
 *   (or its `width` and `height`) is square. An SVG that says neither is refused.
 * - An SVG holding script, an event handler, a `javascript:` link, a
 *   `<foreignObject>` or an external reference is refused (`unsafe_svg`). Any
 *   other SVG is stored as `sanitizeSvg` rebuilds it (brand.ts's allowlist,
 *   D198), never as uploaded.
 *
 * THE WORKER SETS `logo_key`. The key is `testing-logos/<programme uid>/<uuid>.<ext>`
 * in the platform's private `FILES` bucket. A programme body cannot carry one
 * (`programmeInput` refuses it), and the serve route reads only that prefix.
 * Replacing or removing a logo deletes the old object, best effort.
 *
 * WHO. The owner only, through `ownProgramme`: a partner on their firm's
 * programmes, HQ on its own. Another firm's programme is 404, as a missing one.
 * A logo changes only while the programme can be edited (draft, or sent back),
 * as every other field does, so an approved programme cannot change under
 * HQ's review.
 */
import type { Env } from '../types';
import { sanitizeSvg } from '../routes/brand';
import { TestingRefusal, ownProgramme, type Owner } from './testing';

export const LOGO_MAX_BYTES = 256 * 1024;
export const LOGO_PREFIX = 'testing-logos/';
const EDITABLE = ['draft', 'rejected'];

const refuse = (status: number, code: string, message: string) => new TestingRefusal(status, code, message);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG's width and height from its IHDR chunk, or null when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return null;
  // The first chunk must be IHDR: length 13, type "IHDR".
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR') return null;
  const u32 = (o: number) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  return { width: u32(16), height: u32(20) };
}

/** The SVG text when the bytes are UTF-8 whose first element is `<svg`; otherwise null. */
export function svgText(bytes: Uint8Array): string | null {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes); } catch { return null; }
  const body = text.replace(/^﻿/, '').replace(/^\s*<\?xml[^>]*\?>/i, '').replace(/^(\s*<!--[\s\S]*?-->)*/, '').trimStart();
  return /^<svg[\s>/]/i.test(body) ? body : null;
}

/** What makes an SVG unsafe to store at all, before sanitising. */
const UNSAFE_SVG = [
  /<script/i, /<foreignobject/i, /<iframe/i, /<embed/i, /<object/i,
  /[\s/"']on[a-z]+\s*=/i, /javascript\s*:/i, /<!entity/i, /<!doctype/i,
  /(?:xlink:)?href\s*=\s*["']?\s*(?!#)[a-z][a-z0-9+.-]*:/i,
];
export const svgIsUnsafe = (svg: string) => UNSAFE_SVG.some((re) => re.test(svg));

const num = (v: string | undefined) => {
  if (v == null) return null;
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(v);
  return m ? Number(m[1]) : null;
};

/** Whether the root `<svg>` says it is square: its viewBox, else its width and height. */
export function svgIsSquare(svg: string): boolean | null {
  const root = /^<svg\b([^>]*)>/i.exec(svg)?.[1] ?? '';
  // One literal pattern per attribute: nothing a caller passes becomes a regular expression.
  const ATTR = { viewBox: /\sviewBox\s*=\s*["']([^"']*)["']/i, width: /\swidth\s*=\s*["']([^"']*)["']/i, height: /\sheight\s*=\s*["']([^"']*)["']/i };
  const attr = (name: keyof typeof ATTR) => ATTR[name].exec(root)?.[1];
  const box = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (box && box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) return box[2] === box[3];
  const w = num(attr('width')), h = num(attr('height'));
  if (w && h) return w === h;
  return null;
}

export type CheckedLogo = { bytes: Uint8Array; contentType: 'image/png' | 'image/svg+xml'; ext: 'png' | 'svg' };

/** The bytes to store, or the refusal: too big, not an image, not square, unsafe. */
export function checkLogo(raw: Uint8Array): CheckedLogo {
  if (raw.length === 0) throw refuse(400, 'empty_file', 'Choose a file to upload.');
  if (raw.length > LOGO_MAX_BYTES) throw refuse(413, 'file_too_large', `A logo is at most ${LOGO_MAX_BYTES / 1024} KB.`);
  const png = pngSize(raw);
  if (png) {
    if (!png.width || png.width !== png.height) throw refuse(400, 'not_square', 'The logo must be square.');
    return { bytes: raw, contentType: 'image/png', ext: 'png' };
  }
  // Unsafe markup is refused wherever it sits, before the SVG is even recognised (a DOCTYPE ahead of the root included).
  let decoded: string | null = null;
  try { decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(raw); } catch { /* not text */ }
  if (decoded && /<svg/i.test(decoded) && svgIsUnsafe(decoded)) throw refuse(400, 'unsafe_svg', 'This SVG holds script, a link or an embedded document, so it is refused.');
  const svg = svgText(raw);
  if (svg == null) throw refuse(400, 'not_an_image', 'A logo is a PNG or an SVG file.');
  if (svgIsUnsafe(svg)) throw refuse(400, 'unsafe_svg', 'This SVG holds script, a link or an embedded document, so it is refused.');
  const square = svgIsSquare(svg);
  if (square === null) throw refuse(400, 'not_square', 'Give the SVG a square viewBox.');
  if (!square) throw refuse(400, 'not_square', 'The logo must be square.');
  const clean = sanitizeSvg(svg);
  if (!clean) throw refuse(400, 'unsafe_svg', 'This SVG could not be cleaned, so it is refused.');
  return { bytes: new TextEncoder().encode(clean), contentType: 'image/svg+xml', ext: 'svg' };
}

/** The uploaded file's bytes from a multipart body's `file` field. */
export async function uploadedBytes(form: FormData | null): Promise<Uint8Array> {
  const file = form?.get('file') as unknown as { arrayBuffer?: () => Promise<ArrayBuffer>; size?: number } | null;
  if (!file || typeof file.arrayBuffer !== 'function') throw refuse(400, 'empty_file', 'Choose a file to upload.');
  if (typeof file.size === 'number' && file.size > LOGO_MAX_BYTES) throw refuse(413, 'file_too_large', `A logo is at most ${LOGO_MAX_BYTES / 1024} KB.`);
  return new Uint8Array(await file.arrayBuffer());
}

function bucket(env: Env): R2Bucket {
  if (!env.FILES) throw refuse(503, 'storage_unavailable', 'Logo storage is not available. Try again.');
  return env.FILES;
}

async function setKey(env: Env, p: any, actor: number, key: string | null) {
  const res = await env.DB.batch([
    env.DB.prepare(`UPDATE testing_programmes SET logo_key = ?, updated_at = datetime('now')
      WHERE id = ? AND status IN (SELECT value FROM json_each(?))`).bind(key, p.id, JSON.stringify(EDITABLE)),
    env.DB.prepare(`INSERT INTO testing_events (programme_id, actor_user_id, action)
      SELECT ?, ?, ? WHERE changes() = 1`).bind(p.id, actor, key ? 'logo_set' : 'logo_removed'),
  ]);
  return Boolean(res[0]?.meta?.changes);
}

const dropOld = async (env: Env, key: unknown) => {
  if (typeof key === 'string' && key.startsWith(LOGO_PREFIX)) {
    try { await env.FILES?.delete(key); } catch { console.warn('[testing-logo] an old logo could not be deleted'); }
  }
};

/** Stores the owner's logo for their programme and points `logo_key` at it. */
export async function putLogo(env: Env, owner: Owner, actor: number, uid: string, raw: Uint8Array) {
  const p = await ownProgramme(env, owner, uid);
  if (!EDITABLE.includes(p.status)) throw refuse(409, 'not_editable', 'Only a draft can be edited.');
  const logo = checkLogo(raw);
  const key = `${LOGO_PREFIX}${p.uid}/${crypto.randomUUID()}.${logo.ext}`;
  await bucket(env).put(key, logo.bytes, { httpMetadata: { contentType: logo.contentType }, customMetadata: { programme_uid: String(p.uid) } });
  if (!await setKey(env, p, actor, key)) {
    await dropOld(env, key);
    throw refuse(409, 'not_editable', 'Only a draft can be edited.');
  }
  await dropOld(env, p.logo_key);
  return { logo_key: key, content_type: logo.contentType, size: logo.bytes.length };
}

/** Removes the owner's logo; the page draws the initial letter again. */
export async function removeLogo(env: Env, owner: Owner, actor: number, uid: string) {
  const p = await ownProgramme(env, owner, uid);
  if (!EDITABLE.includes(p.status)) throw refuse(409, 'not_editable', 'Only a draft can be edited.');
  if (!p.logo_key) return { logo_key: null };
  if (!await setKey(env, p, actor, null)) throw refuse(409, 'not_editable', 'Only a draft can be edited.');
  await dropOld(env, p.logo_key);
  return { logo_key: null };
}

/** Statuses a member can see a programme in, so its logo too. */
const MEMBER_VISIBLE = ['open', 'testing', 'closed'];

/**
 * The stored logo for a reader, or null (404). The owner and Super Admin read
 * any of their programmes' logos; any other signed-in member reads a logo only
 * while its programme is one members can see.
 */
export async function readLogo(env: Env, reader: { owner: Owner | null; superAdmin: boolean }, uid: string) {
  const p = await env.DB.prepare('SELECT id, uid, status, owner_kind, owner_partner_id, logo_key FROM testing_programmes WHERE uid = ?').bind(uid).first<any>();
  if (!p || typeof p.logo_key !== 'string' || !p.logo_key.startsWith(LOGO_PREFIX)) return null;
  const owns = reader.owner?.kind === 'partner' && p.owner_kind === 'partner' && Number(p.owner_partner_id) === reader.owner.partnerId;
  if (!(reader.superAdmin || owns || MEMBER_VISIBLE.includes(p.status))) return null;
  const obj = await bucket(env).get(p.logo_key);
  return obj ? { body: obj.body, contentType: obj.httpMetadata?.contentType === 'image/svg+xml' ? 'image/svg+xml' : 'image/png' } : null;
}
