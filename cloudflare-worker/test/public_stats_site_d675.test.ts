/**
 * D675 (#1549) — `GET /api/public/stats` returns the figures the new public
 * site prints, each counted from D1.
 *
 * Pins:
 *   - users counts active accounts only, companies counts ventures not deleted;
 *   - members_verified counts exactly the rows `GET /partners` (the public
 *     directory) lists, because both read DIRECTORY_LISTED_WHERE;
 *   - one failing count returns 0 for that field and leaves the others intact;
 *   - the four Task #18 fields are unchanged.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/public_stats_site_d675.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from './_d1_sqlite.mjs';
import publicRoutes, { _resetPublicStatsCache, DIRECTORY_LISTED_WHERE } from '../src/routes/public.ts';

const SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, is_active INTEGER);
  CREATE TABLE projects (id INTEGER PRIMARY KEY, status TEXT, deleted_at TEXT);
  CREATE TABLE partners (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, company TEXT, specialization TEXT,
    referral_code TEXT, referrals_count INTEGER DEFAULT 0, status TEXT, directory_listed INTEGER DEFAULT 0,
    directory_featured INTEGER DEFAULT 0);
  CREATE TABLE vc_funds (id INTEGER PRIMARY KEY, status TEXT);
  CREATE TABLE score_snapshots (id INTEGER PRIMARY KEY, project_id INTEGER, is_sandbox INTEGER);
`;
const SEED = `
  INSERT INTO users (is_active) VALUES (1), (1), (1), (0);
  INSERT INTO projects (status, deleted_at) VALUES ('active', NULL), ('spinout', NULL), ('active', '2026-01-01');
  INSERT INTO partners (uid, name, status, directory_listed) VALUES
    ('p1', 'Listed A', 'active', 1), ('p2', 'Listed B', 'active', 1),
    ('p3', 'Unlisted', 'active', 0), ('p4', 'Inactive', 'pending', 1);
  INSERT INTO vc_funds (status) VALUES ('active'), ('closed');
  INSERT INTO score_snapshots (project_id, is_sandbox) VALUES (1, 0), (1, 0), (2, 1);
`;

async function stats(env: any) {
  _resetPublicStatsCache();
  const res = await publicRoutes.request('/stats', {}, env);
  assert.equal(res.status, 200);
  return res.json() as Promise<Record<string, number>>;
}

test('each figure counts what its definition says', async () => {
  const s = await stats(makeD1(SCHEMA, SEED));
  assert.equal(s.users, 3, 'active accounts only');
  assert.equal(s.companies, 2, 'ventures not deleted');
  assert.equal(s.members_verified, 2, 'active AND listed partners only');
  // Task #18's fields are unchanged.
  assert.equal(s.partners, 3);
  assert.equal(s.funds, 1);
  assert.equal(s.deals_scored, 1);
  assert.equal(s.spinouts, 1);
});

test('the directory figure agrees with the directory list', async () => {
  const env = makeD1(SCHEMA, SEED);
  const s = await stats(env);
  const res = await publicRoutes.request('/partners', {}, env);
  const list = await res.json() as { partners: unknown[] };
  assert.equal(s.members_verified, list.partners.length);
  assert.match(DIRECTORY_LISTED_WHERE, /status = 'active' AND directory_listed = 1/);
});

test('one failing count is 0 and the others survive', async () => {
  // No users table: that count fails, every other field is still counted.
  const schema = SCHEMA.replace('CREATE TABLE users (id INTEGER PRIMARY KEY, is_active INTEGER);', '');
  const seed = SEED.replace('INSERT INTO users (is_active) VALUES (1), (1), (1), (0);', '');
  const errors = console.error;
  console.error = () => {};
  try {
    const s = await stats(makeD1(schema, seed));
    assert.equal(s.users, 0);
    assert.equal(s.companies, 2);
    assert.equal(s.members_verified, 2);
  } finally {
    console.error = errors;
  }
});
