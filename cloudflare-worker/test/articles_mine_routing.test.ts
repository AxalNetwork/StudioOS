/**
 * Task #1 — `GET /api/articles/mine` must not be shadowed by `/:slug`.
 *
 * Hono runs every matching handler in registration order. The `/:slug`
 * catch-all is registered BEFORE `/mine` (and `/draft/:id`, `/trust/me`, …),
 * so its reserved-word branch used to `return c.json({error:'not_found'},404)`
 * for the literal path `mine`, silently shadowing the real handler. The
 * authoring list then always rendered "No articles yet".
 *
 * The fix makes that branch `return next()` so the specific handler runs
 * regardless of registration order. This test drives the real Hono articles
 * app at `/mine` with a valid author token and asserts it returns that
 * author's rows — i.e. the request reached the `/mine` handler, not the
 * `/:slug` 404 guard. Reintroduce the early 404 and this fails.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/articles_mine_routing.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import articles from '../src/routes/articles.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // >= 32 bytes
const AUTHOR_ID = 7;

async function mintToken(userId: number, role: string): Promise<string> {
  // No `jti` so getCurrentUser skips the user_sessions revocation lookup.
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

function authorRow(overrides: Record<string, any> = {}) {
  return {
    id: 101,
    slug: 'my-first-draft',
    title: 'My first draft',
    subtitle: null,
    excerpt: null,
    seo_title: null,
    canonical_url: null,
    body_markdown: 'Hello.',
    sector: 'AI',
    tags: null,
    status: 'draft',
    cover_r2_key: null,
    submitted_at: null,
    reviewed_at: null,
    approved_at: null,
    published_at: null,
    rejected_at: null,
    rejection_reason: null,
    word_count: 1,
    read_minutes: 1,
    views: 0,
    author_user_id: AUTHOR_ID,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

/**
 * Minimal D1 stub. `getCurrentUser` reads the user via `.all()`
 * (`SELECT * FROM users WHERE id = ?`) and probes mi_pro_subscriptions via
 * `.first()`. The `/mine` handler reads the author's articles via `.all()`
 * (`SELECT * FROM articles WHERE author_user_id = ? ...`). Everything else is
 * inert so schema-ensure DDL and side lookups don't blow up.
 */
function makeDb(user: any, mine: any[]) {
  const prepare = (sql: string) => {
    const s = sql.toLowerCase();
    const api: any = {
      bind: () => api,
      async all() {
        if (s.includes('from users where id')) return { results: user ? [user] : [] };
        if (s.includes('from articles where author_user_id')) return { results: mine };
        return { results: [] };
      },
      async first() { return null; },
      async run() { return { meta: { changes: 0 } }; },
    };
    return api;
  };
  return {
    async exec() { return { count: 0, duration: 0 }; },
    prepare,
    async batch(stmts: any[]) { return (stmts || []).map(() => ({ results: [] })); },
  };
}

function req(env: any, token: string, path: string): Promise<Response> {
  return articles.request(path, { headers: { Authorization: `Bearer ${token}` } }, env);
}

test('GET /mine reaches the author handler and returns the caller\'s articles', async () => {
  const user = { id: AUTHOR_ID, role: 'partner', is_active: 1, name: 'Jane' };
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeDb(user, [authorRow()]) };
  const token = await mintToken(AUTHOR_ID, 'partner');

  const res = await req(env, token, '/mine');
  assert.equal(res.status, 200, '/mine must not be shadowed by the /:slug 404 guard');
  const body: any = await res.json();
  assert.ok(Array.isArray(body.items), 'response shape is { items: [...] }');
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].slug, 'my-first-draft');
  assert.equal(body.items[0].status, 'draft', 'drafts must appear in the authoring list');
});

test('GET /mine with an empty table returns an empty list (not a 404)', async () => {
  const user = { id: AUTHOR_ID, role: 'partner', is_active: 1, name: 'Jane' };
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeDb(user, []) };
  const token = await mintToken(AUTHOR_ID, 'partner');

  const res = await req(env, token, '/mine');
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.deepEqual(body.items, []);
});
