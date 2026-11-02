/**
 * D1564 (#3811, deck builder v2 D3) — PUBLISHING A SHARE LINK AS A WEB PAGE.
 *
 * Owner decisions (2026-11-01, on #3716):
 *   A = B  16:9 stays canonical, plus a read-only responsive card view;
 *   E = B  a link can be published, with an email gate on by default, and a
 *          506(b) round can never publish (Rule 506(b) allows no general
 *          solicitation; a public page is one);
 *   T      counsel's wording. Until it lands the compliance footnote stays on
 *          and PUBLIC VIEWS STAY OFF: `PUBLIC_VIEWS_ON` below is false, so a
 *          published link always asks for the reader's email, an un-gated
 *          publish is refused, and no link previews as itself. The answer is
 *          a one-line change here.
 *
 * MIGRATION: NONE. The publish state rides the link's own `include_json`
 * (migration 567) under a `publish` key, beside the four include switches,
 * which `parseShareInclude` reads by name and so never sees it. Nothing else
 * writes `include_json` after the link is made (`createShareLink`).
 *
 * THE EXEMPTION IS STATED, NOT READ. No table records a round's Reg D
 * exemption (`raise_rounds` has none; grep 506 finds only the accreditation
 * templates). With "Migration: none" the founder states it when publishing
 * and it is kept on the link; an unstated exemption is refused, as is
 * 506(b). A refused request writes nothing. A stored state that does not say
 * 506(c) reads as not published (`publishOf`), whatever wrote it. Recording
 * the exemption on the round itself needs a column (`raise_rounds`), which is
 * a later task's migration.
 *
 * Pure: no database, no model.
 */

/** Owner decision T: public (un-gated) views are off until counsel's wording lands. */
export const PUBLIC_VIEWS_ON: boolean = false;
/** What the routes ask, so a test can hold the rules to both answers without flipping the decision. */
export const publicViewsOn = (): boolean => PUBLIC_VIEWS_ON;

export const EXEMPTIONS = ['506b', '506c'] as const;
export type Exemption = typeof EXEMPTIONS[number];
export const GATES = ['email', 'none'] as const;
export type Gate = typeof GATES[number];

export type Publish = { on: true; gate: Gate; exemption: Exemption; embed_origins: string[]; at: string };

/** The most origins one link may be framed by. */
export const MAX_EMBED_ORIGINS = 5;

export const PUBLIC_VIEWS_OFF = 'Public pages are off until counsel\'s wording is in. A published link asks for the reader\'s email first.';
export const REFUSE_506B = 'A 506(b) round cannot be published: Rule 506(b) allows no general solicitation. Share it one investor at a time.';
export const REFUSE_NO_EXEMPTION = 'Say which exemption this round is offered under, 506(b) or 506(c), before publishing.';
export const REFUSE_ORIGINS = 'Each site that may embed the deck is an https address, at most five.';

/** The stored `include_json` as an object; `{}` for none or one that cannot be read. */
function objectOf(raw: unknown): Record<string, unknown> {
  if (raw == null || raw === '') return {};
  let v: unknown = raw;
  if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { return {}; } }
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
}

/** An https origin, normalised, or null. No wildcard, no path, no credentials. */
export function originOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 200 || s.includes('*')) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    if ((u.pathname && u.pathname !== '/') || u.search || u.hash) return null;
    return u.origin;
  } catch { return null; }
}

/** The body's embed origins, cleaned; null when any one is not an https origin or there are too many. */
export function cleanEmbedOrigins(v: unknown): string[] | null {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > MAX_EMBED_ORIGINS) return null;
  const out: string[] = [];
  for (const o of v) {
    const ok = originOf(o);
    if (!ok) return null;
    if (!out.includes(ok)) out.push(ok);
  }
  return out;
}

/** The link's publish state, or null when it is not published (or the stored state cannot be read). */
export function publishOf(raw: unknown): Publish | null {
  const p = objectOf(raw).publish as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object' || p.on !== true) return null;
  const exemption = (EXEMPTIONS as readonly string[]).includes(String(p.exemption)) ? p.exemption as Exemption : null;
  // A stored 506(b) is never published, whatever wrote it.
  if (exemption !== '506c') return null;
  const gate: Gate = p.gate === 'none' ? 'none' : 'email';
  const origins = cleanEmbedOrigins(p.embed_origins) ?? [];
  return { on: true, gate, exemption, embed_origins: origins, at: typeof p.at === 'string' ? p.at : '' };
}

/** `include_json` with the publish state set (or removed with null); the include switches are kept as they were. */
export function withPublish(raw: unknown, p: Publish | null): string {
  const o = objectOf(raw);
  if (p) o.publish = p; else delete o.publish;
  return JSON.stringify(o);
}

/** The gate a published link applies: the email gate, unless public views are on and the founder turned it off. */
export function gateFor(p: Publish, publicViews: boolean = PUBLIC_VIEWS_ON): Gate {
  return publicViews && p.gate === 'none' ? 'none' : 'email';
}

export type Refusal = { status: 409 | 422; code: string; message: string };

/** Why a publish request is refused, or null. */
export function publishRefusal(body: Record<string, unknown>, publicViews: boolean = PUBLIC_VIEWS_ON): Refusal | null {
  const exemption = body.exemption;
  if (exemption === '506b') return { status: 409, code: 'exemption_506b', message: REFUSE_506B };
  if (exemption !== '506c') return { status: 422, code: 'exemption_missing', message: REFUSE_NO_EXEMPTION };
  const gate = body.gate ?? 'email';
  if (!(GATES as readonly string[]).includes(String(gate))) return { status: 422, code: 'gate_invalid', message: 'The gate is email, or none once public pages are on.' };
  if (gate === 'none' && !publicViews) return { status: 409, code: 'public_views_off', message: PUBLIC_VIEWS_OFF };
  if (cleanEmbedOrigins(body.embed_origins) == null) return { status: 422, code: 'embed_origins_invalid', message: REFUSE_ORIGINS };
  return null;
}

/** The embedding page's origin, from the Referer header a framed request carries. */
export function refererOrigin(referer: string | null | undefined): string | null {
  if (!referer) return null;
  try { return new URL(referer).origin; } catch { return null; }
}

/** May this request frame the link: a frame request whose embedding origin is one the founder listed. */
export function embedAllowed(p: Publish | null, referer: string | null | undefined, dest: string | null | undefined): boolean {
  if (!p || !p.embed_origins.length) return false;
  if (dest != null && dest !== 'iframe' && dest !== 'frame') return false;
  const from = refererOrigin(referer);
  return !!from && p.embed_origins.includes(from);
}

/** The frame-ancestors policy for one link's embed: its listed origins only. */
export function frameAncestors(p: Publish): string {
  return `frame-ancestors ${p.embed_origins.join(' ')}`;
}

/** A plain email address, lower-cased; null when it is not one. */
export function cleanEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (s.length < 6 || s.length > 254) return null;
  return /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/.test(s) ? s : null;
}

const httpsUrl = (v: unknown) => (typeof v === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(v.trim()) ? v.trim() : null);

/**
 * The picture a published link previews with: its first card's first image
 * (an image block, or the card's own `image_url`), https only. Null when the
 * first card has none; the caller then uses the site's card.
 */
export function linkOgImage(slides: unknown): string | null {
  const first = Array.isArray(slides) ? slides[0] as any : null;
  if (!first || typeof first !== 'object') return null;
  for (const b of Array.isArray(first.blocks) ? first.blocks : []) {
    if (b?.kind === 'image') { const u = httpsUrl(b.image_url); if (u) return u; }
  }
  return httpsUrl(first.image_url);
}
