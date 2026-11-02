/**
 * D1506 (#3757, A13 part 2) — what an image's bytes may carry into a deck.
 *
 *   · `stripMetadata` takes the metadata out at the byte level: EXIF, XMP,
 *     IPTC and comments from a JPEG; text, EXIF and time chunks from a PNG;
 *     the EXIF and XMP chunks from a WebP (and their VP8X flags). Pixels,
 *     colour profiles and the frame structure are kept byte for byte.
 *   · `measure` reads the width and height from the header and refuses an
 *     image over `MAX_PIXELS` (50 MP) or one whose header cannot be read.
 *   · `fetchExternalImage` fetches an outside image only over https, from a
 *     host that resolves to public addresses only (`guardHost`), following at
 *     most `MAX_REDIRECTS` redirects and checking each hop the same way, and
 *     reads at most `MAX_EXTERNAL_BYTES`.
 *
 * Uploads and outside images are stripped. A generated image is never passed
 * here: its own marking (the AI-image marking spec for counsel, #3763) must
 * survive.
 */
import { imageInfo } from '../ai/shapes';
import { sniffMime, EXTENSION, type MIMES } from '../aiImages';
import { guardHost, type Resolver } from '../../integrations/customMcp';

export const MAX_PIXELS = 50_000_000;
export const MAX_EXTERNAL_BYTES = 5 * 1024 * 1024;
export const MAX_REDIRECTS = 3;
export const FETCH_DEADLINE_MS = 8_000;

type Mime = typeof MIMES[number];

// ─────────────────────────────────────────────────────────── stripping

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u32le = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * A JPEG without its metadata segments: APP1 (EXIF, XMP), APP3–APP13 (IPTC
 * among them), APP15, COM, and an APP2 that is not an ICC profile. APP0
 * (JFIF), APP14 (Adobe colour), the ICC profile and everything from the scan
 * on are kept. Null when the segments cannot be walked.
 */
export function stripJpeg(b: Uint8Array): Uint8Array | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) { i += 1; continue; } // fill byte
    if (marker === 0xd9) { parts.push(b.subarray(i, i + 2)); return concat(parts); }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { parts.push(b.subarray(i, i + 2)); i += 2; continue; }
    const len = u16be(b, i + 2);
    if (len < 2 || i + 2 + len > b.length) return null;
    const seg = b.subarray(i, i + 2 + len);
    if (marker === 0xda) { parts.push(b.subarray(i)); return concat(parts); } // the scan and the rest, unchanged
    const isApp2Icc = marker === 0xe2 && ascii(b, i + 4, 12) === 'ICC_PROFILE\0';
    const drop = marker === 0xfe || marker === 0xe1 || marker === 0xef || (marker >= 0xe3 && marker <= 0xed) || (marker === 0xe2 && !isApp2Icc);
    if (!drop) parts.push(seg);
    i += 2 + len;
  }
  return null;
}

/** The PNG chunks kept: every critical chunk, and the ancillary ones that change how pixels look. */
const PNG_KEEP = new Set(['tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'pHYs', 'bKGD', 'acTL', 'fcTL', 'fdAT']);

/** A PNG without its text, EXIF, time and other ancillary chunks. Null when the chunks cannot be walked. */
export function stripPng(b: Uint8Array): Uint8Array | null {
  if (b.length < 8 || b[0] !== 0x89 || ascii(b, 1, 3) !== 'PNG') return null;
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = u32be(b, i);
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.length) return null;
    const critical = type.charCodeAt(0) >= 65 && type.charCodeAt(0) <= 90;
    if (critical || PNG_KEEP.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') return concat(parts);
  }
  return null;
}

/** A WebP without its EXIF and XMP chunks, its VP8X flags and RIFF size set to match. Null when it cannot be walked. */
export function stripWebp(b: Uint8Array): Uint8Array | null {
  if (b.length < 12 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const parts: Uint8Array[] = [b.subarray(0, 12)];
  let i = 12;
  let vp8x: Uint8Array | null = null;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4);
    const len = u32le(b, i + 4);
    const end = i + 8 + len + (len % 2);
    if (i + 8 + len > b.length) return null;
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = b.slice(i, Math.min(end, b.length));
      if (type === 'VP8X') vp8x = chunk;
      parts.push(chunk);
    }
    i = end;
  }
  // VP8X's flags byte: bit 3 is EXIF, bit 2 is XMP.
  if (vp8x && vp8x.length > 8) vp8x[8] &= ~0x0c;
  const out = concat(parts);
  const size = out.length - 8;
  out[4] = size & 0xff; out[5] = (size >> 8) & 0xff; out[6] = (size >> 16) & 0xff; out[7] = (size >>> 24) & 0xff;
  return out;
}

/** The image without its metadata, for its format; null when its structure cannot be read. */
export function stripMetadata(bytes: Uint8Array, mime: string): Uint8Array | null {
  if (mime === 'image/jpeg') return stripJpeg(bytes);
  if (mime === 'image/png') return stripPng(bytes);
  if (mime === 'image/webp') return stripWebp(bytes);
  return null;
}

// ─────────────────────────────────────────────────────────── measuring

export type Measured = { ok: true; mime: Mime; width: number; height: number } | { ok: false; code: 'image_unreadable' | 'image_too_large' };

/** The format from the bytes, and the size from the header; over 50 MP or unreadable is refused. */
export function measure(bytes: Uint8Array): Measured {
  const mime = sniffMime(bytes);
  const info = mime ? imageInfo(bytes) : null;
  if (!mime || !info || info.mime !== mime || !(info.width > 0) || !(info.height > 0)) return { ok: false, code: 'image_unreadable' };
  if (info.width * info.height > MAX_PIXELS) return { ok: false, code: 'image_too_large' };
  return { ok: true, mime, width: info.width, height: info.height };
}

/** The lower-case hex SHA-256 of the bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** An image ready to store: stripped, measured, hashed. */
export type Prepared = { ok: true; bytes: Uint8Array; mime: Mime; ext: string; width: number; height: number; sha256: string } | { ok: false; code: string };

export async function prepareImage(raw: Uint8Array): Promise<Prepared> {
  const m = measure(raw);
  if (!m.ok) return m;
  const bytes = stripMetadata(raw, m.mime);
  if (!bytes) return { ok: false, code: 'image_unreadable' };
  return { ok: true, bytes, mime: m.mime, ext: EXTENSION[m.mime], width: m.width, height: m.height, sha256: await sha256Hex(bytes) };
}

// ─────────────────────────────────────────────────────────── fetching

const PRIVATE_SUFFIXES = ['localhost', 'local', 'internal', 'lan', 'home', 'corp', 'intranet'];

/** Why an outside image URL may not be fetched, or null. */
export function imageUrlRefusal(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 2048) return 'bad_url';
  let u: URL;
  try { u = new URL(raw); } catch { return 'bad_url'; }
  if (u.protocol !== 'https:') return 'not_https';
  if (u.username || u.password) return 'userinfo';
  if (u.port && u.port !== '443') return 'port';
  const host = u.hostname.toLowerCase();
  // An address literal (IPv4, or IPv6 in brackets) is never fetched: only names, which `guardHost` resolves.
  if (host.startsWith('[') || host.includes(':') || /^\d+(\.\d+){3}$/.test(host)) return 'ip_literal';
  if (!host.includes('.') || PRIVATE_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) return 'private_name';
  return null;
}

export type Fetched = { ok: true; bytes: Uint8Array } | { ok: false; code: string };

/**
 * An outside image's bytes, fetched safely: each URL (the first and every
 * redirect's target) must pass `imageUrlRefusal` and resolve to public
 * addresses only; redirects are followed by hand, at most `MAX_REDIRECTS`;
 * the body is read to at most `maxBytes` (`MAX_EXTERNAL_BYTES` by default).
 */
export async function fetchExternalImage(url: string, resolve: Resolver, fetcher: typeof fetch = fetch, deadlineMs = FETCH_DEADLINE_MS, maxBytes = MAX_EXTERNAL_BYTES): Promise<Fetched> {
  let at = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const refused = imageUrlRefusal(at);
    if (refused) return { ok: false, code: refused };
    const host = new URL(at).hostname.toLowerCase();
    if (await guardHost(host, resolve) !== 'ok') return { ok: false, code: 'host_refused' };
    let res: Response;
    try {
      res = await fetcher(at, { method: 'GET', redirect: 'manual', headers: { Accept: 'image/png,image/jpeg,image/webp' }, signal: AbortSignal.timeout(deadlineMs) });
    } catch { return { ok: false, code: 'fetch_failed' }; }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('Location');
      await res.body?.cancel?.().catch(() => undefined);
      if (!next) return { ok: false, code: 'fetch_failed' };
      at = new URL(next, at).toString();
      continue;
    }
    if (!res.ok || !res.body) return { ok: false, code: 'fetch_failed' };
    const declared = Number(res.headers.get('Content-Length'));
    if (Number.isFinite(declared) && declared > maxBytes) { await res.body.cancel().catch(() => undefined); return { ok: false, code: 'image_too_large' }; }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > maxBytes) { await reader.cancel().catch(() => undefined); return { ok: false, code: 'image_too_large' }; }
      chunks.push(value);
    }
    return { ok: true, bytes: concat(chunks) };
  }
  return { ok: false, code: 'too_many_redirects' };
}
