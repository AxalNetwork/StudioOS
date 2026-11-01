/**
 * D1506 (#3757, deck v2 A13) — an image's bytes before they are stored.
 *
 *   - `imageSize`      width and height read from the header (PNG IHDR, the
 *                      JPEG frame header, WebP VP8 / VP8L / VP8X), never from
 *                      what a client says. Null when the header cannot be read.
 *   - `MAX_PIXELS`     50 megapixels; a larger image is refused before it is
 *                      decoded anywhere.
 *   - `stripMetadata`  byte-level, no decoder: JPEG loses its EXIF and XMP
 *                      (APP1), IPTC (APP13), comments and the other
 *                      application segments, keeping JFIF (APP0), the colour
 *                      profile (APP2 ICC_PROFILE) and Adobe's colour transform
 *                      (APP14); PNG loses tEXt, zTXt, iTXt, eXIf and tIME;
 *                      WebP loses its EXIF and XMP chunks and their VP8X flags.
 *                      The picture's own bytes are untouched.
 *   - `sha256Hex`      the stored bytes' hash, for `UNIQUE(project_id, sha256)`
 *                      (migration 718).
 */

export const MAX_PIXELS = 50_000_000;

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32le = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (b: Uint8Array) => b.length >= 8 && PNG_SIG.every((x, i) => b[i] === x);
const isJpeg = (b: Uint8Array) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isWebp = (b: Uint8Array) => b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP';

/** The image's width and height from its header, or null when it cannot be read. */
export function imageSize(bytes: Uint8Array, mime: ImageMime): { width: number; height: number } | null {
  try {
    if (mime === 'image/png' && isPng(bytes) && bytes.length >= 24 && ascii(bytes, 12, 4) === 'IHDR') {
      return positive(u32be(bytes, 16), u32be(bytes, 20));
    }
    if (mime === 'image/jpeg' && isJpeg(bytes)) {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) return null;
        const marker = bytes[i + 1];
        if (marker === 0xff) { i += 1; continue; }
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
        const len = u16be(bytes, i + 2);
        // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return positive(u16be(bytes, i + 7), u16be(bytes, i + 5));
        }
        if (marker === 0xda || len < 2) return null;
        i += 2 + len;
      }
      return null;
    }
    if (mime === 'image/webp' && isWebp(bytes) && bytes.length >= 30) {
      const kind = ascii(bytes, 12, 4);
      if (kind === 'VP8X') return positive(u24le(bytes, 24) + 1, u24le(bytes, 27) + 1);
      if (kind === 'VP8L' && bytes[20] === 0x2f) {
        const bits = u32le(bytes, 21);
        return positive((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
      }
      if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
        return positive(u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff);
      }
    }
  } catch { /* a truncated header reads as unreadable */ }
  return null;
}
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const positive = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);

/** Whether an image of this size is too large to accept. */
export const tooManyPixels = (size: { width: number; height: number }) => size.width * size.height > MAX_PIXELS;

// ─────────────────────────────────────────────────────────── stripping

/** JPEG application segments kept: JFIF (APP0), the ICC colour profile (APP2), Adobe's colour transform (APP14). */
function keepJpegSegment(bytes: Uint8Array, at: number, marker: number): boolean {
  if (marker === 0xfe) return false; // COM
  if (marker < 0xe0 || marker > 0xef) return true; // not an application segment
  if (marker === 0xe0) return true;
  if (marker === 0xe2) return ascii(bytes, at + 4, 11) === 'ICC_PROFILE';
  if (marker === 0xee) return ascii(bytes, at + 4, 5) === 'Adobe';
  return false; // APP1 (EXIF, XMP), APP13 (IPTC) and the rest
}

function stripJpeg(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return bytes; // not a segment boundary: leave the file as it was
    const marker = bytes[i + 1];
    if (marker === 0xda) { parts.push(bytes.subarray(i)); return concat(parts); } // the scan and everything after
    const len = u16be(bytes, i + 2);
    if (len < 2 || i + 2 + len > bytes.length) return bytes;
    if (keepJpegSegment(bytes, i, marker)) parts.push(bytes.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return bytes;
}

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function stripPng(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= bytes.length) {
    const len = u32be(bytes, i);
    const type = ascii(bytes, i + 4, 4);
    const end = i + 12 + len;
    if (end > bytes.length) return bytes;
    if (!PNG_DROP.has(type)) parts.push(bytes.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return concat(parts);
}

function stripWebp(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let i = 12;
  let dropped = false;
  while (i + 8 <= bytes.length) {
    const type = ascii(bytes, i, 4);
    const len = u32le(bytes, i + 4);
    const end = i + 8 + len + (len & 1);
    if (i + 8 + len > bytes.length) return bytes;
    if (type === 'EXIF' || type === 'XMP ') { dropped = true; } else {
      const chunk = bytes.slice(i, Math.min(end, bytes.length));
      // VP8X flags: bit 3 is EXIF, bit 2 is XMP.
      if (type === 'VP8X' && chunk.length > 8 && (chunk[8] & 0x0c)) { chunk[8] &= ~0x0c; dropped = true; }
      parts.push(chunk);
    }
    i = end;
  }
  if (!dropped) return bytes;
  const body = concat(parts);
  const head = new Uint8Array(12);
  head.set(bytes.subarray(0, 12));
  const size = body.length + 4;
  head[4] = size & 0xff; head[5] = (size >> 8) & 0xff; head[6] = (size >> 16) & 0xff; head[7] = (size >>> 24) & 0xff;
  return concat([head, body]);
}

/** The image without its metadata. A file whose structure cannot be walked is returned as it was. */
export function stripMetadata(bytes: Uint8Array, mime: ImageMime): Uint8Array {
  if (mime === 'image/jpeg' && isJpeg(bytes)) return stripJpeg(bytes);
  if (mime === 'image/png' && isPng(bytes)) return stripPng(bytes);
  if (mime === 'image/webp' && isWebp(bytes)) return stripWebp(bytes);
  return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** The bytes' SHA-256, lower-case hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(d, (x) => x.toString(16).padStart(2, '0')).join('');
}
