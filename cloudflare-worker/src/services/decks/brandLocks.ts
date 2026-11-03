/**
 * D1572 (#3819, deck v2 D11) — brand locks (pd31, "Brand kit locks").
 *
 * A venture's admin (its owner) locks a part of the deck brand kit: the font
 * pair, the palette roles or the logo. "Only the venture’s admins can lock."
 * While a part is locked:
 *   - a brand-kit save that changes it is refused, naming who locked it
 *     (`lockedKitChange`);
 *   - a card save that brings in a colour off the kit's palette is refused
 *     (`saveGates.ts`), so a locked colour cannot be changed on a card.
 * Each refusal says "Nothing changed." because nothing is written.
 *
 * Stored in `deck_brand_locks` (migration 202611031015), one row per locked
 * part. All SQL is bound.
 */
import type { DeckBrandKit } from './brandKit';

export const LOCK_PARTS = Object.freeze(['fonts', 'palette', 'logo'] as const);
export type LockPart = typeof LOCK_PARTS[number];
export type BrandLock = { part: LockPart; by: string | null; at: string };
export type BrandLocks = Record<LockPart, BrandLock | null>;

export const ADMINS_ONLY = 'Only the venture’s admins can lock.';
const WHAT: Record<LockPart, string> = { fonts: 'These fonts are', palette: 'This colour is', logo: 'This logo is' };

/** pd31's refusal: "This colour is locked in the brand kit by [name]. Nothing changed." */
export const lockedLine = (part: LockPart, by: string | null) => `${WHAT[part]} locked in the brand kit by ${by || 'an admin'}. Nothing changed.`;

export const isLockPart = (v: unknown): v is LockPart => (LOCK_PARTS as readonly string[]).includes(String(v));

/** The venture's locks, each with who locked it and when; a part with no row is null. */
export async function brandLocksFor(env: { DB: D1Database }, projectId: number): Promise<BrandLocks> {
  const rows = (await env.DB.prepare(
    `SELECT l.part, l.locked_at, u.name AS by_name
       FROM deck_brand_locks l LEFT JOIN users u ON u.id = l.locked_by
      WHERE l.project_id = ?`,
  ).bind(projectId).all<{ part: string; locked_at: string; by_name: string | null }>()).results || [];
  const out: BrandLocks = { fonts: null, palette: null, logo: null };
  for (const r of rows) if (isLockPart(r.part)) out[r.part] = { part: r.part, by: r.by_name ?? null, at: r.locked_at };
  return out;
}

/** Whether this user is the venture's admin: its owner (the founder whose venture it is). */
export async function canLockBrand(env: { DB: D1Database }, user: { id: number; role?: string; founder_id?: number | null }, projectId: number): Promise<boolean> {
  if (String(user.role || '').toLowerCase() !== 'founder' || user.founder_id == null) return false;
  const row = await env.DB.prepare('SELECT founder_id FROM projects WHERE id = ?').bind(projectId).first<{ founder_id: number | null }>();
  return row?.founder_id != null && Number(row.founder_id) === Number(user.founder_id);
}

/** Lock or unlock one part. */
export async function setBrandLock(env: { DB: D1Database }, projectId: number, part: LockPart, locked: boolean, userId: number | null): Promise<void> {
  if (locked) {
    await env.DB.prepare(
      `INSERT INTO deck_brand_locks (project_id, part, locked_by, locked_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(project_id, part) DO NOTHING`,
    ).bind(projectId, part, userId).run();
  } else {
    await env.DB.prepare('DELETE FROM deck_brand_locks WHERE project_id = ? AND part = ?').bind(projectId, part).run();
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const sortedPalette = (p: Record<string, string> | undefined) => Object.fromEntries(Object.entries(p ?? {}).sort(([a], [z]) => a.localeCompare(z)));

/** The first locked part a kit save would change, or null. A kit with no saved row compares against an empty one. */
export function lockedKitChange(before: DeckBrandKit | null, after: DeckBrandKit, locks: BrandLocks): LockPart | null {
  if (locks.fonts && !same(before?.fonts, after.fonts)) return 'fonts';
  if (locks.palette && !same(sortedPalette(before?.palette), sortedPalette(after.palette))) return 'palette';
  if (locks.logo && !same(before?.logo_uid, after.logo_uid)) return 'logo';
  return null;
}
