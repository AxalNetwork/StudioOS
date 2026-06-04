/**
 * Seed canonical article cover images into R2.
 *
 * Articles are created at runtime (no SQL seed), and covers are R2-backed
 * (bytes in R2, `cover_r2_key` in D1, served via `/api/articles/cover/:id`).
 * `/api/*` is the only path routed to the Worker on BOTH `app.axal.vc` and the
 * `axal.vc` apex, so the cover MUST be served through the R2 endpoint rather
 * than a static `/article-covers/*` asset (which 404s on the apex).
 *
 * To attach a cover with no manual prod step, the compressed JPEG is embedded
 * as base64 (see `articleCoverData.ts`) and seeded into R2 on the first article
 * read where the target article still has no cover — same lazy self-heal pattern
 * as `ensureAuthorWebsites()` / `ensureNewsSchema()`. The article is resolved by
 * slug (stable across envs), so the seed is a no-op where the article is absent
 * (e.g. dev) or already has a cover.
 */
import type { Env } from '../types';
import { SEED_COVER_SLUG, SEED_COVER_MIME, SEED_COVER_B64 } from './articleCoverData';

let _ready = false;

function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * @returns `true` only when this call actually wrote the cover (R2 put + DB
 * update). Callers use that to bypass a stale edge-cache lookup on the seeding
 * request so the fresh, cover-bearing response is recomputed and re-cached,
 * overwriting any pre-cover entry in the local colo. Returns `false` when the
 * cover already exists, the article is absent, R2 is unbound, or on error.
 */
export async function ensureArticleCovers(env: Env): Promise<boolean> {
  if (_ready) return false;
  // Without an R2 binding we can't seed — leave `_ready` false so a later
  // request (once FILES is bound) retries instead of permanently skipping.
  if (!env.FILES) return false;
  try {
    const row: any = await env.DB.prepare(
      `SELECT id, cover_r2_key FROM articles WHERE slug = ? AND status = 'published' LIMIT 1`,
    ).bind(SEED_COVER_SLUG).first();
    if (!row) { _ready = true; return false; }       // article absent (e.g. dev)
    if (row.cover_r2_key) { _ready = true; return false; } // already has a cover

    const key = `articles/${row.id}/cover-seed.jpg`;
    await env.FILES.put(key, bytesFromBase64(SEED_COVER_B64), {
      httpMetadata: { contentType: SEED_COVER_MIME },
    });
    // `cover_r2_key IS NULL` guard avoids clobbering a cover set by a racing
    // upload between the SELECT above and this UPDATE.
    const upd = await env.DB.prepare(
      `UPDATE articles SET cover_r2_key = ?, cover_mime = ?, updated_at = ?
        WHERE id = ? AND cover_r2_key IS NULL`,
    ).bind(key, SEED_COVER_MIME, new Date().toISOString(), row.id).run();
    _ready = true;
    return (upd.meta?.changes ?? 0) > 0;
  } catch (e) {
    console.warn('[articleCovers] ensure failed:', (e as Error).message);
    return false;
  }
}
