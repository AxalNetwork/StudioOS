/**
 * Task #20 — View counts must survive edge-cache hits.
 *
 * GET /api/articles/:slug serves a 60-day edge-cached body. An architect
 * review caught a bug where the per-read view increment was placed AFTER the
 * cache lookup + early return, so warm-cache reads (the common case) silently
 * skipped counting. The fix moves the increment ahead of the cache return and
 * runs it via `waitUntil` keyed on the slug (no blocking DB read).
 *
 * This test pins that ordering: it drives the real Hono articles app twice for
 * the same slug — a cold (cache-miss) read then a warm (cache-hit) read — and
 * asserts the view counter advances on BOTH, i.e. once per request regardless
 * of cache state. If someone reorders the increment back behind the cache
 * return, the warm-read assertion fails.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/articles_view_count.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import articles from '../src/routes/articles.ts';

const SLUG = 'why-this-matters';

// Minimal published article row returned by the slug SELECT (cache-miss path).
function articleRow(views: number) {
  return {
    id: 1,
    slug: SLUG,
    title: 'Why this matters',
    subtitle: null,
    excerpt: null,
    seo_title: null,
    canonical_url: null,
    sector: 'AI',
    tags: null,
    cover_r2_key: null,
    published_at: '2026-01-01T00:00:00Z',
    word_count: 100,
    read_minutes: 1,
    views,
    body_markdown: 'Hello world.',
    body_html: '<p>Hello world.</p>',
    status: 'published',
    author_name: 'Jane',
    author_role: 'partner',
    author_website: null,
    author_user_id: 7,
  };
}

/**
 * In-memory D1 stub. Tracks a per-slug view counter so the actual
 * `UPDATE articles SET views = views + 1 WHERE slug = ? AND status='published'`
 * is observable. Everything the read path touches (schema ensures, the slug
 * SELECT, the best-effort body_html refresh) is handled; unknown statements
 * are inert. `published` gates the increment exactly like the real WHERE.
 */
function makeDb(state: { views: Record<string, number>; published: boolean }) {
  const prepare = (sql: string) => {
    const s = sql.toLowerCase();
    let binds: any[] = [];
    const api: any = {
      bind: (...a: any[]) => { binds = a; return api; },
      async all() { return { results: [] }; },
      async first() {
        // The reader's article SELECT (cache-miss path only).
        if (s.includes('from articles a') && s.includes('a.slug = ?')) {
          const slug = binds[0];
          if (slug === SLUG && state.published) return articleRow(state.views[slug] ?? 0);
          return null;
        }
        // ensureArticleCovers seed probe — no article to seed in the stub.
        return null;
      },
      async run() {
        if (s.includes('update articles set views = views + 1')) {
          const slug = binds[0];
          // Mirror the WHERE: only published rows count.
          if (state.published) state.views[slug] = (state.views[slug] ?? 0) + 1;
          return { meta: { changes: state.published ? 1 : 0 } };
        }
        return { meta: { changes: 0 } };
      },
    };
    return api;
  };
  return {
    async exec() { return { count: 0, duration: 0 }; },
    prepare,
    async batch(stmts: any[]) { return (stmts || []).map(() => ({ results: [] })); },
  };
}

// A fresh process-local edge cache keyed by request URL, swapped onto the
// global `caches.default` the route reads. Returns a clone on every match so a
// cached body can be re-served without being consumed.
function installCache() {
  const store = new Map<string, Response>();
  (globalThis as any).caches = {
    default: {
      async match(req: Request) {
        const r = store.get(req.url);
        return r ? r.clone() : undefined;
      },
      async put(req: Request, res: Response) {
        store.set(req.url, res.clone());
      },
    },
  };
  return store;
}

// Drive one GET /:slug and await any waitUntil work (the view increment) so
// the counter is settled before we assert.
async function readArticle(env: any): Promise<Response> {
  const pending: Promise<any>[] = [];
  const ctx = { waitUntil: (p: Promise<any>) => { pending.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException() {} };
  const res = await articles.request(`/${SLUG}`, {}, env, ctx as any);
  await Promise.all(pending);
  return res;
}

test('view count increments on a cold read AND on a warm cache-hit read', async () => {
  const cache = installCache();
  const state = { views: { [SLUG]: 0 }, published: true };
  const env: any = { JWT_SECRET: 'x'.repeat(40), ENVIRONMENT: 'development', DB: makeDb(state) };

  // 1) Cold read: cache miss -> computes, caches, and counts the view.
  const first = await readArticle(env);
  assert.equal(first.status, 200);
  assert.equal(state.views[SLUG], 1, 'cold read should count one view');
  assert.ok(cache.size >= 1, 'cold read should populate the edge cache');

  // 2) Warm read: served from cache. The increment lives BEFORE the cache
  //    return, so it must still count — this is the regression guard.
  const second = await readArticle(env);
  assert.equal(second.status, 200);
  assert.equal(state.views[SLUG], 2, 'warm cache-hit read must still count a view');

  // A third warm read keeps counting, proving every request increments.
  await readArticle(env);
  assert.equal(state.views[SLUG], 3, 'each cache-hit read counts one more view');
});

test('the warm read is genuinely a cache hit (body served without a fresh DB SELECT)', async () => {
  installCache();
  const state = { views: { [SLUG]: 0 }, published: true };
  const env: any = { JWT_SECRET: 'x'.repeat(40), ENVIRONMENT: 'development', DB: makeDb(state) };

  await readArticle(env);
  // Flip the backing row to unpublished AFTER it's cached. A cache hit serves
  // the stored 200 body; only the increment (gated on status='published')
  // changes behaviour. This proves the second read came from cache, not a new
  // SELECT (which would now 404), while the increment correctly stops counting.
  state.published = false;
  const warm = await readArticle(env);
  assert.equal(warm.status, 200, 'warm read is served from the edge cache, not re-queried');
  assert.equal(state.views[SLUG], 1, 'increment respects status=published (no count once unpublished)');
});
