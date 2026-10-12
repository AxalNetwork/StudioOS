/**
 * Owner, 2026-10-12 — a published author is reachable at /authors/<name slug>
 * as well as /authors/<id>, and the photo honours the author's privacy choice.
 *
 * Runs `GET /api/public/authors/:key` on a real SQLite D1. Pins:
 *   - the slug rule: lower-cased, accents dropped, letters and digits only;
 *   - a clash goes to the lower user id, the other author gets `<slug>-<id>`;
 *   - the numeric id and the slug answer the same author, with `slug` set;
 *   - an unknown slug, or an author with nothing published, is 404;
 *   - a photo the author has hidden is not offered.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/public_author_slug.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from './_d1_sqlite.mjs';
import publicRoutes, { authorSlugBase, authorSlugs } from '../src/routes/public.ts';

const SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, display_name TEXT, headline TEXT, bio TEXT,
    socials TEXT, headshot_r2_key TEXT, city TEXT, country TEXT, role TEXT, privacy_prefs TEXT, is_active INTEGER);
  CREATE TABLE user_profile_ext (user_id INTEGER, experience TEXT);
  CREATE TABLE articles (id INTEGER PRIMARY KEY, slug TEXT, title TEXT, subtitle TEXT, sector TEXT, tags TEXT,
    cover_r2_key TEXT, published_at TEXT, word_count INTEGER, read_minutes INTEGER, author_user_id INTEGER,
    excerpt TEXT, status TEXT);
`;
const SEED = `
  INSERT INTO users (id, uid, name, role, headshot_r2_key, privacy_prefs, is_active) VALUES
    (1, 'u1', 'Guillaume Lauzier', 'admin', 'headshots/1.jpg', NULL, 1),
    (3, 'u3', 'Ana Li', 'founder', 'headshots/3.jpg', '{"public_profile":{"headshot":false}}', 1),
    (5, 'u5', 'Ana Li', 'investor', NULL, NULL, 1),
    (7, 'u7', 'Quiet Writer', 'founder', NULL, NULL, 1);
  INSERT INTO articles (id, slug, title, author_user_id, status, published_at) VALUES
    (10, 'a', 'A', 1, 'published', '2026-10-01'),
    (11, 'b', 'B', 3, 'published', '2026-10-02'),
    (12, 'c', 'C', 5, 'published', '2026-10-03'),
    (13, 'd', 'D', 7, 'draft', NULL);
`;

async function get(key: string) {
  const res = await publicRoutes.request(`/authors/${key}`, {}, makeD1(SCHEMA, SEED));
  return { status: res.status, body: await res.json() as any };
}

test('the slug is the name, lower-cased, without accents, letters and digits only', () => {
  assert.equal(authorSlugBase('Guillaume Lauzier'), 'guillaumelauzier');
  assert.equal(authorSlugBase('Élodie Côté-Roy'), 'elodiecoteroy');
  assert.equal(authorSlugBase(''), '');
});

test('two authors with one slug: the lower id keeps it', () => {
  const m = authorSlugs([{ id: 5, name: 'Ana Li' }, { id: 3, name: 'Ana Li' }]);
  assert.equal(m.get(3), 'anali');
  assert.equal(m.get(5), 'anali-5');
});

test('the id and the slug answer the same author, and the payload names the slug', async () => {
  const byId = await get('1');
  const bySlug = await get('guillaumelauzier');
  assert.equal(byId.status, 200);
  assert.equal(bySlug.status, 200);
  assert.equal(byId.body.author.slug, 'guillaumelauzier');
  assert.equal(bySlug.body.author.id, 1);
  assert.equal(bySlug.body.items.length, 1);
  assert.equal((await get('GuillaumeLauzier')).body.author.id, 1, 'the slug is matched case-blind');
  assert.equal((await get('anali-5')).body.author.id, 5);
});

test('an unknown slug, or an author with nothing published, is not found', async () => {
  assert.equal((await get('nobodyhere')).status, 404);
  assert.equal((await get('quietwriter')).status, 404);
  assert.equal((await get('7')).status, 404);
  assert.equal((await get('bad%20key!')).status, 400);
});

test('a photo the author hid is not offered; a public one is', async () => {
  assert.equal((await get('1')).body.author.headshot_url, '/api/settings/headshot/u1');
  assert.equal((await get('anali')).body.author.headshot_url, null);
});
