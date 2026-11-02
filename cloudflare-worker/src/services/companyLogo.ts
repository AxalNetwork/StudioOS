/**
 * #4201 (#4152 G1) — what a company logo may be, and where it is stored.
 *
 * A logo is a PNG or an SVG of at most 2 MB, square or close to it (width over
 * height within 0.9–1.1). The BYTES decide the type: a PNG by its signature and
 * its IHDR header (width and height), an SVG by its root `<svg` element (its
 * numeric width and height, else its viewBox). An SVG that could run anything
 * or reach outside itself is REFUSED, never cleaned: a script, an `on…=`
 * handler, a `javascript:`/`vbscript:` URL, a `<foreignObject>` (or iframe,
 * embed, object), a DOCTYPE or ENTITY, an `href` or `xlink:href` that is not a
 * `#fragment`, a CSS `@import` or a `url(…)` that is not `url(#…)`. The serve
 * adds a CSP that forbids all of that anyway; refusing keeps a stored logo
 * safe if it is ever served without one.
 *
 * STORAGE is R2 `COMPANY_LOGOS` under `companies/<uid>/logo-<random>.<ext>`.
 * `company_profiles.logo_url` names the served path
 * `/api/company/<uid>/logo?v=<random>.<ext>`, so the row alone says which
 * object is current (no migration, no new column) and a new logo is a new
 * URL, which a cache never confuses with the old one. A `logo_url` of any
 * other shape (an outside host a member pasted) is not ours: it is never
 * parsed into a key, read, deleted or rewritten by a read.
 */

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MIN_RATIO = 0.9;
export const MAX_RATIO = 1.1;

export type LogoKind = 'png' | 'svg';
export const LOGO_CONTENT_TYPE: Record<LogoKind, string> = { png: 'image/png', svg: 'image/svg+xml' };

/** The served path's prefix for a company; the query names the object. */
export const logoPathOf = (uid: string) => `/api/company/${uid}/logo`;

/** The served path for a stored object. */
export const logoUrlFor = (uid: string, token: string, kind: LogoKind) => `${logoPathOf(uid)}?v=${token}.${kind}`;

/** The R2 key for a stored object. */
export const logoKeyFor = (uid: string, token: string, kind: LogoKind) => `companies/${uid}/logo-${token}.${kind}`;

/** A fresh random token: 32 hex characters. */
export const newLogoToken = () => crypto.randomUUID().replace(/-/g, '');

/**
 * The object a company's `logo_url` names, when it names one of this
 * company's own stored logos; null for an outside URL, another company's
 * path, or anything else.
 */
export function storedLogoOf(uid: string, logoUrl: string | null | undefined): { key: string; kind: LogoKind } | null {
  if (typeof logoUrl !== 'string') return null;
  const prefix = `${logoPathOf(uid)}?v=`;
  if (!logoUrl.startsWith(prefix)) return null;
  const m = /^([0-9a-f]{32})\.(png|svg)$/.exec(logoUrl.slice(prefix.length));
  if (!m) return null;
  const kind = m[2] as LogoKind;
  return { key: logoKeyFor(uid, m[1], kind), kind };
}

export type LogoCheck =
  | { ok: true; kind: LogoKind; width: number; height: number }
  | { ok: false; code: LogoRefusal };

export type LogoRefusal =
  | 'file_empty' | 'file_too_large' | 'file_type_invalid'
  | 'logo_dimensions_unreadable' | 'logo_not_square'
  | 'svg_unsafe';

export const LOGO_MESSAGES: Record<LogoRefusal, string> = {
  file_empty: 'The file is empty.',
  file_too_large: 'The logo is larger than 2 MB.',
  file_type_invalid: 'Upload a PNG or SVG file.',
  logo_dimensions_unreadable: 'The logo\'s width and height could not be read. Upload a PNG, or an SVG with a width and height or a viewBox.',
  logo_not_square: 'The logo must be square or close to it.',
  svg_unsafe: 'This SVG holds scripts, event handlers, embedded content or links outside itself. Export it as a plain SVG or a PNG.',
};

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(b: Uint8Array): boolean {
  return b.length >= 8 && PNG_SIG.every((v, i) => b[i] === v);
}

/** Width and height from a PNG's IHDR chunk, which must come first; null when absent. */
export function pngSize(b: Uint8Array): { width: number; height: number } | null {
  if (!isPng(b) || b.length < 24) return null;
  // bytes 12..15 are the first chunk's type, which must be IHDR.
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const width = dv.getUint32(16);
  const height = dv.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** The text of an SVG upload, or null when the bytes are not UTF-8 text whose root is `<svg`. */
export function svgText(b: Uint8Array): string | null {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(b); } catch { return null; }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // Before the root: whitespace, an XML declaration, comments, a DOCTYPE (refused later).
  const lead = /^(?:\s+|<\?xml[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE(?:[^[>]*\[[\s\S]*?\])?[^>]*>)*/i.exec(text);
  const rest = text.slice(lead ? lead[0].length : 0);
  return /^<svg[\s>/]/i.test(rest) ? text : null;
}

/** True when the SVG holds something that could run, embed or reach outside it. */
export function svgIsUnsafe(text: string): boolean {
  const t = text.toLowerCase();
  if (/<!doctype|<!entity/.test(t)) return true;
  if (/<\s*script\b/.test(t)) return true;
  if (/<\s*(?:foreignobject|iframe|embed|object)\b/.test(t)) return true;
  if (/<\?xml-stylesheet/.test(t)) return true;
  // Any `on…=` attribute: onload, onclick, onbegin, …
  if (/[\s"'/]on[a-z]+\s*=/.test(t)) return true;
  // A scripting URL anywhere, also with whitespace or control characters inside it.
  const squashed = t.replace(/[\s\u0000-\u001f]+/g, '');
  if (/(?:javascript|vbscript):/.test(squashed)) return true;
  if (/data:text\/html/.test(squashed)) return true;
  // Character references could spell any of the above inside an attribute.
  if (/&#/.test(t)) return true;
  // href / xlink:href: only a #fragment, quoted.
  for (const m of t.matchAll(/(?:^|[\s"'/])(?:xlink:)?href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g)) {
    const raw = m[1];
    if (!(raw.startsWith('"') || raw.startsWith("'"))) return true;
    if (!raw.slice(1, -1).trim().startsWith('#')) return true;
  }
  if (/@import/.test(t)) return true;
  for (const m of t.matchAll(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/g)) {
    if (!m[2].trim().startsWith('#')) return true;
  }
  return false;
}

const NUM = /^\s*([0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)\s*(?:px)?\s*$/i;

/** A quoted attribute of one tag, by name (case-insensitive). Fixed pattern, compared by name: no regex is built from `name`. */
function attrOf(tag: string, name: string): string | null {
  const want = name.toLowerCase();
  for (const m of tag.matchAll(/[\s"']([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    if (m[1].toLowerCase() === want) return m[2] ?? m[3] ?? null;
  }
  return null;
}

/** Width and height of the root `<svg>`: numeric width and height, else the viewBox; null when neither reads. */
export function svgSize(text: string): { width: number; height: number } | null {
  const open = /<svg\b[^>]*>/i.exec(text);
  if (!open) return null;
  const tag = open[0];
  const w = attrOf(tag, 'width'), h = attrOf(tag, 'height');
  const wn = w != null ? NUM.exec(w) : null, hn = h != null ? NUM.exec(h) : null;
  if (wn && hn) {
    const width = Number(wn[1]), height = Number(hn[1]);
    if (width > 0 && height > 0) return { width, height };
  }
  const vb = attrOf(tag, 'viewBox');
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) return { width: parts[2], height: parts[3] };
  }
  return null;
}

const ALLOWED_DECLARED = new Set(['', 'image/png', 'image/svg+xml', 'application/octet-stream']);

/** Every rule a logo upload meets, in the order a person would fix them. */
export function checkLogo(bytes: Uint8Array, declaredType: string | undefined | null): LogoCheck {
  if (bytes.length === 0) return { ok: false, code: 'file_empty' };
  if (bytes.length > MAX_LOGO_BYTES) return { ok: false, code: 'file_too_large' };
  const declared = String(declaredType || '').toLowerCase().split(';')[0].trim();
  if (!ALLOWED_DECLARED.has(declared)) return { ok: false, code: 'file_type_invalid' };
  let kind: LogoKind;
  let size: { width: number; height: number } | null;
  if (isPng(bytes)) {
    kind = 'png';
    size = pngSize(bytes);
  } else {
    const text = svgText(bytes);
    if (text === null) return { ok: false, code: 'file_type_invalid' };
    kind = 'svg';
    if (svgIsUnsafe(text)) return { ok: false, code: 'svg_unsafe' };
    size = svgSize(text);
  }
  if (!size) return { ok: false, code: 'logo_dimensions_unreadable' };
  const ratio = size.width / size.height;
  if (ratio < MIN_RATIO || ratio > MAX_RATIO) return { ok: false, code: 'logo_not_square' };
  return { ok: true, kind, width: size.width, height: size.height };
}

/** The headers a stored logo is served with. */
export function logoHeaders(kind: LogoKind): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': LOGO_CONTENT_TYPE[kind],
    'Content-Disposition': `inline; filename="logo.${kind}"`,
    'X-Content-Type-Options': 'nosniff',
    // The URL changes with every upload, so a short private cache is safe.
    'Cache-Control': 'private, max-age=300',
  };
  if (kind === 'svg') h['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  return h;
}
