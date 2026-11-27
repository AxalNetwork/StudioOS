/**
 * Seed canonical article cover images into R2.
 *
 * Articles are created at runtime (no SQL seed), and covers are R2-backed
 * (bytes in R2, `cover_r2_key` in D1, served via `/api/articles/cover/:id`).
 * Articles name their cover by its R2 key, so the cover is served through the
 * R2 endpoint; the static file below is only the seed's source.
 *
 * To attach a cover with no manual prod step, the compressed JPEG ships as a
 * static asset (`frontend/public/article-covers/`, D4574 H3; it was embedded
 * as base64 until then) and is copied into R2, read through the Worker's own
 * assets binding, on the first article read where the target article still has
 * no cover — same lazy self-heal pattern
 * as `ensureAuthorWebsites()` / `ensureNewsSchema()`. The article is resolved by
 * slug (stable across envs), so the seed is a no-op where the article is absent
 * (e.g. dev) or already has a cover.
 */
import type { Env } from '../types';
import { SEED_COVERS } from './articleCoverData';
import { bindingKey } from '../util/schemaBootstrap';

const READY = new WeakMap<object, boolean>();

/**
 * D4574 H3: one seed cover's bytes from the assets binding, or null. A missing
 * file answers the SPA shell (`not_found_handling`), so only a JPEG answer
 * with JPEG bytes counts: anything else is never written to R2 as a cover.
 */
export async function seedCoverBytes(env: Env, asset: string): Promise<Uint8Array | null> {
  if (!env.ASSETS) return null;
  // A URL string, not a Request built from the caller's: this reads one static
  // file and forwards nothing (the auth inventory reads `fetch(new Request` as a relay).
  const res = await env.ASSETS.fetch(`https://assets.local${asset}`);
  if (!res.ok || !String(res.headers.get('content-type') || '').startsWith('image/jpeg')) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? bytes : null;
}

/**
 * @returns `true` only when this call actually wrote at least one cover (R2
 * put + DB update). Callers use that to bypass a stale edge-cache lookup on
 * the seeding request so the fresh, cover-bearing response is recomputed and
 * re-cached, overwriting any pre-cover entry in the local colo. Returns
 * `false` when every seed article already has a cover, is absent, R2 is
 * unbound, or on error.
 */
export async function ensureArticleCovers(env: Env): Promise<boolean> {
  if (READY.get(bindingKey(env))) return false;
  // Without an R2 binding we can't seed — leave `_ready` false so a later
  // request (once FILES is bound) retries instead of permanently skipping.
  if (!env.FILES) return false;
  let wroteAny = false;
  // D4574 H3: a cover whose file could not be read is retried on a later request.
  let missed = false;
  try {
    for (const seed of SEED_COVERS) {
      const row: any = await env.DB.prepare(
        `SELECT id, cover_r2_key FROM articles WHERE slug = ? AND status = 'published' LIMIT 1`,
      ).bind(seed.slug).first();
      if (!row) continue;              // article absent (e.g. dev)
      if (row.cover_r2_key) continue;  // already has a cover

      const bytes = await seedCoverBytes(env, seed.asset);
      if (!bytes) { missed = true; continue; }
      const key = `articles/${row.id}/cover-seed.jpg`;
      await env.FILES.put(key, bytes, {
        httpMetadata: { contentType: seed.mime },
      });
      // `cover_r2_key IS NULL` guard avoids clobbering a cover set by a
      // racing upload between the SELECT above and this UPDATE.
      const upd = await env.DB.prepare(
        `UPDATE articles SET cover_r2_key = ?, cover_mime = ?, updated_at = ?
          WHERE id = ? AND cover_r2_key IS NULL`,
      ).bind(key, seed.mime, new Date().toISOString(), row.id).run();
      if ((upd.meta?.changes ?? 0) > 0) wroteAny = true;
    }
    if (!missed) READY.set(bindingKey(env), true);
    return wroteAny;
  } catch (e) {
    console.warn('[articleCovers] ensure failed:', (e as Error).message);
    return wroteAny;
  }
}
