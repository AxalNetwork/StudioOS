/**
 * D583 (#1210; S1's 1A, 2A, 3A for the owner) — the Brand page's voice tags,
 * dark logo and Archived status, on real SQLite: the baseline's landing_pages
 * with migration 399 applied, and the real brand router.
 *
 * What is pinned:
 *   - voice: up to three tags, trimmed and deduplicated; more, an over-long tag
 *     or a non-list is refused before anything is written; a write that does
 *     not name them leaves them alone, and null clears them;
 *   - the dark logo is stored through the same URL and SVG sanitizers, and a
 *     dark template renders it;
 *   - archive unpublishes and hides a page, kept and restorable; an archived
 *     page is never served publicly and cannot be published until restored;
 *   - another founder's project is refused.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/brand_voice_logo_archive_d583.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import brand from '../src/routes/brand.ts';
import { DARK_TEMPLATES, renderLandingTemplate, TEMPLATE_KEYS } from '../src/services/landingTemplates.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const OWNER = 10, OTHER = 20;
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIG399 = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/399_landing_brand_voice_dark_logo_archive.sql'), 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'landing_pages']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(MIG399);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(OWNER, 'founder', 'Fay Owner', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  db.exec("INSERT INTO projects (id, name, founder_id) VALUES (1, 'Acme', 1001), (2, 'Beta', 1002)");
  return db;
}

const app = new Hono<any>();
app.route('/brand', brand);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: any, who: number | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who) {
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const put = (db: any, who: number, pid: number, body: Record<string, unknown>) => call(db, who, 'PUT', `/brand/landing/by-project/${pid}`, { name: 'Acme', ...body });
const voiceOf = (db: any, id = 1) => (db.prepare('SELECT voice_json FROM landing_pages WHERE id = ?').get(id) as any)?.voice_json ?? null;

test('voice: up to three tags, trimmed and deduplicated, and served back', async () => {
  const db = fixture();
  const r = await put(db, OWNER, 1, { voice_tags: ['Plainspoken', '  bold  ', 'plainspoken', 'Warm   and  direct', ''] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.voice_tags, ['Plainspoken', 'bold', 'Warm and direct']);
  assert.equal(voiceOf(db), JSON.stringify(['Plainspoken', 'bold', 'Warm and direct']));
  const g = await call(db, OWNER, 'GET', '/brand/landing/by-project/1');
  assert.deepEqual(g.body.voice_tags, ['Plainspoken', 'bold', 'Warm and direct']);
});

test('voice: a fourth tag, an over-long tag or a non-list is refused, and nothing is written', async () => {
  const db = fixture();
  await put(db, OWNER, 1, { voice_tags: ['Calm'], tagline: 'first' });
  for (const [voice, error] of [
    [['a', 'b', 'c', 'd'], 'at most 3 voice tags'],
    [['x'.repeat(33)], 'a voice tag is at most 32 characters'],
    ['Calm, bold', 'voice_tags must be a list'],
    [[7], 'voice_tags must be text'],
  ] as const) {
    const r = await put(db, OWNER, 1, { voice_tags: voice, tagline: 'second' });
    assert.equal(r.status, 400, JSON.stringify(voice));
    assert.deepEqual(r.body, { error }, JSON.stringify(voice));
  }
  assert.equal(voiceOf(db), JSON.stringify(['Calm']));
  assert.equal((db.prepare('SELECT tagline FROM landing_pages WHERE id = 1').get() as any).tagline, 'first', 'a refused write half-saved the page');
  assert.equal((await put(db, OWNER, 1, { voice_tags: ['a', 'b', 'c', 'A'] })).status, 200, 'a duplicate does not count toward three');
});

test('voice: a write that does not name it leaves it; null or an empty list clears it', async () => {
  const db = fixture();
  await put(db, OWNER, 1, { voice_tags: ['Calm'] });
  await put(db, OWNER, 1, { tagline: 'no voice in this body' });
  assert.equal(voiceOf(db), JSON.stringify(['Calm']));
  await put(db, OWNER, 1, { voice_tags: null });
  assert.equal(voiceOf(db), null);
  await put(db, OWNER, 1, { voice_tags: ['Calm'] });
  await put(db, OWNER, 1, { voice_tags: [] });
  assert.equal(voiceOf(db), null);
});

test('the dark logo is stored through the same sanitizers as the light one', async () => {
  const db = fixture();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="4" onload="x()"/></svg>';
  const r = await put(db, OWNER, 1, { logo_dark_svg: svg, logo_dark_url: 'javascript:alert(1)', logo_dark_asset_id: 'brand-logos/10/x.png' });
  assert.equal(r.status, 200);
  const row = db.prepare('SELECT logo_dark_url, logo_dark_svg, logo_dark_asset_id FROM landing_pages WHERE id = 1').get() as any;
  assert.equal(row.logo_dark_url, null, 'a javascript: URL was stored');
  assert.doesNotMatch(row.logo_dark_svg, /<script|onload/i, 'the dark SVG skipped the sanitizer');
  assert.equal(row.logo_dark_asset_id, 'brand-logos/10/x.png');
  await put(db, OWNER, 1, { logo_dark_url: 'https://cdn.example.test/dark.png' });
  const g = await call(db, OWNER, 'GET', '/brand/landing/by-project/1');
  assert.equal(g.body.logo_dark_url, 'https://cdn.example.test/dark.png');
  await put(db, OWNER, 1, { tagline: 'untouched' });
  assert.equal((db.prepare('SELECT logo_dark_url FROM landing_pages WHERE id = 1').get() as any).logo_dark_url, 'https://cdn.example.test/dark.png');
});

test('another founder\'s project is refused and nothing is stored', async () => {
  const db = fixture();
  const r = await put(db, OTHER, 1, { voice_tags: ['Mine'] });
  assert.equal(r.status, 403);
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM landing_pages').get() as any).n), 0);
});

test('archive unpublishes and hides a page, keeps it, refuses publishing, and restore brings it back as a draft', async () => {
  const db = fixture();
  await put(db, OWNER, 1, {});
  const second = await call(db, OWNER, 'POST', '/brand/landing/by-project/1/pages', { name: 'Investors', page_slug: 'investors' });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  const id = second.body.id;
  assert.equal((await call(db, OWNER, 'POST', `/brand/landing/pages/${id}/publish`, { published: true })).status, 200);
  const slug = second.body.slug;
  assert.equal((await call(db, null, 'GET', `/brand/landing/${slug}`)).status, 200);

  assert.equal((await call(db, OTHER, 'POST', `/brand/landing/pages/${id}/archive`, { archived: true })).status, 403);
  const a = await call(db, OWNER, 'POST', `/brand/landing/pages/${id}/archive`, { archived: true });
  assert.deepEqual(a.body, { ok: true, archived: true, published: false });
  const row = db.prepare('SELECT published, archived_at FROM landing_pages WHERE id = ?').get(id) as any;
  assert.equal(row.published, 0);
  assert.ok(row.archived_at);
  assert.equal((await call(db, null, 'GET', `/brand/landing/${slug}`)).status, 404, 'an archived page is still served');
  const list = await call(db, OWNER, 'GET', '/brand/landing/by-project/1/pages');
  assert.deepEqual(list.body.pages.map((p: any) => p.id), [1], 'an archived page is still in the list');
  const withArchived = await call(db, OWNER, 'GET', '/brand/landing/by-project/1/pages?archived=1');
  assert.deepEqual(withArchived.body.pages.map((p: any) => [p.id, !!p.archived_at]), [[1, false], [id, true]]);
  const pub = await call(db, OWNER, 'POST', `/brand/landing/pages/${id}/publish`, { published: true });
  assert.equal(pub.status, 409);
  assert.deepEqual(pub.body, { error: 'page_archived' });

  const r = await call(db, OWNER, 'POST', `/brand/landing/pages/${id}/archive`, { archived: false });
  assert.deepEqual(r.body, { ok: true, archived: false, published: false });
  const restored = db.prepare('SELECT published, archived_at FROM landing_pages WHERE id = ?').get(id) as any;
  assert.deepEqual({ ...restored }, { published: 0, archived_at: null });
  assert.equal((await call(db, OWNER, 'POST', `/brand/landing/pages/${id}/publish`, { published: true })).status, 200);
  assert.equal((await call(db, null, 'GET', `/brand/landing/${slug}`)).status, 200);
});

test('the primary page\'s publish refuses an archived page too', async () => {
  const db = fixture();
  await put(db, OWNER, 1, {});
  await call(db, OWNER, 'POST', '/brand/landing/pages/1/archive', { archived: true });
  const r = await call(db, OWNER, 'POST', '/brand/landing/by-project/1/publish', { published: true });
  assert.equal(r.status, 409);
  assert.equal((db.prepare('SELECT published FROM landing_pages WHERE id = 1').get() as any).published, 0);
});

test('no public route serves a row that is both published and archived', async () => {
  const db = fixture();
  await put(db, OWNER, 1, {});
  db.exec("UPDATE landing_pages SET published = 1, archived_at = datetime('now') WHERE id = 1");
  const slug = (db.prepare('SELECT slug FROM landing_pages WHERE id = 1').get() as any).slug;
  assert.equal((await call(db, null, 'GET', `/brand/landing/${slug}`)).status, 404);
  const site = (db.prepare('SELECT slug FROM brand_sites WHERE project_id = 1').get() as any).slug;
  assert.equal((await call(db, null, 'GET', `/brand/p/${site}/home`)).status, 404);
  const w = await call(db, null, 'POST', `/brand/landing/${slug}/waitlist`, { email: 'lead@example.test' });
  assert.equal(w.status, 404, 'an archived page still takes waitlist signups');
});

test('a dark template renders the dark logo; a light one keeps the light logo', () => {
  const row = { name: 'Acme', slug: 's', logo_url: 'https://cdn.example.test/light.png', logo_dark_url: 'https://cdn.example.test/dark.png' };
  const dark = renderLandingTemplate({ ...row, template: 'capital-ready-kit' });
  assert.match(dark, /dark\.png/);
  assert.doesNotMatch(dark, /light\.png/);
  const light = renderLandingTemplate({ ...row, template: 'minimal' });
  assert.match(light, /light\.png/);
  assert.doesNotMatch(light, /dark\.png/);
  const noDark = renderLandingTemplate({ ...row, logo_dark_url: null, template: 'capital-ready-kit' });
  assert.match(noDark, /light\.png/, 'with no dark logo the light one is used');
});

test('DARK_TEMPLATES is exactly the set of templates drawn on a dark ground', () => {
  const dark = (TEMPLATE_KEYS as readonly string[]).filter((k) => /color-scheme:\s*dark/.test(renderLandingTemplate({ name: 'A', slug: 's', template: k })));
  assert.deepEqual([...DARK_TEMPLATES].sort(), dark.sort());
});
