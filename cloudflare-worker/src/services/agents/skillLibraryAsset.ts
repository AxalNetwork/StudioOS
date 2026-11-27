/**
 * D4574 H3 (#4574) — the "From Axal" skill library's entries, read from a
 * static asset instead of the Worker script.
 *
 * The generated module embedded every SKILL.md and every case, 421.9 KiB of
 * the script and its largest single input, while only three Super Admin
 * routes ever read them (`GET /library`, `POST /library/seed`,
 * `GET /library/reconcile` in `routes/admin_hq_skills.ts`). So
 * `scripts/build-skill-library.mjs` writes the entries to
 * `frontend/public/skill-library/library-<digest16>.json`, built into `docs/`,
 * and keeps only the index in `skillLibrary.generated.ts`: the slugs, the
 * digest and the asset's path. This reads the asset through the Worker's own
 * assets binding — the pattern of `articleCovers.ts` and
 * `decks/iconGeometry.ts`. `/skill-library/*` is in both `run_worker_first`
 * lists, so a browser asking for it reaches the Worker, which has no such
 * route and answers 404: the entries stay readable only through the routes'
 * Super Admin gate.
 *
 * Read once per isolate and remembered. A read that fails is NOT remembered:
 * the next request tries again, and the route says the library could not be
 * read (503 `library_unreadable`) rather than answering an empty library.
 */
import type { Env } from '../../types';
import { SKILL_LIBRARY_ASSET, SKILL_LIBRARY_DIGEST, SKILL_LIBRARY_SLUGS, type LibraryEntry } from './skillLibrary.generated';

const LOADED = new WeakMap<object, readonly LibraryEntry[]>();
// The DB binding, as `articleCovers.ts` and `iconGeometry.ts` key their own
// caches: one isolate has one DB, and it outlives any one request.
const keyOf = (env: Env): object => (env.DB as unknown as object) ?? (env.ASSETS as unknown as object);

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The asset's entries, or null when the body is anything but the library this
 * script was built with. A missing file answers the SPA shell
 * (`not_found_handling = "single-page-application"`), so an HTML answer, a
 * wrong digest, a slug list that differs from the index and an entry of the
 * wrong shape are all refused here. The digest is recomputed from the entries
 * as read, so a body that only CLAIMS the right digest is refused too.
 */
export async function parseSkillLibrary(body: unknown): Promise<readonly LibraryEntry[] | null> {
  const b = body as { digest?: unknown; entries?: unknown };
  if (!b || typeof b !== 'object' || b.digest !== SKILL_LIBRARY_DIGEST || !Array.isArray(b.entries)) return null;
  const entries = b.entries as unknown[];
  if (entries.length !== SKILL_LIBRARY_SLUGS.length) return null;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as { slug?: unknown; skill_md?: unknown; cases?: unknown };
    if (!e || typeof e !== 'object' || e.slug !== SKILL_LIBRARY_SLUGS[i]) return null;
    if (typeof e.skill_md !== 'string' || !Array.isArray(e.cases)) return null;
  }
  const digest = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(entries))));
  return digest === SKILL_LIBRARY_DIGEST ? (entries as LibraryEntry[]) : null;
}

/**
 * The library's entries for this isolate, or null when the asset could not be
 * read. Callers treat null as "the library could not be read", never as an
 * empty library.
 */
export async function loadSkillLibrary(env: Env): Promise<readonly LibraryEntry[] | null> {
  const key = keyOf(env);
  if (key) {
    const had = LOADED.get(key);
    if (had) return had;
  }
  if (!env.ASSETS) return null;
  try {
    // A URL string, not a Request built from the caller's: this reads one
    // static file and forwards nothing (the auth inventory reads
    // `fetch(new Request` as a relay).
    const res = await env.ASSETS.fetch(`https://assets.local${SKILL_LIBRARY_ASSET}`);
    if (!res.ok || !String(res.headers.get('content-type') || '').includes('json')) return null;
    const entries = await parseSkillLibrary(await res.json());
    if (entries && key) LOADED.set(key, entries);
    return entries;
  } catch (e) {
    console.warn('[skillLibrary] the skill library could not be read:', (e as Error).message);
    return null;
  }
}

/** What a library route answers when `loadSkillLibrary` returns null. */
export const LIBRARY_UNREADABLE = {
  code: 'library_unreadable',
  message: 'The skill library could not be read. Nothing was changed; try again.',
} as const;
