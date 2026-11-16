/**
 * D5583 part 1 (#5583, WorkGraph P1 under the #5577 epic) — the rules for creative media in WorkGraph: which bytes
 * are admitted and as what, the provenance and rights a version carries, how a master pins its fonts, textures and
 * linked images, which renditions a master gets, and brand tokens as mergeable units. Pure: it reads and writes
 * nothing. #5581 part 3 (S14) owns the bytes themselves (content-addressed R2 writes, read-back verification,
 * partial-upload reconciliation); this module decides whether bytes may become a version at all.
 *
 *   ADMISSION   `admitMedia` sniffs the bytes (never trusts the declared type), checks the format is allowed for the
 *               asset kind and object class, enforces the class's size cap, checks the file's structure end to end
 *               where the format has one, and refuses unsafe metadata: SVG scripts, event handlers, external
 *               references and entities; glTF external URIs; JPEG and PNG location (EXIF GPS). Every refusal is a
 *               fixed code. Nothing is guessed: an unknown format is `unsupported_format`.
 *   PROVENANCE  `checkProvenance` refuses a version whose rights cannot support its use: no rights basis, a revoked
 *               or expired licence, a use outside the licence's scope, a person shown without consent (publication),
 *               a generated version with no model, a derived one with no source, or a claim of reproducibility nobody
 *               verified. `provenanceFromDeckImage` reads what `deck_images` already records (D903, migration 543),
 *               so no second consent or model ledger exists.
 *   PINS        `pinDependencies`: fonts by family and licence only (a font binary is never a dependency, so it is
 *               never redistributed); textures, materials, linked images and brand tokens as `read` edges pinned to
 *               an exact revision, which #5581 refuses at the head move once stale.
 *   RENDITIONS  `renditionPlan`: what a master gets (web formats, a thumbnail, a 3D preview), each in its own object
 *               class, and whether it needs external compute (#5571).
 *   BRAND       `brandKitUnits`: a project's `deck_brand_kits` row as one unit per token (fonts, each palette colour,
 *               image style, references, logo), so two writers changing different tokens never collide.
 */
import { stable } from './decks/coedit';
import type { Dependency } from './workGraphRevisions';
import type { UnitDocument } from './workGraphUnits';

// ---------------------------------------------------------------------------------------------------------------
// Formats and object classes.
// ---------------------------------------------------------------------------------------------------------------

/** Kept apart in storage and in policy: a master is never replaced by its renditions (#5583). */
export const OBJECT_CLASSES = ['master', 'snapshot', 'rendition', 'thumbnail'] as const;
export type ObjectClass = (typeof OBJECT_CLASSES)[number];

export type MediaKind = 'image' | 'brand' | 'model_3d';

const MiB = 1024 * 1024;
/** Per-class ceilings. A master or snapshot matches #5581's revision cap; derived objects are far smaller. */
export const CLASS_MAX_BYTES: Readonly<Record<ObjectClass, number>> = Object.freeze({
  master: 2 * 1024 * MiB,
  snapshot: 2 * 1024 * MiB,
  rendition: 256 * MiB,
  thumbnail: 2 * MiB,
});
/** Text formats are parsed whole; above this they are refused rather than half-read. */
export const TEXT_FORMAT_MAX_BYTES = 8 * MiB;

export interface MediaFormat {
  id: string;
  mime: string;
  kinds: readonly MediaKind[];
  classes: readonly ObjectClass[];
  /** A native editable format WorkGraph cannot parse: concurrent edits are variant branches, never merged. */
  opaque: boolean;
}

const ALL: readonly ObjectClass[] = OBJECT_CLASSES;
const MASTERS: readonly ObjectClass[] = ['master', 'snapshot'];

export const MEDIA_FORMATS: readonly MediaFormat[] = Object.freeze([
  { id: 'png', mime: 'image/png', kinds: ['image', 'brand'], classes: ALL, opaque: false },
  { id: 'jpeg', mime: 'image/jpeg', kinds: ['image'], classes: ALL, opaque: false },
  { id: 'webp', mime: 'image/webp', kinds: ['image', 'brand'], classes: ALL, opaque: false },
  { id: 'avif', mime: 'image/avif', kinds: ['image'], classes: ['master', 'snapshot', 'rendition'], opaque: false },
  { id: 'gif', mime: 'image/gif', kinds: ['image'], classes: MASTERS, opaque: false },
  { id: 'svg', mime: 'image/svg+xml', kinds: ['image', 'brand'], classes: MASTERS, opaque: false },
  { id: 'psd', mime: 'image/vnd.adobe.photoshop', kinds: ['image', 'brand'], classes: MASTERS, opaque: true },
  { id: 'glb', mime: 'model/gltf-binary', kinds: ['model_3d'], classes: ['master', 'snapshot', 'rendition'], opaque: false },
  { id: 'gltf', mime: 'model/gltf+json', kinds: ['model_3d'], classes: ['master', 'snapshot', 'rendition'], opaque: false },
  { id: 'usdz', mime: 'model/vnd.usdz+zip', kinds: ['model_3d'], classes: ['master', 'snapshot', 'rendition'], opaque: true },
  { id: 'blend', mime: 'application/x-blender', kinds: ['model_3d'], classes: MASTERS, opaque: true },
]);

export type AdmissionCode =
  | 'empty' | 'oversized' | 'unsupported_format' | 'mime_mismatch' | 'wrong_kind' | 'wrong_class' | 'corrupt'
  | 'unsafe_metadata';

export type Admission =
  | { ok: true; format: MediaFormat; mediaProfile: string; byteLength: number }
  | { ok: false; code: AdmissionCode; detail: string };

const at = (b: Uint8Array, i: number) => (i >= 0 && i < b.length ? b[i] : -1);
const ascii = (b: Uint8Array, from: number, len: number) => String.fromCharCode(...b.subarray(from, Math.min(b.length, from + len)));
const u32le = (b: Uint8Array, i: number) => (at(b, i) | (at(b, i + 1) << 8) | (at(b, i + 2) << 16) | (at(b, i + 3) << 24)) >>> 0;
const u32be = (b: Uint8Array, i: number) => ((at(b, i) << 24) | (at(b, i + 1) << 16) | (at(b, i + 2) << 8) | at(b, i + 3)) >>> 0;

/** The format the bytes are, from their leading signature, or null. Never from a name or a declared type. */
export function sniffFormat(b: Uint8Array): MediaFormat | null {
  const id = ((): string | null => {
    if (b.length >= 8 && at(b, 0) === 0x89 && ascii(b, 1, 3) === 'PNG' && at(b, 4) === 0x0d && at(b, 5) === 0x0a && at(b, 6) === 0x1a && at(b, 7) === 0x0a) return 'png';
    if (at(b, 0) === 0xff && at(b, 1) === 0xd8 && at(b, 2) === 0xff) return 'jpeg';
    if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
    if (ascii(b, 4, 4) === 'ftyp' && ['avif', 'avis'].includes(ascii(b, 8, 4))) return 'avif';
    if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return 'gif';
    if (ascii(b, 0, 4) === '8BPS') return 'psd';
    if (ascii(b, 0, 4) === 'glTF') return 'glb';
    if (ascii(b, 0, 7) === 'BLENDER') return 'blend';
    if (at(b, 0) === 0x50 && at(b, 1) === 0x4b && at(b, 2) === 0x03 && at(b, 3) === 0x04) return 'usdz';
    const head = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(b.subarray(0, 512)).replace(/^﻿/, '').trimStart();
    if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE\s+svg[^\[>]*(\[[\s\S]*?\])?\s*>\s*)?<svg[\s>]/i.test(head)) return 'svg';
    if (head.startsWith('{') && /"asset"\s*:/.test(new TextDecoder().decode(b.subarray(0, Math.min(b.length, 65536))))) return 'gltf';
    return null;
  })();
  return id ? MEDIA_FORMATS.find((f) => f.id === id) ?? null : null;
}

/** Structural integrity, end to end where the format allows it. A truncated or padded file is `corrupt`. */
function structure(f: MediaFormat, b: Uint8Array): string | null {
  switch (f.id) {
    case 'png': {
      if (ascii(b, 12, 4) !== 'IHDR') return 'png: no IHDR chunk';
      // IEND is the last 12 bytes: length 0, "IEND", CRC.
      if (ascii(b, b.length - 8, 4) !== 'IEND') return 'png: does not end in IEND';
      return null;
    }
    case 'jpeg':
      return at(b, b.length - 2) === 0xff && at(b, b.length - 1) === 0xd9 ? null : 'jpeg: no end-of-image marker';
    case 'webp':
      return u32le(b, 4) + 8 === b.length ? null : 'webp: RIFF size does not match the file';
    case 'gif':
      return at(b, b.length - 1) === 0x3b ? null : 'gif: no trailer';
    case 'glb':
      if (u32le(b, 4) !== 2) return 'glb: not glTF 2';
      return u32le(b, 8) === b.length ? null : 'glb: header length does not match the file';
    case 'avif':
      return u32be(b, 0) >= 16 && u32be(b, 0) <= b.length ? null : 'avif: ftyp box does not fit the file';
    default:
      return null;
  }
}

/** JPEG: an APP1 Exif segment carrying the GPS IFD pointer (tag 0x8825) in either byte order. */
function jpegHasGps(b: Uint8Array): boolean {
  let i = 2;
  while (i + 4 < b.length && at(b, i) === 0xff) {
    const marker = at(b, i + 1);
    const len = (at(b, i + 2) << 8) | at(b, i + 3);
    if (marker === 0xda || len < 2) break; // start of scan: no more metadata segments
    if (marker === 0xe1 && ascii(b, i + 4, 6) === 'Exif\0\0') {
      const seg = b.subarray(i + 10, i + 2 + len);
      for (let k = 0; k + 1 < seg.length; k += 1) {
        if ((seg[k] === 0x88 && seg[k + 1] === 0x25) || (seg[k] === 0x25 && seg[k + 1] === 0x88)) return true;
      }
    }
    i += 2 + len;
  }
  return false;
}

/** PNG: an `eXIf` chunk (EXIF inside PNG), which may carry location. Refused, not parsed: strip it before upload. */
function pngHasExif(b: Uint8Array): boolean {
  let i = 8;
  while (i + 8 <= b.length) {
    const len = u32be(b, i);
    const type = ascii(b, i + 4, 4);
    if (type === 'eXIf') return true;
    if (type === 'IEND' || len > b.length) break;
    i += 12 + len;
  }
  return false;
}

const SVG_UNSAFE: [RegExp, string][] = [
  [/<script[\s/>]/i, 'svg: script element'],
  [/\son[a-z]+\s*=/i, 'svg: event handler attribute'],
  [/javascript\s*:/i, 'svg: javascript: URL'],
  [/<foreignObject[\s/>]/i, 'svg: foreignObject'],
  [/<!ENTITY/i, 'svg: entity declaration'],
  [/(?:xlink:)?href\s*=\s*["']\s*(?:https?:|\/\/|file:|data:text\/html)/i, 'svg: external or active reference'],
  [/url\(\s*["']?\s*(?:https?:|\/\/|file:)/i, 'svg: external url() reference'],
  [/@import/i, 'svg: stylesheet import'],
];

/** Admit bytes as one object of a media asset, or refuse with a fixed code. */
export function admitMedia(input: { kind: MediaKind; objectClass: ObjectClass; declaredMime: string; bytes: Uint8Array }): Admission {
  const b = input.bytes;
  if (!(b instanceof Uint8Array) || b.byteLength === 0) return { ok: false, code: 'empty', detail: 'no bytes' };
  if (!(OBJECT_CLASSES as readonly string[]).includes(input.objectClass)) return { ok: false, code: 'wrong_class', detail: String(input.objectClass) };
  if (b.byteLength > CLASS_MAX_BYTES[input.objectClass]) return { ok: false, code: 'oversized', detail: `${input.objectClass} over ${CLASS_MAX_BYTES[input.objectClass]} bytes` };
  const f = sniffFormat(b);
  if (!f) return { ok: false, code: 'unsupported_format', detail: 'unrecognised signature' };
  if (String(input.declaredMime).toLowerCase().split(';')[0].trim() !== f.mime) return { ok: false, code: 'mime_mismatch', detail: `declared ${input.declaredMime}, bytes are ${f.mime}` };
  if (!f.kinds.includes(input.kind)) return { ok: false, code: 'wrong_kind', detail: `${f.id} is not a ${input.kind} format` };
  if (!f.classes.includes(input.objectClass)) return { ok: false, code: 'wrong_class', detail: `${f.id} is not admitted as a ${input.objectClass}` };
  const broken = structure(f, b);
  if (broken) return { ok: false, code: 'corrupt', detail: broken };
  if (f.id === 'jpeg' && jpegHasGps(b)) return { ok: false, code: 'unsafe_metadata', detail: 'jpeg: EXIF location' };
  if (f.id === 'png' && pngHasExif(b)) return { ok: false, code: 'unsafe_metadata', detail: 'png: eXIf chunk' };
  if (f.id === 'svg' || f.id === 'gltf') {
    if (b.byteLength > TEXT_FORMAT_MAX_BYTES) return { ok: false, code: 'oversized', detail: `${f.id} over ${TEXT_FORMAT_MAX_BYTES} bytes` };
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(b); } catch { return { ok: false, code: 'corrupt', detail: `${f.id}: not UTF-8` }; }
    if (f.id === 'svg') {
      for (const [re, why] of SVG_UNSAFE) if (re.test(text)) return { ok: false, code: 'unsafe_metadata', detail: why };
      if (!/<\/svg\s*>\s*$/i.test(text.trimEnd())) return { ok: false, code: 'corrupt', detail: 'svg: no closing tag' };
    } else {
      let doc: any;
      try { doc = JSON.parse(text); } catch { return { ok: false, code: 'corrupt', detail: 'gltf: not JSON' }; }
      if (String(doc?.asset?.version ?? '') !== '2.0') return { ok: false, code: 'corrupt', detail: 'gltf: not glTF 2.0' };
      const uris = [...(Array.isArray(doc.buffers) ? doc.buffers : []), ...(Array.isArray(doc.images) ? doc.images : [])]
        .map((x: any) => (typeof x?.uri === 'string' ? x.uri : null)).filter(Boolean) as string[];
      // A texture or buffer is pinned as a dependency (`pinDependencies`), never fetched from wherever a file says.
      const outside = uris.find((u) => /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(u) && !/^data:/i.test(u) || u.includes('..'));
      if (outside) return { ok: false, code: 'unsafe_metadata', detail: 'gltf: external or escaping URI' };
    }
  }
  return { ok: true, format: f, mediaProfile: f.mime, byteLength: b.byteLength };
}

// ---------------------------------------------------------------------------------------------------------------
// Provenance and rights.
// ---------------------------------------------------------------------------------------------------------------

export const RIGHTS_BASES = ['owned', 'commissioned', 'licensed', 'platform_generated', 'public_domain'] as const;
export type RightsBasis = (typeof RIGHTS_BASES)[number];

export interface MediaProvenance {
  origin: 'upload' | 'generated' | 'import' | 'derived';
  /** For a derived version (a rendition, a crop, an edit): the revision it was made from. */
  sourceRevisionUid?: string | null;
  generation?: {
    provider: string;
    model: string;
    /** The prompt or edit recipe, as recorded. */
    recipe: string | null;
    seed: string | null;
    /** True only once someone re-ran the recipe and got identical bytes (`reproducibilityVerifiedAt`). */
    reproducible: boolean;
    reproducibilityVerifiedAt: string | null;
  } | null;
  rights: {
    basis: RightsBasis | null;
    licensor?: string | null;
    licenseRef?: string | null;
    /** The uses the grant covers, for example `deck`, `site`, `social`, `print`. Empty means none. */
    usageScope: string[];
    attribution?: string | null;
    expiresAt?: string | null;
    revokedAt?: string | null;
  };
  consent?: { showsPerson: boolean; consentAt: string | null; consentByUserId: number | null } | null;
  watermark?: { kind: 'visible' | 'invisible' | 'content_credentials'; ref: string } | null;
}

export type ProvenanceCode =
  | 'rights_missing' | 'license_revoked' | 'license_expired' | 'usage_out_of_scope' | 'license_ref_missing'
  | 'consent_missing' | 'generation_missing' | 'source_missing' | 'reproducibility_unverified';

/**
 * Whether a version's provenance supports a use. `stage` is `draft` (a variant is recorded) or `publish` (a person
 * selects it, or it goes into a pack): publication adds the consent rule. `now` is the caller's clock.
 */
export function checkProvenance(p: MediaProvenance, a: { stage: 'draft' | 'publish'; use: string; now: Date }): ProvenanceCode[] {
  const out: ProvenanceCode[] = [];
  const r = p?.rights;
  if (!r || !r.basis || !(RIGHTS_BASES as readonly string[]).includes(r.basis)) out.push('rights_missing');
  else {
    if (r.basis === 'licensed' && !r.licenseRef) out.push('license_ref_missing');
    if (r.revokedAt) out.push('license_revoked');
    if (r.expiresAt && Date.parse(r.expiresAt) <= a.now.getTime()) out.push('license_expired');
    if (!Array.isArray(r.usageScope) || !r.usageScope.includes(a.use)) out.push('usage_out_of_scope');
  }
  if (p.origin === 'generated' && !(p.generation?.model && p.generation?.provider)) out.push('generation_missing');
  if (p.origin === 'derived' && !p.sourceRevisionUid) out.push('source_missing');
  if (p.generation?.reproducible && !p.generation.reproducibilityVerifiedAt) out.push('reproducibility_unverified');
  if (a.stage === 'publish' && p.consent?.showsPerson && !(p.consent.consentAt && p.consent.consentByUserId)) out.push('consent_missing');
  return out;
}

export interface DeckImageRow {
  uid: string;
  source: 'generated' | 'upload';
  model: string | null;
  prompt: string | null;
  shows_person: number;
  person_consent_at: string | null;
  person_consent_by: number | null;
}

/**
 * What `deck_images` already records, as WorkGraph provenance. The rights a deck image carries are the platform's
 * for a generated one and the uploader's own for an upload, scoped to decks: that is all the table states, so that
 * is all this says. Anything wider (a site, print) needs a recorded licence.
 */
export function provenanceFromDeckImage(row: DeckImageRow, provider = 'axal_ai_router'): MediaProvenance {
  const generated = row.source === 'generated';
  return {
    origin: generated ? 'generated' : 'upload',
    generation: generated ? { provider, model: String(row.model ?? ''), recipe: row.prompt ?? null, seed: null, reproducible: false, reproducibilityVerifiedAt: null } : null,
    rights: { basis: generated ? 'platform_generated' : 'owned', usageScope: ['deck'] },
    consent: { showsPerson: row.shows_person === 1, consentAt: row.person_consent_at, consentByUserId: row.person_consent_by },
    watermark: null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Dependencies.
// ---------------------------------------------------------------------------------------------------------------

export type MediaDependency =
  | { kind: 'font'; family: string; license: string; foundry?: string | null }
  | { kind: 'image' | 'texture' | 'material' | 'brand_tokens'; assetUid: string; revisionUid: string };

/** Font licences under which naming the font (never shipping it) is enough. Anything else is a person's question. */
export const FONT_LICENSES: ReadonlySet<string> = new Set(['OFL-1.1', 'Apache-2.0', 'UFL-1.0', 'platform']);

export type PinResult =
  | { ok: true; edges: Dependency[]; fonts: { family: string; license: string; foundry: string | null }[] }
  | { ok: false; code: 'font_binary' | 'font_license_unknown' | 'malformed_dependency'; detail: string };

/**
 * A master's dependencies as #5581 edges plus a font manifest. A font arrives as a family and a licence; a font
 * given as an asset (bytes) is refused, so WorkGraph never redistributes a binary it has no right to.
 */
export function pinDependencies(deps: unknown[]): PinResult {
  const edges: Dependency[] = [];
  const fonts: { family: string; license: string; foundry: string | null }[] = [];
  for (const d of Array.isArray(deps) ? deps : []) {
    const x = d as any;
    if (x?.kind === 'font') {
      if ('assetUid' in x || 'revisionUid' in x || 'bytes' in x) return { ok: false, code: 'font_binary', detail: String(x.family ?? '') };
      if (typeof x.family !== 'string' || !x.family.trim() || x.family.length > 120) return { ok: false, code: 'malformed_dependency', detail: 'font family' };
      if (!FONT_LICENSES.has(x.license)) return { ok: false, code: 'font_license_unknown', detail: `${x.family}: ${String(x.license)}` };
      fonts.push({ family: x.family.trim(), license: x.license, foundry: typeof x.foundry === 'string' ? x.foundry : null });
    } else if (['image', 'texture', 'material', 'brand_tokens'].includes(x?.kind)) {
      if (typeof x.assetUid !== 'string' || !x.assetUid || typeof x.revisionUid !== 'string' || !x.revisionUid) {
        return { ok: false, code: 'malformed_dependency', detail: String(x.kind) };
      }
      edges.push({ kind: 'read', assetUid: x.assetUid, revisionUid: x.revisionUid });
    } else {
      return { ok: false, code: 'malformed_dependency', detail: String(x?.kind) };
    }
  }
  return { ok: true, edges, fonts };
}

// ---------------------------------------------------------------------------------------------------------------
// Renditions.
// ---------------------------------------------------------------------------------------------------------------

export interface PlannedRendition { objectClass: 'rendition' | 'thumbnail'; formatId: string; maxEdge: number }

/**
 * What a master gets. Renditions and thumbnails are derived objects in their own classes; they never replace the
 * master and are never a source. An opaque native format (PSD, Blend, USDZ) needs a renderer the Worker does not
 * have, so `externalCompute` is set and the job waits for #5571's executor.
 */
export function renditionPlan(formatId: string): { renditions: PlannedRendition[]; externalCompute: boolean } {
  const web: PlannedRendition[] = [
    { objectClass: 'rendition', formatId: 'webp', maxEdge: 2048 },
    { objectClass: 'rendition', formatId: 'avif', maxEdge: 2048 },
    { objectClass: 'thumbnail', formatId: 'webp', maxEdge: 320 },
  ];
  switch (formatId) {
    case 'png': case 'jpeg': case 'webp': case 'avif': case 'gif': case 'svg':
      return { renditions: web, externalCompute: false };
    case 'glb': case 'gltf':
      return { renditions: [{ objectClass: 'rendition', formatId: 'glb', maxEdge: 0 }, { objectClass: 'thumbnail', formatId: 'webp', maxEdge: 320 }], externalCompute: true };
    case 'psd': case 'blend': case 'usdz':
      return { renditions: [{ objectClass: 'thumbnail', formatId: 'webp', maxEdge: 320 }], externalCompute: true };
    default:
      return { renditions: [], externalCompute: false };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Brand tokens.
// ---------------------------------------------------------------------------------------------------------------

export interface BrandKitRow {
  project_id: number;
  display_font: string | null;
  body_font: string | null;
  palette_json: string;
  image_style: string | null;
  reference_uids_json: string;
  logo_uid: string | null;
  updated_at: string;
}

/**
 * A project's brand kit (`deck_brand_kits`, D1562, migration 737) as one unit per token. No token is text-merged:
 * two writers changing one token is a conflict for a person; changing different tokens never collides.
 */
export function brandKitUnits(row: BrandKitRow): UnitDocument {
  const tok = (id: string, v: unknown) => ({ id, kind: 'term' as const, value: stable(v ?? null), text: '', textMergeable: false, sensitive: [] });
  let palette: Record<string, unknown> = {};
  try { const p = JSON.parse(row.palette_json || '{}'); if (p && typeof p === 'object' && !Array.isArray(p)) palette = p; } catch { palette = {}; }
  let refs: unknown = [];
  try { refs = JSON.parse(row.reference_uids_json || '[]'); } catch { refs = []; }
  return {
    kind: 'brand',
    source: { store: 'd1_record', locator: 'deck_brand_kits', id: String(row.project_id), revision: row.updated_at },
    units: [
      tok('display_font', row.display_font),
      tok('body_font', row.body_font),
      ...Object.keys(palette).sort().map((k) => tok(`palette.${k}`, palette[k])),
      tok('image_style', row.image_style),
      tok('reference_uids', refs),
      tok('logo_uid', row.logo_uid),
    ],
  };
}
