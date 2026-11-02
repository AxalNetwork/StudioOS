/**
 * D1539 (#3789, deck v2 B13) — a deck version as a list of card hashes.
 *
 * Each card's JSON is kept once in `pitch_card_blobs` (migration 730), under
 * the SHA-256 of its canonical JSON, and a version records its cards' hashes in
 * order in `pitch_decks.card_hashes`. A save that changes two cards of sixty
 * adds two blob rows.
 *
 * - `cardBlobsOf` hashes a version's cards (`insertVersion` writes them, in the
 *   same D1 batch as the version, so a prune can never fall between the two).
 * - `hydrateSlides` reassembles a version's slides from its hashes. A version
 *   written before 730 (`card_hashes` NULL), or one whose blobs cannot all be
 *   read, is read from `pitch_decks.slides`, which is still written in full
 *   during the transition.
 * - `pruneCardBlobs` removes blobs no version names, older than a grace window.
 * - Renditions (256 and 1024 px) have a contract and a storage key here, and
 *   are NOT switched on: rendering a card needs the Browser Rendering binding
 *   and R2 storage, which is new spend the owner approves first (D1556, L = A).
 *   Nothing writes a rendition; D1539 states the estimated monthly cost.
 *
 * Every statement is a literal with bound parameters; a list is one bound JSON
 * array read through `json_each`.
 */
import type { Env } from '../../types';
import { bindingKey } from '../../util/schemaBootstrap';

export const CARD_HASH_RE = /^[0-9a-f]{64}$/;

/** A blob younger than this is never pruned, whatever references it (D1539 §3). */
export const PRUNE_MIN_AGE_MINUTES = 60;
/** At most this many blobs go per prune statement, so one run stays short. */
export const PRUNE_LIMIT = 500;

/** JSON with its keys sorted at every depth. The input is already JSON (no undefined, no functions). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest, (x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * A card's hash and the JSON its blob keeps. The hash is over the canonical
 * form, so the same card hashes the same whatever its key order; the blob keeps
 * the JSON as written, so a version reassembled from blobs reads as it was saved.
 */
export async function cardHash(card: unknown): Promise<{ hash: string; json: string }> {
  const json = JSON.stringify(card ?? null);
  return { hash: await sha256Hex(canonicalJson(JSON.parse(json))), json };
}

/** A version's hashes, in card order, and each distinct blob once. */
export async function cardBlobsOf(slides: unknown[]): Promise<{ hashes: string[]; blobs: Array<[string, string]> }> {
  const hashes: string[] = [];
  const blobs = new Map<string, string>();
  for (const card of slides) {
    const { hash, json } = await cardHash(card);
    hashes.push(hash);
    if (!blobs.has(hash)) blobs.set(hash, json);
  }
  return { hashes, blobs: [...blobs.entries()] };
}

const READY = new WeakMap<object, boolean>();

/**
 * Migration 730 where it has not run: the blob table and `pitch_decks.card_hashes`,
 * declared exactly as the migration declares them. True only when both are
 * there; a caller that gets false writes and reads a version the old way.
 */
export async function ensureCardBlobSchema(env: Env): Promise<boolean> {
  const key = bindingKey(env);
  if (READY.get(key)) return true;
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS pitch_card_blobs (
      hash       TEXT PRIMARY KEY CHECK (length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*'),
      json       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
    const cols = await env.DB.prepare('PRAGMA table_info(pitch_decks)').all<any>();
    const have = new Set(((cols.results || []) as any[]).map((r) => String(r.name)));
    if (!have.has('card_hashes')) {
      await env.DB.prepare('ALTER TABLE pitch_decks ADD COLUMN card_hashes TEXT CHECK (card_hashes IS NULL OR json_valid(card_hashes))').run();
    }
    const after = await env.DB.prepare('PRAGMA table_info(pitch_decks)').all<any>();
    const ok = ((after.results || []) as any[]).some((r) => String(r.name) === 'card_hashes');
    if (ok) READY.set(key, true);
    return ok;
  } catch (e) {
    console.error('[decks] card blob schema unavailable', (e as Error)?.message);
    return false;
  }
}

/** The hashes a stored row names, or null when it names none or names them badly (a legacy read). */
export function hashesOf(row: any): string[] | null {
  if (row?.card_hashes == null) return null;
  try {
    const list = JSON.parse(String(row.card_hashes));
    if (!Array.isArray(list) || !list.every((h) => typeof h === 'string' && CARD_HASH_RE.test(h))) return null;
    return list;
  } catch { return null; }
}

/**
 * The row with `slides` reassembled from its card hashes. A row without
 * hashes, or one whose blobs cannot all be read, keeps its own `slides`.
 */
export async function hydrateSlides<T extends Record<string, any>>(env: Env, row: T): Promise<T> {
  const hashes = hashesOf(row);
  if (!hashes) return row;
  if (!hashes.length) return { ...row, slides: '[]' };
  try {
    const res = await env.DB.prepare(
      'SELECT hash, json FROM pitch_card_blobs WHERE hash IN (SELECT value FROM json_each(?))',
    ).bind(JSON.stringify([...new Set(hashes)])).all<{ hash: string; json: string }>();
    const byHash = new Map<string, string>();
    for (const b of (res.results || [])) byHash.set(String(b.hash), String(b.json));
    if (hashes.some((h) => !byHash.has(h))) {
      console.warn('[decks] card blobs missing; reading the version from slides', row.id);
      return row;
    }
    return { ...row, slides: `[${hashes.map((h) => byHash.get(h)).join(',')}]` };
  } catch (e) {
    console.warn('[decks] card blobs unreadable; reading the version from slides', (e as Error)?.message);
    return row;
  }
}

/**
 * D1539 §3 — the prune rule. A blob is deleted when no `pitch_decks` row names
 * its hash in `card_hashes` AND it was first written more than
 * `PRUNE_MIN_AGE_MINUTES` ago. It is one statement, so it runs whole either
 * before or after any save's batch (which writes the version and its blobs
 * together); the grace window also covers any writer that ever puts a blob in
 * ahead of its version. A deleted version (only a project's hard delete removes
 * one) frees its blobs on the next run. Versions themselves are never pruned.
 */
export async function pruneCardBlobs(env: Env, opts: { minAgeMinutes?: number; limit?: number } = {}): Promise<{ deleted: number }> {
  if (!(await ensureCardBlobSchema(env))) return { deleted: 0 };
  const minAge = Math.max(0, Math.floor(opts.minAgeMinutes ?? PRUNE_MIN_AGE_MINUTES));
  const limit = Math.max(1, Math.floor(opts.limit ?? PRUNE_LIMIT));
  const r = await env.DB.prepare(
    `DELETE FROM pitch_card_blobs WHERE hash IN (
       SELECT b.hash FROM pitch_card_blobs b
        WHERE b.created_at <= datetime('now', ?)
          AND b.hash NOT IN (SELECT j.value FROM pitch_decks d, json_each(d.card_hashes) j WHERE d.card_hashes IS NOT NULL)
        LIMIT ?)`,
  ).bind(`-${minAge} minutes`, limit).run();
  return { deleted: Number(r?.meta?.changes ?? 0) };
}

// ---------------------------------------------------------------------------
// Renditions — the contract, NOT switched on (D1539 §4).

/** The two widths a card's picture is kept at; the height follows the card's 16:9. */
export const RENDITION_SIZES = [256, 1024] as const;
export type RenditionSize = (typeof RENDITION_SIZES)[number];

/**
 * False until the owner approves the monthly cost in D1539 §4. While false,
 * nothing renders or writes a rendition, and a read finds none.
 */
export const RENDITIONS_SWITCHED_ON = false;

export function renditionSizeOf(raw: unknown): RenditionSize | null {
  const n = Number(raw);
  return (RENDITION_SIZES as readonly number[]).includes(n) ? (n as RenditionSize) : null;
}

/**
 * Where a card's rendition lives in the existing `FILES` bucket: by card hash,
 * so a card unchanged across versions is rendered once, and a pruned blob's
 * renditions are found by the same key.
 */
export function renditionKey(hash: string, size: RenditionSize): string {
  if (!CARD_HASH_RE.test(hash)) throw new Error('card hash must be 64 lowercase hex characters');
  return `deck-cards/renditions/${size}/${hash}.png`;
}
